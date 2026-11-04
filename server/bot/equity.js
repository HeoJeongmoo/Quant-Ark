// 날짜별 계좌 평가금액 기록 → 손익 캘린더
//   data/equity-daily.json  { "2026-11-03": { first, last, high, low, firstAt, lastAt } }  (뉴욕 거래일 기준)
//   장전·정규장·애프터마켓 동안 계좌를 조회할 때마다 갱신. 그날 손익 = 그날 마지막 평가금액 − 전 거래일 마지막 평가금액
//   입출금·환전이 있던 날은 그 금액이 손익처럼 보일 수 있다 (실현 손익 칸은 체결 기록 기준이라 영향 없음)
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve(process.env.BOT_EQUITY_FILE || 'data/equity-daily.json');
let days = null;
const load = () => {
  if (days) return days;
  try {
    days = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    days = {};
  }
  return days;
};
let savedAt = 0;
const save = (force = false) => {
  if (!force && Date.now() - savedAt < 60_000) return;
  savedAt = Date.now();
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(days));
  } catch {
    /* 무시 */
  }
};

export function record(ymd, total, at = new Date().toISOString()) {
  if (!(total > 0) || !ymd) return;
  const d = load();
  const x = d[ymd];
  const isNew = !x;
  if (!x) d[ymd] = { first: total, last: total, high: total, low: total, firstAt: at, lastAt: at };
  else Object.assign(x, { last: total, high: Math.max(x.high, total), low: Math.min(x.low, total), lastAt: at });
  save(isNew);
}

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const nyDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));

/** @param {string} month YYYY-MM  @param {Array} trades journal trades (env 필터 후) */
export function calendar(month, trades = []) {
  const d = load();
  const keys = Object.keys(d).sort();
  const realized = {};
  for (const t of trades) {
    if (!t.closedAt) continue;
    const k = nyDate(t.closedAt);
    if (!k.startsWith(month)) continue;
    const r = (realized[k] ||= { pnl: 0, trades: 0, wins: 0, bot: 0 });
    r.pnl += t.pnl || 0;
    r.trades++;
    if ((t.pnl || 0) > 0) r.wins++;
    if ((t.strategies || []).length) r.bot++;
  }
  const out = [];
  for (const k of new Set([...keys.filter((x) => x.startsWith(month)), ...Object.keys(realized)])) {
    const e = d[k];
    const prevKey = keys.filter((x) => x < k).pop();
    const base = prevKey ? d[prevKey].last : e?.first;
    const pnl = e && base ? e.last - base : null;
    out.push({ date: k, equity: e ? r2(e.last) : null, base: base ? r2(base) : null, pnl: r2(pnl), pnlPct: pnl != null && base ? r2((pnl / base) * 100) : null, realized: realized[k] ? r2(realized[k].pnl) : null, trades: realized[k]?.trades || 0, wins: realized[k]?.wins || 0 });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  const withPnl = out.filter((x) => x.pnl != null);
  const firstBase = withPnl[0]?.base;
  const lastEq = withPnl[withPnl.length - 1]?.equity;
  return {
    month,
    days: out,
    total: {
      pnl: r2(withPnl.reduce((s, x) => s + x.pnl, 0)),
      pnlPct: firstBase && lastEq ? r2((lastEq / firstBase - 1) * 100) : null,
      realized: r2(out.reduce((s, x) => s + (x.realized || 0), 0)),
      trades: out.reduce((s, x) => s + x.trades, 0),
      upDays: withPnl.filter((x) => x.pnl > 0).length,
      downDays: withPnl.filter((x) => x.pnl < 0).length,
    },
    note: '평가금액 기준 손익에는 입출금·환전 금액이 섞일 수 있어요. 실현 손익은 체결 기록(수수료 차감) 기준입니다.',
  };
}
