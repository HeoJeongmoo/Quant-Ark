// Alpha Vantage NEWS_SENTIMENT: 종목별 뉴스 + 기사별·종목별 감성 점수
//   무료 키는 하루 25회(분당 5회)라 data/av-usage.json에 뉴욕 날짜별 사용량을 세고, 한도에 닿으면 쓰지 않는다.
//   점수 기준(Alpha Vantage 정의): ≤ -0.35 Bearish, ≤ -0.15 Somewhat-Bearish, < 0.15 Neutral, < 0.35 Somewhat-Bullish, ≥ 0.35 Bullish
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.ALPHAVANTAGE_BASE_URL || 'https://www.alphavantage.co';
const USAGE_FILE = path.resolve(process.env.ALPHAVANTAGE_USAGE_FILE || 'data/av-usage.json');
const MIN_GAP_MS = 13_000; // 분당 5회 → 13초 간격

const nyYmd = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
// "20261103T083000" (UTC로 오는 것으로 문서화돼 있음) → epoch
const parseTs = (s) => (s && s.length >= 13 ? Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13), +(s.slice(13, 15) || 0)) : null);

export function createAlphaVantage({ apiKey = process.env.ALPHAVANTAGE_API_KEY || '', dailyLimit = Number(process.env.ALPHAVANTAGE_DAILY_LIMIT || 25), clockNow = Date.now, fetchImpl = fetch } = {}) {
  let usage = { date: null, used: 0 };
  try {
    usage = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
  } catch {
    /* 처음 */
  }
  let lastCall = 0; // 실제 시각 기준 (분당 한도)
  const today = () => nyYmd(clockNow());
  const used = () => (usage.date === today() ? usage.used : 0);
  const save = () => {
    try {
      fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
      fs.writeFileSync(USAGE_FILE, JSON.stringify(usage));
    } catch {
      /* 무시 */
    }
  };
  const status = () => ({ enabled: !!apiKey, used: used(), limit: dailyLimit, left: Math.max(0, dailyLimit - used()) });

  /**
   * @returns {Promise<Array<{date,time,at,source,title,url,sentiment:number|null,label:string|null,relevance:number|null,overall:number|null}>>}
   * 한도 소진·간격 부족이면 Error('budget') / Error('throttle')
   */
  async function news(symbol, { lookbackHours = 48, limit = 50, wait = false } = {}) {
    if (!apiKey) throw new Error('no-key');
    if (used() >= dailyLimit) throw new Error('budget');
    const gap = MIN_GAP_MS - (Date.now() - lastCall);
    if (gap > 0) {
      if (!wait) throw new Error('throttle');
      await new Promise((r) => setTimeout(r, gap));
    }
    lastCall = Date.now();
    if (usage.date !== today()) usage = { date: today(), used: 0 };
    usage.used++;
    save();
    const from = new Date(clockNow() - lookbackHours * 3600_000).toISOString().replace(/[-:]/g, '').slice(0, 13); // YYYYMMDDTHHMM
    const u = new URL('/query', BASE);
    u.search = new URLSearchParams({ function: 'NEWS_SENTIMENT', tickers: symbol, time_from: from, sort: 'LATEST', limit: String(limit), apikey: apiKey }).toString();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10_000);
    let body;
    try {
      const r = await fetchImpl(u, { signal: ac.signal, headers: { 'User-Agent': 'quant-office/1.0' } });
      body = await r.json();
    } finally {
      clearTimeout(timer);
    }
    if (body.Information || body.Note) {
      // 한도 초과 안내가 오면 오늘은 그만 쓴다
      if (/limit|premium|rate/i.test(body.Information || body.Note)) {
        usage.used = dailyLimit;
        save();
        throw new Error('budget');
      }
      throw new Error(String(body.Information || body.Note).slice(0, 120));
    }
    if (body['Error Message']) throw new Error(String(body['Error Message']).slice(0, 120));
    const feed = Array.isArray(body.feed) ? body.feed : [];
    return feed.map((a) => {
      const at = parseTs(a.time_published);
      const ts = (a.ticker_sentiment || []).find((x) => String(x.ticker).toUpperCase() === symbol.toUpperCase());
      const d = at ? nyYmd(at) : null;
      const hm = at ? new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at)) : null;
      return {
        date: d,
        time: hm,
        at,
        source: a.source || 'AlphaVantage',
        title: String(a.title || '').trim(),
        url: a.url || null,
        sentiment: ts ? Number(ts.ticker_sentiment_score) : null,
        label: ts?.ticker_sentiment_label || null,
        relevance: ts ? Number(ts.relevance_score) : null,
        overall: a.overall_sentiment_score != null ? Number(a.overall_sentiment_score) : null,
      };
    });
  }
  return { news, status };
}
