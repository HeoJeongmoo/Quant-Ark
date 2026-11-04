// 다윗의 전시장 탐색: 거래량 급증 + 매수 체결강도 상위 → 필터 → 후보 10~15개
//   해외주식 거래량급증 [해외주식-039]       GET /uapi/overseas-stock/v1/ranking/volume-surge  tr_id HHDFS76270000
//   해외주식 매수체결강도상위 [해외주식-040]  GET /uapi/overseas-stock/v1/ranking/volume-power  tr_id HHDFS76280000
// 모든 호출은 KisClient의 큐를 거치므로 요청 간격(모의 0.5초 / 실전 0.05초)이 자동으로 지켜진다.

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const rows = (body) => (Array.isArray(body.output2) ? body.output2 : Array.isArray(body.output) ? body.output : []);

async function surge(client, excd, { minutes = '3', volRange = '3' } = {}) {
  // MINX 3 = 5분 전 대비, VOL_RANG 3 = 1만주 이상
  const { body } = await client.get('/uapi/overseas-stock/v1/ranking/volume-surge', {
    trId: 'HHDFS76270000',
    params: { EXCD: excd, MINX: minutes, VOL_RANG: volRange, KEYB: '', AUTH: '' },
  });
  return rows(body).map((r) => ({
    symbol: (r.symb || '').trim(),
    exchange: (r.excd || excd).trim(),
    name: (r.knam || r.name || r.enam || r.ename || '').trim(),
    ename: (r.enam || r.ename || '').trim(),
    last: num(r.last),
    rate: num(r.rate),
    volume: num(r.tvol),
    amount: num(r.tamt) ?? (num(r.last) != null && num(r.tvol) != null ? num(r.last) * num(r.tvol) : null), // tamt가 없으면 현재가 × 거래량
    surgeRate: num(r.n_rate), // 기준 대비 거래량 증가율(%)
    baseVolume: num(r.n_tvol), // 기준 거래량
    tradable: r.e_ordyn ? r.e_ordyn !== 'X' && r.e_ordyn !== 'N' : true,
    _raw: r,
  }));
}

async function power(client, excd, { nday = '0', volRange = '3' } = {}) {
  // NDAY 0 = 당일, VOL_RANG 3 = 1만주 이상
  const { body } = await client.get('/uapi/overseas-stock/v1/ranking/volume-power', {
    trId: 'HHDFS76280000',
    params: { EXCD: excd, NDAY: nday, VOL_RANG: volRange, AUTH: '', KEYB: '' },
  });
  return rows(body).map((r) => ({
    symbol: (r.symb || '').trim(),
    exchange: (r.excd || excd).trim(),
    name: (r.knam || r.name || r.enam || r.ename || '').trim(),
    ename: (r.enam || r.ename || '').trim(),
    last: num(r.last),
    rate: num(r.rate),
    volume: num(r.tvol),
    amount: num(r.tamt) ?? (num(r.last) != null && num(r.tvol) != null ? num(r.last) * num(r.tvol) : null),
    power: num(r.tpow ?? r.powx ?? r.strn), // 당일체결강도(tpow) → 체결강도(powx) 순
    buyVol: num(r.asvl), // 매수체결량
    sellVol: num(r.bivl), // 매도체결량
    tradable: r.e_ordyn ? r.e_ordyn !== 'X' && r.e_ordyn !== 'N' : true,
    _raw: r,
  }));
}

/**
 * 시장 전체 탐색
 * @param {{exchanges?:string[], minPrice?:number, minAmount?:number, limit?:number, exclude?:string[]}} opts
 *   minPrice: 최소 주가($, 기본 5)  minAmount: 최소 당일 거래대금($, 기본 2,000만)
 * @returns {{candidates: Array, errors: string[], scannedAt: string}}
 */
