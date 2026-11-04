// npm run llm:check — 키·모델 연결 확인 (모델마다 아주 짧은 호출 1번, 장부에는 기록하지 않음)
import { llmConfig, hasKey, maskKey } from './config.js';
import { PROVIDERS } from './providers.js';
import { costOf } from './pricing.js';

console.log(`[LLM] enabled=${llmConfig.enabled} budget=$${llmConfig.dailyBudgetUsd}/day`);
console.log(`[LLM] ANTHROPIC_API_KEY=${maskKey(llmConfig.anthropicKey) || '(없음)'}  GEMINI_API_KEY=${maskKey(llmConfig.geminiKey) || '(없음)'}`);
let fail = 0;
for (const provider of ['claude', 'gemini']) {
  if (!hasKey(provider)) {
    console.log(`- ${provider}: 키 없음, 건너뜀`);
    continue;
  }
  for (const tier of ['fast', 'smart']) {
    const model = llmConfig.models[provider][tier];
    try {
      const r = await PROVIDERS[provider]({ model, system: '너는 연결 확인용 봇이다. JSON만 출력한다.', user: '{"ping":true} 에 {"pong":true} 로만 답해.', maxTokens: 1024 });
      const c = costOf(model, r.usage);
      console.log(`✓ ${provider}/${tier} ${model}  ${r.ms}ms  in ${r.usage.input} / out ${r.usage.output} 토큰  ≈ $${c == null ? '?' : c.toFixed(6)}  응답: ${r.text.slice(0, 60)}`);
    } catch (e) {
      fail++;
      console.log(`✗ ${provider}/${tier} ${model}  ${e.message}`);
    }
  }
}
process.exit(fail ? 1 : 0);
