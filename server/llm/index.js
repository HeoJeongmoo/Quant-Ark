// LLM 서비스 진입점: createLlm(kis) → { health, run }
import { llmConfig, hasKey, llmReady } from './config.js';
import { createAgentRunner } from './agents.js';
import { spentToday } from '../usage.js';

export function createLlm(kis) {
  const runner = createAgentRunner(kis);
  return {
    // 브라우저로 나가는 정보: 키 값은 보내지 않고 "있음/없음"만
    health() {
      return {
        enabled: llmConfig.enabled,
        ready: llmReady(),
        providers: { claude: { key: hasKey('claude'), models: llmConfig.models.claude }, gemini: { key: hasKey('gemini'), models: llmConfig.models.gemini } },
        budget: { dailyUsd: llmConfig.dailyBudgetUsd, spentTodayUsd: Math.round(spentToday() * 1e4) / 1e4 },
        routes: runner.routes(),
        tasks: runner.tasks,
      };
    },
    run: (agent, task, input) => runner.run(agent, task, input),
  };
}
