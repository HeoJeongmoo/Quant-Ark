// npm run kis:scan — 다윗 탐색용 순위 API 테스트 코너
//   거래량급증(HHDFS76270000) / 매수체결강도상위(HHDFS76280000) 를 실제로 호출해
//   1) 응답 필드가 공식 스펙과 같은지  2) 매핑된 값  3) 필터 통과 후보 를 보여준다.
import { createKis } from './index.js';
import { EXPECTED_FIELDS } from './scanner.js';

const kis = createKis();
console.log(kis.describe());
const r = await kis.discover({ limit: 15, raw: true });
let bad = 0;
for (const [k, v] of Object.entries(r.raw || {})) {
  const kind = k.split('.')[1];
  if (!v.count) {
    console.log(`\n■ ${k}: 응답 0건 (장 시간이 아니거나 모의투자 미지원일 수 있음)`);
    continue;
  }
  console.log(`\n■ ${k}: ${v.count}건`);
  console.log(`  받은 필드: ${v.keys.join(', ')}`);
  if (v.missing.length) {
    bad++;
    console.log(`  ⚠ 스펙에 있는데 없는 필드: ${v.missing.join(', ')}`);
  } else console.log(`  ✓ 스펙 필드 모두 있음 (${EXPECTED_FIELDS[kind].length}개)`);
  const f = v.first;
  console.log(`  첫 행: ${f.symb} ${f.knam || f.name || ''} last=${f.last} rate=${f.rate}% tvol=${f.tvol} tamt=${f.tamt ?? '-'} ${kind === 'surge' ? `n_rate=${f.n_rate}% n_tvol=${f.n_tvol}` : `tpow=${f.tpow} powx=${f.powx}`} e_ordyn=${f.e_ordyn}`);
}
console.log(`\n거래대금 단위: ${r.amountUnit}`);
if (r.errors.length) console.log(`오류: ${r.errors.join(' / ')}`);
console.log(`\n필터 ($${r.filters.minPrice} 이상, 거래대금 $${(r.filters.minAmount / 1e6).toFixed(0)}M 이상) 통과 후보 ${r.candidates.length}개:`);
for (const c of r.candidates) console.log(`  ${c.symbol.padEnd(6)} ${c.exchange} $${c.last}  ${c.rate}%  거래량+${c.surgeRate ?? '-'}%  체결강도 ${c.power ?? '-'}  대금 $${((c.amount || 0) / 1e6).toFixed(1)}M  점수 ${c.score} [${c.sources.join('+')}]`);

// 상품기본정보로 위험 상품 판별 (레버리지 배수, PTP, 상품분류)
const { classify } = await import('../bot/risk.js');
console.log('\n위험 상품 판별 (상품기본정보 CTPF1702R):');
let infoOk = 0;
for (const c of r.candidates) {
  const k = await classify(kis, c.symbol, c.exchange, `${c.name} ${c.ename || ''}`);
  if (k.source === 'kis') infoOk++;
  const i = k.info || {};
  console.log(`  ${k.risky ? '✗ 제외' : '✓ 통과'} ${c.symbol.padEnd(6)} 분류=${i.className || '-'} 구분코드=${i.stockDivision || '-'} 추적배수=${i.etpMultiple ?? '-'} PTP=${i.ptp ? 'Y' : 'N'} 거래정지코드=${i.tradeStop || '-'}${k.reasons.length ? `  ← ${k.reasons.join(', ')}` : ''}`);
}
if (r.candidates.length && !infoOk) console.log('  ⚠ 상품기본정보 조회가 모두 실패해 이름·티커로만 판별했습니다 (모의투자 미지원일 수 있음)');

