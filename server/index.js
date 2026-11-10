// 퀀트 오피스 백엔드: 프론트(대시보드)와 에이전트가 KIS를 호출하는 로컬 API 서버
//   npm run server  →  http://127.0.0.1:8787
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as journal from './bot/journal.js';
import { createBot } from './bot/engine.js';
import * as sTier from '../src/strategy/sTier.js';
import * as watch from './watchlist.js';
import * as usage from './usage.js';
import * as planner from './planner.js';
import * as auth from './auth.js';
import { makeCards } from './study.js';
import { createLlm } from './llm/index.js';
import { maskKey, llmConfig } from './llm/config.js';
let createKis, KisApiError, OrderRejected;
try {
  ({ createKis, KisApiError, OrderRejected } = await import('./kis/index.js'));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const kis = createKis();
const PORT = Number(process.env.SERVER_PORT || 8787);
const HOST = process.env.SERVER_HOST || '127.0.0.1'; // 기본은 내 PC에서만 접근
const ALLOW_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const API_TOKEN = process.env.LOCAL_API_TOKEN || '';
const barsCache = new Map(); // 설정 시 주문 API에 x-api-token 헤더 필요

console.log(kis.describe());
const llm = createLlm(kis);
const bot = createBot({ kis, llm });
if (process.env.BOT_ENABLED !== 'false') bot.start();
else console.log('[bot] BOT_ENABLED=false: 매매 봇을 켜지 않습니다 (API만 제공)');
const DIST = path.resolve(process.env.DIST_DIR || 'dist/index.html');
{
  const h = llm.health();
  console.log(`[LLM] ${h.ready ? '사용' : '꺼짐'}  Claude=${maskKey(llmConfig.anthropicKey) || '키 없음'} (${h.providers.claude.models.fast} / ${h.providers.claude.models.smart})  Gemini=${maskKey(llmConfig.geminiKey) || '키 없음'} (${h.providers.gemini.models.fast} / ${h.providers.gemini.models.smart})  하루 예산 $${h.budget.dailyUsd}`);
}

const ENDPOINTS = [
  'GET  /                 대시보드 (npm run build 결과 dist/index.html)',
  'GET  /api/bot/health   봇 루프 생존 확인 (도커 헬스체크)',
  'GET  /api/bot/state    봇 상태 (계좌, 시세, 신호, 모세 판단, 주문)',
  'GET  /api/bot/events   봇 이벤트 실시간 (SSE)',
  'GET|POST /api/bot/settings',
  'POST /api/bot/order    {symbol, side:buy|sell, qty}',
  'POST /api/bot/liquidate',
  'POST /api/bot/discover  다윗 탐색 즉시 1회',
  'GET  /api/bot/calendar?month=2026-11   날짜별 손익 캘린더',
  'GET  /api/bot/shadowcal?month=2026-11  날짜별 가상 거래 (전략·청산별)',
  'GET  /api/planner · PUT /api/planner  공부·일 플래너 (data/planner.json)',
  'POST /api/study/cards {text, n}  공부 내용 → 암기 카드 (AI)',
  'GET  /api/news?limit=60   뉴스 속보 (KIS + 종목별 야후·Alpha Vantage)',
  'POST /api/bot/gapscan   트랙 1 갭 스캔 즉시 1회 (?final=1 이면 오늘 후보 확정)',
  'GET  /api/bot/stats?env=demo   전략별 승률·손익비·PF',
  'GET  /api/bot/journal?kind=trades|fills|signals&limit=100',
  'GET  /api/kis/discover?raw=1   순위 API 원본 필드 확인',
  'GET  /api/kis/health',
  'GET  /api/kis/price?symbol=AAPL&exchange=NAS',
  'GET  /api/kis/orderbook?symbol=AAPL&exchange=NAS',
  'GET  /api/kis/candles?symbol=AAPL&exchange=NAS&interval=5&count=120',
  'GET  /api/kis/bars?symbol=AAPL&exchange=NAS&period=D|W|M   일봉·주봉·월봉',
  'GET  /api/kis/account',
  'GET  /api/kis/signals?symbol=NVDA&exchange=NAS',
  'GET  /api/kis/discover?limit=15&minPrice=5',
  'GET|PUT /api/watchlist',
  'GET|POST|DELETE /api/usage',
  'GET  /api/usage/stream (SSE)',
  'GET  /api/llm/health',
  'POST /api/llm/agents/:agent/run  {task, ...}',
  'POST /api/watchlist/ai/:code/promote',
  'DELETE /api/watchlist/(manual|ai)/:code',
  'GET  /api/kis/holdings',
  'GET  /api/kis/resolve?symbol=META',
  'GET  /api/kis/watchlist',
  'GET  /api/kis/stream?symbols=AAPL:NAS,TSLA:NAS',
  'POST /api/kis/orders',
];

// 내 PC의 개발 화면(localhost / 127.0.0.1, 포트 무관)과 CORS_ORIGIN만 허용
const isLocalOrigin = (o) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o || '');
let currentOrigin = ALLOW_ORIGIN;
const send = (res, code, data) => {
  const head = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': currentOrigin, 'Access-Control-Allow-Headers': 'Content-Type, x-api-token', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', Vary: 'Accept-Encoding' };
  let body = Buffer.from(JSON.stringify(data));
  // 큰 응답(봇 상태 등)은 gzip으로 줄여 보냄 → 휴대폰 데이터망에서 받다가 끊기는 일을 줄임
  if (res._gz && body.length > 2048) {
    body = zlib.gzipSync(body, { level: 6 });
    head['Content-Encoding'] = 'gzip';
  }
  head['Content-Length'] = body.length;
  res.writeHead(code, head);
  res.end(body);
};
const readJson = (req, max = 1e5) =>
  new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > max) reject(Object.assign(new Error('요청 본문이 너무 큽니다.'), { code: 413 }));
    });
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        reject(new Error('JSON 형식이 아닙니다.'));
      }
    });
  });

