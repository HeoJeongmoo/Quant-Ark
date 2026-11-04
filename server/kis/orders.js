// 해외주식 주문 [v1_해외주식-001]  POST /uapi/overseas-stock/v1/trading/order
//
// 미국 주문 구분(ORD_DVSN):
//   매수(TTTT1002U): 00 지정가, 32 LOO(장개시지정가), 34 LOC(장마감지정가)
//   매도(TTTT1006U): 00 지정가, 31 MOO(장개시시장가), 32 LOO, 33 MOC(장마감시장가), 34 LOC
//   모의투자(매수 VTTT1002U, 매도 VTTT1001U)는 00 지정가만 가능
// ※ 정규장 중 즉시 체결되는 "시장가" 주문 코드는 없다. type:'market'은 현재 호가에
//   슬리피지 한도를 더한 "즉시 체결형 지정가(marketable limit)"로 보낸다.
import { toOrderExchange, toQuoteExchange, roundUsPrice } from './exchanges.js';
import { getOrderbook, getPrice } from './quotes.js';

const ORD_DVSN = { limit: '00', moo: '31', loo: '32', moc: '33', loc: '34' };
const BUY_ALLOWED = new Set(['limit', 'market', 'loo', 'loc']);
const PRICELESS = new Set(['moo', 'moc']);

function trIdFor(side, isReal) {
  if (side === 'buy') return isReal ? 'TTTT1002U' : 'VTTT1002U';
  return isReal ? 'TTTT1006U' : 'VTTT1001U'; // 모의 매도는 V+실전ID가 아니라 VTTT1001U
}

export class OrderRejected extends Error {}

/**
 * 해외주식 매수/매도 주문
 * @param {import('./client.js').KisClient} client
 * @param {{side:'buy'|'sell', symbol:string, exchange?:string, qty:number,
 *          type?:'limit'|'market'|'moo'|'loo'|'moc'|'loc', price?:number,
 *          slippage?:number, dryRun?:boolean, agent?:string}} o
 */
export async function placeOrder(client, o) {
  const cfg = client.cfg;
  const side = o.side;
  const type = o.type || 'limit';
  const symbol = String(o.symbol || '').toUpperCase();
  const qty = Number(o.qty);
  const exch = toOrderExchange(o.exchange || 'NASD');

  if (side !== 'buy' && side !== 'sell') throw new OrderRejected('side는 buy 또는 sell이어야 합니다.');
  if (!/^[A-Z.\-]{1,12}$/.test(symbol)) throw new OrderRejected(`종목코드 형식 오류: ${o.symbol}`);
  if (!Number.isInteger(qty) || qty <= 0) throw new OrderRejected('수량은 1 이상의 정수여야 합니다.');
  if (type !== 'market' && !ORD_DVSN[type]) throw new OrderRejected(`지원하지 않는 주문 유형: ${type}`);
  if (side === 'buy' && !BUY_ALLOWED.has(type)) throw new OrderRejected(`미국 매수는 ${[...BUY_ALLOWED].join(', ')}만 가능합니다. (MOO/MOC는 매도 전용)`);
  if (!cfg.isReal && !(type === 'limit' || type === 'market')) throw new OrderRejected('모의투자는 지정가(00) 주문만 가능합니다.');

  // 가격 결정
  let price;
  let basis = null;
  if (PRICELESS.has(type)) {
    price = 0;
    // 금액 한도 확인용 참고가
    basis = { ref: (await getPrice(client, symbol, toQuoteExchange(exch))).last, slippage: 0 };
  } else if (type === 'market') {
    const slip = o.slippage ?? cfg.marketSlippage;
    const ob = await getOrderbook(client, symbol, toQuoteExchange(exch)).catch(() => null);
    let ref = side === 'buy' ? ob?.ask : ob?.bid;
    if (!ref) ref = (await getPrice(client, symbol, toQuoteExchange(exch))).last;
    if (!ref) throw new OrderRejected('기준 호가를 가져오지 못해 시장가(즉시 체결형 지정가) 주문을 보낼 수 없습니다.');
    price = roundUsPrice(side === 'buy' ? ref * (1 + slip) : ref * (1 - slip), side === 'buy' ? 'up' : 'down');
    basis = { ref, slippage: slip };
  } else {
    price = Number(o.price);
    if (!(price > 0)) throw new OrderRejected('지정가 주문에는 0보다 큰 price가 필요합니다.');
    price = roundUsPrice(price);
  }

  // 사고 방지 가드
  const notional = (price || basis?.ref || 0) * qty;
  // 금액 한도는 매수에만 적용 (매도는 위험을 줄이는 주문이라 손절이 한도에 막히면 안 된다)
  if (side === 'buy' && notional > cfg.maxOrderUsd) throw new OrderRejected(`주문 금액 $${notional.toFixed(2)}가 한도 $${cfg.maxOrderUsd}(KIS_MAX_ORDER_USD)를 넘습니다.`);
  if (cfg.isReal && !cfg.enableRealOrders && !o.dryRun) {
    throw new OrderRejected('실전 주문이 잠겨 있습니다. .env에 KIS_ENABLE_REAL_ORDERS=true를 설정해야 실제 주문이 나갑니다.');
  }

  const trId = trIdFor(side, cfg.isReal);
  const body = {
    CANO: cfg.cano,
    ACNT_PRDT_CD: cfg.acntPrdtCd,
    OVRS_EXCG_CD: exch,
    PDNO: symbol,
    ORD_QTY: String(qty),
    OVRS_ORD_UNPR: PRICELESS.has(type) ? '0' : price.toFixed(price >= 1 ? 2 : 4),
    CTAC_TLNO: '',
    MGCO_APTM_ODNO: '',
    SLL_TYPE: side === 'sell' ? '00' : '',
    ORD_SVR_DVSN_CD: '0',
    ORD_DVSN: type === 'market' ? '00' : ORD_DVSN[type],
  };
  const summary = { agent: o.agent || 'user', env: cfg.env, side, symbol, exchange: exch, qty, type, price: PRICELESS.has(type) ? null : price, notional: Number(notional.toFixed(2)), basis, trId };

  if (o.dryRun) return { ok: true, dryRun: true, ...summary, request: { ...body, CANO: `${cfg.cano.slice(0, 2)}******` } };

  const { body: res } = await client.post('/uapi/overseas-stock/v1/trading/order', { trId, body });
  const out = res.output || {};
  return { ok: true, orderNo: out.ODNO, orderTime: out.ORD_TMD, branch: out.KRX_FWDG_ORD_ORGNO, message: res.msg1, ...summary };
}

