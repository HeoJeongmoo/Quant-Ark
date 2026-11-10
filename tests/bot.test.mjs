// npm run test:bot — 서버 봇 핵심 로직 단위 테스트 (KIS 호출 없이 가짜 클라이언트 사용)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qo-bot-'));
process.env.JOURNAL_DIR = path.join(tmp, 'journal');
process.env.BOT_POSITIONS_FILE = path.join(tmp, 'pos.json');
process.env.BOT_ORDERS_FILE = path.join(tmp, 'orders.json');
process.env.BOT_EQUITY_FILE = path.join(tmp, 'equity.json');

const { marketPhase } = await import('../server/bot/session.js');
const journal = await import('../server/bot/journal.js');
const { judgeExit } = await import('../server/bot/moses.js');
const { createExecutor } = await import('../server/bot/executor.js');
const { sizePosition, mergeStats } = await import('../src/strategy/sTier.js');

let fail = 0;
const ok = (cond, name, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` ${extra}` : ''}`);
  if (!cond) fail++;
};

// ---- 장 시간 ----
const ph = (iso) => marketPhase(Date.parse(iso)).phase;
ok(ph('2026-11-02T14:35:00Z') === 'open', '11/2 09:35 EST 정규장');
ok(ph('2026-11-02T14:25:00Z') === 'pre', '11/2 09:25 EST 장전');
ok(ph('2026-11-02T21:01:00Z') === 'post', '11/2 16:01 EST 장후');
ok(ph('2026-07-06T13:30:00Z') === 'open', '7/6 09:30 EDT 정규장 (서머타임)');
ok(ph('2026-11-26T15:00:00Z') === 'closed', '추수감사절 휴장');
ok(ph('2026-11-27T18:05:00Z') === 'post', '11/27 조기폐장 13:00 이후 장후');
ok(ph('2026-11-07T15:00:00Z') === 'closed', '토요일 휴장');

// ---- 모세 ----
const flat = Array.from({ length: 30 }, () => ({ c: 100 }));
const rules = { mode: 'auto', hardStopPct: 3, stopPct: -2, takePct: 5 };
let j = judgeExit({ price: 96.9, avg: 100, qty: 10, candles: flat, market: {} }, rules);
ok(j.action === 'EXIT_STOP' && j.hard, '강제 손절선 -3% 도달 시 즉시 손절', j.reasons[0]);
j = judgeExit({ price: 97.5, avg: 100, qty: 10, candles: [], market: {} }, rules);
ok(j.action === 'HOLD', '봉이 부족하면 강제 손절선만 감시 (-2.5%는 보유)');
j = judgeExit({ price: 98, avg: 100, qty: 10, candles: flat, market: {} }, { ...rules, mode: 'manual' });
ok(j.action === 'EXIT_STOP', '수동 모드 고정 손절선 -2%');
j = judgeExit({ price: 105.5, avg: 100, qty: 10, candles: flat, market: {} }, { ...rules, mode: 'manual' });
ok(j.action === 'EXIT_TAKE', '수동 모드 고정 익절선 +5%');
const up = Array.from({ length: 40 }, (_, i) => ({ c: 100 + i * 0.3 }));
j = judgeExit({ price: 110.4, avg: 100, peak: 112.5, qty: 10, candles: up, market: {} }, rules);
ok(j.action === 'EXIT_TAKE', '수익 중 고점 대비 되밀림 → 트레일링 익절', j.reasons[0]);

// 비용 반영 규칙
const r2 = { ...rules, minTargetPct: 2, lossCutPct: 1, costPct: 0.6, maxHoldMin: 120 };
j = judgeExit({ price: 101.5, avg: 100, qty: 10, candles: up, market: {} }, r2);
ok(j.action === 'HOLD' && !j.trailStop, '목표(+2%) 전에는 트레일링 시작 안 함 (+1.5%)');
j = judgeExit({ price: 100.65, avg: 100, peak: 102.5, qty: 10, candles: up, market: {} }, r2);
ok(j.trailStop >= 100.6 && j.action === 'EXIT_TAKE', '트레일링 스톱은 평단+비용($100.60) 아래로 안 내려감', String(j.trailStop));
j = judgeExit({ price: 100.3, avg: 100, qty: 10, candles: flat, market: {}, botPosition: true, ageMin: 130 }, r2);
ok(j.action === 'EXIT_TAKE' && /시간 손절/.test(j.reasons[0]), '보유 2시간 넘도록 비용 못 넘기면 시간 손절');
j = judgeExit({ price: 98.4, avg: 100, qty: 10, candles: flat, market: {} }, r2);
ok(j.action === 'EXIT_STOP', 'AI 손절 기준 1%의 1.5배(-1.5%) 넘으면 압력 없어도 손절');

// ---- 체결 기록 → 왕복 거래 → 통계 → 켈리 피드백 ----
journal.recordFill({ env: 'demo', side: 'buy', symbol: 'AAA', exchange: 'NAS', qty: 10, price: 100, strategies: ['A'] });
journal.recordFill({ env: 'demo', side: 'sell', symbol: 'AAA', exchange: 'NAS', qty: 4, price: 103, reason: '익절' });
journal.recordFill({ env: 'demo', side: 'sell', symbol: 'AAA', exchange: 'NAS', qty: 6, price: 104, reason: '익절' });
journal.recordFill({ env: 'demo', side: 'buy', symbol: 'BBB', exchange: 'NAS', qty: 5, price: 50, strategies: ['A', 'B'] });
journal.recordFill({ env: 'demo', side: 'sell', symbol: 'BBB', exchange: 'NAS', qty: 5, price: 49, reason: '손절' });
const st = journal.stats({ env: 'demo' });
ok(st.overall.trades === 2 && st.overall.wins === 1, '왕복 거래 2건 (1승 1패)');
ok(st.byStrategy.A.avgWinPct === 3.091, 'A 평균 이익률: 수수료 전 $36 - 수수료 0.25%×($1000+$1036)=$5.09 → 3.091%', String(st.byStrategy.A.avgWinPct));
ok(st.byStrategy.A.payoff === 1.239, 'A 손익비 = 3.091 / 2.495 (수수료 후)', String(st.byStrategy.A.payoff));
ok(st.byStrategy.A.profitFactor === 4.954, 'A Profit Factor = $30.91 / $6.24 (수수료 후)', String(st.byStrategy.A.profitFactor));
ok(st.byStrategy.B.trades === 1 && st.byStrategy.C.trades === 0, 'B 1건, C 0건');
const fb = journal.kellyFeedback('demo');
ok(fb.A.trades === 2 && fb.A.wins === 1, '켈리 피드백 A: 2건 1승');
const m = mergeStats({ trades: 4, wins: 2, avgWin: 0.01, avgLoss: 0.01 }, fb.A);
ok(m.trades === 8 && m.observed === 2, '백테스트 4건 + 실거래 2건×2 = 8건');
const candles = Array.from({ length: 40 }, (_, i) => ({ o: 100, h: 101, l: 99, c: 100 + (i % 2), v: 1000 }));
const sz = sizePosition({ hits: [{ id: 'A' }], candles, totalEquity: 10000, price: 100, observed: fb });
ok(sz.kellies[0].observed === 2, 'sizePosition이 실거래 표본 수를 보고', JSON.stringify(sz.best));
journal.reconcile([{ symbol: 'ZZZ', qty: 3, avgPrice: 20, price: 21, quoteExchange: 'NAS' }], 'demo');
ok(journal.getPositions().ZZZ?.external, '계좌에만 있는 종목은 외부 포지션으로 등록');
journal.reconcile([], 'demo', { ZZZ: 22 });
ok(!journal.getPositions().ZZZ && journal.stats({ env: 'demo' }).external.trades === 1, '계좌에서 사라지면 외부 청산 기록 (전략 통계 제외)');

// ---- 안심 체결 엔진: 미체결 → 취소 → 단계별 재주문 → 체결 ----
const book = { orders: [], cancels: [] };
let no = 1000;
const fakeKis = {
  placeOrder: async (o) => {
    const ord = { orderNo: String(++no), qty: o.qty, price: Math.round(100 * (1 - o.slippage) * 100) / 100, side: o.side, symbol: o.symbol, filled: 0 };
    book.orders.push(ord);
    if (book.orders.length >= 3) ord.filled = ord.qty; // 3번째 주문에서 체결
    return { ok: true, orderNo: ord.orderNo, qty: o.qty, price: ord.price };
  },
  joshuaBuy: async () => ({ ok: true, orderNo: String(++no), qty: 1, price: 100 }),
  cancelOrder: async (o) => book.cancels.push(o.orderNo),
  getOrderFills: async () => book.orders.map((o) => ({ orderNo: o.orderNo, side: o.side, symbol: o.symbol, qty: o.qty, filledQty: o.filled, unfilledQty: o.qty - o.filled, filledPrice: o.filled ? o.price : 0, isCancel: false })),
};
const events = [];
const ex = createExecutor({ kis: fakeKis, emit: (t, a, text) => events.push(text), getEnv: () => 'demo', nyYmd: () => '20261102', dryRunFor: () => false, stages: { stop: [{ slip: 0.002, wait: 0.05 }, { slip: 0.01, wait: 0.05 }, { slip: 0.03, wait: 0.05 }] }, retrySec: 0.05 });
journal.recordFill({ env: 'demo', side: 'buy', symbol: 'CCC', exchange: 'NAS', qty: 7, price: 105, strategies: ['C'] });
await ex.submit({ side: 'sell', symbol: 'CCC', exchange: 'NAS', qty: 7, urgency: 'stop', reason: '강제 손절', agent: '모세' });
for (let i = 0; i < 12 && ex.active().length; i++) {
  await new Promise((r) => setTimeout(r, 80));
  await ex.poll();
}
ok(book.orders.length === 3 && book.cancels.length === 2, '미체결 2회 취소 후 3단계(-3%)에서 체결', `주문 ${book.orders.map((o) => o.price).join(' → ')}`);
ok(ex.all()[0].status === 'filled', '주문 상태 filled');
const cc = journal.readLines('trades').find((t) => t.symbol === 'CCC');
ok(cc && cc.strategies[0] === 'C' && cc.exitAvg === 97, '체결가 $97로 손절 거래 기록', JSON.stringify(cc && { exitAvg: cc.exitAvg, pnl: cc.pnl }));

// --- 트랙 1: 시가 범위 돌파(D) ---
const { checkD } = await import('../src/strategy/sTier.js');
const bar = (o, h, l, c, v) => ({ o, h, l, c, v });
const orb = [bar(12, 12.5, 11.9, 12.3, 100000), bar(12.3, 12.45, 12.1, 12.2, 80000), bar(12.2, 12.4, 12.05, 12.35, 70000)];
const d1 = checkD({ session: [...orb, bar(12.4, 12.75, 12.38, 12.7, 200000)], prevClose: 11.43, nowMin: 595 });
ok(d1.fired && d1.orHigh === 12.5 && d1.orLow === 11.9, 'D: 시가 범위 고가 돌파 + 거래량 → 신호', d1.detail);
ok(!checkD({ session: orb, prevClose: 11.43, nowMin: 580 }).fired, 'D: 개장 15분 전에는 판정 안 함');
ok(!checkD({ session: [...orb, bar(12.4, 12.75, 12.38, 12.7, 50000)], prevClose: 11.43, nowMin: 595 }).fired, 'D: 돌파 거래량 부족이면 안 삼');
ok(!checkD({ session: [...orb, bar(12.6, 13.4, 12.6, 13.3, 200000)], prevClose: 11.43, nowMin: 595 }).fired, 'D: 고가 대비 3% 넘게 달아나면 추격 금지');
ok(!checkD({ session: [...orb, bar(12.4, 12.75, 12.38, 12.7, 200000)], prevClose: 11.43, nowMin: 665 }).fired, 'D: 진입 마감(11:00) 이후 안 삼');
const js = judgeExit({ symbol: 'GAPX', price: 12.44, avg: 12.74, qty: 35, peak: 12.74, botPosition: true, stopPrice: 12.45, stopReason: '진입가 -2%', ageMin: 3, candles: [] }, { mode: 'auto', hardStopPct: 3, minTargetPct: 3, lossCutPct: 1.5, costPct: 0.6, maxHoldMin: 360 });
ok(js.action === 'EXIT_STOP' && js.urgency === 'stop', '모세: 진입 손절가 이탈 시 즉시 손절', js.reasons[0]);
const jh = judgeExit({ symbol: 'GAPX', price: 12.6, avg: 12.74, qty: 35, peak: 12.74, botPosition: true, stopPrice: 12.45, ageMin: 3, candles: [] }, { mode: 'auto', hardStopPct: 3, minTargetPct: 3, lossCutPct: 1.5, costPct: 0.6, maxHoldMin: 360 });
ok(jh.action !== 'EXIT_STOP', '모세: 손절가 위면 손절 안 함', jh.action);

// --- 상대 거래량 ---
const { sessionShare, rvolAt } = await import('../server/bot/rvol.js');
ok(Math.abs(sessionShare(30) - 0.17) < 1e-9 && sessionShare(390) === 1 && sessionShare(0) === 0, 'RVol: 하루 거래량 누적 곡선 (30분 17%, 마감 100%)');
ok(rvolAt(510000, 1000000, 600) === 3, 'RVol: 개장 30분에 평소의 51% 거래 → 3배', String(rvolAt(510000, 1000000, 600)));
ok(rvolAt(100, 1000, 575) === null, 'RVol: 개장 10분 전에는 판단 안 함');

// --- 사무엘 뉴스 규칙 ---
const { classifyHeadlines } = await import('../server/bot/samuel.js');
ok(classifyHeadlines([{ title: 'XYZ announces pricing of $40 million public offering' }]).catalyst === 'negative', '사무엘: 공모 가격 확정 → 악재');
ok(classifyHeadlines([{ title: 'XYZ 1-for-10 reverse stock split' }]).catalyst === 'negative', '사무엘: 역분할 → 악재');
ok(classifyHeadlines([{ title: 'XYZ 유상증자 결정' }]).catalyst === 'negative', '사무엘: 한글 유상증자 → 악재');
ok(classifyHeadlines([{ title: 'XYZ beats Q3 estimates, raises guidance' }]).catalyst === 'positive', '사무엘: 실적 상회·가이던스 상향 → 재료');
ok(classifyHeadlines([{ title: 'XYZ FDA 승인 획득' }]).catalyst === 'positive', '사무엘: 한글 FDA 승인 → 재료');
ok(classifyHeadlines([]).catalyst === 'none', '사무엘: 뉴스 없음');
const { matchesSymbol } = await import('../server/bot/samuel.js');
ok(matchesSymbol({ title: '애플, 아이폰 판매 호조' }, 'AAPL', ['애플']) && matchesSymbol({ title: 'Tesla recalls cars' }, 'TSLA', ['TESLA INC']), '사무엘: 전체 뉴스에서 한글·영문 이름으로 종목 찾기');
ok(!matchesSymbol({ title: 'S&P500, 올해 번 거 다 잃는다' }, 'ALL', ['올스테이트']) && !matchesSymbol({ title: 'metamaterial' }, 'META', []), '사무엘: 흔한 단어·부분 일치는 무시');

const { parseRss } = await import('../server/news/yahoo.js');
const rss = parseRss('<rss><channel><item><title><![CDATA[XYZ prices $40M offering &amp; warrants]]></title><link>https://y/1</link><pubDate>Tue, 03 Nov 2026 13:00:00 +0000</pubDate></item></channel></rss>');
ok(rss.length === 1 && rss[0].title === 'XYZ prices $40M offering & warrants' && rss[0].date === '2026-11-03' && rss[0].time === '08:00', '야후 RSS: 제목·뉴욕 시각 파싱', JSON.stringify(rss[0]));
ok(classifyHeadlines(rss).catalyst === 'negative', '야후 RSS 제목도 같은 악재 규칙 적용');

// --- 전략 자동 선택 (Holly식) ---
const jdir = process.env.JOURNAL_DIR;
fs.mkdirSync(jdir, { recursive: true });
const tline = (i, pnlPct) => JSON.stringify({ env: 'demo', symbol: `S${i}`, strategies: ['B'], pnl: pnlPct, pnlPct, closedAt: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T15:00:${String(i).padStart(2, '0')}Z` });
fs.appendFileSync(path.join(jdir, 'trades.jsonl'), Array.from({ length: 30 }, (_, i) => tline(i, i % 3 === 0 ? 1 : -1)).join('\n') + '\n');
let hl = journal.strategyHealth('demo', { minTrades: 30 });
ok(hl.B.status === 'off' && hl.A.status === 'on', '자동 선택: B 실거래 30건 기대값 음수 → 끔, 표본 없는 A는 켬', hl.B.reason);
ok(journal.strategyHealth('demo', { minTrades: 30, modes: { B: 'on' } }).B.status === 'on', '자동 선택: 사용자가 켬으로 고정하면 무시');
fs.appendFileSync(path.join(jdir, 'shadow.jsonl'), Array.from({ length: 16 }, (_, i) => JSON.stringify({ env: 'demo', symbol: `S${i}`, strategies: ['B'], pnl: i % 4 === 0 ? -1 : 1.5, pnlPct: i % 4 === 0 ? -1 : 1.5, closedAt: `2026-11-02T15:${String(10 + i).padStart(2, '0')}:00Z` })).join('\n') + '\n');
hl = journal.strategyHealth('demo', { minTrades: 30 });
ok(hl.B.status === 'on', '자동 선택: 꺼진 뒤 가상 거래 16건이 좋아지면 다시 켬', hl.B.reason);

