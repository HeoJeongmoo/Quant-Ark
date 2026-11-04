// 후보 전략 (E~I): 처음에는 가상 거래로만 성적을 재고, 승격 기준을 통과하면 S티어에 들어간다.
// 모두 "마감된 5분봉"만 보고, 오늘 정규장 봉(session)과 전일 종가를 함께 쓴다.
//   E VWAP 회복       당일 평균가(VWAP) 아래 있다가 거래량과 함께 다시 위로 마감
//   F 장중 고점 돌파   최근 6봉이 좁게 횡보한 뒤 당일 고점을 거래량과 함께 넘어 마감
//   G 레드 투 그린     전일 종가 아래에서 놀다가 처음으로 전일 종가 위로 마감
//   H NR7 돌파        직전 봉이 최근 7봉 중 가장 좁았고, 이번 봉이 그 고가를 넘어 양봉 마감 (크라벨)
//   I 불 플래그       4봉 안에 3% 이상 급등 → 거래량 줄며 절반 이내 눌림 → 직전 봉 고가를 넘는 양봉
//   J 터틀 수프       (린다 라쉬키) 20봉 저가를 살짝 깬 뒤 1~3봉 안에 다시 그 위로 양봉 마감 (가짜 하락 돌파)
//   K 실버 불릿       (ICT) 뉴욕 10~11시: 당일 저가를 쓸고 생긴 상승 FVG로 처음 되돌아와 양봉 마감
//   L VWAP 2σ 되돌림  VWAP −2σ 아래로 마감한 뒤 다시 밴드 안으로 양봉 마감
//   M 홀리 그레일     (린다 라쉬키) ADX 30↑ 상승 추세에서 20 EMA 첫 눌림 → 직전 봉 고가 돌파
//   N DTFX           구조 전환(직전 고점 종가 돌파) 뒤 상승폭 50~70% 되돌림 구간에서 양봉 재상승
// 한 번 붙인 알파벳은 영구 (은퇴해도 다른 전략에 다시 쓰지 않음)

const bullish = (c) => c.c > c.o;
const round = (v, d = 2) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const avgVol = (bars) => avg(bars.map((b) => b.v || 0));

export const CANDIDATES = {
  E: { id: 'E', name: 'VWAP 회복', prior: { win: 0.48, payoff: 1.4 } },
  F: { id: 'F', name: '장중 고점 돌파', prior: { win: 0.45, payoff: 1.6 } },
  G: { id: 'G', name: '레드 투 그린', prior: { win: 0.47, payoff: 1.5 } },
  H: { id: 'H', name: 'NR7 돌파', prior: { win: 0.46, payoff: 1.5 } },
  I: { id: 'I', name: '불 플래그', prior: { win: 0.45, payoff: 1.7 } },
  J: { id: 'J', name: '터틀 수프', prior: { win: 0.45, payoff: 1.5 } },
  K: { id: 'K', name: '실버 불릿', prior: { win: 0.45, payoff: 1.6 } },
  L: { id: 'L', name: 'VWAP 2σ 되돌림', prior: { win: 0.5, payoff: 1.3 } },
  M: { id: 'M', name: '홀리 그레일', prior: { win: 0.47, payoff: 1.5 } },
  N: { id: 'N', name: 'DTFX', prior: { win: 0.45, payoff: 1.6 } },
};
// 등록 순서 = 대기열 순서 (A~I 다음 J부터)
export const STRATEGY_ORDER = ['A', 'B', 'C', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];

// 청산 규칙 3종: 같은 진입이라도 청산이 성적을 크게 가른다
export const EXIT_PROFILES = {
  P1: { id: 'P1', name: '짧게', tpPct: 2, slPct: 1, holdBars: 24 },
  P2: { id: 'P2', name: '기본', tpPct: 3, slPct: 1.5, holdBars: 36 },
  P3: { id: 'P3', name: '길게', tpPct: 5, slPct: 2, holdBars: 48 },
};