// 트랙 1: 상승률 순위(updown-rate)로 갭 후보 (장전 22:30~23:25 KST에 돌리면 프리마켓 기준)
console.log('\n■ 갭 후보 (상승률 순위 HHDFS76290000, 갭 +4~25%, $5~30, 거래량 500K주 또는 $5M)');
try {
  const g = await kis.premarketGappers({ raw: true });
  for (const [ex, v] of Object.entries(g.raw || {})) console.log(`  ${ex}: ${v.count}건 · 필드 ${v.keys.join(', ')}`);
  if (g.errors.length) console.log(`  오류: ${g.errors.join(' / ')}`);
  console.log(`  순위 ${g.scanned}개 중 통과 ${g.candidates.length}개`);
  for (const c of g.candidates.slice(0, 8)) {
    let mcap = '-';
    try {
      const sh = (await kis.getProductInfo(c.symbol, c.exchange))?.shares;
      if (sh) mcap = `$${Math.round((sh * c.last) / 1e6)}M`;
    } catch {
      /* 시총 확인 실패 */
    }
    console.log(`  ${c.symbol.padEnd(6)} ${c.exchange} $${c.last}  +${c.rate}%  거래량 ${c.volume ?? '-'}  대금 $${((c.amount || 0) / 1e6).toFixed(1)}M  시총 ${mcap}  점수 ${c.score}`);
  }
} catch (e) {
  console.log(`  ⚠ 갭 스캔 실패: ${e.message}`);
}

// 상대 거래량용 일봉 · 사무엘 뉴스 (해외뉴스종합 HHPSTH60100C1)
// 상장된 지 얼마 안 된 종목은 일봉이 적고 뉴스가 없을 수 있어, 잘 알려진 종목으로도 같이 확인한다
const probes = [...new Map([[r.candidates[0]?.symbol, r.candidates[0]?.exchange], ['AAPL', 'NAS'], ['TSLA', 'NAS']].filter(([sym]) => sym)).entries()];
console.log(`\n■ 일봉(HHDFS76240000)`);
for (const [sym, ex] of probes) {
  try {
    const d = await kis.getDailyBars(sym, ex, { count: 25 });
    const past = d.slice(0, -1).slice(-20);
    const avg = past.length ? Math.round(past.reduce((s2, b) => s2 + (b.v || 0), 0) / past.length) : null;
    console.log(`  ${sym.padEnd(6)} 일봉 ${d.length}개 (${d[0]?.date ?? '-'} ~ ${d[d.length - 1]?.date ?? '-'}) · 직전 ${past.length}일 평균 거래량 ${avg ?? '-'}${d.length < 6 ? '  ← 상장 초기 종목이면 RVol 계산 안 함(5일 미만)' : ''}`);
  } catch (e) {
    console.log(`  ⚠ ${sym} 일봉 실패: ${e.message}`);
  }
}
console.log(`\n■ 뉴스(HHPSTH60100C1) 조건별 건수`);
const tries = [['AAPL', 'US', ''], ['AAPL', 'US', 'NAS'], ['AAPL', 'US', 'NASD'], ['AAPL', 'US', 'O'], ['TSLA', 'US', 'NAS'], ['', 'US', '']];
for (const [sym, nation, exch] of tries) {
  try {
    const r2 = await kis.getNews(sym, { nation, exchange: exch, raw: true });
    const n = r2.rows;
    console.log(`  종목=${sym || '(전체)'} 국가=${nation || '(전체)'} 거래소=${exch || '(공백)'} → ${n.length}건${n[0] ? ` · ${n[0].date} ${n[0].time} [${n[0].source}] 종목필드=${n[0].symbol || '-'} ${n[0].title}` : ''}`);
    if (!sym) {
      console.log(`    응답 키: ${r2.keys.join(', ')} · 다음 페이지 키: ${r2.next ?? '-'}`);
      console.log(`    첫 행 원본: ${JSON.stringify(r2.first)}`);
      const withSym = n.filter((x) => x.symbol);
      console.log(`    종목코드가 붙은 뉴스 ${withSym.length}/${n.length}건${withSym[0] ? ` (예: ${withSym[0].symbol} ${withSym[0].title})` : ''}`);
    }
  } catch (e) {
    console.log(`  ⚠ 종목=${sym || '(전체)'} 거래소=${exch || '(공백)'} 실패: ${e.message}`);
  }
}
const { matchesSymbol } = await import('../bot/samuel.js');
try {
  const feedRows = (await kis.getNews('', { nation: 'US' }));
  const hits = [];
  for (const c of r.candidates.slice(0, 13)) for (const x of feedRows) if (matchesSymbol(x, c.symbol, [c.name, c.ename])) hits.push(`${c.symbol}: ${x.title}`);
  console.log(`  전체 뉴스 ${feedRows.length}건에서 후보 종목 이름으로 찾은 제목 ${hits.length}건${hits.length ? `\n   ${hits.slice(0, 5).join('\n   ')}` : ''}`);
} catch {
  /* 위에서 이미 출력 */
}
process.exit(bad || r.errors.length ? 1 : 0);