// 보수적 체결 이전 기록은 0.3%p 깎아서 셈
const rawFirst = journal.readLines('shadow').find((t) => t.model !== 'conservative' && Number.isFinite(t.pnlPct));
const legacy = journal.shadowRows().find((t) => t.legacy);
ok(legacy && Math.abs(legacy.pnlPct - (rawFirst.pnlPct - 0.3)) < 1e-9, '가상 거래: 예전(완벽 체결 가정) 기록은 0.3%p 불리하게 계산', legacy && `${rawFirst.pnlPct} → ${legacy.pnlPct}`);

// --- 손익 캘린더 ---
const equity = await import('../server/bot/equity.js');
equity.record('2026-10-30', 1000);
equity.record('2026-11-02', 1000);
equity.record('2026-11-02', 1030);
equity.record('2026-11-03', 1010);
const cal = equity.calendar('2026-11', [{ closedAt: '2026-11-03T15:00:00Z', pnl: 12.5, strategies: ['A'] }, { closedAt: '2026-11-03T16:00:00Z', pnl: -2.5, strategies: ['D'] }]);
const d2 = cal.days.find((d) => d.date === '2026-11-02');
const d3 = cal.days.find((d) => d.date === '2026-11-03');
ok(d2.pnl === 30 && d2.pnlPct === 3 && d2.base === 1000, '캘린더: 11/2 = 전 거래일(10/30) 대비 +$30 (+3%)', JSON.stringify(d2));
ok(d3.pnl === -20 && d3.realized === 10 && d3.trades === 2 && d3.wins === 1, '캘린더: 11/3 평가 −$20, 실현 +$10 (2건 중 1승)', JSON.stringify(d3));
ok(cal.total.pnl === 10 && cal.total.pnlPct === 1 && cal.total.upDays === 1 && cal.total.downDays === 1, '캘린더: 월 합계 +$10 (+1%), 오른 날 1·내린 날 1', JSON.stringify(cal.total));

