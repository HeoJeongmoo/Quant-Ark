import { CANDIDATES } from './candidates.js';
// S티어 매수 트리거 (OR 조건) + 켈리 공식 포지션 사이징
// 순수 함수만 두어 브라우저(에이전트 파이프라인)와 Node 서버(/api/kis/signals) 양쪽에서 같은 판정을 쓴다.
//
// 캔들 형식: { o, h, l, c, v, time? }  (time: "YYYY-MM-DD HH:MM" 뉴욕 현지, 마감된 봉만 넣을 것)

// ---------------------------------------------------------------------------
// 지표
// ---------------------------------------------------------------------------
export function sma(values, n) {
  if (values.length < n) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i];
  return s / n;
}

export function bollinger(closes, n = 20, k = 2) {
  const mid = sma(closes, n);
  if (mid == null) return null;
  let v = 0;
  for (let i = closes.length - n; i < closes.length; i++) v += (closes[i] - mid) ** 2;
  const sd = Math.sqrt(v / n);
  return { mid, upper: mid + k * sd, lower: mid - k * sd, sd };
}

// Wilder ATR
export function atr(candles, n = 14) {
  if (candles.length < n + 1) return null;
  const tr = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const pc = candles[i - 1].c;
    tr.push(Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc)));
  }
  let a = tr.slice(0, n).reduce((s, x) => s + x, 0) / n;
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
}

