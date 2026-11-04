// 퀀트 오피스 실행부 에이전트 연결부
//   여호수아(Joshua): 리스크 승인 건을 가장 유리한 호가로 매수
//   모세(Moses): 프론트의 판단(EXIT_STOP / EXIT_TAKE / TRIM)을 받아 매도
import { getOrderbook } from './quotes.js';
import { placeOrder } from './orders.js';
import { roundUsPrice } from './exchanges.js';

/**
 * 여호수아 매수
 * @param {{symbol, exchange?, qty?, usd?, style?:'best'|'passive'|'urgent', maxPrice?, dryRun?}} d
 *   best(기본): 최우선 매도호가에 지정가 → 즉시 체결되면서 그 이상은 지불하지 않음
 *   passive  : 최우선 매수호가에 지정가 → 체결은 늦을 수 있으나 더 싸게
 *   urgent   : 매도호가 + 슬리피지 한도 (즉시 체결형 지정가)
 */
export async function joshuaBuy(client, d) {
  const ob = await getOrderbook(client, d.symbol, d.exchange || 'NAS');
  const style = d.style || 'best';
  if (style === 'urgent') {
    const qty = d.qty ?? Math.floor((d.usd || 0) / (ob.ask || 1));
    return placeOrder(client, { side: 'buy', type: 'market', symbol: d.symbol, exchange: d.exchange, qty, dryRun: d.dryRun, agent: '여호수아' });
  }
  let price = style === 'passive' ? ob.bid : ob.ask;
  if (!price) throw new Error(`[여호수아] ${d.symbol} 호가를 가져오지 못했습니다.`);
  if (d.maxPrice && price > d.maxPrice) price = d.maxPrice; // 리스크부가 정한 상한
  const qty = d.qty ?? Math.floor((d.usd || 0) / price);
  return placeOrder(client, { side: 'buy', type: 'limit', price: roundUsPrice(price), symbol: d.symbol, exchange: d.exchange, qty, dryRun: d.dryRun, agent: '여호수아' });
}

/**
 * 모세 매도
 * @param {{symbol, exchange?, qty:number, action:'EXIT_STOP'|'EXIT_TAKE'|'TRIM', dryRun?}} d
 *   EXIT_STOP: 빠져나오는 게 우선 → 즉시 체결형 지정가(매수호가 - 슬리피지)
 *   EXIT_TAKE / TRIM: 이익 보전 → 최우선 매수호가 지정가 (TRIM은 절반)
 */
export async function mosesSell(client, d) {
  const qty = d.action === 'TRIM' ? Math.max(1, Math.floor(d.qty / 2)) : d.qty;
  if (d.action === 'EXIT_STOP') {
    return placeOrder(client, { side: 'sell', type: 'market', symbol: d.symbol, exchange: d.exchange, qty, dryRun: d.dryRun, agent: '모세' });
  }
  const ob = await getOrderbook(client, d.symbol, d.exchange || 'NAS');
  if (!ob.bid) throw new Error(`[모세] ${d.symbol} 매수호가를 가져오지 못했습니다.`);
  return placeOrder(client, { side: 'sell', type: 'limit', price: roundUsPrice(ob.bid), symbol: d.symbol, exchange: d.exchange, qty, dryRun: d.dryRun, agent: '모세' });
}