// --- 후보 전략 ---
const C = await import('../src/strategy/candidates.js');
const b = (o, h, l, c, v = 1000) => ({ o, h, l, c, v });
// E VWAP 회복: 하락하다 VWAP 위로 거래량 실린 양봉
const eS = [b(10, 10.1, 9.9, 10, 1000), b(10, 10, 9.7, 9.75, 1000), b(9.75, 9.8, 9.6, 9.65, 1000), b(9.65, 9.7, 9.6, 9.68, 1000), b(9.68, 10.2, 9.66, 10.15, 3000)];
ok(C.checkE(eS).fired, '후보 E: VWAP 회복 양봉 → 신호', C.checkE(eS).detail);
// F 장중 고점 돌파: 고점 10.5 → 6봉 좁은 횡보 → 돌파
const fS = [b(10, 10.5, 9.9, 10.3), b(10.3, 10.35, 10.25, 10.3), b(10.3, 10.36, 10.26, 10.32), b(10.32, 10.37, 10.27, 10.3), b(10.3, 10.36, 10.26, 10.33), b(10.33, 10.38, 10.28, 10.31), b(10.31, 10.37, 10.27, 10.34), b(10.34, 10.7, 10.33, 10.65, 3000)];
ok(C.checkF(fS).fired, '후보 F: 좁은 횡보 후 당일 고점 돌파 → 신호', C.checkF(fS).reason || C.checkF(fS).detail);
// G 레드 투 그린
const gS = [b(9.8, 9.9, 9.6, 9.7), b(9.7, 9.95, 9.65, 9.9), b(9.9, 10.2, 9.88, 10.15, 2000)];
ok(C.checkG(gS, 10).fired && !C.checkG([...gS, b(10.15, 10.3, 10.1, 10.25)], 10).fired, '후보 G: 전일 종가 첫 회복만 신호 (두 번째 봉은 아님)');
// H NR7: 넓은 봉 6개 → 좁은 봉 → 그 고가 돌파 양봉
const hS = [b(10, 10.5, 9.5, 10), b(10, 10.4, 9.6, 10.1), b(10.1, 10.5, 9.7, 10), b(10, 10.4, 9.6, 10.2), b(10.2, 10.6, 9.8, 10.1), b(10.1, 10.5, 9.7, 10), b(10, 10.1, 9.95, 10.05), b(10.05, 10.4, 10.02, 10.3)];
ok(C.checkH(hS).fired, '후보 H: NR7 봉 고가 돌파 → 신호');
// I 불 플래그: 급등 → 얕은 눌림(거래량 감소) → 재상승
const iS = [b(10, 10.05, 9.95, 10), b(10, 10.05, 9.95, 10), b(10, 10.05, 9.95, 10), b(10, 10.05, 9.95, 10), b(10, 10.2, 10, 10.2, 3000), b(10.2, 10.45, 10.2, 10.45, 3000), b(10.45, 10.5, 10.35, 10.4, 800), b(10.4, 10.42, 10.3, 10.33, 700), b(10.33, 10.4, 10.3, 10.38, 600), b(10.38, 10.5, 10.37, 10.48, 1500)];
ok(C.checkI(iS).fired, '후보 I: 불 플래그 재상승 → 신호', C.checkI(iS).detail || C.checkI(iS).reason);

