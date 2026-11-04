// 미국 주식 시세: 현재가, 호가, 분봉(OHLCV)
import { toQuoteExchange } from './exchanges.js';

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

// 뉴욕 현지 일시(YYYYMMDD, HHMMSS) → epoch ms (서머타임 자동 반영)
const NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
export function nyLocalToEpoch(ymd, hms) {
  const [Y, M, D] = [+ymd.slice(0, 4), +ymd.slice(4, 6), +ymd.slice(6, 8)];
  const [h, m, s] = [+hms.slice(0, 2), +hms.slice(2, 4), +hms.slice(4, 6) || 0];
  for (const off of [4, 5]) {
    const t = Date.UTC(Y, M - 1, D, h + off, m, s);
    const p = Object.fromEntries(NY.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    if (+p.hour % 24 === h && +p.minute === m && +p.day === D) return t;
  }
  return Date.UTC(Y, M - 1, D, h + 5, m, s);
}
function epochToNyKey(t) {
  const p = Object.fromEntries(NY.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}${String(+p.hour % 24).padStart(2, '0')}${p.minute}00`;
}

/**
 * 해외주식 현재체결가 [v1_해외주식-009]  GET /uapi/overseas-price/v1/quotations/price  (tr_id HHDFS00000300, 실전/모의 공통)
 * @returns {{symbol, exchange, last, prevClose, diff, rate, volume, amount, tradable}}
 */
export async function getPrice(client, symbol, exchange = 'NAS') {
  const excd = toQuoteExchange(exchange);
  const { body } = await client.get('/uapi/overseas-price/v1/quotations/price', {
    trId: 'HHDFS00000300',
    params: { AUTH: '', EXCD: excd, SYMB: symbol.toUpperCase() },
  });
  const o = body.output || {};
  const down = o.sign === '4' || o.sign === '5';
  const diff = Math.abs(num(o.diff) ?? 0) * (down ? -1 : 1);
  return {
    symbol: symbol.toUpperCase(),
    exchange: excd,
    last: num(o.last),
    prevClose: num(o.base),
    diff,
    rate: num(o.rate),
    volume: num(o.tvol),
    amount: num(o.tamt),
    tradable: o.ordy !== '매수불가',
    raw: o,
  };
}

/**
 * 해외주식 현재가 호가 [v1_해외주식-033]  GET /uapi/overseas-price/v1/quotations/inquire-asking-price  (tr_id HHDFS76200100)
 * 여호수아/모세가 지정가를 정할 때 사용 (최우선 매수/매도호가)
 */
export async function getOrderbook(client, symbol, exchange = 'NAS') {
  const excd = toQuoteExchange(exchange);
  const { body } = await client.get('/uapi/overseas-price/v1/quotations/inquire-asking-price', {
    trId: 'HHDFS76200100',
    params: { AUTH: '', EXCD: excd, SYMB: symbol.toUpperCase() },
  });
  const pick = (k) => {
    for (const out of [body.output2, body.output1, body.output3]) {
      const o = Array.isArray(out) ? out[0] : out;
      if (o && o[k] !== undefined && o[k] !== '') return num(o[k]);
    }
    return null;
  };
  const bid = pick('pbid1');
  const ask = pick('pask1');
  const bidQty = pick('vbid1');
  const askQty = pick('vask1');
  return { symbol: symbol.toUpperCase(), exchange: excd, bid, ask, bidQty, askQty, bidAskRatio: bidQty && askQty ? bidQty / askQty : null };
}

/**
 * 해외주식분봉조회 [v1_해외주식-030]  GET /uapi/overseas-price/v1/quotations/inquire-time-itemchartprice  (tr_id HHDFS76950200)
 * 한 번에 최대 120개 → KEYB(마지막 봉 시각 - n분)로 이어받기
 * @param {{interval?:number, count?:number, includePrevDay?:boolean}} opts
 * @returns {Promise<Array<{t:number, time:string, open:number, high:number, low:number, close:number, volume:number}>>} 오래된 순
 */
export async function getMinuteCandles(client, symbol, exchange = 'NAS', { interval = 5, count = 120, includePrevDay = true } = {}) {
  const excd = toQuoteExchange(exchange);
  const out = new Map();
  let keyb = '';
  let next = '';
  for (let page = 0; page < 10 && out.size < count; page++) {
    const { body } = await client.get('/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice', {
      trId: 'HHDFS76950200',
      params: {
        AUTH: '',
        EXCD: excd,
        SYMB: symbol.toUpperCase(),
        NMIN: String(interval),
        PINC: includePrevDay || page > 0 ? '1' : '0', // 다음 조회 시 반드시 "1"
        NEXT: next,
        NREC: String(Math.min(120, count - out.size)),
        FILL: '',
        KEYB: keyb,
      },
    });
    const rows = Array.isArray(body.output2) ? body.output2 : [];
    if (!rows.length) break;
    let oldest = Infinity;
    for (const r of rows) {
      if (!r.xymd || !r.xhms) continue;
      const t = nyLocalToEpoch(r.xymd, r.xhms);
      oldest = Math.min(oldest, t);
      out.set(t, {
        t,
        time: `${r.xymd.slice(0, 4)}-${r.xymd.slice(4, 6)}-${r.xymd.slice(6, 8)} ${r.xhms.slice(0, 2)}:${r.xhms.slice(2, 4)}`,
        open: num(r.open),
        high: num(r.high),
        low: num(r.low),
        close: num(r.last),
        volume: num(r.evol),
      });
    }
    const more = body.output1 && (body.output1.next === '1' || body.output1.more === '1');
    if (!more || !isFinite(oldest)) break;
    next = '1';
    keyb = epochToNyKey(oldest - interval * 60 * 1000);
  }
  return [...out.values()].sort((a, b) => a.t - b.t).slice(-count);
}

/**
 * 해외주식 잔고 [v1_해외주식-006]  GET /uapi/overseas-stock/v1/trading/inquire-balance  (TTTS3012R / 모의 VTTS3012R)
 * 모세의 보유 종목 감시용
 */
export async function getHoldings(client, { exchange, currency = 'USD' } = {}) {
  const cfg = client.cfg;
  const trId = cfg.isReal ? 'TTTS3012R' : 'VTTS3012R';
  // 'NASD'는 실전에선 미국 전체, 모의에선 나스닥만 → 모의는 거래소별로 따로 조회해 합친다
  const exchanges = exchange ? [exchange] : cfg.isReal ? ['NASD'] : ['NASD', 'NYSE', 'AMEX'];
  const items = [];
  const seen = new Set();
  let summary = null;
  for (const ex of exchanges) {
    let fk = '';
    let nk = '';
    let trCont = '';
    for (let page = 0; page < 10; page++) {
      const res = await client.get('/uapi/overseas-stock/v1/trading/inquire-balance', {
        trId,
        trCont,
        params: { CANO: cfg.cano, ACNT_PRDT_CD: cfg.acntPrdtCd, OVRS_EXCG_CD: ex, TR_CRCY_CD: currency, CTX_AREA_FK200: fk, CTX_AREA_NK200: nk },
      });
      for (const r of res.body.output1 || []) {
        const key = `${r.ovrs_pdno}:${r.ovrs_excg_cd}`;
        if (!num(r.ovrs_cblc_qty) || seen.has(key)) continue;
        seen.add(key);
        items.push({
          symbol: r.ovrs_pdno,
          name: r.ovrs_item_name,
          exchange: r.ovrs_excg_cd,
          qty: num(r.ovrs_cblc_qty),
          sellableQty: num(r.ord_psbl_qty),
          avgPrice: num(r.pchs_avg_pric),
          price: num(r.now_pric2),
          pnl: num(r.frcr_evlu_pfls_amt),
          pnlRate: num(r.evlu_pfls_rt),
        });
      }
      summary = res.body.output2 || summary;
      if (!['M', 'F'].includes(res.trCont)) break;
      trCont = 'N';
      fk = res.body.ctx_area_fk200 || '';
      nk = res.body.ctx_area_nk200 || '';
    }
  }
  return { items, summary };
}

/**
 * 티커 확인: 나스닥 → 뉴욕 → 아멕스 순으로 현재가를 조회해 실제 거래되는 종목인지 확인
 * @returns {Promise<{symbol, exchange, last, prevClose, rate} | null>}
 */
export async function resolveSymbol(client, symbol, prefer) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z.\-]{0,9}$/.test(sym)) return null;
  const order = [prefer, 'NAS', 'NYS', 'AMS'].filter((x, i, a) => x && a.indexOf(x) === i);
  for (const ex of order) {
    try {
      const p = await getPrice(client, sym, ex);
      if (p.last > 0) return { symbol: sym, exchange: p.exchange, last: p.last, prevClose: p.prevClose, rate: p.rate };
    } catch {
      /* 다음 거래소 시도 */
    }
  }
  return null;
}

/**
 * 한투(HTS/MTS) 관심종목 불러오기
 *   관심종목 그룹조회   GET /uapi/domestic-stock/v1/quotations/intstock-grouplist         tr_id HHKCM113004C7
 *   그룹별 종목조회     GET /uapi/domestic-stock/v1/quotations/intstock-stocklist-by-group tr_id HHKCM113004C6
 * 두 API 모두 국내주식 분류에 있고 HTS ID(USER_ID)가 필요하다. 그룹 안의 해외 종목 포함 여부는
 * 공식 문서에 명시돼 있지 않아, 결과에서 영문 티커만 골라 resolveSymbol로 검증해서 쓴다.
 */
export async function getKisWatchlist(client, htsId = client.cfg.htsId) {
  if (!htsId) throw new Error('.env에 KIS_HTS_ID(한국투자증권 HTS 아이디)를 넣어야 한투 관심종목을 불러올 수 있습니다.');
  const { body } = await client.get('/uapi/domestic-stock/v1/quotations/intstock-grouplist', {
    trId: 'HHKCM113004C7',
    params: { TYPE: '1', FID_ETC_CLS_CODE: '00', USER_ID: htsId },
  });
  const groups = (body.output2 || []).map((g) => ({ code: g.inter_grp_code, name: g.inter_grp_name, items: [] }));
  for (const g of groups) {
    const { body: b } = await client.get('/uapi/domestic-stock/v1/quotations/intstock-stocklist-by-group', {
      trId: 'HHKCM113004C6',
      params: { TYPE: '1', USER_ID: htsId, INTER_GRP_CODE: g.code, FID_ETC_CLS_CODE: '4', DATA_RANK: '', INTER_GRP_NAME: '', HTS_KOR_ISNM: '', CNTG_CLS_CODE: '' },
    });
    g.items = (b.output2 || []).map((r) => ({
      code: (r.jong_code || '').trim(),
      name: (r.hts_kor_isnm || '').trim(),
      exchCode: (r.exch_code || '').trim(),
      market: r.fid_mrkt_cls_code,
      looksUs: /^[A-Z][A-Z.\-]{0,9}$/.test((r.jong_code || '').trim()),
    }));
  }
  return groups;
}

/**
 * 실제 계좌 스냅샷 (포트폴리오 패널용)
 * 해외주식 체결기준현재잔고 [v1_해외주식-008]
 *   GET /uapi/overseas-stock/v1/trading/inquire-present-balance   tr_id CTRP6504R (모의 VTRP6504R)
 *   WCRC_FRCR_DVSN_CD=02(외화), NATN_CD=840(미국), TR_MKET_CD=00(전체), INQR_DVSN_CD=00(전체)
 *   output1: 종목별 잔고 / output2: 통화별 예수금 / output3: 계좌 합계
 * 증권사 앱과 같은 "체결 기준" 잔고라 당일 체결분까지 반영된다.
 */
export async function getAccount(client, { currency = 'USD' } = {}) {
  const cfg = client.cfg;
  const { body } = await client.get('/uapi/overseas-stock/v1/trading/inquire-present-balance', {
    trId: cfg.isReal ? 'CTRP6504R' : 'VTRP6504R',
    params: { CANO: cfg.cano, ACNT_PRDT_CD: cfg.acntPrdtCd, WCRC_FRCR_DVSN_CD: '02', NATN_CD: '840', TR_MKET_CD: '00', INQR_DVSN_CD: '00' },
  });
  const toQuote = { NASD: 'NAS', NAS: 'NAS', NYSE: 'NYS', NYS: 'NYS', AMEX: 'AMS', AMS: 'AMS' };
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []);

  const holdings = list(body.output1)
    .filter((r) => num(r.cblc_qty13) > 0)
    .map((r) => {
      const qty = num(r.cblc_qty13);
      const avgPrice = num(r.avg_unpr3);
      const price = num(r.ovrs_now_pric1);
      return {
        symbol: (r.pdno || '').trim(),
        name: (r.prdt_name || r.ovrs_item_name || '').trim(),
        exchange: r.ovrs_excg_cd,
        quoteExchange: toQuote[r.ovrs_excg_cd] || 'NAS',
        qty,
        sellableQty: num(r.ord_psbl_qty1),
        avgPrice,
        price,
        purchaseAmount: num(r.frcr_pchs_amt) ?? (avgPrice != null ? avgPrice * qty : null),
        evalAmount: num(r.frcr_evlu_amt2) ?? (price != null ? price * qty : null),
        pnl: num(r.evlu_pfls_amt2),
        pnlRate: num(r.evlu_pfls_rt1),
      };
    });

  const rows = list(body.output2);
  const cashRow = rows.find((r) => r.crcy_cd === currency) || rows[0] || {};
  const cash = {
    currency,
    deposit: num(cashRow.frcr_dncl_amt_2) ?? 0, // 외화 예수금
    withdrawable: num(cashRow.frcr_drwg_psbl_amt_1), // 외화 출금가능
    exchangeRate: num(cashRow.frst_bltn_exrt),
  };

  const purchase = holdings.reduce((s, h) => s + (h.purchaseAmount || 0), 0);
  const stocks = holdings.reduce((s, h) => s + (h.evalAmount || 0), 0);
  const pnl = holdings.reduce((s, h) => s + (h.pnl ?? (h.evalAmount || 0) - (h.purchaseAmount || 0)), 0);
  return {
    env: cfg.env,
    fetchedAt: new Date().toISOString(),
    cash,
    holdings,
    totals: {
      purchase: round2(purchase),
      stocks: round2(stocks),
      pnl: round2(pnl),
      pnlRate: purchase ? round2((pnl / purchase) * 100) : 0,
      total: round2(cash.deposit + stocks), // 총 평가금액 = 외화 예수금 + Σ(보유수량 × 현재가)
    },
    raw: { output3: body.output3 || null },
  };
}
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * 해외주식 상품기본정보 [v1_해외주식-034]  GET /uapi/overseas-price/v1/quotations/search-info  (tr_id CTPF1702R)
 * 위험 상품 판별용: 상품분류명, ETP 추적수익률배수(레버리지/인버스), PTP 여부, 거래정지·상장폐지
 * PRDT_TYPE_CD: 512 나스닥 / 513 뉴욕 / 529 아멕스
 */
export async function getProductInfo(client, symbol, exchange = 'NAS') {
  const excd = toQuoteExchange(exchange);
  const type = { NAS: '512', NYS: '513', AMS: '529', BAQ: '512', BAY: '513', BAA: '529' }[excd] || '512';
  const { body } = await client.get('/uapi/overseas-price/v1/quotations/search-info', {
    trId: 'CTPF1702R',
    params: { PRDT_TYPE_CD: type, PDNO: symbol.toUpperCase() },
  });
  const o = body.output || {};
  return {
    symbol: symbol.toUpperCase(),
    name: (o.prdt_name || o.ovrs_item_name || '').trim(),
    engName: (o.prdt_eng_name || '').trim(),
    classCode: o.prdt_clsf_cd || '',
    className: (o.prdt_clsf_name || '').trim(), // 예: 보통주, ETF, ADR ...
    stockDivision: o.ovrs_stck_dvsn_cd || '', // 해외주식구분코드
    etpMultiple: num(o.etp_chas_erng_rt_dbnb), // ETP 추적수익률배수 (2, 3, -1 ...)
    etfRiskCode: o.ovrs_stck_etf_risk_drtp_cd || '',
    ptp: o.ptp_item_yn === 'Y',
    delisted: o.lstg_abol_item_yn === 'Y',
    tradeStop: o.ovrs_stck_tr_stop_dvsn_cd || '', // 해외주식거래정지구분코드
    stopReason: o.ovrs_stck_stop_rson_cd || '',
    listedDate: o.lstg_dt || '',
    shares: num(o.lstg_stck_num), // 상장주식수 (시가총액 계산용)
    raw: o,
  };
}

/**
 * 해외주식 기간별시세 [v1_해외주식-010]  GET /uapi/overseas-price/v1/quotations/dailyprice  (tr_id HHDFS76240000, 실전/모의 공통)
 * 상대 거래량(RVol)의 기준이 되는 평소 거래량을 구하는 데 쓴다. 오래된 날 → 최근 날 순서로 돌려준다.
 */
export async function getDailyBars(client, symbol, exchange = 'NAS', { count = 30 } = {}) {
  const excd = toQuoteExchange(exchange);
  const { body } = await client.get('/uapi/overseas-price/v1/quotations/dailyprice', {
    trId: 'HHDFS76240000',
    params: { AUTH: '', EXCD: excd, SYMB: symbol.toUpperCase(), GUBN: '0', BYMD: '', MODP: '1' },
  });
  const rows = Array.isArray(body.output2) ? body.output2 : [];
  return rows
    .filter((r) => r.xymd)
    .map((r) => ({ date: `${r.xymd.slice(0, 4)}-${r.xymd.slice(4, 6)}-${r.xymd.slice(6, 8)}`, o: num(r.open), h: num(r.high), l: num(r.low), c: num(r.clos), v: num(r.tvol), amount: num(r.tamt) }))
    .slice(0, count)
    .reverse();
}

/**
 * 해외뉴스종합(제목) [해외주식-053]  GET /uapi/overseas-price/v1/quotations/news-title  (tr_id HHPSTH60100C1)
 * 종목 하나의 최근 뉴스 제목. 모의투자에서는 지원하지 않을 수 있다.
 */
export async function getNews(client, symbol = '', { nation = 'US', exchange = '', cts = '', raw = false } = {}) {
  const { body } = await client.get('/uapi/overseas-price/v1/quotations/news-title', {
    trId: 'HHPSTH60100C1',
    params: { INFO_GB: '', CLASS_CD: '', NATION_CD: nation, EXCHANGE_CD: exchange, SYMB: symbol.toUpperCase(), DATA_DT: '', DATA_TM: '', CTS: cts },
  });
  const list = Array.isArray(body.outblock1) ? body.outblock1 : Array.isArray(body.output) ? body.output : [];
  // KIS 뉴스 시각은 한국 시각 → epoch(at)과 뉴욕 날짜·시각으로 바꿔 다른 출처(야후·Alpha Vantage)와 맞춘다
  const NYF = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const rows = list.map((r) => {
    const dt = r.data_dt || '';
    const tm = (r.data_tm || '000000').padEnd(6, '0');
    const at = dt.length === 8 ? Date.UTC(+dt.slice(0, 4), +dt.slice(4, 6) - 1, +dt.slice(6, 8), +tm.slice(0, 2) - 9, +tm.slice(2, 4)) : null;
    const p = at ? Object.fromEntries(NYF.formatToParts(new Date(at)).map((x) => [x.type, x.value])) : null;
    return {
    key: r.news_key || '',
    at,
    date: p ? `${p.year}-${p.month}-${p.day}` : null,
    time: p ? `${String(+p.hour % 24).padStart(2, '0')}:${p.minute}` : null,
    source: (r.source || '').trim(),
    category: (r.class_name || '').trim(),
    symbol: (r.symb || '').trim(),
    name: (r.symb_name || '').trim(),
    title: (r.title || '').trim(),
    };
  });
  if (!raw) return rows;
  return { rows, keys: Object.keys(body), first: list[0] || null, next: body.cts || body.CTS || body.ctx_area_nk || null };
}
