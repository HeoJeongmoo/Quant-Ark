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
const tline = (i, pnlPct) => JSON.stringify({ env: 'demo', strategies: ['B'], pnl: pnlPct, pnlPct, closedAt: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T15:00:${String(i).padStart(2, '0')}Z` });
fs.appendFileSync(path.join(jdir, 'trades.jsonl'), Array.from({ length: 30 }, (_, i) => tline(i, i % 3 === 0 ? 1 : -1)).join('\n') + '\n');
let hl = journal.strategyHealth('demo', { minTrades: 30 });
ok(hl.B.status === 'off' && hl.A.status === 'on', '자동 선택: B 실거래 30건 기대값 음수 → 끔, 표본 없는 A는 켬', hl.B.reason);
ok(journal.strategyHealth('demo', { minTrades: 30, modes: { B: 'on' } }).B.status === 'on', '자동 선택: 사용자가 켬으로 고정하면 무시');
fs.appendFileSync(path.join(jdir, 'shadow.jsonl'), Array.from({ length: 16 }, (_, i) => JSON.stringify({ env: 'demo', strategies: ['B'], pnl: i % 4 === 0 ? -1 : 1.5, pnlPct: i % 4 === 0 ? -1 : 1.5, closedAt: `2026-11-02T15:${String(10 + i).padStart(2, '0')}:00Z` })).join('\n') + '\n');
hl = journal.strategyHealth('demo', { minTrades: 30 });
ok(hl.B.status === 'on', '자동 선택: 꺼진 뒤 가상 거래 16건이 좋아지면 다시 켬', hl.B.reason);

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

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `\n${fail}개 실패` : '\n모두 통과');
process.exit(fail ? 1 : 0);