// --- 승격 ---
const { evaluatePromotions } = await import('../server/bot/promotion.js');
const shLine = (id, pid, i, pnl) => JSON.stringify({ kind: 'candidate', model: 'conservative', env: 'demo', symbol: `S${i}`, strategies: [id], profile: pid, pnl, pnlPct: pnl, closedAt: `2026-10-${String(1 + (i % 20)).padStart(2, '0')}T15:${String(i % 60).padStart(2, '0')}:00Z` });
const lines = [];
for (let i = 0; i < 40; i++) lines.push(shLine('E', 'P2', i, i % 3 === 0 ? -1.5 : 1.4)); // 승률 약 2/3, 기대값 +0.3 이상
for (let i = 0; i < 40; i++) lines.push(shLine('F', 'P1', i, i % 2 === 0 ? -1 : 0.9)); // 기대값 음수
for (let i = 0; i < 20; i++) lines.push(shLine('G', 'P3', i, 3)); // 표본 부족
fs.appendFileSync(path.join(jdir, 'shadow.jsonl'), lines.join('\n') + '\n');
const pm = evaluatePromotions('demo', { minTrades: 40, minExp: 0.3, minPF: 1.3 });
ok(evaluatePromotions('demo', { minTrades: 40, minExp: 0.3, minPF: 1.3, minDays: 25 }).E.status === 'watch', '승격: 거래일 25일 미만이면 관찰 유지', evaluatePromotions('demo', { minDays: 25 }).E.reason);
ok(pm.E.status === 'promoted' && pm.E.profile === 'P2', '승격: E 청산 P2가 40건·기대값·PF·앞뒤 절반 모두 통과 → 승격', pm.E.reason);
ok(pm.F.status === 'watch' && pm.G.status === 'watch', '승격: 기대값 음수(F)·표본 부족(G)은 관찰', `${pm.F.reason} / ${pm.G.reason}`);
ok(evaluatePromotions('demo', { modes: { E: 'off' } }).E.status === 'watch' && evaluatePromotions('demo', { modes: { G: 'on' } }).G.status === 'promoted', '승격: 사용자 모드(관찰 고정/승격 고정)가 우선');