// Wilder RSI 시계열 (closes와 같은 길이, 앞부분은 null)
export function rsiSeries(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  g /= n;
  l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

const bullish = (c) => c.c > c.o;
const round = (v, d = 2) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

// ---------------------------------------------------------------------------
// 조건 A: 변동성 돌파 & 강한 모멘텀
//   마지막 마감 봉 거래량 ≥ 직전 봉의 200%(2배)  AND  종가가 볼린저 상단(20, 2σ) 또는 전봉 종가 + 1×ATR(14) 돌파  AND 양봉
// ---------------------------------------------------------------------------
export function checkA(candles, { volMult = 2, atrMult = 1 } = {}) {
  const n = candles.length;
  if (n < 21) return { id: 'A', fired: false, reason: '봉 부족(21개 필요)' };
  const last = candles[n - 1];
  const prev = candles[n - 2];
  const closes = candles.map((c) => c.c);
  const bb = bollinger(closes.slice(0, -1), 20, 2); // 돌파 기준선은 직전 봉까지로 계산
  const a = atr(candles.slice(0, -1), 14);
  const volRatio = prev.v > 0 ? last.v / prev.v : 0;
  const bbBreak = bb ? last.c > bb.upper : false;
  const atrBreak = a ? last.c > prev.c + atrMult * a : false;
  const fired = volRatio >= volMult && (bbBreak || atrBreak) && bullish(last);
  return {
    id: 'A',
    fired,
    metrics: { volRatio: round(volRatio), bbUpper: round(bb?.upper), atr: round(a, 3), close: last.c, bbBreak, atrBreak },
    detail: `거래량 ${round(volRatio, 1)}배${bbBreak ? ', 볼린저 상단 돌파' : ''}${atrBreak ? ', ATR 상단 돌파' : ''}`,
  };
}

// ---------------------------------------------------------------------------
// 조건 B: 과매도 평균 회귀
//   직전 3개 봉 중 RSI(14) ≤ 30 이 있었고, 마지막 마감 봉이 양봉 + 전봉보다 높은 종가 + RSI 반등
// ---------------------------------------------------------------------------
export function checkB(candles, { oversold = 30, lookback = 3 } = {}) {
  const n = candles.length;
  if (n < 16) return { id: 'B', fired: false, reason: '봉 부족(16개 필요)' };
  const closes = candles.map((c) => c.c);
  const r = rsiSeries(closes, 14);
  const last = candles[n - 1];
  const prev = candles[n - 2];
  const recent = r.slice(Math.max(0, n - 1 - lookback), n - 1).filter((x) => x != null);
  const minRsi = recent.length ? Math.min(...recent) : null;
  const fired = minRsi != null && minRsi <= oversold && bullish(last) && last.c > prev.c && r[n - 1] > r[n - 2];
  return {
    id: 'B',
    fired,
    metrics: { rsi: round(r[n - 1], 1), minRsi: round(minRsi, 1), bullish: bullish(last) },
    detail: `RSI ${round(minRsi, 1)}까지 과매도 후 ${round(r[n - 1], 1)}로 반등, 양봉 전환`,
  };
}

// ---------------------------------------------------------------------------
// 조건 C: 장 초반(09:30~10:00 ET) 지수 대비 강한 갭 상승 + 눌림목 반등
//   갭 ≥ +1%  AND  종목 갭 − 지수(QQQ) 갭 ≥ +0.5%p  AND  갭의 절반 이상 유지
//   AND 장중 고점 대비 0.5×ATR 이상 눌렸다가 마지막 봉 양봉 반등
// ctx: { nowMin, prevClose, dayOpen, indexGap, sessionBars }
// ---------------------------------------------------------------------------
export function checkC(candles, ctx = {}, { minGap = 0.01, minRel = 0.005 } = {}) {
  const { nowMin, prevClose, dayOpen, indexGap = 0 } = ctx;
  const inWindow = nowMin != null && nowMin >= 570 && nowMin < 600;
  if (!inWindow) return { id: 'C', fired: false, reason: '09:30~10:00 ET에만 판정' };
  if (!(prevClose > 0 && dayOpen > 0)) return { id: 'C', fired: false, reason: '전일 종가/당일 시가 없음' };
  const n = candles.length;
  const k = Math.max(1, Math.min(ctx.sessionBars || 0, n));
  const session = candles.slice(n - k);
  const last = candles[n - 1];
  const gap = dayOpen / prevClose - 1;
  const rel = gap - indexGap;
  const held = last.c >= prevClose * (1 + gap * 0.5);
  const dayHigh = Math.max(...session.map((c) => c.h));
  const a = atr(candles, 14) || dayHigh * 0.002;
  const lowAfterHigh = Math.min(...session.slice(session.findIndex((c) => c.h === dayHigh)).map((c) => c.l));
  const pulledBack = dayHigh - lowAfterHigh >= 0.5 * a;
  const fired = gap >= minGap && rel >= minRel && held && pulledBack && bullish(last);
  return {
    id: 'C',
    fired,
    metrics: { gap: round(gap * 100), indexGap: round(indexGap * 100), rel: round(rel * 100), held, pulledBack },
    detail: `갭 +${round(gap * 100)}% (지수 대비 ${rel >= 0 ? '+' : ''}${round(rel * 100)}%p), 눌림 후 반등`,
  };
}

export const STRATEGIES = {
  A: { id: 'A', name: '변동성 돌파', prior: { win: 0.45, payoff: 2.0 } },
  B: { id: 'B', name: '과매도 평균회귀', prior: { win: 0.56, payoff: 1.25 } },
  C: { id: 'C', name: '장 초반 갭 눌림목', prior: { win: 0.52, payoff: 1.6 } },
  D: { id: 'D', name: '갭 후보 시가 범위 돌파', prior: { win: 0.45, payoff: 1.6 } },
};
// 후보 전략(E~I)까지 포함한 전체 목록 (켈리 기본값·이름 조회용)
export const ALL_STRATEGIES = { ...STRATEGIES, ...CANDIDATES };

// ---------------------------------------------------------------------------
// 조건 D (트랙 1): 장전 갭 후보의 시가 범위 돌파 (Opening Range Breakout)
//   시가 범위 = 개장 후 첫 orbBars개 5분봉의 고가·저가
//   마지막 마감 봉 종가 > 시가 범위 고가  AND 양봉  AND 거래량 ≥ 시가 범위 평균의 volMult배
//   AND 종가가 고가 + maxChase% 이내 (너무 멀리 달아난 뒤 추격 금지)  AND 갭의 절반 이상 유지
// ctx: { sessionBars(오늘 정규장 봉 배열), prevClose, nowMin, orbBars, endMin }
// ---------------------------------------------------------------------------
export function checkD(ctx, { volMult = 1.2, maxChase = 0.03 } = {}) {
  const { session = [], prevClose, nowMin, orbBars = 3, endMin = 660 } = ctx;
  if (nowMin == null || nowMin < 570 + orbBars * 5) return { id: 'D', fired: false, reason: `시가 범위 형성 중 (개장 후 ${orbBars * 5}분)` };
  if (nowMin >= endMin) return { id: 'D', fired: false, reason: '진입 시간 종료' };
  if (session.length < orbBars + 1) return { id: 'D', fired: false, reason: '시가 범위 이후 봉 없음' };
  const or = session.slice(0, orbBars);
  const orHigh = Math.max(...or.map((c) => c.h));
  const orLow = Math.min(...or.map((c) => c.l));
  const orVol = or.reduce((s2, c) => s2 + (c.v || 0), 0) / or.length;
  const last = session[session.length - 1];
  const gap = prevClose > 0 ? session[0].o / prevClose - 1 : null;
  const held = gap == null || last.c >= prevClose * (1 + gap * 0.5);
  const broke = last.c > orHigh;
  const notChased = last.c <= orHigh * (1 + maxChase);
  const volOk = orVol > 0 ? last.v >= orVol * volMult : false;
  const fired = broke && bullish(last) && volOk && notChased && held;
  return {
    id: 'D',
    fired,
    orHigh: round(orHigh),
    orLow: round(orLow),
    metrics: { orHigh: round(orHigh), orLow: round(orLow), gap: gap == null ? null : round(gap * 100), volVsOr: orVol ? round(last.v / orVol, 1) : null, held, notChased },
    detail: `시가 범위 고가 $${round(orHigh)} 돌파 (거래량 ${orVol ? round(last.v / orVol, 1) : '-'}배, 갭 ${gap == null ? '-' : `+${round(gap * 100)}%`})`,
    reason: !broke ? `시가 범위 고가 $${round(orHigh)} 아래` : !notChased ? `고가 대비 ${round((last.c / orHigh - 1) * 100)}% 달아남 (추격 금지)` : !volOk ? '돌파 거래량 부족' : !held ? '갭 절반 이상 반납' : '음봉',
  };
}

/** OR 판정: A, B, C 중 하나라도 참이면 매수 시그널 */
export function evaluateSTier(candles, ctx = {}) {
  const results = [checkA(candles), checkB(candles), checkC(candles, ctx)];
  const hits = results.filter((r) => r.fired);
  return { fired: hits.length > 0, hits, results };
}

// ---------------------------------------------------------------------------
// 켈리 공식
//   f* = W − (1 − W) / R      W: 승률, R: 평균 이익 / 평균 손실
//   과거 봉에서 같은 조건이 떴던 자리의 결과(목표 +1.5ATR / 손절 −1ATR / 최대 6봉 보유)로 W, R을 추정하고,
//   표본이 적을 때 튀지 않게 전략별 기본값(prior)과 10건 가중으로 섞는다.
// ---------------------------------------------------------------------------
// tpPct/slPct(비율)를 주면 ATR 대신 고정 목표·손절, cost(왕복 비용 비율)는 거래마다 차감
export function backtestStats(candles, id, { hold = 6, tp = 1.5, sl = 1, tpPct = null, slPct = null, cost = 0 } = {}) {
  if (id !== 'A' && id !== 'B') return { trades: 0, wins: 0, avgWin: 0, avgLoss: 0 }; // 시각·당일 정보가 필요한 C·D·후보 전략은 기본값만 사용
  const check = id === 'A' ? checkA : checkB;
  const res = [];
  for (let i = 25; i < candles.length - 1; i++) {
    const hist = candles.slice(0, i + 1);
    if (!check(hist).fired) continue;
    const entry = candles[i].c;
    const a = atr(hist, 14) || entry * 0.003;
    const up = tpPct != null ? entry * tpPct : tp * a;
    const down = slPct != null ? entry * slPct : sl * a;
    let ret = null;
    for (let j = i + 1; j <= Math.min(i + hold, candles.length - 1); j++) {
      if (candles[j].l <= entry - down) {
        ret = -down;
        break;
      }
      if (candles[j].h >= entry + up) {
        ret = up;
        break;
      }
    }
    if (ret == null) ret = candles[Math.min(i + hold, candles.length - 1)].c - entry;
    res.push(ret / entry - cost);
    i += hold; // 겹치는 진입 제외
  }
  const wins = res.filter((x) => x > 0);
  const losses = res.filter((x) => x <= 0);
  return {
    trades: res.length,
    wins: wins.length,
    avgWin: wins.length ? wins.reduce((s, x) => s + x, 0) / wins.length : 0,
    avgLoss: losses.length ? -losses.reduce((s, x) => s + x, 0) / losses.length : 0,
  };
}

// prior: 전략 기본값. costAdj(왕복 비용/목표)를 주면 기본 손익비를 그만큼 깎아 수수료 후 값으로 본다
export function kelly(id, stats, { priorWeight = 10, payoffOverride = null } = {}) {
  const p0 = ALL_STRATEGIES[id].prior;
  const p = { win: p0.win, payoff: payoffOverride ?? p0.payoff };
  const n = stats?.trades || 0;
  const win = (stats.wins + p.win * priorWeight) / (n + priorWeight);
  const obsR = stats.avgLoss > 0 && stats.avgWin > 0 ? stats.avgWin / stats.avgLoss : null;
  const payoff = obsR ? (obsR * n + p.payoff * priorWeight) / (n + priorWeight) : p.payoff;
  const f = win - (1 - win) / payoff;
  return { id, win: round(win, 3), payoff: round(payoff, 2), f: round(f, 4), samples: n };
}

/**
 * 아브라함의 사이징
 * 포지션 사이즈 = (총 평가금액 × 켈리 비중) / 현재가
 *   켈리 비중 = min(f* × fraction, 종목당 한도 − 현재 비중)   (fraction 기본 0.5 = 하프 켈리)
 */
// 두 표본(봉 백테스트 + 실제 체결 기록)을 합친다. 실제 체결은 2배 가중
export function mergeStats(bt, obs, obsWeight = 2) {
  if (!obs || !obs.trades) return { ...bt, observed: 0 };
  const w = obsWeight;
  const btL = bt.trades - bt.wins;
  const obL = obs.trades - obs.wins;
  const wins = bt.wins + obs.wins * w;
  const losses = btL + obL * w;
  return {
    trades: bt.trades + obs.trades * w,
    wins,
    avgWin: wins ? (bt.avgWin * bt.wins + obs.avgWin * obs.wins * w) / wins : 0,
    avgLoss: losses ? (bt.avgLoss * btL + obs.avgLoss * obL * w) / losses : 0,
    observed: obs.trades,
  };
}

export function sizePosition({ hits, candles, totalEquity, price, currentWeight = 0, maxWeight = 0.15, fraction = 0.5, observed = {}, bt = {} }) {
  const ks = hits.map((h) => ({ ...kelly(h.id, mergeStats(backtestStats(candles, h.id, bt), observed[h.id]), bt.kellyOpts), observed: observed[h.id]?.trades || 0 }));
  const best = ks.reduce((a, b) => (b.f > a.f ? b : a), ks[0]);
  const raw = Math.max(0, best.f);
  const room = Math.max(0, maxWeight - currentWeight);
  const weight = Math.min(raw * fraction, room);
  const qty = price > 0 ? Math.floor((totalEquity * weight) / price) : 0;
  return {
    kellies: ks,
    best,
    fullKelly: round(raw, 4),
    fraction,
    weight: round(weight, 4),
    cappedBy: raw * fraction > room ? 'limit' : null,
    qty,
    notional: round(qty * price),
    reason: best.f <= 0 ? '켈리 값이 0 이하(기대값 음수)라 진입하지 않음' : qty < 1 ? '계산된 수량이 1주 미만' : null,
  };
}

// ---------------------------------------------------------------------------
// 실시세 캔들 보조: 마감된 봉만 남기기, 당일 정규장 시가/봉 개수, 뉴욕 현재 분
// ---------------------------------------------------------------------------
export function closedOnly(candles, nowMs = Date.now(), intervalMin = 5) {
  return candles.filter((c) => c.t == null || c.t + intervalMin * 60000 <= nowMs);
}

// candle.time "YYYY-MM-DD HH:MM"(뉴욕) 기준, 가장 최근 거래일의 09:30 이후 봉
export function sessionInfo(candles) {
  const timed = candles.filter((c) => c.time);
  if (!timed.length) return { dayOpen: null, sessionBars: 0, date: null };
  const date = timed[timed.length - 1].time.slice(0, 10);
  const session = timed.filter((c) => c.time.slice(0, 10) === date && c.time.slice(11) >= '09:30' && c.time.slice(11) < '16:00');
  return { dayOpen: session[0]?.o ?? null, sessionBars: session.length, date };
}

const NY_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' });
export function nyMinutes(nowMs = Date.now()) {
  const p = Object.fromEntries(NY_FMT.formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
  return (+p.hour % 24) * 60 + +p.minute;
}

// MACD(12,26,9) 히스토그램 마지막 값
export function macdHist(closes, f = 12, sl = 26, sig = 9) {
  if (closes.length < sl + sig) return null;
  const ema = (arr, n) => {
    const k = 2 / (n + 1);
    const out = [];
    let e = arr[0];
    for (const v of arr) out.push((e = v * k + e * (1 - k)));
    return out;
  };
  const ef = ema(closes, f);
  const es = ema(closes, sl);
  const line = closes.map((_, i) => ef[i] - es[i]);
  const signal = ema(line, sig);
  return line[line.length - 1] - signal[signal.length - 1];
}

// 보유 예정 시간(봉 수) 동안 기대할 수 있는 움직임 폭(%) ≈ 5분봉 ATR% × √봉수
export function expectedMovePct(candles, price, holdBars = 12) {
  const a = atr(candles, 14);
  if (!a || !(price > 0)) return null;
  return (a / price) * 100 * Math.sqrt(holdBars);
}
