// 한 곳에서 꺼내 쓰는 진입점
import { config, describeConfig } from './config.js';
import { TokenManager } from './token.js';
import { KisClient, KisApiError } from './client.js';
import { getPrice, getOrderbook, getMinuteCandles, getHoldings, resolveSymbol, getKisWatchlist, getAccount, getProductInfo, getDailyBars, getNews } from './quotes.js';
import { placeOrder, buy, sell, cancelOrder, getOrderFills, getBuyingPower, OrderRejected } from './orders.js';
import { KisRealtime, trKeyFor, parseTickFrame } from './realtime.js';
import { joshuaBuy, mosesSell } from './agents.js';
import { discover, premarketGappers } from './scanner.js';

export function createKis(cfg = config) {
  const tokens = new TokenManager(cfg);
  const client = new KisClient(cfg, { tokens });
  return {
    config: cfg,
    describe: describeConfig,
    tokens,
    client,
    getPrice: (symbol, exchange) => getPrice(client, symbol, exchange),
    getOrderbook: (symbol, exchange) => getOrderbook(client, symbol, exchange),
    getMinuteCandles: (symbol, exchange, opts) => getMinuteCandles(client, symbol, exchange, opts),
    getHoldings: (opts) => getHoldings(client, opts),
    getAccount: (opts) => getAccount(client, opts),
    getProductInfo: (symbol, exchange) => getProductInfo(client, symbol, exchange),
    getDailyBars: (symbol, exchange, opts) => getDailyBars(client, symbol, exchange, opts),
    getNews: (symbol, opts) => getNews(client, symbol, opts),
    resolveSymbol: (symbol, prefer) => resolveSymbol(client, symbol, prefer),
    getKisWatchlist: () => getKisWatchlist(client),
    placeOrder: (o) => placeOrder(client, o),
    buy: (o) => buy(client, o),
    sell: (o) => sell(client, o),
    cancelOrder: (o) => cancelOrder(client, o),
    getOrderFills: (o) => getOrderFills(client, o),
    getBuyingPower: (o) => getBuyingPower(client, o),
    discover: (opts) => discover(client, opts),
    premarketGappers: (opts) => premarketGappers(client, opts),
    joshuaBuy: (d) => joshuaBuy(client, d),
    mosesSell: (d) => mosesSell(client, d),
    realtime: () => new KisRealtime(tokens, cfg),
  };
}

export { KisApiError, OrderRejected, trKeyFor, parseTickFrame };