// A·B·C도 승격 대상: 예전 가상 거래(청산 표시 없음, 목표 3%·손절 1.5%)는 P2로 셈
fs.appendFileSync(path.join(jdir, 'shadow.jsonl'), Array.from({ length: 10 }, (_, i) => JSON.stringify({ env: 'demo', symbol: `S${i}`, strategies: ['A', 'C'], tpPct: 3, slPct: 1.5, pnl: -0.7, pnlPct: -0.7, closedAt: `2026-11-03T15:${String(i).padStart(2, '0')}:00Z` })).join('\n') + '\n');
const pa = evaluatePromotions('demo', {});
ok(pa.A && pa.A.status === 'watch' && pa.A.profiles.P2.trades === 10 && pa.C.profiles.P2.trades >= 10 && !pa.D, '승격: A·C 예전 가상 거래가 P2로 집계, 관찰 상태 (D는 승격 대상 아님)', pa.A.reason);

// 모세: 승격 전략은 목표 도달 시 바로 익절
const jt = judgeExit({ symbol: 'E1', price: 10.31, avg: 10, qty: 3, peak: 10.31, botPosition: true, ageMin: 10, candles: [] }, { mode: 'auto', hardStopPct: 3, minTargetPct: 3, lossCutPct: 1.5, costPct: 0.6, maxHoldMin: 360, fixedTake: true });
ok(jt.action === 'EXIT_TAKE', '모세: 승격 전략 목표 +3% 도달 → 익절', jt.reasons[0]);