export const buy = (client, o) => placeOrder(client, { ...o, side: 'buy' });
export const sell = (client, o) => placeOrder(client, { ...o, side: 'sell' });

/**
 * 해외주식 정정취소주문 [v1_해외주식-003]  POST /uapi/overseas-stock/v1/trading/order-rvsecncl
 * 실전 TTTT1004U / 모의 VTTT1004U.  RVSE_CNCL_DVSN_CD 02 = 취소 (단가 0)
 */
export async function cancelOrder(client, { symbol, exchange = 'NASD', orderNo, qty }) {
  const cfg = client.cfg;
  if (!orderNo) throw new OrderRejected('취소할 주문번호가 없습니다.');
  const body = {
    CANO: cfg.cano,
    ACNT_PRDT_CD: cfg.acntPrdtCd,
    OVRS_EXCG_CD: toOrderExchange(exchange),
    PDNO: String(symbol).toUpperCase(),
    ORGN_ODNO: String(orderNo),
    RVSE_CNCL_DVSN_CD: '02',
    ORD_QTY: String(qty),
    OVRS_ORD_UNPR: '0',
    MGCO_APTM_ODNO: '',
    ORD_SVR_DVSN_CD: '0',
  };
  const { body: res } = await client.post('/uapi/overseas-stock/v1/trading/order-rvsecncl', { trId: cfg.isReal ? 'TTTT1004U' : 'VTTT1004U', body });
  return { ok: true, orderNo: res.output?.ODNO, message: res.msg1 };
}

/**
 * 해외주식 주문체결내역 [v1_해외주식-007]  GET /uapi/overseas-stock/v1/trading/inquire-ccnl
 * 실전 TTTS3035R / 모의 VTTS3035R. 날짜는 현지(뉴욕) 기준 YYYYMMDD.
 * 모의투자는 PDNO, OVRS_EXCG_CD 공란 / SLL_BUY_DVSN·CCLD_NCCS_DVSN "00"만 가능, 주문번호(ODNO) 검색 불가.
 * @returns {Promise<Array<{orderNo, origOrderNo, side:'buy'|'sell', symbol, qty, filledQty, unfilledQty, filledPrice, status, rejectReason, isCancel:boolean}>>}
 */
