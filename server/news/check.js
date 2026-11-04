// npm run news:check [-- TSLA]  → 뉴스 출처 3곳이 실제로 응답하는지 확인 (봇 판단까지)
import { createKis } from '../kis/index.js';
import { createAlphaVantage } from './alphavantage.js';
import { createYahoo } from './yahoo.js';
import { createSamuel, classifyHeadlines } from '../bot/samuel.js';

const sym = (process.argv[2] || 'TSLA').toUpperCase();
const kis = createKis();
const av = createAlphaVantage();
const yahoo = createYahoo();
const line = (n) => `   ${n.date || '-'} ${n.time || ''} [${n.source}]${n.sentiment != null ? ` 감성 ${n.sentiment}` : ''} ${n.title}`;

console.log(`뉴스 확인: ${sym}\n`);
console.log(`■ Alpha Vantage (${av.status().enabled ? `키 있음 · 오늘 ${av.status().used}/${av.status().limit}회 사용` : '키 없음 → 건너뜀'})`);
if (av.status().enabled) {
  try {
    const a = await av.news(sym);
    console.log(`  ✓ ${a.length}건 (이번 확인으로 1회 사용)`);
    a.slice(0, 5).forEach((n) => console.log(line(n)));
  } catch (e) {
    console.log(`  ⚠ ${e.message === 'budget' ? '오늘 한도 소진' : e.message}`);
  }
}
console.log(`\n■ 야후 RSS (${yahoo.status().enabled ? '켜짐' : '꺼짐'})`);
try {
  const y = await yahoo.news(sym);
  console.log(`  ✓ ${y.length}건`);
  y.slice(0, 5).forEach((n) => console.log(line(n)));
} catch (e) {
  console.log(`  ⚠ ${e.message}`);
}
console.log('\n■ KIS 해외뉴스 (전체 뉴스에서 이름으로 찾기 포함)');
try {
  const k = await kis.getNews('', { nation: 'US' });
  console.log(`  ✓ 전체 ${k.length}건 수신`);
} catch (e) {
  console.log(`  ⚠ ${e.message}`);
}

// 봇과 같은 방식으로 합쳐서 판단 (AI 없이 규칙만, Alpha Vantage는 위에서 받은 걸 다시 쓰지 않으므로 끔)
const samuel = createSamuel({ kis, llm: null, aiReady: () => false, yahoo, av: null });
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const r = await samuel.check(sym, { ymd, names: [] });
console.log(`\n■ 사무엘 판단 (야후+KIS, 규칙): ${r.block ? '⛔ 막음' : '통과'} · ${r.catalyst} · ${r.why} · 출처 ${r.sources?.join('+') || '-'}`);
(r.headlines || []).slice(0, 5).forEach((n) => console.log(line(n)));
console.log(`\n참고: 제목 규칙 예시 → "XYZ prices $40M public offering" = ${classifyHeadlines([{ title: 'XYZ prices $40M public offering' }]).catalyst}`);
process.exit(0);
