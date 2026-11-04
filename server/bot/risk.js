// 위험 상품 걸러내기 (다윗 탐색 후보 + 모든 매수 직전)
//
// 1순위: 한투 상품기본정보(CTPF1702R)의 공식 분류
//   - ETP 추적수익률배수가 1이 아님 (2배·3배 레버리지, -1배 인버스 등)
//   - PTP 종목 (매도 대금의 10% 원천징수 대상이라 단타에 치명적)
//   - 상장폐지 종목
//   - 상품분류명이 워런트·유닛·권리·우선주·채권·노트 등
// 2순위(API 실패 또는 정보 부족 시): 종목명·티커 패턴
//   - 레버리지·인버스·변동성(VIX) ETF/ETN 이름, 알려진 티커
//   - 워런트(…W, …WS), 유닛(…U), 권리(…R) 5자리 티커
// 결과는 data/product-info.json 에 7일간 저장해 같은 종목을 다시 묻지 않는다.
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve(process.env.PRODUCT_INFO_FILE || 'data/product-info.json');
const TTL = 7 * 24 * 3600 * 1000;

const RISKY_NAME = /(레버리지|인버스|\d(\.\d)?배|\b[1-3](\.5)?X\b|-[1-3]X\b|\bLEVERAGED\b|\bINVERSE\b|\bULTRAPRO\b|PROSHARES\s+ULTRA|\bDAILY\b.*\b(BULL|BEAR|LONG|SHORT)\b|\bVIX\b|변동성\s*(지수|ETF)|VOLATILITY\s+(ETF|INDEX|FUND)|디렉시온|그래닛셰어즈|티렉스|T-REX|프로셰어즈\s*울트라)/i;
const RISKY_CLASS = /(워런트|\bWARRANTS?\b|유닛|\bUNITS?\b|권리|\bRIGHTS?\b|우선주|\bPREFERRED\b|채권|\bNOTES?\b|\bETN\b|신주인수권)/i;
// 펀드(폐쇄형·수익형·BDC 등): 개별 기업이 아니라 단타 대상이 아님. 'TRUST' 단독은 은행 이름(Northern Trust 등)과 겹쳐 쓰지 않는다
const FUND_NAME = /(펀드|\bFUNDS?\b|\bFD\b|폐쇄형|CLOSED[- ]END|INCOME\s+(TRUST|OPPORTUNIT|SECURITIES|STRATEGIES)|인컴\s*(트러스트|오퍼튜니티|증권|전략)|MUNICIPAL|\bMUNI\b|지방채|BDC|CAPITAL\s+INCOME|DIVIDEND\s+(INCOME|AND\s+INCOME)|PREFERRED\s+(INCOME|AND|SECURITIES)|하이일드|HIGH\s+(YIELD|INCOME)|\bCEF\b)/i;
const RISKY_TICKERS = new Set([
  'TQQQ', 'SQQQ', 'QLD', 'QID', 'SOXL', 'SOXS', 'TECL', 'TECS', 'FNGU', 'FNGD', 'UPRO', 'SPXU', 'SPXL', 'SPXS', 'SSO', 'SDS', 'SH', 'PSQ',
  'TNA', 'TZA', 'LABU', 'LABD', 'TSLL', 'TSLQ', 'TSLZ', 'TSLS', 'NVDL', 'NVDX', 'NVDD', 'NVDQ', 'AMDL', 'GGLL', 'AAPU', 'AAPD', 'AMZU', 'MSFU', 'METU', 'CONL',
  'MSTU', 'MSTX', 'MSTZ', 'BITX', 'BITU', 'SBIT', 'ETHU', 'BABX', 'IONL', 'UVXY', 'UVIX', 'SVIX', 'SVXY', 'VXX', 'VIXY', 'VIXM', 'BOIL', 'KOLD', 'UCO', 'SCO',
  'NUGT', 'DUST', 'JNUG', 'JDST', 'YINN', 'YANG', 'TMF', 'TMV', 'DPST', 'BULZ', 'WEBL', 'CURE', 'NAIL', 'DFEN', 'USD', 'SSG', 'ROM', 'REW',
]);

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
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cache, null, 2));
};

/** 이름·티커만으로 판단 (빠르고 API 호출 없음) */
export function quickCheck(symbol, name = '') {
  const reasons = [];
  const sym = String(symbol || '').toUpperCase();
  if (RISKY_TICKERS.has(sym)) reasons.push('레버리지·인버스·변동성 상품 (티커 목록)');
  if (RISKY_NAME.test(name)) reasons.push('레버리지·인버스·변동성 상품 (종목명)');
  if (/^[A-Z]{4}(W|WS|U|R)$/.test(sym) || /\.(W|WS|U|R)$/.test(sym)) reasons.push('워런트·유닛·권리 추정 (티커 형식)');
  if (RISKY_CLASS.test(name)) reasons.push('워런트·유닛·권리·우선주·채권형 (종목명)');
  if (FUND_NAME.test(name)) reasons.push('펀드 (폐쇄형·수익형, 종목명)');
  return reasons;
}

/** 공식 분류로 판단 */
function fromInfo(info) {
  const reasons = [];
  const m = info.etpMultiple;
  if (m != null && m !== 0 && m !== 1) reasons.push(`ETP 추적배수 ${m}배 (${m < 0 ? '인버스' : '레버리지'})`);
  if (info.ptp) reasons.push('PTP 종목 (매도 대금 10% 원천징수)');
  if (info.delisted) reasons.push('상장폐지 종목');
  if (RISKY_CLASS.test(info.className)) reasons.push(`상품분류: ${info.className}`);
  if (/(펀드|FUND|CEF|BDC)/i.test(info.className)) reasons.push(`상품분류: ${info.className} (펀드)`);
  if (FUND_NAME.test(`${info.name} ${info.engName}`)) reasons.push('펀드 (폐쇄형·수익형, 공식 종목명)');
  if (RISKY_NAME.test(`${info.name} ${info.engName}`)) reasons.push('레버리지·인버스·변동성 상품 (공식 종목명)');
  return reasons;
}

/**
 * @returns {Promise<{risky:boolean, reasons:string[], source:'kis'|'name', info?:object}>}
 */
export async function classify(kis, symbol, exchange, name = '') {
  const sym = String(symbol).toUpperCase();
  const c = load();
  const hit = c[sym];
  let info = hit && Date.now() - hit.at < TTL ? hit.info : null;
  if (!info && kis?.getProductInfo) {
    try {
      info = await kis.getProductInfo(sym, exchange);
      const { raw, ...keep } = info;
      c[sym] = { at: Date.now(), info: keep };
      save();
    } catch {
      info = null; // 모의투자 미지원 등 → 이름으로만 판단
    }
  }
  const reasons = [...new Set([...(info ? fromInfo(info) : []), ...quickCheck(sym, `${name} ${info?.name || ''} ${info?.engName || ''}`)])];
  return { risky: reasons.length > 0, reasons, source: info ? 'kis' : 'name', info: info || undefined };
}

export const cached = (symbol) => load()[String(symbol).toUpperCase()]?.info || null;