export function sessionVwap(session) {
  let pv = 0;
  let vv = 0;
  for (const b of session) {
    const tp = (b.h + b.l + b.c) / 3;
    pv += tp * (b.v || 0);
    vv += b.v || 0;
  }
  return vv > 0 ? pv / vv : null;
}

const no = (id, reason) => ({ id, fired: false, reason });

export function checkE(session) {
  if (session.length < 4) return no('E', '오늘 봉 4개 미만');
  const last = session[session.length - 1];
  const prev = session[session.length - 2];
  const vwapPrev = sessionVwap(session.slice(0, -1));
  const vwap = sessionVwap(session);
  if (!vwap || !vwapPrev) return no('E', '거래량 없음');
  const below = prev.c < vwapPrev;
  const above = last.c > vwap;
  const volOk = (last.v || 0) >= avgVol(session.slice(-11, -1)) * 1.3;
  const fired = below && above && bullish(last) && volOk;
  return { id: 'E', fired, detail: `VWAP $${round(vwap)} 회복 (거래량 ${round((last.v || 0) / Math.max(1, avgVol(session.slice(-11, -1))), 1)}배)`, reason: !below ? '직전 봉이 VWAP 위' : !above ? 'VWAP 아래' : !bullish(last) ? '음봉' : '거래량 부족', metrics: { vwap: round(vwap) } };
}

export function checkF(session) {
  if (session.length < 8) return no('F', '오늘 봉 8개 미만');
  const last = session[session.length - 1];
  const before = session.slice(0, -1);
  const hod = Math.max(...before.map((b) => b.h));
  const base = session.slice(-7, -1);
  const hi = Math.max(...base.map((b) => b.h));
  const lo = Math.min(...base.map((b) => b.l));
  const tight = (hi - lo) / last.c <= 0.015;
  const broke = last.c > hod;
  const volOk = (last.v || 0) >= avgVol(base) * 1.5;
  const fired = tight && broke && bullish(last) && volOk;
  return { id: 'F', fired, detail: `당일 고점 $${round(hod)} 돌파 (횡보폭 ${round(((hi - lo) / last.c) * 100)}%)`, reason: !tight ? '직전 횡보폭 1.5% 초과' : !broke ? '당일 고점 아래' : !bullish(last) ? '음봉' : '거래량 부족', metrics: { hod: round(hod) } };
}

export function checkG(session, prevClose) {
  if (!(prevClose > 0)) return no('G', '전일 종가 없음');
  if (session.length < 2) return no('G', '오늘 봉 2개 미만');
  const last = session[session.length - 1];
  const earlier = session.slice(0, -1);
  const startedRed = session[0].o < prevClose;
  const firstCross = earlier.every((b) => b.c <= prevClose) && last.c > prevClose;
  const volOk = (last.v || 0) >= avgVol(earlier.slice(-10));
  const fired = startedRed && firstCross && bullish(last) && volOk;
  return { id: 'G', fired, detail: `전일 종가 $${round(prevClose)} 첫 회복`, reason: !startedRed ? '시가가 전일 종가 위' : !firstCross ? (last.c <= prevClose ? '전일 종가 아래' : '이미 넘은 적 있음') : !bullish(last) ? '음봉' : '거래량 부족' };
}

export function checkH(closed) {
  if (closed.length < 8) return no('H', '봉 8개 미만');
  const last = closed[closed.length - 1];
  const prev = closed[closed.length - 2];
  const win = closed.slice(-8, -1); // prev 포함 최근 7봉
  const range = (b) => b.h - b.l;
  const nr7 = range(prev) > 0 && win.every((b) => range(b) >= range(prev));
  const broke = last.c > prev.h;
  const fired = nr7 && broke && bullish(last);
  return { id: 'H', fired, detail: `NR7 봉 고가 $${round(prev.h)} 돌파`, reason: !nr7 ? '직전 봉이 최근 7봉 중 가장 좁지 않음' : !broke ? 'NR7 고가 아래' : '음봉' };
}

