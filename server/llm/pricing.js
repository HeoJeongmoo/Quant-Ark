// 모델 단가 (USD / 100만 토큰). 2026-11-02에 확인한 공개 정가.
// LLM_PRICES_JSON='{"model-id":{"in":1,"out":5}}' 로 덮어쓰거나 추가할 수 있다.
const BASE = {
  'claude-haiku-5-5': { in: 0.1, out: 0.5, longIn: 0.5, longOut: 2.5, longAt: 100_000 }, // 프롬프트 10만 토큰 초과 시 상위 단가
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-opus-5-5': { in: 4, out: 20 },
  'gemini-3.6-flash': { in: 1.5, out: 7.5 },
  'gemini-3.5-flash-lite': { in: 0.3, out: 2.5 },
  'gemini-3.1-pro-preview': { in: 2, out: 12 },
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
};
let extra = {};
try {
  extra = JSON.parse(process.env.LLM_PRICES_JSON || '{}');
} catch {
  extra = {};
}
export const PRICES = { ...BASE, ...extra };

// 캐시 읽기 토큰은 입력 단가의 10%로 계산 (두 회사 공통 관행). 출력에는 생각 토큰이 포함된다.
export function costOf(model, { input = 0, output = 0, cacheRead = 0, cacheWrite = 0 }) {
  const p = PRICES[model] || PRICES[Object.keys(PRICES).find((k) => model.startsWith(k))];
  if (!p) return null;
  const promptTotal = input + cacheRead + cacheWrite;
  const long = p.longAt && promptTotal > p.longAt;
  const pin = long ? p.longIn : p.in;
  const pout = long ? p.longOut : p.out;
  return (input * pin + cacheRead * pin * 0.1 + cacheWrite * pin * 1.25 + output * pout) / 1e6;
}
