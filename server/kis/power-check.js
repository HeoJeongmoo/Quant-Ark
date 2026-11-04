// npm run kis:power -- NVTS 9.04  → 그 종목·가격으로 지금 몇 주 살 수 있는지 KIS에 직접 물어본다
import { createKis } from './index.js';

const kis = createKis();
const sym = (process.argv[2] || 'AAPL').toUpperCase();
console.log(kis.describe());
const ex = (await kis.resolveSymbol(sym).catch(() => null))?.exchange || 'NAS';
const price = Number(process.argv[3]) || (await kis.getPrice(sym, ex)).last;
const acct = await kis.getAccount();
console.log(`\n잔고 조회: 외화 예수금 $${acct.cash.deposit} · 출금가능 $${acct.cash.withdrawable ?? '-'} · 총 평가 $${acct.totals.total}`);
const bp = await kis.getBuyingPower({ symbol: sym, exchange: ex, price });
console.log(`\n매수가능 조회 (${sym} ${ex} @ $${price}):`);
console.log(`  주문가능 외화금액   $${bp.orderableUsd}`);
console.log(`  매도 재사용 가능    $${bp.sellReuseUsd}`);
console.log(`  해외 주문가능금액   $${bp.overseasOrderable}`);
console.log(`  주문가능수량        ${bp.qty}주 (최대 ${bp.maxQty}주)`);
console.log(`  원화 환전 후        $${bp.afterExchangeUsd} · ${bp.afterExchangeQty}주 (환율 ${bp.exchangeRate})`);
console.log(`\n원본: ${JSON.stringify(bp.raw)}`);
process.exit(0);