export function checkI(closed) {
  if (closed.length < 10) return no('I', '봉 10개 미만');
  const last = closed[closed.length - 1];
  const prev = closed[closed.length - 2];
  // 최근 12봉 안에서 급등 구간(4봉 이내 +3%)과 그 뒤 눌림(2~5봉)을 찾는다
  const w = closed.slice(-13, -1);
  for (let pole = 0; pole < w.length - 2; pole++) {
    for (let len = 1; len <= 4 && pole + len < w.length; len++) {
      const start = w[pole].o;
      const top = Math.max(...w.slice(pole, pole + len + 1).map((b) => b.h));
      const topIdx = pole + w.slice(pole, pole + len + 1).findIndex((b) => b.h === top);
      if (!(start > 0) || top / start - 1 < 0.03) continue;
      const flag = w.slice(topIdx + 1);
      if (flag.length < 2 || flag.length > 5) continue;
      const low = Math.min(...flag.map((b) => b.l));
      const retrace = (top - low) / (top - start);
      const poleVol = avgVol(w.slice(pole, topIdx + 1));
      const flagVol = avgVol(flag);
      const fired = retrace <= 0.5 && flagVol < poleVol && bullish(last) && last.c > prev.h;
      if (fired) return { id: 'I', fired: true, detail: `급등 +${round((top / start - 1) * 100)}% 후 눌림 ${round(retrace * 100)}% → 재상승`, reason: null };
    }
  }
  return no('I', '급등 후 눌림 패턴 없음');
}

const hhmm = (b) => (b?.time ? b.time.slice(11, 16) : '');

export function checkJ(closed) {
  if (closed.length < 26) return no('J', '봉 26개 미만');
  const n = closed.length;
  const last = closed[n - 1];
  // 깨는 봉(b)은 최근 1~3봉 전, 기준 저가는 그 전 20봉의 최저가이고 b보다 4봉 이상 앞에서 만들어짐
  for (let b = n - 2; b >= n - 4; b--) {
    const ref = closed.slice(b - 20, b);
    const refLow = Math.min(...ref.map((x) => x.l));
    const refIdx = b - 20 + ref.findIndex((x) => x.l === refLow);
    if (b - refIdx < 4) continue;
    const brk = closed[b];
    const depth = (refLow - brk.l) / refLow;
    if (!(depth >= 0.001 && depth <= 0.015)) continue; // 살짝(0.1~1.5%) 깬 것만
    const after = closed.slice(b + 1, n - 1);
    if (after.some((x) => x.c > refLow)) continue; // 이미 회복한 뒤면 첫 회복이 아님
    if (after.some((x) => x.l < brk.l)) continue; // 더 깊이 빠졌으면 무효
    const fired = bullish(last) && last.c > refLow && brk.c <= refLow * 1.002;
    if (fired) return { id: 'J', fired: true, detail: `20봉 저가 $${round(refLow)} 깬 뒤(−${round(depth * 100)}%) 회복 마감`, reason: null, metrics: { refLow: round(refLow), sweepLow: round(brk.l) } };
  }
  return no('J', '20봉 저가 이탈 후 회복 없음');
}

export function checkK(session) {
  const n = session.length;
  if (n < 6) return no('K', '오늘 봉 6개 미만');
  const last = session[n - 1];
  const t = hhmm(last);
  if (!(t >= '10:00' && t < '11:00')) return no('K', '10~11시 아님');
  // FVG: 세 봉 x,y,z에서 z 저가 > x 고가 (y가 크게 올라 빈 구간이 생김), z는 마지막 봉보다 앞
  for (let z = n - 2; z >= 2; z--) {
    const x = session[z - 2];
    const y = session[z - 1];
    const zb = session[z];
    if (!(zb.l > x.h) || (zb.l - x.h) / x.h < 0.001 || !bullish(y)) continue;
    // 저가 쓸기: x나 y가 그 전까지의 당일 저가를 새로 씀 (최소 3봉 뒤)
    const swept = [z - 2, z - 1].some((i) => i >= 3 && session[i].l < Math.min(...session.slice(0, i).map((q) => q.l)));
    if (!swept) continue;
    const mid = session.slice(z + 1, n - 1);
    if (mid.some((q) => q.l <= zb.l)) return no('K', 'FVG에 이미 한 번 들어옴'); // 첫 되돌림만
    const fired = last.l <= zb.l && last.c > x.h && bullish(last);
    return fired ? { id: 'K', fired: true, detail: `저가 쓸기 후 FVG $${round(x.h)}~$${round(zb.l)} 첫 되돌림 양봉`, reason: null, metrics: { fvgLo: round(x.h), fvgHi: round(zb.l) } } : no('K', 'FVG 되돌림 대기');
  }
  return no('K', '저가 쓸기 + FVG 없음');
}

