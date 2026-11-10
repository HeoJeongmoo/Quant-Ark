// 플래너 저장소: data/planner.json (원자적 저장, 기기 간 충돌 감지)
import fs from 'node:fs';
import path from 'node:path';

export const MAX_BYTES = 4 * 1024 * 1024;
const FILE = process.env.BOT_PLANNER_FILE || path.resolve('data/planner.json');

export function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { data: j.data || {}, updatedAt: j.updatedAt || null };
  } catch {
    return { data: {}, updatedAt: null };
  }
}

// base: 클라이언트가 마지막으로 받은 updatedAt. 서버 쪽이 더 새로우면 409
export function save(data, base) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Object.assign(new Error('플래너 데이터 형식이 아닙니다.'), { code: 400 });
  const cur = load();
  if (cur.updatedAt && base !== undefined && base !== cur.updatedAt) throw Object.assign(new Error('다른 기기에서 먼저 수정됨'), { code: 409 });
  const updatedAt = new Date().toISOString();
  const body = JSON.stringify({ data, updatedAt });
  if (body.length > MAX_BYTES) throw Object.assign(new Error('플래너 용량 초과 (4MB)'), { code: 413 });
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, FILE);
  return { updatedAt };
}
