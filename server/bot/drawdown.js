// 누적 손실 방어: 최근 N거래일 평가금액 고점 대비 하락폭으로 단계를 정한다 (하루 −5% 셧다운과 별개)
//   0 정상 · 1 방어(비중 ½, 동시 보유 2) · 2 최소(비중 ¼, 동시 보유 1, D만) · 3 정지(신규 매수 중지, 사용자가 직접 풀기)
//   오를 때(악화)는 바로, 내려올 때(회복)는 그 단계 기준의 절반 위로 회복하면 하루에 한 단계씩. 3단계는 자동으로 안 풀림.
//   평가금액 기준이라 입출금이 섞이면 "고점 다시 잡기"로 기준을 새로 잡는다.
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve(process.env.BOT_DRAWDOWN_FILE || 'data/drawdown.json');
export const LEVELS = [
  { level: 0, name: '정상', weight: 1, maxPos: null, onlyD: false },
  { level: 1, name: '방어', weight: 0.5, maxPos: 2, onlyD: false },
  { level: 2, name: '최소', weight: 0.25, maxPos: 1, onlyD: true },
  { level: 3, name: '정지', weight: 0, maxPos: 0, onlyD: true },
];

export function loadDrawdown() {
  try {
    return { level: 0, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return { level: 0, resetYmd: null, upYmd: null };
  }
}
export function saveDrawdown(s) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
  } catch {
    /* 무시 */
  }
}

/**
 * @param {object} s 이전 상태
 * @param {{ymd:string, total:number, days:{[ymd]:{last:number}}, th:[number,number,number], lookback:number}} p
 * @returns {{s:object, changed:boolean, from:number}}
 */
export function evaluateDrawdown(s, { ymd, total, days, th = [8, 12, 15], lookback = 20 }) {
  const from = s.level || 0;
  if (!(total > 0)) return { s, changed: false, from };
  const keys = Object.keys(days || {})
    .filter((k) => k < ymd && (!s.resetYmd || k >= s.resetYmd))
    .sort()
    .slice(-lookback);
  const peak = Math.max(total, ...keys.map((k) => days[k]?.last || 0), s.resetYmd === ymd && s.resetTotal > 0 ? s.resetTotal : 0);
  const ddPct = Math.round((total / peak - 1) * 10000) / 100;
  const target = ddPct <= -th[2] ? 3 : ddPct <= -th[1] ? 2 : ddPct <= -th[0] ? 1 : 0;
  let level = from;
  let upYmd = s.upYmd || null;
  if (target > level) level = target;
  else if (level >= 1 && level <= 2 && upYmd !== ymd && ddPct > -th[level - 1] / 2) {
    level -= 1;
    upYmd = ymd;
  }
  const next = { ...s, level, upYmd, peak: Math.round(peak * 100) / 100, ddPct, at: new Date().toISOString() };
  if (level !== from) next.changedAt = next.at;
  return { s: next, changed: level !== from, from };
}

/** 3단계 정지 풀기 → 2단계(최소)부터 다시 */
export const releaseDrawdown = (s, ymd) => ({ ...s, level: s.level >= 3 ? 2 : s.level, upYmd: ymd, releasedAt: new Date().toISOString() });
/** 고점 다시 잡기 (입출금한 날): 오늘부터 기준을 새로 잡음. 3단계는 따로 풀어야 함 */
export const resetPeak = (s, ymd, total) => ({ ...s, resetYmd: ymd, resetTotal: total, level: s.level >= 3 ? 3 : 0, upYmd: ymd, resetAt: new Date().toISOString() });