export function checkL(session) {
  const n = session.length;
  if (n < 12) return no('L', '오늘 봉 12개 미만');
  const band = (bars) => {
    let pv = 0;
    let vv = 0;
    for (const b of bars) {
      pv += ((b.h + b.l + b.c) / 3) * (b.v || 0);
      vv += b.v || 0;
    }
    if (!(vv > 0)) return null;
    const vw = pv / vv;
    let s2 = 0;
    for (const b of bars) s2 += (b.v || 0) * (((b.h + b.l + b.c) / 3) - vw) ** 2;
    const sd = Math.sqrt(s2 / vv);
    return { vw, lo: vw - 2 * sd, sd };
  };
  const bp = band(session.slice(0, -1));
  const bn = band(session);
  if (!bp || !bn || !(bn.sd > 0)) return no('L', '거래량 없음');
  const prev = session[n - 2];
  const last = session[n - 1];
  const fired = prev.c < bp.lo && last.c > bn.lo && bullish(last);
  return { id: 'L', fired, detail: `VWAP $${round(bn.vw)} −2σ $${round(bn.lo)} 밴드 복귀`, reason: prev.c >= bp.lo ? '−2σ 아래 이탈 없음' : !bullish(last) ? '음봉' : '아직 밴드 밖', metrics: { vwap: round(bn.vw), lo: round(bn.lo) } };
}

