// 상대 거래량(RVol) = 오늘 지금까지 거래량 ÷ (평소 하루 거래량 × 이 시각까지 보통 쌓이는 비율)
//   평소 하루 거래량: 최근 20거래일 일봉 평균 (오늘 제외). 종목당 하루 한 번만 조회해 data/avg-volume.json에 둔다.
//   하루 중 거래량은 U자 모양(개장·마감에 몰림)이라 경과 시간 비율 대신 일반적인 누적 곡선을 쓴다.
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve(process.env.BOT_AVGVOL_FILE || 'data/avg-volume.json');
let cache = null;
const load = () => {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    cache = {};
  }
  return cache;
};
const save = () => {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache));
  } catch {
    /* 캐시 저장 실패는 무시 */
  }
};

// 개장 후 분 → 하루 거래량 중 그때까지 쌓이는 비율 (미국 주식 평균적인 U자 곡선 근사)
const CURVE = [[0, 0], [15, 0.1], [30, 0.17], [60, 0.27], [90, 0.35], [120, 0.42], [180, 0.53], [240, 0.63], [300, 0.73], [330, 0.79], [360, 0.86], [390, 1]];
export function sessionShare(minSinceOpen) {
  const m = Math.max(0, Math.min(390, minSinceOpen));
  for (let i = 1; i < CURVE.length; i++) {
    const [m1, s1] = CURVE[i];
    const [m0, s0] = CURVE[i - 1];
    if (m <= m1) return s0 + ((s1 - s0) * (m - m0)) / (m1 - m0);
  }
  return 1;
}

/** 오늘(ymd) 기준 최근 20일 평균 거래량. 실패하면 null (판단 보류) */
export async function avgVolume(kis, symbol, exchange, ymd) {
  const c = load();
  const hit = c[symbol];
  if (hit && hit.ymd === ymd) return hit;
  try {
    const bars = (await kis.getDailyBars(symbol, exchange, { count: 25 })).filter((b) => b.date < ymd && b.v > 0);
    const last = bars.slice(-20);
    if (last.length < 5) return null;
    const v = last.reduce((s, b) => s + b.v, 0) / last.length;
    const amount = last.reduce((s, b) => s + (b.amount || b.v * b.c), 0) / last.length;
    c[symbol] = { ymd, avgVol: Math.round(v), avgAmount: Math.round(amount), days: last.length };
    save();
    return c[symbol];
  } catch {
    return null;
  }
}

/** 정규장 RVol. nyMin = 뉴욕 자정 이후 분. 개장 10분 전에는 표본이 너무 작아 null */
export function rvolAt(dayVolume, avgVol, nyMin) {
  if (!(dayVolume > 0) || !(avgVol > 0)) return null;
  const since = nyMin - 570;
  if (since < 10) return null;
  return Math.round((dayVolume / (avgVol * sessionShare(since))) * 100) / 100;
}

export const cachedAvg = (symbol) => load()[symbol] || null;