// 공식 예제(kis_devlp examples_llm/overseas_stock/volume_surge, volume_power)의 output2 필드
// 실제 실전 서버 응답(2026-11-02 확인) 기준. 거래량급증은 knam/enam, 체결강도는 name/ename, 둘 다 tamt(거래대금)는 없음
export const EXPECTED_FIELDS = {
  surge: ['rsym', 'excd', 'symb', 'knam', 'last', 'sign', 'diff', 'rate', 'tvol', 'pask', 'pbid', 'n_tvol', 'n_diff', 'n_rate', 'enam', 'e_ordyn'],
  power: ['rsym', 'excd', 'symb', 'name', 'last', 'sign', 'diff', 'rate', 'tvol', 'pask', 'pbid', 'tpow', 'powx', 'ename', 'e_ordyn'],
};
import { quickCheck } from '../bot/risk.js';
// 지수 ETF는 위험하진 않지만 단타 후보로 의미가 없어 뺀다 (QQQ는 방주 판단용 지수)
const INDEX_ETFS = new Set(['QQQ', 'QQQM', 'SPY', 'SPLG', 'VOO', 'IVV', 'VTI', 'DIA', 'IWM', 'RSP']);

export async function discover(client, { exchanges = ['NAS', 'NYS'], minPrice = 5, minAmount = 20_000_000, limit = 15, exclude = [], raw = false } = {}) {
  const merged = new Map();
  const errors = [];
  const samples = {};
  const skip = new Set(exclude.map((s) => s.toUpperCase()));
  for (const ex of exchanges) {
    for (const [kind, fn] of [
      ['surge', surge],
      ['power', power],
    ]) {
      try {
        const rows = await fn(client, ex);
        if (rows[0]) {
          const keys = Object.keys(rows[0]._raw);
          samples[`${ex}.${kind}`] = { count: rows.length, keys, missing: EXPECTED_FIELDS[kind].filter((k) => !keys.includes(k)), first: rows[0]._raw };
        } else samples[`${ex}.${kind}`] = { count: 0 };
        for (const r0 of rows) {
          const { _raw, ...r } = r0;
          if (!r.symbol || skip.has(r.symbol)) continue;
          const cur = merged.get(r.symbol) || { ...r, sources: [] };
          Object.assign(cur, Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== '')));
          cur.sources = [...new Set([...cur.sources, kind])];
          merged.set(r.symbol, cur);
        }
      } catch (e) {
        errors.push(`${ex} ${kind}: ${e.message}`);
      }
    }
  }
  // 거래대금 단위 자동 확인: tamt ≈ last × tvol 이면 달러, 1/1000이면 천 달러 단위로 보고 보정
  const ratios = [...merged.values()].filter((c) => c.amount > 0 && c.last > 0 && c.volume > 0).map((c) => c.amount / (c.last * c.volume)).sort((a, b) => a - b);
  const med = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1;
  const amountUnit = med < 0.01 ? 1000 : 1;
  if (amountUnit !== 1) for (const c of merged.values()) if (c.amount != null) c.amount *= amountUnit;
  // 레버리지·인버스·변동성 상품, 워런트·유닛 등은 이름·티커로 1차 제외 (공식 분류 확인은 봇이 추가로 함)
  const isEtf = (c) => INDEX_ETFS.has(c.symbol) || quickCheck(c.symbol, `${c.name} ${c.ename || ''}`).length > 0;
  // 거래대금을 모르면 통과시키지 않는다 (예전엔 빈 값이면 통과 → 소형 잡주가 섞였음)
  const list = [...merged.values()].filter((c) => c.tradable && c.last >= minPrice && c.amount != null && c.amount >= minAmount && !isEtf(c));
  // 점수: 두 목록에 모두 오르면 가산, 거래량 증가율/체결강도/거래대금 순위를 합산
  const rank = (key) => {
    const sorted = [...list].filter((c) => c[key] != null).sort((a, b) => b[key] - a[key]);
    return new Map(sorted.map((c, i) => [c.symbol, 1 - i / Math.max(1, sorted.length)]));
  };
  // 체결강도 999.99는 표본이 작아 상한에 걸린 값이 많다 → 순위 계산에서는 300으로 눌러 둔다
  for (const c of list) if (c.power != null) c.powerRank = Math.min(c.power, 300);
  const rs = rank('surgeRate');
  const rp = rank('powerRank');
  const ra = rank('amount');
  for (const c of list) c.score = Math.round(((rs.get(c.symbol) || 0) + (rp.get(c.symbol) || 0) + (ra.get(c.symbol) || 0) + (c.sources.length > 1 ? 0.5 : 0)) * 100) / 100;
  list.sort((a, b) => b.score - a.score);
  const toQuote = { NAS: 'NAS', NYS: 'NYS', AMS: 'AMS', NASD: 'NAS', NYSE: 'NYS', AMEX: 'AMS' };
  return {
    scannedAt: new Date().toISOString(),
    filters: { minPrice, minAmount, exchanges },
    amountUnit: amountUnit === 1 ? 'USD' : 'thousand USD → 보정',
    ...(raw ? { raw: samples } : {}),
    errors,
    candidates: list.slice(0, limit).map((c) => ({ ...c, exchange: toQuote[c.exchange] || c.exchange })),
  };
}

