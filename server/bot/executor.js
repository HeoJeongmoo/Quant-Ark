// 안심 체결 엔진: 주문 → 체결 확인 → 미체결이면 취소 후 더 공격적인 가격으로 재주문
//
// KIS 미국주식은 정규장 "시장가" 주문 코드가 없다 (모의투자는 지정가만 가능).
// 그래서 "시장가 정산" = 현재 매수호가보다 충분히 낮은 지정가(즉시 체결형 지정가)로 보낸다.
//
// 매도 단계 (urgency)
//   stop : 매수호가 -0.2% → 20초 → -1% → 20초 → -3% (사실상 시장가) → 이후 60초마다 -3% 재시도
//   take : 매수호가 그대로 → 45초 → -0.3% → 30초 → -1.5% → 이후 stop 마지막 단계와 동일
// 매수: 최우선 매도호가 지정가(상한 maxPrice) → 60초 안에 안 되면 잔량 취소 (추격 매수 안 함)
import fs from 'node:fs';
import path from 'node:path';
import * as journal from './journal.js';

const FILE = path.resolve(process.env.BOT_ORDERS_FILE || 'data/bot-orders.json');
const SELL_STAGES = {
  stop: [{ slip: 0.002, wait: 20 }, { slip: 0.01, wait: 20 }, { slip: 0.03, wait: 30 }],
  take: [{ slip: 0, wait: 45 }, { slip: 0.003, wait: 30 }, { slip: 0.015, wait: 30 }, { slip: 0.03, wait: 30 }],
};
const RETRY_LAST_SEC = 60;
const MAX_RETRIES = 8;
const BUY_WAIT_SEC = 60;
const normNo = (x) => String(x || '').replace(/^0+/, '');

