// 사무엘: 뉴스 재료 확인 (막기만 하고 밀어 주지는 않는다)
//   뉴스 출처 (위에서부터, 합쳐서 씀)
//     Alpha Vantage NEWS_SENTIMENT  종목별 기사 + 감성 점수 (키 필요, 무료 하루 25회 → 매수 직전·갭 후보 확정에만)
//     야후 파이낸스 RSS             종목별 영문 헤드라인 (키 없음)
//     KIS 해외뉴스                  한글 제목 (종목 지정이 안 되면 전체 뉴스에서 이름으로 찾음)
//   1) 종목별로 10분 캐시 (Alpha Vantage 결과는 60분)
//   2) 규칙: 유상증자·공모·희석·역분할·상장폐지·파산 같은 제목이 있으면 차단, 실적 호조·FDA 승인·계약 등은 '재료 있음'
//   3) AI 키가 있으면 제목들을 사무엘에게 보여 주고 BLOCK/NEUTRAL/SUPPORT 의견 (BLOCK만 효력)
const NEG = [
  /\b(public|secondary|registered direct|follow-on|proposed|underwritten)\s+offering\b/i, /\bpric(es|ed|ing)\b.*\boffering\b/i, /\boffering\b.*\bpric/i,
  /\bdilut/i, /\breverse (stock )?split\b/i, /\bgoing concern\b/i, /\bdelist/i, /\bbankrupt/i, /\bchapter 11\b/i, /\bat-the-market\b/i, /\bshelf registration\b/i,
  /\bSEC (probe|investigation)\b/i, /\bclass action\b/i, /\bhalted\b/i, /\bwarrants?\b.*\bexercise/i,
  /유상\s*증자/, /공모/, /희석/, /신주\s*발행/, /주식\s*발행/, /역분할/, /상장\s*폐지/, /파산/, /거래\s*정지/, /집단\s*소송/, /전환사채/,
];
const POS = [
  /\b(beats?|tops?|surpass)\b/i, /\braises? (guidance|outlook|forecast)\b/i, /\brecord (revenue|quarter)\b/i, /\bFDA (approv|clear)/i, /\bapprov(al|ed)\b/i,
  /\b(contract|partnership|agreement|collaborat)/i, /\bacquir(e|es|ed)\b|\bto be acquired\b|\bbuyout\b/i, /\bbuyback\b|\brepurchase\b/i, /\bupgrade/i, /\bprice target (raised|hike)/i,
  /어닝\s*서프라이즈/, /실적\s*(호조|상회|개선)/, /(판매|매출|수요)\s*(호조|급증|증가)/, /예상\s*(상회|웃돌)/, /가이던스\s*상향/, /승인/, /계약/, /수주/, /제휴/, /인수/, /자사주/, /목표\s*(주가|가)\s*상향/, /상향/,
];
const EARN = [/\bearnings\b|\bquarter(ly)? results\b|\bQ[1-4]\b/i, /실적|분기|어닝/];

export function classifyHeadlines(items) {
  const neg = [];
  const pos = [];
  let earnings = false;
  for (const n of items) {
    const t = n.title || '';
    if (NEG.some((r) => r.test(t))) neg.push(t);
    else if (POS.some((r) => r.test(t))) pos.push(t);
    if (EARN.some((r) => r.test(t))) earnings = true;
  }
  const catalyst = neg.length ? 'negative' : pos.length ? 'positive' : items.length ? 'news' : 'none';
  return { catalyst, earnings, neg: neg.slice(0, 3), pos: pos.slice(0, 3), count: items.length };
}

// 전체 뉴스 제목에서 종목을 찾는 규칙: 종목코드 필드, 한글 이름, 영문 이름 첫 단어, 티커 단어
const STOP = new Set(['THE', 'INC', 'CORP', 'CO', 'LTD', 'PLC', 'HOLDINGS', 'GROUP', 'CLASS', 'ORDINARY', 'SHARES', 'COMPANY', 'TECHNOLOGIES', 'INTERNATIONAL', 'AMERICAN', 'GLOBAL', 'ENERGY']);
const COMMON_TICKERS = new Set(['ALL', 'IT', 'ON', 'AI', 'A', 'AN', 'ARE', 'BE', 'CAN', 'FOR', 'GO', 'NOW', 'ONE', 'OUT', 'SO', 'UP', 'NEW', 'BIG', 'CEO', 'IPO', 'ETF', 'USA', 'GDP', 'CPI', 'FED']);
export function matchesSymbol(item, symbol, names = []) {
  if (item.symbol && item.symbol.toUpperCase() === symbol) return true;
  const t = item.title || '';
  for (const n0 of names) {
    const n = String(n0 || '').trim();
    if (!n) continue;
    if (/[가-힣]/.test(n)) {
      const kr = n.replace(/\s*(보통주|우선주|ADR|클래스\s*[A-Z])\s*$/i, '').trim();
      if (kr.length >= 2 && t.includes(kr)) return true;
    } else {
      const w = n.toUpperCase().split(/[^A-Z0-9&]+/).find((x) => x.length >= 4 && !STOP.has(x));
      if (w && new RegExp(`\\b${w.replace(/&/g, '\\&')}\\b`, 'i').test(t)) return true;
    }
  }
  if (symbol.length >= 3 && !COMMON_TICKERS.has(symbol) && new RegExp(`(^|[^A-Za-z])${symbol}([^A-Za-z]|$)`).test(t)) return true;
  return false;
}

