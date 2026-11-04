// 장세(Regime) 기록: 모두 KIS 데이터로 계산
//   QQQ 5분봉 → 방향(등락률) · 시가 갭 · 장중 변동폭(20일 평균 대비) · 추세/횡보(효율) · 장중 변동성
//   섹터 ETF 11개 + RSP/SPY → 시장 폭 대체 (오른 섹터 수, 동일가중 − 시총가중)
//   VIXY → VIX 대체 (VIX 선물 ETF 등락률)
//   IWM(러셀2000) → 소형주 장세, QQQ − IWM → 대형주 장인지 소형주 장인지 (갭 후보는 대부분 소형주)
// 매수 순간의 값은 가상 거래마다 붙이고(나중에 필터로 쓸 수 있는 정보), 하루 값은 캘린더용으로 날짜별 저장

export const SECTOR_ETFS = ['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLB', 'XLU', 'XLRE', 'XLC'];
export const BREADTH_EXTRA = ['RSP', 'SPY', 'VIXY', 'IWM'];
// KIS 시세 거래소 코드: 섹터 SPDR·RSP·SPY는 NYSE Arca, VIXY는 Cboe BZX → 둘 다 AMS로 조회되는지 확인 후 실패하면 NYS·NAS 순으로 다시 찾음
export const ETF_EX = 'AMS';

const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

/**
 * @param {{session: Array<{o,h,l,c}>, prevClose: number, price?: number, avgRangePct?: number}} p
 *   session: 오늘 정규장 닫힌 5분봉
 */
export function qqqRegime({ session, prevClose, price, avgRangePct }) {
  if (!(prevClose > 0) || !session?.length) return null;
  const o = session[0].o;
  const c = price > 0 ? price : session[session.length - 1].c;
  const hi = Math.max(...session.map((k) => k.h), c);
  const lo = Math.min(...session.map((k) => k.l), c);
  const chgPct = (c / prevClose - 1) * 100;
  const gapPct = (o / prevClose - 1) * 100;
  const rangePct = ((hi - lo) / prevClose) * 100;
  const eff = hi > lo ? (c - o) / (hi - lo) : 0; // +1 한 방향 상승 · −1 한 방향 하락 · 0 근처 횡보
  // 장중 변동성: 5분 수익률 표준편차 × √78 (하루 환산, %)
  const rets = [];
  for (let i = 1; i < session.length; i++) rets.push(Math.log(session[i].c / session[i - 1].c));
  const mean = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
  const sd = rets.length > 2 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)) : null;
  const rvPct = sd == null ? null : sd * Math.sqrt(78) * 100;
  if (Math.abs(gapPct) > 20 || Math.abs(chgPct) > 30) return null; // 봉·시세가 서로 안 맞는 비정상 데이터
  const rangeRatio = avgRangePct > 0 ? rangePct / avgRangePct : null;
  return {
    chgPct: r2(chgPct),
    gapPct: r2(gapPct),
    rangePct: r2(rangePct),
    rangeRatio: r2(rangeRatio),
    eff: r2(eff),
    rvPct: r2(rvPct),
    bars: session.length,
    dir: chgPct >= 0.5 ? '강세' : chgPct <= -0.5 ? '약세' : '보합',
    trend: session.length < 6 ? '초반' : Math.abs(eff) >= 0.6 ? '추세' : Math.abs(eff) <= 0.3 ? '횡보' : '혼조',
    vol: rangeRatio == null ? null : rangeRatio >= 1.3 ? '높음' : rangeRatio <= 0.7 ? '낮음' : '보통',
  };
}

/** @param {{[sym]: number}} rates 전일 대비 등락률(%), qqq = 그 시점 QQQ 등락률 */
export function breadthOf(rates, qqq = null) {
  const sec = SECTOR_ETFS.filter((s) => Number.isFinite(rates[s]));
  const up = sec.filter((s) => rates[s] > 0).length;
  const rspSpy = Number.isFinite(rates.RSP) && Number.isFinite(rates.SPY) ? rates.RSP - rates.SPY : null;
  const ratio = sec.length ? up / sec.length : null;
  return {
    sectorsUp: sec.length ? up : null,
    sectorsN: sec.length,
    rspSpy: r2(rspSpy),
    vixy: Number.isFinite(rates.VIXY) ? r2(rates.VIXY) : null,
    spy: Number.isFinite(rates.SPY) ? r2(rates.SPY) : null,
    iwm: Number.isFinite(rates.IWM) ? r2(rates.IWM) : null,
    qqqIwm: Number.isFinite(rates.IWM) && Number.isFinite(qqq) ? r2(qqq - rates.IWM) : null,
    breadth: ratio == null ? null : ratio >= 0.73 ? '넓음' : ratio <= 0.36 ? '좁음' : '보통', // 11개 중 8개↑ / 4개↓
  };
}

/** 가상 거래에 붙일 작은 스냅샷 */
export const snap = (R) =>
  R?.qqq
    ? {
        qqq: R.qqq.chgPct,
        gap: R.qqq.gapPct,
        eff: R.qqq.eff,
        rv: R.qqq.rvPct,
        dir: R.qqq.dir,
        trend: R.qqq.trend,
        vol: R.qqq.vol,
        sectorsUp: R.breadth?.sectorsUp ?? null,
        rspSpy: R.breadth?.rspSpy ?? null,
        vixy: R.breadth?.vixy ?? null,
        spy: R.breadth?.spy ?? null,
        iwm: R.breadth?.iwm ?? null,
        qqqIwm: R.breadth?.iwm != null ? r2(R.qqq.chgPct - R.breadth.iwm) : null,
      }
    : null;

/** 짧은 표시: "강세·추세·변동↑" */
export const tagOf = (q) => (q ? [q.dir, q.trend !== '혼조' && q.trend !== '초반' ? q.trend : null, q.vol === '높음' ? '변동↑' : q.vol === '낮음' ? '변동↓' : null].filter(Boolean).join('·') : '');
