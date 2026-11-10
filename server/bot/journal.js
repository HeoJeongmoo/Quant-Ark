// 체결 기록 + 전략별 성과 집계 (데이터 로거)
//
//   data/journal/fills.jsonl    실제 체결 1건 = 1줄 (매수/매도, 부분체결 포함)
//   data/journal/trades.jsonl   진입~완전 청산까지 끝난 왕복 거래 1건 = 1줄 (전략, 손익, 청산 사유)
//   data/journal/signals.jsonl  S티어 신호와 그 처리 결과 (집행/차단/패스)
//   data/bot-positions.json     봇이 연 포지션의 메타 (전략, 진입 시각, 고점, 평단)
//
// stats()가 전략(A/B/C)별 승률·손익비·Profit Factor·기대값을 계산하고,
// kellyFeedback()이 이를 켈리 공식 입력값(관측 표본)으로 넘긴다.
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.env.JOURNAL_DIR || 'data/journal');
const POS_FILE = path.resolve(process.env.BOT_POSITIONS_FILE || 'data/bot-positions.json');
// 매매 수수료(한 방향, %). KIS 체결가에는 수수료가 빠져 있어 손익 계산 때 직접 뺀다
const FEE = Number(process.env.KIS_FEE_PCT || 0.25) / 100;
const IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q']; // S티어 + 후보 전략
const ensure = (f) => fs.mkdirSync(path.dirname(f), { recursive: true });
const FILES = { fills: path.join(DIR, 'fills.jsonl'), trades: path.join(DIR, 'trades.jsonl'), signals: path.join(DIR, 'signals.jsonl'), shadow: path.join(DIR, 'shadow.jsonl') };

function append(file, obj) {
  ensure(file);
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}
// 가상 기록을 백업 파일로 옮김 (초기화). 옮긴 파일 이름을 돌려줌
export function archiveShadow(tag = 'reset') {
  try {
    if (!fs.existsSync(FILES.shadow)) return null;
    const to = FILES.shadow.replace(/\.jsonl$/, `.${tag}-${new Date().toISOString().slice(0, 10)}.bak.jsonl`);
    fs.renameSync(FILES.shadow, to);
    return path.basename(to);
  } catch {
    return null;
  }
}
// 파일이 바뀌지 않았으면 이전에 읽은 결과를 재사용 (몇 달치가 쌓여도 5분마다 전체를 다시 파싱하지 않게)
const cache = {};
export function readLines(kind, { limit = 5000 } = {}) {
  try {
    const st = fs.statSync(FILES[kind]);
    let c = cache[kind];
    if (!c || c.size !== st.size || c.mtime !== st.mtimeMs) {
      const rows = [];
      for (const l of fs.readFileSync(FILES[kind], 'utf8').split('\n')) {
        if (!l.trim()) continue;
        try {
          rows.push(JSON.parse(l));
        } catch {
          /* 깨진 줄은 건너뜀 */
        }
      }
      c = cache[kind] = { size: st.size, mtime: st.mtimeMs, rows };
    }
    return Number.isFinite(limit) ? c.rows.slice(-limit) : c.rows.slice();
  } catch {
    return [];
  }
}

// ---------- 포지션 메타 ----------
let positions = null;
function loadPositions() {
  if (positions) return positions;
  try {
    positions = JSON.parse(fs.readFileSync(POS_FILE, 'utf8'));
  } catch {
    positions = {};
  }
  return positions;
}
function savePositions() {
  ensure(POS_FILE);
  fs.writeFileSync(POS_FILE, JSON.stringify(positions, null, 2));
}
export const getPositions = () => loadPositions();
export function updatePeak(symbol, price) {
  const p = loadPositions()[symbol];
  if (!p || !(price > 0)) return;
  if (!(p.peak >= price)) {
    p.peak = price;
    savePositions();
  }
}
export function markTrimmed(symbol) {
  const p = loadPositions()[symbol];
  if (p) {
    p.trimmed = true;
    savePositions();
  }
}

/**
 * 체결 기록. 매수면 포지션 메타를 만들거나 늘리고, 매도면 실현손익을 쌓아
 * 수량이 0이 되면 왕복 거래(trades.jsonl)를 확정한다.
 * @param {{env, side:'buy'|'sell', symbol, exchange, qty, price, orderNo, agent, strategies?:string[], reason?:string, at?:string}} f
 */