export function createSamuel({ kis, llm, aiReady, emit, clockNow = Date.now, av = null, yahoo = null }) {
  const cache = new Map(); // symbol → {at, res}
  const avCache = new Map(); // symbol → {at, items}
  const feed = { at: 0, items: new Map(), err: null }; // KIS 전체 뉴스 (종목 지정 조회가 0건일 때 제목에서 찾기)
  const AV_RESERVE = 8; // 갭 후보 확정에 쓰고도 매수 직전 확인용으로 남겨 둘 횟수
  const keepDays = (ymd) => {
    const d = new Date(`${ymd}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 2); // 주말 넘어 온 재료까지
    return d.toISOString().slice(0, 10);
  };
  async function refreshFeed() {
    if (clockNow() - feed.at < 3 * 60_000) return;
    feed.at = clockNow();
    try {
      let cts = '';
      for (let page = 0; page < 3; page++) {
        const r = await kis.getNews('', { cts, raw: true });
        for (const n of r.rows) feed.items.set(n.key || `${n.date}${n.time}${n.title}`, n);
        if (!r.next || !r.rows.length) break;
        cts = r.next;
      }
      if (feed.items.size > 400) for (const k of [...feed.items.keys()].slice(0, feed.items.size - 400)) feed.items.delete(k);
      feed.err = null;
    } catch (e) {
      feed.err = e.message;
    }
  }
  async function kisNews(symbol, names) {
    let items = [];
    try {
      items = (await kis.getNews(symbol)).filter((n) => !n.symbol || n.symbol === symbol);
    } catch {
      /* 아래 전체 뉴스로 */
    }
    if (items.length) return items.map((n) => ({ ...n, source: n.source || 'KIS' }));
    await refreshFeed();
    return [...feed.items.values()].filter((n) => matchesSymbol(n, symbol, names)).map((n) => ({ ...n, source: n.source || 'KIS' }));
  }
  // priority: entry(매수 직전) | gap-final(갭 후보 확정) | gap(장전 중간 스캔: Alpha Vantage 안 씀)
  async function avNews(symbol, priority) {
    if (!av || !av.status().enabled) return { items: null, note: null };
    const hit = avCache.get(symbol);
    if (hit && clockNow() - hit.at < 60 * 60_000) return { items: hit.items, note: null };
    const st = av.status();
    if (priority === 'gap' || (priority === 'gap-final' && st.left <= AV_RESERVE)) return { items: null, note: null };
    try {
      const items = await av.news(symbol, { wait: priority === 'gap-final' }); // 장전 확정은 뒤에서 도니 13초 간격을 기다린다
      avCache.set(symbol, { at: clockNow(), items });
      return { items, note: null };
    } catch (e) {
      return { items: null, note: e.message === 'budget' ? 'Alpha Vantage 오늘 한도 소진' : e.message === 'throttle' ? null : `Alpha Vantage 실패 (${e.message})` };
    }
  }

  /** @returns {{ok:boolean, catalyst, earnings, neg, pos, headlines, block:boolean, why, sources, sentiment, ai?}} */
  async function check(symbol, { ymd, names = [], useAi = true, priority = 'entry', ttlMs = 10 * 60_000 } = {}) {
    const hit = cache.get(symbol);
    const wantAv = av?.status().enabled && priority !== 'gap' && !avCache.has(symbol);
    if (hit && clockNow() - hit.at < ttlMs && (!useAi || hit.res.aiDone || !aiReady()) && !(wantAv && !hit.res.sources?.includes('AlphaVantage'))) return hit.res;
    const sources = [];
    const notes = [];
    let all = [];
    const a = await avNews(symbol, priority);
    if (a.note) notes.push(a.note);
    if (a.items) {
      sources.push('AlphaVantage');
      all.push(...a.items);
    }
    if (!a.items?.length && yahoo) {
      try {
        const y = await yahoo.news(symbol);
        sources.push('Yahoo');
        all.push(...y);
      } catch (e) {
        if (!['off', 'cooldown'].includes(e.message)) notes.push(`야후 RSS 실패 (${e.message})`);
      }
    }
    try {
      const k = await kisNews(symbol, names);
      if (k.length) sources.push('KIS');
      all.push(...k);
    } catch {
      /* KIS 뉴스 실패는 무시 */
    }
    // 같은 제목 중복 제거, 최신순
    const seen = new Set();
    all = all.filter((n) => n.title && !seen.has(n.title.toLowerCase()) && seen.add(n.title.toLowerCase())).sort((x, y) => `${y.date}${y.time}`.localeCompare(`${x.date}${x.time}`));
    const since = ymd ? keepDays(ymd) : null;
    const recent = all.filter((n) => !since || !n.date || n.date >= since).slice(0, 15);
    if (!sources.length && notes.length) {
      const res = { ok: false, catalyst: 'unknown', block: false, why: notes.join(' · '), headlines: [], sources };
      cache.set(symbol, { at: clockNow(), res });
      return res;
    }
    const r = classifyHeadlines(recent);
    // Alpha Vantage 종목 감성: 관련도 0.3 이상 기사만, 관련도로 가중 평균
    const rel = recent.filter((n) => n.sentiment != null && (n.relevance ?? 0) >= 0.3);
    const wsum = rel.reduce((x, n) => x + n.relevance, 0);
    const sentiment = wsum > 0 ? Math.round((rel.reduce((x, n) => x + n.sentiment * n.relevance, 0) / wsum) * 1000) / 1000 : null;
    let catalyst = r.catalyst;
    let why = r.catalyst === 'negative' ? `악재 제목: ${r.neg[0]}` : r.catalyst === 'positive' ? `재료: ${r.pos[0]}` : recent.length ? '뉴스 있음 (뚜렷한 재료 없음)' : '최근 뉴스 없음';
    if (catalyst !== 'negative' && sentiment != null && rel.length >= 2 && sentiment <= -0.35) {
      catalyst = 'negative';
      why = `Alpha Vantage 감성 ${sentiment} (Bearish, 관련 기사 ${rel.length}건)`;
    } else if (catalyst !== 'negative' && sentiment != null && sentiment >= 0.25) {
      catalyst = 'positive';
      why = `${r.catalyst === 'positive' ? `${why} · ` : ''}Alpha Vantage 감성 +${sentiment} (관련 기사 ${rel.length}건)`;
    }
    const res = { ok: true, ...r, catalyst, sentiment, sentimentN: rel.length, sources, notes, headlines: recent.slice(0, 6).map((n) => ({ at: n.at || null, date: n.date, time: n.time, title: n.title, source: n.source, url: n.url || null, sentiment: n.sentiment ?? null })), block: catalyst === 'negative', why };
    if (useAi && aiReady() && recent.length) {
      try {
        const out = await llm.run('crawlB', 'news_check', { symbol, headlines: recent.map((n) => `${n.date || ''} ${n.time || ''} [${n.source}${n.sentiment != null ? ` 감성 ${n.sentiment}` : ''}] ${n.title}`) });
        res.ai = { ...out.output, model: out.model };
        res.aiDone = true;
        if (out.output.verdict === 'BLOCK') {
          res.block = true;
          res.why = `AI 뉴스 판단 차단: ${out.output.say}`;
        }
        emit?.('ai', 'crawlB', `${symbol} 뉴스 ${recent.length}건 (${sources.join('+')}) → ${out.output.verdict === 'BLOCK' ? '진입 막음' : out.output.verdict === 'SUPPORT' ? '재료 확인' : '중립'} (${out.output.catalyst}). ${out.output.say}`, { ai: { model: out.model, fallback: out.fallback, usage: out.usage, task: '뉴스 재료' } });
      } catch (e) {
        emit?.('ai-error', 'crawlB', `${symbol} AI 뉴스 판단 실패 (${e.message}). 규칙 판단만 씁니다.`, {}, 'warn');
      }
    }
    cache.set(symbol, { at: clockNow(), res });
    return res;
  }
  // 뉴스 속보 창: KIS 전체 뉴스 + 종목별로 확인한 기사(야후·Alpha Vantage·KIS)를 최신순으로
  function feedList({ limit = 60, symbols = [] } = {}) {
    const out = new Map();
    for (const n of feed.items.values()) {
      const sym = n.symbol || symbols.find((x) => matchesSymbol(n, x.symbol, x.names))?.symbol || null;
      out.set(n.title.toLowerCase(), { ...n, symbol: sym, source: n.source || 'KIS' });
    }
    for (const [sym, c] of cache) for (const h of c.res.headlines || []) if (!out.has(h.title.toLowerCase())) out.set(h.title.toLowerCase(), { ...h, symbol: sym });
    return [...out.values()]
      .map((n) => ({ ...n, tone: classifyHeadlines([n]).catalyst }))
      .sort((a, b) => (b.at || 0) - (a.at || 0) || `${b.date || ''}${b.time || ''}`.localeCompare(`${a.date || ''}${a.time || ''}`))
      .slice(0, limit);
  }
  return {
    check,
    feedList,
    refreshFeed,
    cached: (s2) => cache.get(s2)?.res || null,
    status: () => ({ alphaVantage: av ? av.status() : { enabled: false }, yahoo: yahoo ? yahoo.status() : { enabled: false }, kisFeed: feed.items.size }),
  };
}
