// 에이전트별 모델 호출 토큰 장부 (data/usage.json)
// - server/llm 이 실제 Claude/Gemini 응답의 usage를 자동으로 기록한다.
// - 외부에서 직접 기록하려면 POST /api/usage
//   { "agent": "cha", "model": "claude-sonnet-5-5", "input_tokens": 1234, "output_tokens": 210 }
// - 변경될 때마다 이벤트를 내보내 GET /api/usage/stream (SSE)로 대시보드에 실시간 반영된다.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { costOf } from './llm/pricing.js';

const FILE = path.resolve(process.env.USAGE_FILE || 'data/usage.json');
export const AGENT_IDS = ['crawlA', 'crawlB', 'cha', 'ju', 'na', 'kang', 'trA', 'trB'];
export const events = new EventEmitter();
events.setMaxListeners(50);

const today = () => new Date().toISOString().slice(0, 10); // UTC 날짜
const row = () => ({ calls: 0, failed: 0, prompt: 0, completion: 0, cacheRead: 0, cost: 0, models: {} });
function empty() {
  return { by: Object.fromEntries(AGENT_IDS.map((a) => [a, row()])), daily: {}, recent: [], updatedAt: null };
}
let state = null;
function read() {
  if (state) return state;
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const base = empty();
    state = { ...base, ...d, by: Object.fromEntries(AGENT_IDS.map((a) => [a, { ...row(), ...(d.by?.[a] || {}) }])) };
  } catch {
    state = empty();
  }
  return state;
}
// 호출 빈도가 낮으므로 즉시 저장 (프로세스가 바로 꺼져도 기록이 남게)
function persist() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('[usage] 저장 실패:', e.message);
  }
}

export function load() {
  const s = read();
  return { ...s, today: { date: today(), ...(s.daily[today()] || { cost: 0, calls: 0 }) } };
}
export function spentToday() {
  return read().daily[today()]?.cost || 0;
}

/**
 * 호출 1건 기록. 응답 파싱에 실패해도 토큰은 청구되므로 기록한다.
 * @param {{agent:string, provider?:string, model:string, task?:string, input:number, output:number, cacheRead?:number, cacheWrite?:number, ok?:boolean, ms?:number, note?:string}} e
 */
export function recordCall(e) {
  const s = read();
  if (!AGENT_IDS.includes(e.agent)) throw new Error(`agent는 ${AGENT_IDS.join(', ')} 중 하나여야 합니다.`);
  const cost = costOf(e.model, e) ?? 0;
  const r = s.by[e.agent];
  r.calls += 1;
  if (e.ok === false) r.failed += 1;
  r.prompt += e.input || 0;
  r.completion += e.output || 0;
  r.cacheRead += e.cacheRead || 0;
  r.cost += cost;
  r.models[e.model] = (r.models[e.model] || 0) + 1;
  const d = (s.daily[today()] ||= { cost: 0, calls: 0 });
  d.cost += cost;
  d.calls += 1;
  const days = Object.keys(s.daily).sort();
  while (days.length > 31) delete s.daily[days.shift()];
  const entry = { at: new Date().toISOString(), agent: e.agent, provider: e.provider, model: e.model, task: e.task || '', input: e.input || 0, output: e.output || 0, cost, ok: e.ok !== false, ms: e.ms || 0, note: e.note || '' };
  s.recent.unshift(entry);
  s.recent.length = Math.min(s.recent.length, 50);
  s.updatedAt = entry.at;
  persist();
  events.emit('change', entry);
  return entry;
}

// 외부 기록용 (POST /api/usage)
export function record(body = {}) {
  const input = Math.max(0, Math.round(Number(body.input_tokens ?? body.prompt_tokens ?? 0)));
  const output = Math.max(0, Math.round(Number(body.output_tokens ?? body.completion_tokens ?? 0)));
  if (!input && !output) throw new Error('input_tokens 또는 output_tokens가 필요합니다.');
  recordCall({ agent: String(body.agent || ''), provider: body.provider || '', model: String(body.model || 'unknown').slice(0, 60), task: 'external', input, output });
  return load();
}

export function reset() {
  state = empty();
  persist();
  events.emit('change', { reset: true });
  return load();
}