export function recordFill(f) {
  const at = f.at || new Date().toISOString();
  const fill = { at, ...f };
  append(FILES.fills, fill);
  const pos = loadPositions();
  const p = pos[f.symbol];
  if (f.side === 'buy') {
    if (!p) {
      pos[f.symbol] = { tradeId: `${f.symbol}-${Date.now()}`, env: f.env, symbol: f.symbol, exchange: f.exchange, strategies: f.strategies || [], openedAt: at, qty: f.qty, avg: f.price, cost: f.qty * f.price, peak: f.price, realized: 0, soldQty: 0, sellValue: 0, trimmed: false, ...(f.meta || {}) };
    } else {
      p.cost += f.qty * f.price;
      p.qty += f.qty;
      p.avg = p.cost / p.qty;
      p.strategies = [...new Set([...(p.strategies || []), ...(f.strategies || [])])];
    }
  } else if (p) {
    const q = Math.min(f.qty, p.qty);
    p.realized += (f.price - p.avg) * q;
    p.soldQty += q;
    p.sellValue += f.price * q;
    p.cost -= p.avg * q;
    p.qty -= q;
    p.lastExitReason = f.reason || p.lastExitReason;
    if (p.qty <= 0) closeTrade(p, at, f.reason);
  }
  savePositions();
  return fill;
}

function closeTrade(p, at, reason) {
  const entryValue = p.avg * p.soldQty; // 평단은 매도 중 변하지 않음
  const fees = (entryValue + p.sellValue) * FEE; // 매수·매도 수수료 추정
  const net = p.realized - fees;
  const trade = {
    tradeId: p.tradeId,
    env: p.env,
    symbol: p.symbol,
    strategies: p.strategies,
    openedAt: p.openedAt,
    closedAt: at,
    holdMin: Math.round((Date.parse(at) - Date.parse(p.openedAt)) / 60000),
    qty: p.soldQty,
    entryAvg: round(p.avg, 4),
    exitAvg: round(p.sellValue / (p.soldQty || 1), 4),
    pnlGross: round(p.realized, 2), // 수수료 전
    fees: round(fees, 2),
    pnl: round(net, 2), // 수수료 후 (통계는 이 값 기준)
    pnlPct: entryValue ? round((net / entryValue) * 100, 3) : 0,
    exitReason: reason || p.lastExitReason || '',
    track: p.track || (p.strategies?.length ? 'intraday' : ''),
    profile: p.profile || null,
    source: p.external ? 'external' : 'bot',
  };
  append(FILES.trades, trade);
  delete loadPositions()[p.symbol];
  return trade;
}

/**
 * 계좌와 메타 맞추기: 봇 밖(HTS 등)에서 판 종목은 마지막 시세로 닫고 외부 청산으로 표시,
 * 봇 밖에서 산 종목은 전략 없는 메타로 등록 (전략 통계에서 제외)
 */
export function reconcile(holdings, env, lastPrice = {}, busy = new Set()) {
  const pos = loadPositions();
  const held = new Map(holdings.map((h) => [h.symbol, h]));
  const closed = [];
  for (const sym of Object.keys(pos)) {
    const p = pos[sym];
    if ((p.env && p.env !== env) || busy.has(sym)) continue;
    if (!held.has(sym)) {
      const px = lastPrice[sym] || p.avg;
      p.realized += (px - p.avg) * p.qty;
      p.soldQty += p.qty;
      p.sellValue += px * p.qty;
      p.qty = 0;
      p.external = true;
      closed.push(closeTrade(p, new Date().toISOString(), '계좌에서 사라짐(외부 매도 추정, 마지막 시세로 기록)'));
    }
  }
  for (const h of holdings) {
    if (!pos[h.symbol]) {
      pos[h.symbol] = { tradeId: `${h.symbol}-ext-${Date.now()}`, env, symbol: h.symbol, exchange: h.quoteExchange, strategies: [], openedAt: new Date().toISOString(), qty: h.qty, avg: h.avgPrice, cost: h.qty * h.avgPrice, peak: h.price || h.avgPrice, realized: 0, soldQty: 0, sellValue: 0, external: true };
    } else if (pos[h.symbol].qty !== h.qty && !busy.has(h.symbol)) {
      // 수량·평단은 계좌가 정답 (부분 체결 누락, 외부 매매 보정)
      pos[h.symbol].qty = h.qty;
      pos[h.symbol].avg = h.avgPrice;
      pos[h.symbol].cost = h.qty * h.avgPrice;
    }
  }
  savePositions();
  return closed;
}

export function recordSignal(s) {
  append(FILES.signals, { at: new Date().toISOString(), ...s });
}

// ---------- 통계 ----------
const round = (x, d = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

export function summarize(trades) {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const sumW = wins.reduce((s, t) => s + t.pnl, 0);
  const sumL = -losses.reduce((s, t) => s + t.pnl, 0);
  const avgWinPct = wins.length ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLossPct = losses.length ? -losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
  const n = trades.length;
  const winRate = n ? wins.length / n : null;
  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: round(winRate, 4),
    avgWinPct: round(avgWinPct, 3),
    avgLossPct: round(avgLossPct, 3),
    payoff: avgLossPct > 0 ? round(avgWinPct / avgLossPct, 3) : null, // 손익비 = 평균 이익률 / 평균 손실률
    profitFactor: sumL > 0 ? round(sumW / sumL, 3) : sumW > 0 ? null : null, // 총이익 / 총손실
    expectancyPct: n ? round(trades.reduce((s, t) => s + t.pnlPct, 0) / n, 3) : null, // 거래당 평균 수익률
    netPnl: round(trades.reduce((s, t) => s + t.pnl, 0), 2),
  };
}

