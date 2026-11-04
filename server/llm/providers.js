// Claude(Messages API) / Gemini(generateContent) REST 호출. SDK 없이 fetch만 쓴다.
import { llmConfig } from './config.js';

export class LlmError extends Error {
  constructor(message, { provider, model, status, retryable = false, kind = 'api', retryAfterMs = 0 } = {}) {
    super(message);
    Object.assign(this, { provider, model, status, retryable, kind, retryAfterMs });
  }
}

async function post(url, headers, body, ctx) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), llmConfig.timeoutMs);
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ac.signal });
  } catch (e) {
    const timeout = e.name === 'AbortError';
    throw new LlmError(timeout ? `응답 시간 초과 (${llmConfig.timeoutMs}ms)` : `네트워크 오류: ${e.message}`, { ...ctx, retryable: true, kind: timeout ? 'timeout' : 'network' });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 비JSON 응답 */
  }
  if (!res.ok) {
    const msg = json?.error?.message || json?.error?.type || text.slice(0, 200) || `HTTP ${res.status}`;
    const ra = Number(res.headers.get('retry-after'));
    throw new LlmError(`${res.status} ${msg}`, {
      ...ctx,
      status: res.status,
      retryable: res.status === 429 || res.status === 408 || res.status >= 500, // 529 overloaded 포함
      kind: res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate' : res.status === 400 || res.status === 404 ? 'request' : 'api',
      retryAfterMs: Number.isFinite(ra) ? Math.min(ra * 1000, 5000) : 0,
    });
  }
  return { json, ms: Date.now() - t0 };
}

export async function callClaude({ model, system, user, maxTokens }) {
  const ctx = { provider: 'claude', model };
  const { json, ms } = await post(
    `${llmConfig.anthropicBase}/v1/messages`,
    { 'x-api-key': llmConfig.anthropicKey, 'anthropic-version': llmConfig.anthropicVersion },
    { model, max_tokens: maxTokens || llmConfig.maxOutputTokens, system, messages: [{ role: 'user', content: user }] },
    ctx
  );
  const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const u = json.usage || {};
  return {
    provider: 'claude',
    model: json.model || model,
    text,
    stop: json.stop_reason,
    ms,
    usage: { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 },
  };
}

export async function callGemini({ model, system, user, maxTokens }) {
  const ctx = { provider: 'gemini', model };
  const generationConfig = { maxOutputTokens: maxTokens || llmConfig.maxOutputTokens, responseMimeType: 'application/json' };
  if (llmConfig.geminiThinkingLevel) generationConfig.thinkingConfig = { thinkingLevel: llmConfig.geminiThinkingLevel };
  const { json, ms } = await post(
    `${llmConfig.geminiBase}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': llmConfig.geminiKey },
    { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig },
    ctx
  );
  const cand = json.candidates?.[0];
  if (!cand) throw new LlmError(`응답 후보 없음 (${json.promptFeedback?.blockReason || '사유 미상'})`, { ...ctx, kind: 'empty' });
  const text = (cand.content?.parts || []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  const u = json.usageMetadata || {};
  const cached = u.cachedContentTokenCount || 0;
  return {
    provider: 'gemini',
    model: json.modelVersion || model,
    text,
    stop: cand.finishReason,
    ms,
    // 생각(thoughts) 토큰은 출력 단가로 청구된다
    usage: { input: Math.max(0, (u.promptTokenCount || 0) - cached), output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), cacheRead: cached, cacheWrite: 0 },
  };
}

export const PROVIDERS = { claude: callClaude, gemini: callGemini };
