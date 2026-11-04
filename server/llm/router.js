// 에이전트별 모델 라우팅 + 재시도 + 다른 회사 모델로 폴백 + 하루 예산 + 토큰 기록
import { llmConfig, hasKey } from './config.js';
import { PROVIDERS, LlmError } from './providers.js';
import { recordCall, spentToday } from '../usage.js';

// tier: fast(속도·비용) / smart(추론). order: 먼저 시도할 회사 → 실패 시 다음 회사
export const ROUTES = {
  crawlA: { name: '다윗', tier: 'fast', order: ['gemini', 'claude'] },
  crawlB: { name: '사무엘', tier: 'fast', order: ['gemini', 'claude'] },
  cha: { name: '솔로몬', tier: 'smart', order: ['claude', 'gemini'] },
  ju: { name: '요셉', tier: 'smart', order: ['claude', 'gemini'] },
  na: { name: '노아', tier: 'smart', order: ['claude', 'gemini'] },
  kang: { name: '아브라함', tier: 'smart', order: ['claude', 'gemini'] },
  trA: { name: '여호수아', tier: 'fast', order: ['gemini', 'claude'] },
  trB: { name: '모세', tier: 'smart', order: ['gemini', 'claude'] },
};

export function chainFor(agent) {
  const r = ROUTES[agent];
  if (!r) throw new LlmError(`알 수 없는 에이전트: ${agent}`, { kind: 'request' });
  return r.order.filter(hasKey).map((provider) => ({ provider, model: llmConfig.models[provider][r.tier] }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 체인 순서대로 호출. 각 모델은 일시 오류(429/5xx/시간초과)에 한 번 재시도하고,
 * 그래도 실패하거나 인증·요청 오류, 출력 형식 불량이면 다음 회사 모델로 넘어간다.
 * @param {{agent:string, task:string, system:string, user:string, parse?:(text:string)=>any, maxTokens?:number}} req
 */
export async function routeCall({ agent, task, system, user, parse, maxTokens }) {
  if (!llmConfig.enabled) throw new LlmError('LLM_ENABLED=false 로 꺼져 있습니다.', { kind: 'disabled' });
  const chain = chainFor(agent);
  if (!chain.length) throw new LlmError('ANTHROPIC_API_KEY / GEMINI_API_KEY 가 모두 없습니다.', { kind: 'nokey' });
  const attempts = [];
  for (const step of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (spentToday() >= llmConfig.dailyBudgetUsd) {
        throw new LlmError(`오늘 LLM 예산 $${llmConfig.dailyBudgetUsd} 소진 (LLM_DAILY_BUDGET_USD)`, { kind: 'budget' });
      }
      try {
        const res = await PROVIDERS[step.provider]({ model: step.model, system, user, maxTokens });
        let output;
        let parseError = null;
        try {
          output = parse ? parse(res.text) : res.text;
        } catch (e) {
          parseError = e.message;
        }
        // 출력이 쓸모없어도 토큰은 청구되므로 기록
        recordCall({ agent, provider: res.provider, model: step.model, task, ...res.usage, ok: !parseError, ms: res.ms, note: parseError || '' });
        if (parseError) {
          attempts.push({ ...step, error: `출력 형식 오류: ${parseError}` });
          break; // 같은 모델 재시도 대신 다른 회사로
        }
        return { ...res, output, attempts, fallback: attempts.length > 0 };
      } catch (e) {
        if (e.kind === 'budget') throw e;
        attempts.push({ ...step, error: e.message, kind: e.kind });
        if (e.retryable && attempt === 0) {
          await sleep(e.retryAfterMs || 800);
          continue;
        }
        break;
      }
    }
  }
  const err = new LlmError(`모든 모델 호출 실패: ${attempts.map((a) => `${a.provider}/${a.model} ${a.error}`).join(' → ')}`, { kind: 'exhausted' });
  err.attempts = attempts;
  throw err;
}