export function adx(bars, len = 14) {
  if (bars.length < len * 2 + 1) return null;
  let tr = 0;
  let pdm = 0;
  let mdm = 0;
  const dxs = [];
  let pdi = 0;
  let mdi = 0;
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].h;
    const l = bars[i].l;
    const pc = bars[i - 1].c;
    const up = h - bars[i - 1].h;
    const dn = bars[i - 1].l - l;
    const t = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    const p = up > dn && up > 0 ? up : 0;
    const m = dn > up && dn > 0 ? dn : 0;
    if (i <= len) {
      tr += t;
      pdm += p;
      mdm += m;
      if (i < len) continue;
    } else {
      tr = tr - tr / len + t;
      pdm = pdm - pdm / len + p;
      mdm = mdm - mdm / len + m;
    }
    pdi = tr > 0 ? (100 * pdm) / tr : 0;
    mdi = tr > 0 ? (100 * mdm) / tr : 0;
    dxs.push(pdi + mdi > 0 ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0);
  }
  if (dxs.length < len) return null;
  let a = avg(dxs.slice(0, len));
  for (let i = len; i < dxs.length; i++) a = (a * (len - 1) + dxs[i]) / len;
  return { adx: a, pdi, mdi };
}
export function ema(values, len) {
  if (!values.length) return [];
  const k = 2 / (len + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

export function checkM(closed) {
  const n = closed.length;
  if (n < 40) return no('M', '봉 40개 미만');
  const last = closed[n - 1];
  const prev = closed[n - 2];
  const a = adx(closed.slice(0, -1));
  if (!a) return no('M', 'ADX 계산 불가');
  const e = ema(closed.map((b) => b.c), 20);
  const ePrev = e[n - 2];
  if (!(a.adx >= 30 && a.pdi > a.mdi)) return no('M', `ADX ${round(a.adx, 1)} · 상승 추세 아님`);
  if (!(prev.l <= ePrev * 1.001 && prev.c >= ePrev * 0.995)) return no('M', '20 EMA 눌림 아님');
  // 첫 눌림: 직전 10봉 동안 20 EMA를 건드린 적 없음
  for (let i = n - 12; i < n - 2; i++) if (closed[i].l <= e[i] * 1.001) return no('M', '첫 눌림 아님');
  const fired = last.c > prev.h && bullish(last);
  return { id: 'M', fired, detail: `ADX ${round(a.adx, 1)} 추세 중 20 EMA $${round(ePrev)} 첫 눌림 → 재상승`, reason: fired ? null : '직전 봉 고가 돌파 대기' };
}

export function checkN(closed, piv = 3) {
  const n = closed.length;
  if (n < 30) return no('N', '봉 30개 미만');
  const last = closed[n - 1];
  const prev = closed[n - 2];
  // 스윙 고점·저점: 왼쪽은 엄격히, 오른쪽은 같거나 낮은(높은) 것까지 허용 (같은 값 연속 봉 처리)
  const isHigh = (i) => closed.slice(i - piv, i + piv + 1).every((b, k) => k === piv || (k < piv ? b.h < closed[i].h : b.h <= closed[i].h));
  const isLow = (i) => closed.slice(i - piv, i + piv + 1).every((b, k) => k === piv || (k < piv ? b.l > closed[i].l : b.l >= closed[i].l));
  // 최근 확정된 고점(H)을 종가로 돌파한 봉(bos), 그 전의 저점(L0)
  for (let bos = n - 2; bos >= n - 20 && bos > piv * 3; bos--) {
    let H = -1;
    for (let i = bos - 1 - piv; i >= piv; i--) if (isHigh(i)) {
      H = i;
      break;
    }
    if (H < 0 || !(closed[bos].c > closed[H].h) || !(closed[bos - 1].c <= closed[H].h)) continue;
    let L0 = -1;
    for (let i = bos - 1; i >= Math.max(piv, H - 20); i--) if (i + piv < n && isLow(i)) {
      L0 = i;
      break;
    }
    if (L0 < 0) continue;
    const lo = closed[L0].l;
    const after = closed.slice(bos, n - 1);
    const top = Math.max(...after.map((b) => b.h));
    const leg = top - lo;
    if (!(leg > 0) || leg / lo < 0.01) continue;
    const z50 = top - leg * 0.5;
    const z70 = top - leg * 0.7;
    const topIdx = bos + after.findIndex((b) => b.h === top);
    const pull = closed.slice(topIdx + 1, n);
    if (!pull.length || pull.some((b) => b.c < z70)) return no('N', '70% 아래로 무너짐');
    const touched = pull.some((b) => b.l <= z50);
    const fired = touched && bullish(last) && last.c > prev.h && last.c < top;
    return { id: 'N', fired, detail: `구조 전환 $${round(closed[H].h)} 돌파 후 50~70% 구간 $${round(z70)}~$${round(z50)} 재상승`, reason: fired ? null : touched ? '재상승 대기' : '50% 되돌림 대기' };
  }
  return no('N', '구조 전환 없음');
}

const CHECKS = {
  E: ({ session }) => checkE(session),
  F: ({ session }) => checkF(session),
  G: ({ session, prevClose }) => checkG(session, prevClose),
  H: ({ closed }) => checkH(closed),
  I: ({ closed }) => checkI(closed),
  J: ({ closed }) => checkJ(closed),
  K: ({ session }) => checkK(session),
  L: ({ session }) => checkL(session),
  M: ({ closed }) => checkM(closed),
  N: ({ closed }) => checkN(closed),
};

/** 후보 전략 판정. session = 오늘 정규장 마감봉, closed = 전일 포함 마감봉, active = 지금 후보 자리에 있는 전략만 */
export function evaluateCandidates({ session, closed, prevClose, active = ['E', 'F', 'G', 'H', 'I'] }) {
  return active.filter((id) => CHECKS[id]).map((id) => CHECKS[id]({ session, closed, prevClose }));
}