/** @param {{env?:string, since?:string}} f */
export function stats({ env, since } = {}) {
  const all = readLines('trades', { limit: Infinity }).filter((t) => (!env || t.env === env) && (!since || t.closedAt >= since));
  const bot = all.filter((t) => t.source !== 'external' && (t.strategies || []).length);
  const by = {};
  for (const id of IDS) by[id] = summarize(bot.filter((t) => t.strategies.includes(id)));
  by.multi = summarize(bot.filter((t) => new Set(t.strategies).size >= 2)); // 2개 이상 동시 신호
  const byTrack = { gap: summarize(bot.filter((t) => t.track === 'gap')), intraday: summarize(bot.filter((t) => t.track !== 'gap')) };
  const sh = shadowRows().filter((t) => (!env || !t.env || t.env === env) && (!since || t.closedAt >= since));
  const shadow = { overall: summarize(sh.filter((t) => t.kind !== 'candidate' || t.profile === 'P2')) };
  for (const id of IDS) shadow[id] = summarize(sh.filter((t) => (t.strategies || []).includes(id) && (t.kind !== 'candidate' || t.profile === 'P2')));
  // 실거래마다 같은 신호의 가상 거래를 찾아 붙인다 (같은 종목·전략, 진입 시각 15분 안, 청산 3종 중이면 실거래 청산 규칙과 같은 것 우선)
  const allSh = shadowRows();
  const match = (t) => {
    if (!(t.strategies || []).length) return null;
    const at = Date.parse(t.openedAt);
    const cands = allSh.filter((x) => x.symbol === t.symbol && (x.strategies || []).some((id) => t.strategies.includes(id)) && Math.abs(Date.parse(x.openedAt) - at) <= 15 * 60_000);
    const m = cands.find((x) => !x.profile || x.profile === (t.profile || 'P2')) || cands[0];
    return m ? { pnlPct: m.pnlPct, exit: m.exit, why: m.why, profile: m.profile || null } : null;
  };
  const recent = all.slice(-50).reverse().map((t) => ({ ...t, shadow: match(t) }));
  const paired = recent.filter((t) => t.shadow && Number.isFinite(t.shadow.pnlPct) && t.source !== 'external');
  const gap = paired.length ? round(paired.reduce((x, t) => x + (t.pnlPct - t.shadow.pnlPct), 0) / paired.length, 3) : null;
  return { env: env || 'all', since: since || null, overall: summarize(bot), external: summarize(all.filter((t) => t.source === 'external')), byStrategy: by, byTrack, shadow, recent, realVsShadow: { pairs: paired.length, avgGapPct: gap } };
}

/**
 * 켈리 입력값 피드백: 실제 왕복 거래로 본 전략별 승수·평균 이익/손실(비율)
 * sTier.sizePosition({observed}) 형식 { A: {trades, wins, avgWin, avgLoss} }
 */
export function kellyFeedback(env) {
  const s = stats({ env }).byStrategy;
  const out = {};
  for (const [id, x] of Object.entries(s)) {
    if (!x.trades || !IDS.includes(id)) continue;
    out[id] = { trades: x.trades, wins: x.wins, avgWin: (x.avgWinPct || 0) / 100, avgLoss: (x.avgLossPct || 0) / 100 };
  }
  return out;
}

