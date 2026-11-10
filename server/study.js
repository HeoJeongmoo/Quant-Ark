// 공부방: 붙여 넣은 공부 내용 → 암기 카드 (질문/답) 만들기. 요셉(해석가) 경로 = Claude 우선, 실패 시 Gemini
import { routeCall } from './llm/router.js';

const SYSTEM = `너는 시험공부를 돕는 조교다. 사용자가 준 공부 내용만 근거로 암기 카드를 만든다.
- 한 카드에 사실 하나. 질문은 짧고 분명하게, 답은 1~2줄.
- 내용에 없는 사실을 지어내지 않는다. 단어 목록이면 앞면=단어, 뒷면=뜻.
- 사용자 글의 언어를 따른다.
반드시 JSON 하나만 출력: {"cards":[{"q":"질문","a":"답"}]}`;

export async function makeCards(text, n = 10) {
  const body = String(text || '').trim().slice(0, 6000);
  if (body.length < 10) throw Object.assign(new Error('내용을 조금 더 적어 주세요 (10자 이상).'), { code: 400 });
  const count = Math.max(3, Math.min(20, Number(n) || 10));
  const r = await routeCall({
    agent: 'ju',
    task: 'study_cards',
    system: SYSTEM,
    user: `카드 ${count}장 이내로 만들어 줘.\n\n---\n${body}\n---`,
    maxTokens: 2000,
    parse: (t) => {
      const m = t.match(/\{[\s\S]*\}/);
      const j = JSON.parse(m ? m[0] : t);
      const cards = (j.cards || [])
        .map((c) => ({ q: String(c.q || '').trim().slice(0, 300), a: String(c.a || '').trim().slice(0, 600) }))
        .filter((c) => c.q && c.a)
        .slice(0, count);
      if (!cards.length) throw new Error('카드가 비어 있음');
      return cards;
    },
  });
  return { cards: r.output, provider: r.provider, model: r.model };
}