/**
 * 해외주식 상승율/하락율 [해외주식-041]  GET /uapi/overseas-stock/v1/ranking/updown-rate  tr_id HHDFS76290000
 * 장전 갭 스캐너용: 전일 종가 대비 등락률 상위 (프리마켓 시간에는 프리마켓 가격 기준)
 */
export async function gainers(client, excd, { nday = '0', gubn = '1', volRange = '0' } = {}) {
  const { body } = await client.get('/uapi/overseas-stock/v1/ranking/updown-rate', {
    trId: 'HHDFS76290000',
    params: { EXCD: excd, NDAY: nday, GUBN: gubn, VOL_RANG: volRange, AUTH: '', KEYB: '' },
  });
  return rows(body).map((r) => {
    const last = num(r.last);
    const vol = num(r.tvol);
    return {
      symbol: (r.symb || '').trim(),
      exchange: (r.excd || excd).trim(),
      name: (r.name || r.knam || r.ename || r.enam || '').trim(),
      ename: (r.ename || r.enam || '').trim(),
      last,
      rate: num(r.rate), // 전일 종가 대비 등락률 %
      baseRate: num(r.n_rate),
      volume: vol,
      amount: num(r.tamt) ?? (last != null && vol != null ? last * vol : null),
      rank: num(r.rank),
      tradable: r.e_ordyn ? r.e_ordyn !== 'X' && r.e_ordyn !== 'N' : true,
      _raw: r,
    };
  });
}

/**
 * 장전 갭 후보: 상승률 상위(나스닥·뉴욕) → 갭·가격·거래량 필터
 * @returns {{scannedAt, candidates:Array, errors:string[], raw?:object}}
 */
export async function premarketGappers(client, { exchanges = ['NAS', 'NYS'], minGap = 4, maxGap = 25, minPrice = 5, maxPrice = 30, minVol = 500_000, minAmount = 5_000_000, raw = false } = {}) {
  const out = new Map();
  const errors = [];
  const samples = {};
  for (const ex of exchanges) {
    try {
      const list = await gainers(client, ex);
      if (list[0]) samples[ex] = { count: list.length, keys: Object.keys(list[0]._raw), first: list[0]._raw };
      for (const { _raw, ...c } of list) {
        if (!c.symbol || out.has(c.symbol)) continue;
        out.set(c.symbol, c);
      }
    } catch (e) {
      errors.push(`${ex} updown-rate: ${e.message}`);
    }
  }
  const all = [...out.values()];
  const candidates = all
    .filter((c) => c.tradable && c.rate >= minGap && c.rate <= maxGap && c.last >= minPrice && c.last <= maxPrice)
    .filter((c) => (c.volume ?? 0) >= minVol || (c.amount ?? 0) >= minAmount)
    .filter((c) => !INDEX_ETFS.has(c.symbol) && quickCheck(c.symbol, `${c.name} ${c.ename}`).length === 0)
    // 점수: 갭 크기와 거래대금(로그)을 함께
    .map((c) => ({ ...c, score: Math.round((c.rate / 10 + Math.log10(Math.max(1, c.amount || 1)) - 6) * 100) / 100 }))
    .sort((a, b) => b.score - a.score);
  return { scannedAt: new Date().toISOString(), scanned: all.length, filters: { minGap, maxGap, minPrice, maxPrice, minVol, minAmount }, errors, candidates, ...(raw ? { raw: samples } : {}) };
}