{
  const t0 = Date.parse('2026-11-04T14:30:00Z');
  const base = { env: 'real', symbol: 'FLNC', strategies: ['H'], profile: 'P1' };
  const rows = [{ ...base, barT: t0 }, { ...base, barT: t0 }, { ...base, barT: t0 + 3600e3 }, { ...base, profile: 'P2', barT: t0 }, { ...base, symbol: 'IBTA', barT: t0 }, { ...base, barT: t0 + 86400e3 }];
  const d = journal.dedupeShadows(rows);
  ok(d.length === 4, '가상 거래: 같은 종목·전략·청산은 하루 1건만', d.length);
}

{
  const Rg = await import('../server/bot/regime.js');
  const up = Array.from({ length: 12 }, (_, i) => ({ o: 100 + i * 0.1, h: 100.15 + i * 0.1, l: 99.95 + i * 0.1, c: 100.1 + i * 0.1 }));
  const q = Rg.qqqRegime({ session: up, prevClose: 99.5, avgRangePct: 1 });
  ok(q.dir === '강세' && q.trend === '추세', '장세: QQQ 꾸준히 상승 → 강세·추세', JSON.stringify(q));
  const chop = Array.from({ length: 12 }, (_, i) => ({ o: 100, h: 100.6, l: 99.4, c: i % 2 ? 100.3 : 99.8 }));
  const q2 = Rg.qqqRegime({ session: chop, prevClose: 100, avgRangePct: 0.6 });
  ok(q2.dir === '보합' && q2.trend === '횡보' && q2.vol === '높음', '장세: 위아래 흔들림 → 보합·횡보·변동 높음', JSON.stringify(q2));
  const b = Rg.breadthOf({ XLK: 1, XLF: 0.5, XLE: -1, XLV: 0.2, XLY: 0.3, XLP: 0.1, XLI: 0.4, XLB: 0.2, XLU: -0.2, XLRE: 0.1, XLC: 0.6, RSP: 0.2, SPY: 0.5, VIXY: -3, IWM: -0.8 }, 1.1);
  ok(b.iwm === -0.8 && b.spy === 0.5 && b.qqqIwm === 1.9, '시장 폭: IWM −0.8% · QQQ−IWM +1.9%p (대형주 장)', JSON.stringify(b));
  ok(b.sectorsUp === 9 && b.breadth === '넓음' && b.rspSpy === -0.3 && b.vixy === -3, '시장 폭: 섹터 9/11 상승 · RSP−SPY −0.3%p · VIXY −3%', JSON.stringify(b));
}