// ---------- 가상 거래 (그림자) ----------
// 매수 신호가 날 때마다 "규칙대로 샀다면"을 5분봉으로 끝까지 따라가 결과를 남긴다 (주문 여부와 무관).
// 실제 돈 없이 전략 성과를 계속 재는 용도: 꺼진 전략을 다시 켤지 판단할 때 쓴다. 켈리에는 섞지 않는다.
export function recordShadow(x) {
  append(FILES.shadow, { ...x, pnl: x.pnlPct, closedAt: x.closedAt || new Date().toISOString() });
}
// 미체결로 버린 가상 거래(kind: missed)는 성적 계산에서 뺀다
const counted = (t) => !t.skipped && Number.isFinite(t.pnlPct);
// 보수적 체결 가정 이전(완벽 체결 가정)에 기록된 가상 거래는 실제와의 차이만큼 깎아서 센다
const LEGACY_HAIRCUT = Number(process.env.SHADOW_LEGACY_HAIRCUT_PCT || 0.3);
// 같은 종목·전략·청산 방식은 뉴욕 기준 하루 1건만 센다 (재시작 등으로 중복 기록된 것 제거)
const NY_YMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const shadowYmd = (t) => {
  const ms = Number.isFinite(t.barT) ? t.barT : Date.parse(t.openedAt || t.closedAt || '');
  return Number.isFinite(ms) ? NY_YMD.format(new Date(ms)) : '';
};
export const shadowDayKey = (t) => {
  const ymd = shadowYmd(t);
  return `${t.env || ''}|${ymd}|${t.symbol}|${(t.strategies || []).join('')}|${t.profile || ''}`;
};
export function dedupeShadows(rows) {
  const seen = new Set();
  return rows.filter((t) => {
    const k = shadowDayKey(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// 가상 캘린더: 날짜(뉴욕) → 전략·청산별 {n, sum, wins}
export function shadowCalendar(env, month) {
  const days = {};
  for (const t of shadowRows()) {
    if (t.env && env && t.env !== env) continue;
    const ymd = shadowYmd(t);
    if (!ymd.startsWith(month)) continue;
    const k = `${(t.strategies || []).join('+')}${t.profile ? `·${t.profile}` : ''}`;
    const d = (days[ymd] ||= {});
    const x = (d[k] ||= { n: 0, sum: 0, wins: 0 });
    x.n++;
    x.sum = Math.round((x.sum + t.pnlPct) * 1000) / 1000;
    if (t.pnlPct > 0) x.wins++;
  }
  return { month, days };
}

export function shadowRows() {
  return dedupeShadows(readLines('shadow', { limit: Infinity }).filter(counted))
    .map((t) => (t.model === 'conservative' ? t : { ...t, pnlPct: t.pnlPct - LEGACY_HAIRCUT, pnl: (t.pnl ?? t.pnlPct) - LEGACY_HAIRCUT, legacy: true }));
}

/**
 * Holly식 전략 자동 선택: 전략별 최근 실거래로 끄고, 꺼진 뒤의 가상 거래로 다시 켠다.
 * @returns {{[id]: {status:'on'|'off', mode, reason, real, shadow, shadowSinceOff}}}
 */
export function strategyHealth(env, { modes = {}, minTrades = 30, window = 40, minShadow = 15 } = {}) {
  const bot = readLines('trades', { limit: Infinity }).filter((t) => t.env === env && t.source !== 'external' && (t.strategies || []).length);
  const sh = shadowRows().filter((t) => !t.env || t.env === env);
  const out = {};
  for (const id of IDS) {
    const realAll = bot.filter((t) => t.strategies.includes(id));
    const real = summarize(realAll.slice(-window));
    // A~D는 S티어 가상 거래, E~I(후보)는 후보 전략 가상 거래(청산 규칙 3종 모두)
    const shadowAll = sh.filter((t) => (t.strategies || []).includes(id) && (t.kind !== 'candidate' || t.profile === 'P2')); // 청산 3종 중 기본(P2)만 세어 중복 방지
    const shadow = summarize(shadowAll.slice(-window));
    const mode = modes[id] || 'auto';
    let status = 'on';
    let reason = '';
    let shadowSinceOff = null;
    if (mode === 'off') {
      status = 'off';
      reason = '사용자가 끔';
    } else if (mode === 'on') reason = '사용자가 켬 (자동 판단 무시)';
    else if (real.trades >= minTrades && real.expectancyPct < 0 && (real.profitFactor ?? 0) < 1) {
      // 실거래가 나빠서 꺼야 할 상태. 마지막 실거래 이후 가상 거래가 좋아졌으면 다시 켠다
      const lastReal = realAll[realAll.length - 1]?.closedAt || '';
      const after = shadowAll.filter((t) => t.closedAt > lastReal);
      shadowSinceOff = summarize(after.slice(-window));
      if (shadowSinceOff.trades >= minShadow && shadowSinceOff.expectancyPct > 0 && (shadowSinceOff.profitFactor ?? 0) >= 1.1) {
        reason = `실거래 최근 ${real.trades}건 기대값 ${real.expectancyPct}%였지만 이후 가상 ${shadowSinceOff.trades}건 기대값 +${shadowSinceOff.expectancyPct}%로 회복 → 다시 켬`;
      } else {
        status = 'off';
        reason = `실거래 최근 ${real.trades}건 기대값 ${real.expectancyPct}%, PF ${real.profitFactor ?? '-'} → 자동으로 끔 (가상 거래 ${shadowSinceOff.trades}/${minShadow}건 회복 확인 중)`;
      }
    } else reason = real.trades < minTrades ? `실거래 ${real.trades}/${minTrades}건 (판단 전, 켜 둠)` : `실거래 최근 ${real.trades}건 기대값 ${real.expectancyPct}%`;
    out[id] = { status, mode, reason, real, shadow, shadowSinceOff };
  }
  return out;
}
