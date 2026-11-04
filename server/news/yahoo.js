// 야후 파이낸스 종목별 헤드라인 RSS (키 없음, 비공식 피드라 막히거나 바뀔 수 있음)
const BASE = process.env.YAHOO_RSS_BASE || 'https://feeds.finance.yahoo.com';
const nyParts = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${String(+p.hour % 24).padStart(2, '0')}:${p.minute}` };
};
const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
};

export function parseRss(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const it = m[1];
    const at = Date.parse(tag(it, 'pubDate'));
    const ny = Number.isFinite(at) ? nyParts(at) : { date: null, time: null };
    const title = tag(it, 'title');
    if (title) out.push({ ...ny, at: Number.isFinite(at) ? at : null, source: 'Yahoo', title, url: tag(it, 'link') || null, sentiment: null, label: null, relevance: null });
  }
  return out;
}

export function createYahoo({ enabled = process.env.NEWS_YAHOO !== 'false', fetchImpl = fetch } = {}) {
  let blockedUntil = 0;
  async function news(symbol) {
    if (!enabled) throw new Error('off');
    if (Date.now() < blockedUntil) throw new Error('cooldown');
    const u = new URL('/rss/2.0/headline', BASE);
    u.search = new URLSearchParams({ s: symbol, region: 'US', lang: 'en-US' }).toString();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    try {
      const r = await fetchImpl(u, { signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; quant-office/1.0)', Accept: 'application/rss+xml, application/xml, text/xml' } });
      if (r.status === 429 || r.status === 403) {
        blockedUntil = Date.now() + 30 * 60_000; // 막히면 30분 쉰다
        throw new Error(`HTTP ${r.status}`);
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return parseRss(await r.text());
    } finally {
      clearTimeout(timer);
    }
  }
  return { news, status: () => ({ enabled, blocked: Date.now() < blockedUntil }) };
}