// 실시간 체결가 → SSE로 브라우저에 중계
const rt = kis.realtime();
const listeners = new Set();
rt.on('tick', (t) => {
  const line = `data: ${JSON.stringify(t)}\n\n`;
  for (const res of listeners) res.write(line);
});
rt.on('error', (e) => console.warn(e.message));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  currentOrigin = isLocalOrigin(req.headers.origin) ? req.headers.origin : ALLOW_ORIGIN;
  res._gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const q = Object.fromEntries(url.searchParams);
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});

    // ---------- 인터넷 공개 시 로그인 ----------
    if (auth.viaProxy(req) && !auth.enabled) {
      // 비밀번호 없이 인터넷에 열리는 것을 막는다
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('APP_PASSWORD가 비어 있어 외부 접속을 막았습니다. .env에 APP_PASSWORD를 넣고 다시 시작하세요.');
    }
    if (auth.enabled) {
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const b = await readJson(req, 2000).catch(() => ({}));
        const r = auth.login(req, res, b.password);
        return send(res, r.code, r.code === 200 ? { ok: true } : { ok: false, error: r.error });
      }
      if (url.pathname === '/api/logout' && req.method === 'POST') {
        auth.logout(res);
        return send(res, 200, { ok: true });
      }
      const local = !auth.viaProxy(req) && /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress || '');
      if (auth.valid(req)) {
        // 로그인한 사람은 LOCAL_API_TOKEN을 따로 묻지 않음
        if (API_TOKEN) req.headers['x-api-token'] = API_TOKEN;
      } else if (!(local && url.pathname === '/api/bot/health')) {
        if (url.pathname.startsWith('/api/')) return send(res, 401, { ok: false, login: true, error: '로그인이 필요해요.' });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
        return res.end(auth.LOGIN_HTML);
      }
    }

    if (req.method === 'GET' && url.pathname === '/' && fs.existsSync(DIST)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(fs.readFileSync(DIST));
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/api' || url.pathname === '/api/kis')) return send(res, 200, { ok: true, message: '퀀트 오피스 KIS 백엔드가 실행 중입니다. 아래 경로로 호출하세요.', env: kis.config.env, endpoints: ENDPOINTS });

    if (req.method === 'GET' && url.pathname === '/api/kis/health') return send(res, 200, { ok: true, env: kis.config.env, realOrders: kis.config.isReal && kis.config.enableRealOrders });

    if (req.method === 'GET' && url.pathname === '/api/kis/price') return send(res, 200, await kis.getPrice(q.symbol, q.exchange || 'NAS'));

    if (req.method === 'GET' && url.pathname === '/api/kis/orderbook') return send(res, 200, await kis.getOrderbook(q.symbol, q.exchange || 'NAS'));

    if (req.method === 'GET' && url.pathname === '/api/kis/candles') {
      const candles = await kis.getMinuteCandles(q.symbol, q.exchange || 'NAS', { interval: Number(q.interval || 5), count: Math.min(600, Number(q.count || 120)) });
      return send(res, 200, { symbol: q.symbol, interval: Number(q.interval || 5), candles });
    }

    // 일봉·주봉·월봉 (차트 탭용, 종목·주기별 5분 캐시)
    if (req.method === 'GET' && url.pathname === '/api/kis/bars') {
      const sym = String(q.symbol || '').toUpperCase();
      const period = ['D', 'W', 'M'].includes(q.period) ? q.period : 'D';
      if (!/^[A-Z][A-Z.\-]{0,9}$/.test(sym)) return send(res, 400, { ok: false, error: 'symbol이 올바르지 않습니다.' });
      const key = `${sym}:${q.exchange || 'NAS'}:${period}`;
      const hit = barsCache.get(key);
      if (hit && Date.now() - hit.at < 5 * 60_000) return send(res, 200, hit.body);
      const bars = await kis.getDailyBars(sym, q.exchange || 'NAS', { count: Math.min(100, Number(q.count || 90)), period });
      const body = { ok: true, symbol: sym, period, bars };
      barsCache.set(key, { at: Date.now(), body });
      if (barsCache.size > 200) barsCache.delete(barsCache.keys().next().value);
      return send(res, 200, body);
    }

    if (req.method === 'GET' && url.pathname === '/api/kis/holdings') {
      const h = await kis.getHoldings();
      // 화면에서 바로 쓰도록 거래소 코드를 시세용(NAS/NYS/AMS)으로도 함께 내려준다
      const exMap = { NASD: 'NAS', NYSE: 'NYS', AMEX: 'AMS', NAS: 'NAS', NYS: 'NYS', AMS: 'AMS' };
      return send(res, 200, { ok: true, items: h.items.map((i) => ({ ...i, quoteExchange: exMap[i.exchange] || 'NAS' })) });
    }

    // 실제 계좌 스냅샷: 외화 예수금 + 체결기준 보유 종목 + 합계
    if (req.method === 'GET' && url.pathname === '/api/kis/account') {
      try {
        return send(res, 200, { ok: true, ...(await kis.getAccount()) });
      } catch (e) {
        console.error(`[계좌] 비상: KIS API 잔고 조회 실패, 대기 모드 전환 (${e.message})`);
        return send(res, 502, { ok: false, error: e.message, msgCd: e.msgCd });
      }
    }

    // 다윗 전시장 탐색: /api/kis/discover?limit=15&minPrice=5&minAmount=20000000&exclude=AAPL,MSFT
    if (req.method === 'GET' && url.pathname === '/api/kis/discover') {
      const r = await kis.discover({
        limit: Math.min(20, Number(q.limit) || 15),
        minPrice: Number(q.minPrice) || 5,
        minAmount: q.minAmount != null ? Number(q.minAmount) : 20_000_000,
        exclude: (q.exclude || '').split(',').filter(Boolean),
        raw: q.raw === '1',
      });
      if (r.errors.length) console.warn(`[탐색] 일부 실패: ${r.errors.join(' / ')}`);
      if (!r.candidates.length && r.errors.length) return send(res, 502, { ok: false, error: `탐색 API 실패: ${r.errors[0]}`, ...r });
      return send(res, 200, { ok: true, ...r });
    }

    // 관심종목 저장소 (수동 / AI)
    // 에이전트 토큰 장부 (실제 모델 호출 시 usage 기록)
    if (url.pathname === '/api/usage' && req.method === 'GET') return send(res, 200, { ok: true, ...usage.load() });
    if (url.pathname === '/api/usage' && req.method === 'POST') {
      try {
        return send(res, 200, { ok: true, ...usage.record(await readJson(req)) });
      } catch (e) {
        return send(res, 400, { ok: false, error: e.message });
      }
    }
    if (url.pathname === '/api/usage/stream' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': currentOrigin });
      res.write(`event: snapshot\ndata: ${JSON.stringify(usage.load())}\n\n`);
      const on = (entry) => res.write(`event: call\ndata: ${JSON.stringify({ entry, snapshot: usage.load() })}\n\n`);
      usage.events.on('change', on);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => {
        clearInterval(ping);
        usage.events.off('change', on);
      });
      return;
    }

    // ---------- 매매 봇 ----------
    if (url.pathname === '/api/bot/health') {
      const ok = bot.healthy();
      return send(res, ok ? 200 : 503, { ok, state: ok ? 'running' : 'stalled' });
    }
    if (url.pathname === '/api/bot/state' && req.method === 'GET') return send(res, 200, { ok: true, ...bot.state() });
    if (url.pathname === '/api/bot/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': currentOrigin });
      const since = Number(q.since || 0);
      for (const ev of bot.events().filter((e) => e.id > since).slice(-80)) res.write(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`);
      const on = (ev) => res.write(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`);
      bot.bus.on('event', on);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => {
        clearInterval(ping);
        bot.bus.off('event', on);
      });
      return;
    }
    if (url.pathname === '/api/bot/settings') {
      if (req.method === 'GET') return send(res, 200, { ok: true, settings: bot.state().settings });
      if (req.method === 'POST') {
        if (API_TOKEN && req.headers['x-api-token'] !== API_TOKEN) return send(res, 401, { ok: false, error: 'x-api-token이 올바르지 않습니다.' });
        return send(res, 200, { ok: true, settings: bot.updateSettings(await readJson(req)) });
      }
    }
    if (['/api/bot/order', '/api/bot/liquidate', '/api/bot/discover', '/api/bot/gapscan'].includes(url.pathname) && req.method === 'POST') {
      if (API_TOKEN && req.headers['x-api-token'] !== API_TOKEN) return send(res, 401, { ok: false, error: 'x-api-token이 올바르지 않습니다.' });
      try {
        if (url.pathname === '/api/bot/order') return send(res, 200, { ok: true, ...(await bot.userOrder(await readJson(req))) });
        if (url.pathname === '/api/bot/liquidate') return send(res, 200, await bot.liquidate());
        if (url.pathname === '/api/bot/gapscan') {
          await bot.gapScan(url.searchParams.get('final') === '1');
          return send(res, 200, { ok: true, gap: bot.state().gap });
        }
        await bot.discoverNow();
        return send(res, 200, { ok: true });
      } catch (e) {
        return send(res, e.status || 500, { ok: false, error: e.message });
      }
    }
    if (url.pathname === '/api/bot/calendar' && req.method === 'GET') {
      const month = /^\d{4}-\d{2}$/.test(q.month || '') ? q.month : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).slice(0, 7);
      return send(res, 200, { ok: true, ...bot.calendar(month) });
    }
    if (url.pathname === '/api/bot/shadowcal' && req.method === 'GET') {
      const month = /^\d{4}-\d{2}$/.test(q.month || '') ? q.month : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).slice(0, 7);
      return send(res, 200, { ok: true, ...bot.shadowCalendar(month) });
    }
    if (url.pathname === '/api/planner' && req.method === 'GET') return send(res, 200, { ok: true, ...planner.load() });
    if (url.pathname === '/api/planner' && req.method === 'PUT') {
      if (API_TOKEN && req.headers['x-api-token'] !== API_TOKEN) return send(res, 401, { ok: false, error: 'x-api-token이 올바르지 않습니다.' });
      try {
        const b = await readJson(req, planner.MAX_BYTES);
        return send(res, 200, { ok: true, ...planner.save(b.data, b.base === null ? undefined : b.base) });
      } catch (e) {
        return send(res, e.code || 500, { ok: false, error: e.message });
      }
    }
    if (url.pathname === '/api/study/cards' && req.method === 'POST') {
      if (API_TOKEN && req.headers['x-api-token'] !== API_TOKEN) return send(res, 401, { ok: false, error: 'x-api-token이 올바르지 않습니다.' });
      try {
        const b = await readJson(req, 3e4);
        const r = await makeCards(b.text, b.n);
        console.log(`[공부방] 카드 ${r.cards.length}장 → ${r.provider}/${r.model}`);
        return send(res, 200, { ok: true, ...r });
      } catch (e) {
        const code = e.code || e.status || { budget: 429, nokey: 503, disabled: 503, exhausted: 502 }[e.kind] || 500;
        return send(res, code, { ok: false, error: e.message });
      }
    }
    if (url.pathname === '/api/news' && req.method === 'GET') return send(res, 200, { ok: true, ...bot.news(Math.min(200, Math.max(1, Number(q.limit) || 60))) });
    if (url.pathname === '/api/bot/stats' && req.method === 'GET') return send(res, 200, { ok: true, ...journal.stats({ env: q.env || kis.config.env, since: q.since }), kellyFeedback: journal.kellyFeedback(q.env || kis.config.env) });
    if (url.pathname === '/api/bot/journal' && req.method === 'GET') {
      const kind = ['trades', 'fills', 'signals'].includes(q.kind) ? q.kind : 'trades';
      return send(res, 200, { ok: true, kind, rows: journal.readLines(kind, { limit: Math.min(1000, Number(q.limit) || 100) }).reverse() });
    }

    // LLM (Claude / Gemini)
    if (url.pathname === '/api/llm/health' && req.method === 'GET') return send(res, 200, { ok: true, ...llm.health() });
    {
      const m = url.pathname.match(/^\/api\/llm\/agents\/([A-Za-z]+)\/run$/);
      if (m && req.method === 'POST') {
        if (API_TOKEN && req.headers['x-api-token'] !== API_TOKEN) return send(res, 401, { ok: false, error: 'x-api-token이 올바르지 않습니다.' });
        const b = await readJson(req);
        try {
          const r = await llm.run(m[1], String(b.task || ''), b);
          console.log(`[LLM] ${m[1]} ${r.task} → ${r.provider}/${r.model}${r.fallback ? ' (폴백)' : ''} in ${r.usage.input} / out ${r.usage.output}`);
          return send(res, 200, { ok: true, ...r });
        } catch (e) {
          const code = e.status || { budget: 429, nokey: 503, disabled: 503, exhausted: 502, request: 400 }[e.kind] || 500;
          console.error(`[LLM] ${m[1]} ${b.task} 실패: ${e.message}`);
          return send(res, code, { ok: false, error: e.message, kind: e.kind || 'error', attempts: e.attempts });
        }
      }
    }
    if (url.pathname === '/api/usage' && req.method === 'DELETE') return send(res, 200, { ok: true, ...usage.reset() });
    if (url.pathname === '/api/watchlist/manual' && req.method === 'POST') {
      const b = await readJson(req);
      try {
        const sym = String(b.code || b.symbol || '').toUpperCase().trim();
        // 종목이 실제로 있는 거래소를 KIS 시세로 확인 (가짜 종목 방지)
        const r = await kis.resolveSymbol(sym, b.exchange);
        if (!r) throw new Error(`${sym}: 나스닥/뉴욕/아멕스에서 시세를 찾지 못했습니다.`);
        return send(res, 200, { ok: true, resolved: r, ...watch.addManual({ code: r.symbol, exchange: r.exchange, kr: b.kr || '' }) });
      } catch (e) {
        return send(res, 400, { ok: false, error: e.message });
      }
    }
    if (url.pathname === '/api/watchlist' && req.method === 'GET') return send(res, 200, { ok: true, ...watch.load() });
    if (url.pathname === '/api/watchlist' && req.method === 'PUT') return send(res, 200, { ok: true, ...watch.replace(await readJson(req)) });
    {
      const m = url.pathname.match(/^\/api\/watchlist\/ai\/([A-Za-z.\-]+)\/promote$/);
      if (m && req.method === 'POST') {
        try {
          return send(res, 200, { ok: true, ...watch.promote(m[1]) });
        } catch (e) {
          return send(res, 400, { ok: false, error: e.message });
        }
      }
      const d = url.pathname.match(/^\/api\/watchlist\/(manual|ai)\/([A-Za-z.\-]+)$/);
      if (d && req.method === 'DELETE') return send(res, 200, { ok: true, ...watch.remove(d[1], d[2]) });
    }

    // S티어 판정 (서버에서 실시세 봉으로 직접 확인): /api/kis/signals?symbol=NVDA&exchange=NAS
    if (req.method === 'GET' && url.pathname === '/api/kis/signals') {
      const ex = q.exchange || 'NAS';
      const [p, raw, idx] = await Promise.all([
        kis.getPrice(q.symbol, ex),
        kis.getMinuteCandles(q.symbol, ex, { interval: 5, count: 60 }),
        kis.getPrice('QQQ', 'NAS').catch(() => null),
      ]);
      const idxBars = await kis.getMinuteCandles('QQQ', 'NAS', { interval: 5, count: 30 }).catch(() => []);
      const toC = (list) => list.map((k) => ({ o: k.open, h: k.high, l: k.low, c: k.close, v: k.volume || 0, t: k.t, time: k.time }));
      const nowMs = Number(q.now) || Date.now(); // ?now=epoch(ms) 로 특정 시각 기준 판정 가능 (점검용)
      const candles = sTier.closedOnly(toC(raw), nowMs);
      const si = sTier.sessionInfo(candles);
      const isi = sTier.sessionInfo(toC(idxBars));
      const indexGap = idx?.prevClose && isi.dayOpen ? isi.dayOpen / idx.prevClose - 1 : 0;
      const ctx = { nowMin: sTier.nyMinutes(nowMs), prevClose: p.prevClose, dayOpen: si.dayOpen, indexGap, sessionBars: si.sessionBars };
      const r = sTier.evaluateSTier(candles, ctx);
      let sizing = null;
      if (r.fired) {
        let equity = Number(q.equity) || null;
        if (!equity) {
          try {
            equity = (await kis.getAccount()).totals.total;
          } catch (e) {
            console.error(`[S티어] 비상: KIS API 잔고 조회 실패, 대기 모드 전환 (${e.message})`);
            return send(res, 503, { ok: false, standby: true, error: '비상: KIS API 잔고 조회 실패, 대기 모드 전환', signal: r });
          }
        }
        sizing = sTier.sizePosition({ hits: r.hits, candles, totalEquity: equity, price: p.last, maxWeight: Number(q.maxWeight || 0.15) });
      }
      return send(res, 200, { ok: true, symbol: p.symbol, price: p.last, ctx, fired: r.fired, hits: r.hits, results: r.results, sizing });
    }

    // 티커 확인 (관심 종목 추가 시)
    if (req.method === 'GET' && url.pathname === '/api/kis/resolve') {
      const r = await kis.resolveSymbol(q.symbol, q.exchange);
      return r ? send(res, 200, { ok: true, ...r }) : send(res, 404, { ok: false, error: `${(q.symbol || '').toUpperCase()}: 나스닥, 뉴욕, 아멕스에서 찾을 수 없는 종목입니다.` });
    }

    // 한투 관심종목 (미국 티커만 골라 검증)
    if (req.method === 'GET' && url.pathname === '/api/kis/watchlist') {
      const groups = await kis.getKisWatchlist();
      const seen = new Set();
      const us = [];
      for (const g of groups)
        for (const it of g.items) {
          if (!it.looksUs || seen.has(it.code)) continue;
          seen.add(it.code);
          const r = await kis.resolveSymbol(it.code);
          if (r) us.push({ ...r, name: it.name, group: g.name });
        }
      return send(res, 200, { ok: true, groups: groups.map((g) => ({ code: g.code, name: g.name, count: g.items.length })), us });
    }

    if (req.method === 'GET' && url.pathname === '/api/kis/stream') {
      const symbols = (q.symbols || '').split(',').filter(Boolean).slice(0, 40);
      for (const s of symbols) {
        const [sym, ex] = s.split(':');
        await rt.subscribe(sym, ex || 'NAS');
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': currentOrigin });
      res.write(': connected\n\n');
      listeners.add(res);
      req.on('close', () => listeners.delete(res));
      return;
    }

    // 주문: { agent: 'joshua'|'moses'|'user', ... }
    if (req.method === 'POST' && url.pathname === '/api/kis/orders') {
      if (API_TOKEN && req.headers['x-api-token'] !== API_TOKEN) return send(res, 401, { ok: false, error: 'x-api-token이 올바르지 않습니다.' });
      const b = await readJson(req);
      let result;
      if (b.agent === 'joshua') result = await kis.joshuaBuy(b);
      else if (b.agent === 'moses') result = await kis.mosesSell(b);
      else result = await kis.placeOrder({ ...b, agent: '사용자' });
      console.log(`[주문] ${result.agent} ${result.side} ${result.symbol} ${result.qty}주 @ ${result.price ?? result.type} ${result.dryRun ? '(dry-run)' : `주문번호 ${result.orderNo}`}`);
      return send(res, 200, result);
    }

    send(res, 404, { ok: false, error: `없는 경로입니다: ${req.method} ${url.pathname}`, endpoints: ENDPOINTS });
  } catch (e) {
    const code = e instanceof OrderRejected ? 400 : e instanceof KisApiError ? 502 : 500;
    send(res, code, { ok: false, error: e.message, msgCd: e.msgCd });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n[server] ${PORT} 포트를 이미 다른 프로그램이 쓰고 있어요. 이전에 켠 npm run server가 아직 실행 중일 가능성이 커요.`);
    console.error('  1) 그 터미널에서 Ctrl+C로 끄거나');
    console.error(`  2) PowerShell: netstat -ano | findstr :${PORT}  →  taskkill /PID <마지막 칸 숫자> /F\n`);
  } else console.error('[server] 시작 실패:', e.message);
  process.exit(1);
});

// 감시견: 봇 루프가 5분 넘게 멈추면 프로세스를 끝내 도커(restart: always)가 다시 띄우게 한다
let stalledSince = 0;
setInterval(() => {
  if (process.env.BOT_ENABLED === 'false' || bot.healthy()) return (stalledSince = 0);
  stalledSince ||= Date.now();
  if (Date.now() - stalledSince > 5 * 60_000) {
    console.error('[watchdog] 봇 루프가 5분 넘게 멈춰 프로세스를 재시작합니다.');
    process.exit(1);
  }
}, 30_000).unref();
process.on('unhandledRejection', (e) => console.error('[server] 처리되지 않은 오류:', e?.message || e));

server.listen(PORT, HOST, () => {
  console.log(`[server] http://${HOST}:${PORT} 실행 중`);
  console.log(`  예) http://${HOST}:${PORT}/api/kis/price?symbol=AAPL`);
});
