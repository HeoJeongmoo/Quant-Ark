// 관심종목 저장소 (서버 파일): { manual: [...], ai: [...] }
//   manual: 사용자가 직접 넣은 종목   ai: 다윗이 발굴해 관망 중인 종목
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve(process.env.WATCHLIST_FILE || 'data/watchlists.json');
const LIMITS = { manual: 20, ai: 15 };
const clean = (x) => ({
  code: String(x.code || '').toUpperCase().trim(),
  exchange: ['NAS', 'NYS', 'AMS'].includes(x.exchange) ? x.exchange : 'NAS',
  kr: String(x.kr || '').slice(0, 40),
  ...(x.reason ? { reason: String(x.reason).slice(0, 120) } : {}),
  ...(x.addedAt ? { addedAt: x.addedAt } : {}),
  ...(x.score != null ? { score: Number(x.score) } : {}),
});
const valid = (x) => /^[A-Z][A-Z.\-]{0,9}$/.test(x.code);

export function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { manual: (d.manual || []).map(clean).filter(valid), ai: (d.ai || []).map(clean).filter(valid), exists: true };
  } catch {
    return { manual: [], ai: [], exists: false };
  }
}

function save(d) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const out = { manual: d.manual.slice(0, LIMITS.manual), ai: d.ai.slice(0, LIMITS.ai), updatedAt: new Date().toISOString() };
  fs.writeFileSync(FILE, JSON.stringify(out, null, 2));
  return { ...out, exists: true };
}

export function replace(body) {
  const manual = (body.manual || []).map(clean).filter(valid);
  const m = new Set(manual.map((x) => x.code));
  const ai = (body.ai || []).map(clean).filter((x) => valid(x) && !m.has(x.code));
  return save({ manual, ai });
}

export function promote(code) {
  const d = load();
  const c = code.toUpperCase();
  const item = d.ai.find((x) => x.code === c);
  if (!item) throw new Error(`${c}: AI 관심종목에 없습니다.`);
  if (d.manual.length >= LIMITS.manual) throw new Error(`수동 관심종목은 최대 ${LIMITS.manual}개입니다.`);
  d.ai = d.ai.filter((x) => x.code !== c);
  d.manual.push({ code: item.code, exchange: item.exchange, kr: item.kr });
  return save(d);
}

export function remove(list, code) {
  if (!LIMITS[list]) throw new Error('list는 manual 또는 ai입니다.');
  const d = load();
  d[list] = d[list].filter((x) => x.code !== code.toUpperCase());
  return save(d);
}

export function addManual(item) {
  const d = load();
  const x = clean(item);
  if (!valid(x)) throw new Error(`종목코드 형식 오류: ${item.code}`);
  if (d.manual.some((m) => m.code === x.code)) return { ...save(d), added: false };
  if (d.manual.length >= LIMITS.manual) throw new Error(`수동 관심종목은 최대 ${LIMITS.manual}개입니다.`);
  d.ai = d.ai.filter((a) => a.code !== x.code);
  d.manual.push({ code: x.code, exchange: x.exchange, kr: x.kr });
  return { ...save(d), added: true };
}

/**
 * 다윗 발굴 종목을 AI 관심종목에 넣는다. 꽉 차면 오래된 것부터 내보내되 keep(보유·신호 종목)은 남긴다.
 * @param {Array} items  @param {Set<string>} keep
 */
export function upsertAi(items, keep = new Set()) {
  const d = load();
  const manual = new Set(d.manual.map((m) => m.code));
  for (const it of items.map(clean).filter(valid)) {
    if (manual.has(it.code)) continue;
    const cur = d.ai.find((a) => a.code === it.code);
    if (cur) Object.assign(cur, { reason: it.reason || cur.reason, score: it.score ?? cur.score });
    else d.ai.push({ ...it, addedAt: it.addedAt || new Date().toISOString() });
  }
  while (d.ai.length > LIMITS.ai) {
    const victim = [...d.ai].filter((a) => !keep.has(a.code)).sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)))[0];
    if (!victim) break;
    d.ai = d.ai.filter((a) => a !== victim);
  }
  return save(d);
}
