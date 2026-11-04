// LLM 설정: 키는 .env에서만 읽고, 로그·응답에는 마스킹된 형태만 내보낸다.
import 'dotenv/config';

const env = process.env;
const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

export const llmConfig = {
  anthropicKey: (env.ANTHROPIC_API_KEY || '').trim(),
  geminiKey: (env.GEMINI_API_KEY || '').trim(),
  anthropicBase: (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, ''),
  geminiBase: (env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, ''),
  anthropicVersion: env.ANTHROPIC_VERSION || '2023-06-01',
  // 모델은 환경변수로 바꿀 수 있다 (출시·단종이 잦으므로)
  models: {
    claude: { fast: env.CLAUDE_MODEL_FAST || 'claude-haiku-5-5', smart: env.CLAUDE_MODEL_SMART || 'claude-sonnet-5-5' },
    gemini: { fast: env.GEMINI_MODEL_FAST || 'gemini-3.6-flash', smart: env.GEMINI_MODEL_SMART || 'gemini-3.1-pro-preview' },
  },
  geminiThinkingLevel: env.GEMINI_THINKING_LEVEL || '', // low | medium | high (Gemini 3 계열만, 비우면 보내지 않음)
  maxOutputTokens: num(env.LLM_MAX_OUTPUT_TOKENS, 4096), // 생각 토큰 포함 상한
  timeoutMs: num(env.LLM_TIMEOUT_MS, 30000),
  dailyBudgetUsd: num(env.LLM_DAILY_BUDGET_USD, 3), // 하루 예산 초과 시 호출 거부
  enabled: env.LLM_ENABLED !== 'false',
};

export const hasKey = (provider) => (provider === 'claude' ? !!llmConfig.anthropicKey : !!llmConfig.geminiKey);
export const llmReady = () => llmConfig.enabled && (hasKey('claude') || hasKey('gemini'));

export function maskKey(k) {
  if (!k) return null;
  return `${k.slice(0, 6)}…${k.slice(-4)}`;
}