{
const C = await import('../src/strategy/candidates.js');
const t = (i) => { const m = 570 + 5 * i; return `2026-11-05T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const B = (o, h, l, c, v = 1000, i = 0) => ({ o, h, l, c, v, time: t(i) });
// J
const J = Array.from({ length: 24 }, (_, i) => B(10, 10.05, i === 5 ? 9.9 : 9.95, 10, 1000, i));
J.push(B(9.95, 9.96, 9.85, 9.88, 1000, 24), B(9.88, 9.97, 9.87, 9.95, 1000, 25));
ok(C.checkJ(J).fired, '후보 J 터틀 수프: 20봉 저가 살짝 깬 뒤 회복 → 신호', C.checkJ(J).detail || C.checkJ(J).reason);
// K
const K = [B(10, 10.05, 9.95, 10, 1000, 0), B(10, 10.05, 9.95, 10, 1000, 1), B(10, 10.05, 9.95, 9.97, 1000, 2), B(9.97, 9.9, 9.8, 9.85, 1000, 3), B(9.85, 10.25, 9.84, 10.2, 3000, 4), B(10.2, 10.3, 10.0, 10.25, 2000, 5), B(10.25, 10.3, 10.05, 10.1, 1000, 6), B(10.08, 10.15, 9.98, 10.1, 1000, 7)];
ok(C.checkK(K).fired, '후보 K 실버 불릿: 저가 쓸기 → FVG 첫 되돌림 → 신호', C.checkK(K).detail || C.checkK(K).reason);
ok(!C.checkK(K.map((b) => ({ ...b, time: b.time.replace('T10:', 'T11:') }))).fired, '후보 K: 11시 이후는 신호 없음', '');
// L
const L = Array.from({ length: 13 }, (_, i) => B(10, 10.03, 9.97, 10, 1000, i));
L.push(B(9.9, 9.9, 9.45, 9.5, 1500, 13), B(9.6, 9.92, 9.58, 9.9, 1500, 14));
ok(C.checkL(L).fired, '후보 L VWAP 2σ: 밴드 밖 → 안으로 복귀 → 신호', C.checkL(L).detail);
// M
const M = Array.from({ length: 45 }, (_, i) => { const o = 10 + i * 0.2; return B(o, o + 0.25, o - 0.03, o + 0.2, 1000, i); });
const e = C.ema(M.map((b) => b.c), 20);
const top = M[M.length - 1].c;
const ePrev = e[e.length - 1];
M.push(B(top, top + 0.02, ePrev - 0.02, ePrev + 0.15, 1000, 45));
M.push(B(ePrev + 0.15, top + 0.1, ePrev + 0.1, top + 0.05, 1000, 46));
ok(C.checkM(M).fired, '후보 M 홀리 그레일: ADX 30↑ 추세 중 20 EMA 첫 눌림 → 신호', C.checkM(M).detail || C.checkM(M).reason);
{
  const cs = [10, 10.1, 10.2, 10.3, 10.4, 10.5, 10.4, 10.3, 10.2, 10.1, 10.0, 10.1, 10.25, 10.4, 10.6, 10.8, 10.9, 10.7, 10.55, 10.45, 10.5, 10.6];
  const pre = Array.from({ length: 10 }, (_, i) => 9.9 - (10 - i) * 0.01);
  const all = [...pre, ...cs];
  const N2 = all.map((c, i) => { const o = i ? all[i - 1] : c; return B(o, Math.max(o, c) + 0.02, Math.min(o, c) - 0.02, c, 1000, i); });
  ok(C.checkN(N2).fired, '후보 N DTFX: 구조 전환 후 50~70% 되돌림 재상승 → 신호', C.checkN(N2).detail || C.checkN(N2).reason);
}

  // O: QQQ 마이너스인데 +1%↑ 종목이 당일 고가 거래량 돌파
  const O = Array.from({ length: 10 }, (_, i) => B(10.1 + i * 0.01, 10.2 + i * 0.01, 10.05 + i * 0.01, 10.15 + i * 0.01, 1000, i));
  O.push(B(10.25, 10.45, 10.24, 10.42, 2500, 10));
  ok(C.checkO(O, 10, { qqqChg: -1.2 }).fired, '후보 O 상대강도: QQQ −1.2%인데 +4% 종목이 당일 고가 돌파 → 신호', C.checkO(O, 10, { qqqChg: -1.2 }).detail);
  ok(!C.checkO(O, 10, { qqqChg: 0.5 }).fired, '후보 O: QQQ 플러스인 날은 신호 없음', '');
  // P: 오전 내내 VWAP 위 → 10:30 이후 첫 VWAP 눌림 → 반등
  const P = Array.from({ length: 13 }, (_, i) => B(10 + i * 0.05, 10.08 + i * 0.05, 9.98 + i * 0.05, 10.05 + i * 0.05, 1000, i));
  const vwP = C.sessionVwap(P);
  P.push(B(10.6, 10.62, vwP * 0.9995, vwP * 1.002, 800, 13));
  P.push(B(vwP * 1.002, 10.7, vwP, 10.68, 1200, 14));
  ok(C.checkP(P).fired, '후보 P VWAP 첫 눌림: 오전 내내 위 → 10:40 첫 눌림 반등 → 신호', C.checkP(P).detail || C.checkP(P).reason);
  // Q: 첫 15분 고가 돌파 → 첫 리테스트 지지 → 재상승
  const Q = [B(10, 10.2, 9.95, 10.1, 1000, 0), B(10.1, 10.3, 10.05, 10.2, 1000, 1), B(10.2, 10.3, 10.1, 10.25, 1000, 2), B(10.25, 10.5, 10.24, 10.45, 1500, 3), B(10.45, 10.6, 10.4, 10.55, 1200, 4), B(10.55, 10.56, 10.31, 10.35, 900, 5), B(10.35, 10.62, 10.33, 10.6, 1300, 6)];
  ok(C.checkQ(Q).fired, '후보 Q ORB 리테스트: 15분 고가 $10.3 돌파 → 첫 리테스트 지지 → 신호', C.checkQ(Q).detail || C.checkQ(Q).reason);
  // 은퇴 판정 · 장세 한정 승격
  const { evaluateRetirements, evaluatePromotions: evP } = await import('../server/bot/promotion.js');
  const day = (i) => new Date(Date.UTC(2026, 6, 1 + (i % 40), 15)).toISOString();
  const rowsX = [];
  for (const pf of ['P1', 'P2', 'P3']) for (let i = 0; i < 110; i++) rowsX.push(JSON.stringify({ kind: 'candidate', model: 'conservative', env: 'demo', symbol: `R${i}`, strategies: ['M'], profile: pf, pnl: i % 3 ? -0.6 : 0.4, pnlPct: i % 3 ? -0.6 : 0.4, closedAt: day(i) }));
  for (let i = 0; i < 120; i++) {
    const dir = ['강세', '보합', '약세'][i % 3];
    const v = dir === '강세' ? (i % 4 ? 1.2 : -0.9) : -0.8;
    rowsX.push(JSON.stringify({ kind: 'candidate', model: 'conservative', env: 'demo', symbol: `Q${i}`, strategies: ['J'], profile: 'P2', regime: { dir }, pnl: v, pnlPct: v, closedAt: day(i) }));
  }
  fs.appendFileSync(path.join(jdir, 'shadow.jsonl'), rowsX.join('\n') + '\n');
  const pr = evP('demo', { ids: ['M', 'J'], minTrades: 40, minExp: 0.3, minPF: 1.3, minDays: 10 });
  ok(pr.J.status === 'regime' && pr.J.dirs.join() === '강세', '장세 한정 승격: J는 강세일에만 기준 통과 → 강세 한정', pr.J.reason);
  const ret = evaluateRetirements('demo', { ids: ['M', 'J'], promo: pr, elapsed: () => 35 });
  ok(ret.length === 1 && ret[0].id === 'M' && ret[0].kind === 'poor', '은퇴: M 110건·40일·기대값 마이너스 → 부진 은퇴 (J는 장세 한정이라 제외)', ret.map((r) => r.reason).join(' | '));
  ok(evaluateRetirements('demo', { ids: ['K'], promo: { K: { status: 'watch' } }, elapsed: () => 61 })[0]?.kind === 'sparse', '은퇴: 60거래일 지나도 40건 미만 → 신호 부족', '');
  // 명부: 은퇴 → 결번, 대기열 맨 앞 투입
  process.env.BOT_REGISTRY_FILE = path.join(tmp, 'registry.json');
  const { createRegistry } = await import('../server/bot/registry.js');
  const reg = createRegistry({ today: () => '2026-11-05' });
  ok(reg.active().length === 10 && reg.queued().join('') === 'OPLQMN', '명부: 후보 10자리 (A~K, D 제외) · 대기열 O·P·L·Q·M·N (추천 순서)', reg.active().join('') + ' / ' + reg.queued().join(''));
  const added = reg.retire('H', '테스트');
  ok(added.join('') === 'O' && !reg.active().includes('H') && reg.retired()[0].id === 'H', '명부: H 은퇴 → 결번, 대기열 맨 앞 O 투입', added.join(''));
  const reg2 = createRegistry({ today: () => '2026-11-06' });
  ok(reg2.retired().some((r) => r.id === 'H') && reg2.active().includes('O'), '명부: 재시작해도 은퇴·투입 유지', reg2.active().join(''));
}

{
  const D = await import('../server/bot/drawdown.js');
  const days = { '2026-11-02': { last: 213 }, '2026-11-03': { last: 205 }, '2026-11-04': { last: 200 } };
  let st = { level: 0 };
  let r = D.evaluateDrawdown(st, { ymd: '2026-11-05', total: 195, days });
  ok(r.s.level === 1 && r.s.peak === 213, '누적 손실: 고점 $213 대비 −8.5% → 1단계 방어', JSON.stringify(r.s));
  r = D.evaluateDrawdown(r.s, { ymd: '2026-11-05', total: 180, days });
  ok(r.s.level === 3, '누적 손실: −15.5% → 3단계 정지 (바로 올라감)', r.s.ddPct);
  r = D.evaluateDrawdown(r.s, { ymd: '2026-11-06', total: 212, days });
  ok(r.s.level === 3, '누적 손실: 3단계는 회복해도 자동으로 안 풀림', r.s.level);
  st = D.releaseDrawdown(r.s, '2026-11-06');
  ok(st.level === 2, '누적 손실: 정지 풀기 → 2단계(최소)부터', st.level);
  r = D.evaluateDrawdown(st, { ymd: '2026-11-06', total: 210, days });
  ok(r.s.level === 2, '누적 손실: 같은 날 두 번 내려오지 않음', r.s.level);
  r = D.evaluateDrawdown(r.s, { ymd: '2026-11-07', total: 210, days });
  ok(r.s.level === 1, '누적 손실: 다음 날 기준 절반(−6%) 위 회복 → 한 단계만 완화', `${r.s.level} ${r.s.ddPct}`);
  st = D.resetPeak({ level: 1 }, '2026-11-08', 150);
  r = D.evaluateDrawdown(st, { ymd: '2026-11-08', total: 150, days });
  ok(r.s.level === 0 && r.s.peak === 150, '누적 손실: 고점 다시 잡기 (출금 후) → 기준 $150', JSON.stringify(r.s));
}

{
  const { judgeShadow } = await import('../server/bot/shadowJudge.js');
  const bar = (hm, o, h, l, c, day = '2026-11-04') => ({ time: `${day} ${hm}`, t: Date.parse(`${day}T${hm}:00-05:00`), o, h, l, c });
  const x = { entry: 10, tpPct: 5, slPct: 2, holdBars: 48 };
  const day = [bar('15:40', 10, 10.05, 9.95, 10), bar('15:45', 10, 10.1, 9.95, 10.05), bar('15:50', 10.05, 10.1, 10, 10.08), bar('15:55', 10.08, 10.15, 10.05, 10.1)];
  const j1 = judgeShadow(x, day, { entryDay: '2026-11-04', closeAt: '16:00' });
  ok(j1.kind === 'closed' && j1.why === '장 마감' && Math.abs(j1.exit - 10.08 * 0.999) < 1e-9, '가상 마감: 실제 봇처럼 15:55에 정리 (15:55 봉 시가)', JSON.stringify(j1));
  const j2 = judgeShadow(x, [...day.slice(0, 3), bar('16:00', 10.08, 10.2, 9.0, 9.1), bar('09:30', 9, 9.1, 8.5, 8.6, '2026-11-05')], { entryDay: '2026-11-04', closeAt: '16:00' });
  ok(j2.kind === 'closed' && j2.why === '장 마감' && Math.abs(j2.exit - 10.08 * 0.999) < 1e-9, '가상 마감: 마감 봉이 빠지고 시간외 급락이 와도 마지막 정규장 봉 종가로 (시간외로 손절 안 함)', JSON.stringify(j2));
  const j3 = judgeShadow(x, [bar('12:45', 10, 10.05, 9.95, 10, '2026-11-27'), bar('12:50', 10, 10.05, 9.95, 10, '2026-11-27'), bar('12:55', 10, 10.05, 9.95, 10.02, '2026-11-27')], { entryDay: '2026-11-27', closeAt: '13:00' });
  ok(j3.kind === 'closed' && j3.why === '장 마감', '가상 마감: 조기폐장일은 12:55 봉에서 정리', JSON.stringify(j3));
  ok(judgeShadow(x, day.slice(0, 2), { entryDay: '2026-11-04' }).kind === 'open', '가상 마감: 아직 마감 봉 전이면 진행 중', '');
}


fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `\n${fail}개 실패` : '\n모두 통과');
process.exit(fail ? 1 : 0);