export function createExecutor({ kis, emit, getEnv, nyYmd, dryRunFor, onFill = () => {}, stages = SELL_STAGES, buyWaitSec = BUY_WAIT_SEC, retrySec = RETRY_LAST_SEC }) {
  let orders = [];
  try {
    orders = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    orders = [];
  }
  const save = () => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(orders, null, 2));
  };
  const active = () => orders.filter((o) => o.status === 'working');
  const busySymbols = () => new Set(active().map((o) => o.symbol));

  async function send(o, stage) {
    const dryRun = dryRunFor();
    let res;
    if (o.side === 'buy') {
      res = await kis.joshuaBuy({ symbol: o.symbol, exchange: o.exchange, qty: o.remaining, style: 'best', maxPrice: o.maxPrice, dryRun });
    } else {
      res = await kis.placeOrder({ side: 'sell', type: 'market', slippage: stage.slip, symbol: o.symbol, exchange: o.exchange, qty: o.remaining, dryRun, agent: '모세' });
    }
    return res;
  }

  /** @param {{side:'buy'|'sell', symbol, exchange, qty, maxPrice?, urgency?:'stop'|'take', reason, strategies?:string[], agent:string, action?:string}} req */
  async function submit(req) {
    if (active().some((o) => o.symbol === req.symbol && o.side === req.side)) return { skipped: '같은 종목·방향 주문이 이미 진행 중' };
    const o = { id: `${req.side}-${req.symbol}-${Date.now()}`, ...req, remaining: req.qty, filled: 0, fillValue: 0, stage: 0, retries: 0, status: 'working', createdAt: new Date().toISOString(), legs: [] };
    const stage = req.side === 'sell' ? stages[req.urgency || 'stop'][0] : { wait: buyWaitSec };
    let res;
    try {
      res = await send(o, stage);
    } catch (e) {
      emit('order-error', req.side === 'buy' ? 'trA' : 'trB', `${req.symbol} ${req.side === 'buy' ? '매수' : '매도'} 주문 실패: ${e.message}`, { order: o, error: e.message }, 'warn');
      // 주문가능금액 초과로 거절되면 그 순간의 KIS 매수가능 금액을 같이 남긴다 (원인 확인용)
      if (req.side === 'buy' && /APBK0952|주문가능금액/.test(e.message) && kis.getBuyingPower) {
        kis
          .getBuyingPower({ symbol: req.symbol, exchange: req.exchange, price: req.maxPrice || 1 })
          .then((bp) => emit('order-error', 'trA', `${req.symbol} 거절 직후 KIS 매수가능 조회: 주문가능 외화 $${bp.orderableUsd} · 해외주문가능 $${bp.overseasOrderable} · 주문가능 ${bp.qty}주 · 매도재사용 $${bp.sellReuseUsd} (주문 ${req.qty}주 × 상한 $${req.maxPrice})`, { buyingPower: bp.raw }, 'warn'))
          .catch(() => null);
      }
      return { error: e.message };
    }
    if (res.dryRun) {
      emit('order-dry', req.side === 'buy' ? 'trA' : 'trB', `${req.symbol} ${req.side === 'buy' ? '매수' : '매도'} ${req.qty}주 @ $${res.price} 주문안 (실전 주문 잠금: KIS_ENABLE_REAL_ORDERS=false)`, { order: { ...o, price: res.price } }, 'warn');
      return { dryRun: true, price: res.price };
    }
    o.legs.push({ orderNo: normNo(res.orderNo), qty: res.qty, price: res.price, at: Date.now(), deadline: Date.now() + stage.wait * 1000, filled: 0, fillValue: 0 });
    o.price = res.price;
    orders.push(o);
    save();
    emit('order', req.side === 'buy' ? 'trA' : 'trB', `${req.symbol} ${req.side === 'buy' ? '매수' : '매도'} ${res.qty}주 지정가 $${res.price} 전송 (주문번호 ${normNo(res.orderNo)})${req.side === 'sell' ? ` · ${req.urgency === 'stop' ? '손절' : '익절'} 1단계` : ''}`, { order: o });
    return { ok: true, order: o };
  }

  function applyFill(o, leg, row) {
    const newQty = row.filledQty - leg.filled;
    if (newQty <= 0) return;
    const newValue = row.filledQty * row.filledPrice - leg.fillValue;
    const px = newValue / newQty;
    leg.filled = row.filledQty;
    leg.fillValue = row.filledQty * row.filledPrice;
    o.filled += newQty;
    o.fillValue += newValue;
    o.remaining = Math.max(0, o.qty - o.filled);
    onFill(o, newQty, px);
    journal.recordFill({ env: getEnv(), side: o.side, symbol: o.symbol, exchange: o.exchange, qty: newQty, price: Math.round(px * 10000) / 10000, orderNo: leg.orderNo, agent: o.agent, strategies: o.strategies, reason: o.reason, meta: o.meta });
    emit('fill', o.side === 'buy' ? 'trA' : 'trB', `${o.symbol} ${o.side === 'buy' ? '매수' : '매도'} ${newQty}주 체결 @ $${px.toFixed(2)}${o.remaining ? ` (잔량 ${o.remaining}주)` : ' · 전량 체결'}`, { order: o, fillQty: newQty, fillPrice: px });
  }

  // 엔진이 매 틱 호출
  async function poll() {
    const list = active();
    if (!list.length) return;
    let rows;
    try {
      rows = await kis.getOrderFills({ fromYmd: nyYmd() });
    } catch (e) {
      emit('order-error', 'trB', `체결 내역 조회 실패: ${e.message}. 다음 틱에 다시 확인합니다.`, {}, 'warn');
      return;
    }
    const byNo = new Map(rows.filter((r) => !r.isCancel).map((r) => [r.orderNo, r]));
    for (const o of list) {
      const leg = o.legs[o.legs.length - 1];
      const row = byNo.get(leg.orderNo);
      if (row) {
        applyFill(o, leg, row);
        if (row.rejectReason) leg.rejected = row.rejectReason;
      }
      if (leg.failed && Date.now() < leg.deadline) continue;
      const legOpen = leg.failed ? false : row ? row.unfilledQty > 0 && !leg.rejected : true;
      if (o.remaining <= 0) {
        o.status = 'filled';
        o.doneAt = new Date().toISOString();
        continue;
      }
      if (legOpen && Date.now() < leg.deadline) continue;

      // 마감 시간 지남 → 잔량 취소
      if (legOpen && row) {
        try {
          await kis.cancelOrder({ symbol: o.symbol, exchange: o.exchange, orderNo: leg.orderNo, qty: row.unfilledQty });
          emit('order-cancel', o.side === 'buy' ? 'trA' : 'trB', `${o.symbol} 미체결 ${row.unfilledQty}주 취소${o.side === 'sell' ? ', 더 낮은 가격으로 다시 냅니다' : ' (추격 매수 안 함)'}`, { order: o });
        } catch (e) {
          // 이미 체결됐을 수 있음 → 다음 틱에 체결 내역으로 확인
          emit('order-error', o.side === 'buy' ? 'trA' : 'trB', `${o.symbol} 취소 실패: ${e.message} (체결 여부 재확인)`, { order: o }, 'warn');
          leg.deadline = Date.now() + 10_000;
          continue;
        }
      } else if (legOpen && !row && Date.now() < leg.deadline + 30_000) {
        continue; // 조회 지연: 조금 더 기다림
      }

      if (o.side === 'buy') {
        o.status = o.filled ? 'partial' : 'cancelled';
        o.doneAt = new Date().toISOString();
        if (!o.filled) emit('order-cancel', 'trA', `${o.symbol} 매수 미체결로 종료 (0주)`, { order: o });
        continue;
      }
      // 매도: 다음 단계로 재주문
      const stgs = stages[o.urgency || 'stop'];
      if (o.stage + 1 >= stgs.length) o.retries++;
      o.stage = Math.min(o.stage + 1, stgs.length - 1);
      if (o.retries > MAX_RETRIES) {
        o.status = 'stuck';
        emit('alarm', 'trB', `⚠️ ${o.symbol} 매도 잔량 ${o.remaining}주가 ${MAX_RETRIES}회 재시도에도 체결되지 않았습니다. 직접 확인이 필요합니다.`, { order: o }, 'error');
        continue;
      }
      const st = stgs[o.stage];
      try {
        const res = await send(o, st);
        o.legs.push({ orderNo: normNo(res.orderNo), qty: res.qty, price: res.price, at: Date.now(), deadline: Date.now() + (o.retries ? retrySec : st.wait) * 1000, filled: 0, fillValue: 0 });
        o.price = res.price;
        emit('order', 'trB', `${o.symbol} 잔량 ${res.qty}주 ${o.stage + 1}단계 재주문 @ $${res.price}${st.slip >= 0.03 ? ' (시장가 정산)' : ''}`, { order: o });
      } catch (e) {
        o.legs.push({ orderNo: '', qty: o.remaining, price: null, at: Date.now(), deadline: Date.now() + 15_000, filled: 0, fillValue: 0, failed: e.message });
        emit('order-error', 'trB', `${o.symbol} 재주문 실패: ${e.message}. 15초 뒤 다시 시도`, { order: o }, 'warn');
      }
    }
    // 끝난 주문은 최근 50건만 보관
    const done = orders.filter((o) => o.status !== 'working');
    orders = [...active(), ...done.slice(-50)];
    save();
  }

  return { submit, poll, active, busySymbols, all: () => orders };
}
