// npm run kis:check -- AAPL NAS
// 토큰 발급, 현재가, 호가, 5분봉, 주문 dry-run(실제 주문 안 나감)을 순서대로 점검
let createKis;
try {
  ({ createKis } = await import('./index.js'));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const [symbol = 'AAPL', exchange = 'NAS'] = process.argv.slice(2);
const kis = createKis();
console.log(kis.describe());

const step = async (name, fn) => {
  try {
    const r = await fn();
    console.log(`✔ ${name}`, r);
    return r;
  } catch (e) {
    console.log(`✘ ${name}: ${e.message}`);
  }
};

await step('접근 토큰', async () => {
  await kis.tokens.getAccessToken();
  return `유효, 만료 ${new Date(kis.tokens.token.expiresAt).toLocaleString('ko-KR')}`;
});
const p = await step(`${symbol} 현재가`, async () => {
  const r = await kis.getPrice(symbol, exchange);
  return { last: r.last, diff: r.diff, rate: r.rate, volume: r.volume };
});
await step(`${symbol} 호가`, () => kis.getOrderbook(symbol, exchange));
await step(`${symbol} 5분봉 (최근 3개)`, async () => (await kis.getMinuteCandles(symbol, exchange, { interval: 5, count: 24 })).slice(-3));
await step('실제 계좌 (예수금, 보유 종목, 총 평가금액)', async () => {
  const a = await kis.getAccount();
  return { 예수금: a.cash.deposit, 출금가능: a.cash.withdrawable, 보유종목: a.holdings.map((h) => `${h.symbol} ${h.qty}주`).join(', ') || '없음', ...a.totals };
});
if (p?.last) await step('매수 주문 dry-run (실제 전송 안 함)', () => kis.placeOrder({ side: 'buy', symbol, exchange, qty: 1, type: 'limit', price: p.last * 0.9, dryRun: true }));