export async function getOrderFills(client, { fromYmd, toYmd } = {}) {
  const cfg = client.cfg;
  const n = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
  const rows = [];
  let nk = '';
  let fk = '';
  let trCont = '';
  for (let page = 0; page < 5; page++) {
    const { body, trCont: next } = await client.get('/uapi/overseas-stock/v1/trading/inquire-ccnl', {
      trId: cfg.isReal ? 'TTTS3035R' : 'VTTS3035R',
      trCont,
      params: {
        CANO: cfg.cano,
        ACNT_PRDT_CD: cfg.acntPrdtCd,
        PDNO: cfg.isReal ? '%' : '',
        ORD_STRT_DT: fromYmd,
        ORD_END_DT: toYmd || fromYmd,
        SLL_BUY_DVSN: '00',
        CCLD_NCCS_DVSN: '00',
        OVRS_EXCG_CD: cfg.isReal ? '%' : '',
        SORT_SQN: 'DS',
        ORD_DT: '',
        ORD_GNO_BRNO: '',
        ODNO: '',
        CTX_AREA_NK200: nk,
        CTX_AREA_FK200: fk,
      },
    });
    const list = Array.isArray(body.output) ? body.output : body.output ? [body.output] : [];
    rows.push(...list);
    if (!(next === 'M' || next === 'F') || !list.length) break;
    trCont = 'N';
    nk = body.ctx_area_nk200 || '';
    fk = body.ctx_area_fk200 || '';
  }
  return rows.map((r) => ({
    orderNo: String(r.odno || '').replace(/^0+/, ''),
    origOrderNo: String(r.orgn_odno || '').replace(/^0+/, ''),
    side: r.sll_buy_dvsn_cd === '01' ? 'sell' : 'buy',
    symbol: String(r.pdno || '').trim(),
    qty: n(r.ft_ord_qty),
    filledQty: n(r.ft_ccld_qty),
    unfilledQty: n(r.nccs_qty),
    filledPrice: n(r.ft_ccld_unpr3),
    status: r.prcs_stat_name || '',
    rejectReason: r.rjct_rson_name || r.rjct_rson || '',
    isCancel: r.rvse_cncl_dvsn === '02' || /취소/.test(r.rvse_cncl_dvsn_name || ''),
  }));
}

/**
 * 해외주식 매수가능금액조회 [v1_해외주식-014]  GET /uapi/overseas-stock/v1/trading/inquire-psamount  (실전 TTTS3007R / 모의 VTTS3007R)
 * 예수금이 있어도 미체결 매수 주문, 수수료, 결제 전 금액 때문에 실제로 살 수 있는 금액은 더 적을 수 있어 주문 직전에 확인한다.
 */
export async function getBuyingPower(client, { symbol, exchange = 'NASD', price }) {
  const cfg = client.cfg;
  const n = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
  const { body } = await client.get('/uapi/overseas-stock/v1/trading/inquire-psamount', {
    trId: cfg.isReal ? 'TTTS3007R' : 'VTTS3007R',
    params: { CANO: cfg.cano, ACNT_PRDT_CD: cfg.acntPrdtCd, OVRS_EXCG_CD: toOrderExchange(exchange), OVRS_ORD_UNPR: String(price), ITEM_CD: String(symbol).toUpperCase() },
  });
  const o = body.output || {};
  return {
    currency: o.tr_crcy_cd || 'USD',
    orderableUsd: n(o.ord_psbl_frcr_amt), // 주문가능외화금액
    sellReuseUsd: n(o.sll_ruse_psbl_amt), // 매도 재사용 가능 금액
    overseasOrderable: n(o.ovrs_ord_psbl_amt), // 해외주문가능금액
    qty: n(o.ord_psbl_qty), // 주문가능수량 (외화 기준)
    maxQty: n(o.max_ord_psbl_qty), // 최대주문가능수량
    afterExchangeUsd: n(o.echm_af_ord_psbl_amt), // 원화 환전 후 주문가능금액 (통합증거금)
    afterExchangeQty: n(o.echm_af_ord_psbl_qty),
    exchangeRate: n(o.exrt),
    raw: o,
  };
}
