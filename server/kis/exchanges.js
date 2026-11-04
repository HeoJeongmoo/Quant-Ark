// 시세 API와 주문 API의 거래소 코드가 서로 다르다.
//   시세(EXCD):  NAS 나스닥 / NYS 뉴욕 / AMS 아멕스   (주간거래: BAQ / BAY / BAA)
//   주문(OVRS_EXCG_CD): NASD / NYSE / AMEX
const QUOTE_TO_ORDER = { NAS: 'NASD', NYS: 'NYSE', AMS: 'AMEX', BAQ: 'NASD', BAY: 'NYSE', BAA: 'AMEX' };
const ORDER_TO_QUOTE = { NASD: 'NAS', NYSE: 'NYS', AMEX: 'AMS' };

export function toQuoteExchange(ex = 'NAS') {
  const e = ex.toUpperCase();
  if (QUOTE_TO_ORDER[e]) return e;
  if (ORDER_TO_QUOTE[e]) return ORDER_TO_QUOTE[e];
  throw new Error(`[KIS] 지원하지 않는 미국 거래소 코드: ${ex} (NAS/NYS/AMS 또는 NASD/NYSE/AMEX)`);
}

export function toOrderExchange(ex = 'NASD') {
  const e = ex.toUpperCase();
  if (ORDER_TO_QUOTE[e]) return e;
  if (QUOTE_TO_ORDER[e]) return QUOTE_TO_ORDER[e];
  throw new Error(`[KIS] 지원하지 않는 미국 거래소 코드: ${ex} (NASD/NYSE/AMEX 또는 NAS/NYS/AMS)`);
}

// 미국 주식 호가 단위: $1 이상 0.01, $1 미만 0.0001
export function roundUsPrice(p, mode = 'nearest') {
  const tick = p >= 1 ? 0.01 : 0.0001;
  const n = p / tick;
  const steps = mode === 'up' ? Math.ceil(n - 1e-7) : mode === 'down' ? Math.floor(n + 1e-7) : Math.round(n);
  return Number((steps * tick).toFixed(p >= 1 ? 2 : 4));
}
