// 공부방: 암기 카드(간격 반복 + AI 카드 만들기) · 오피스 꾸미기(코인 상점)
//   저장은 플래너와 같은 data/planner.json (study, room 키). 코인 = 플래너 체크 + 카드 복습으로 번 것 − 산 것
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePlannerStore } from '../planner/store';
import { createOffice, W, H } from '../office';
import { ITEMS, ITEM, SLOTS, GROUPS, coinsOf, EARN, isPlaced } from '../decor';
import { AgentPix, ItemPix, Coin, AGENT_IDS, agentName } from '../pixel';

const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (ymd, n) => {
  const [a, b, c] = ymd.split('-').map(Number);
  return ymdOf(new Date(a, b - 1, c + n));
};
const uid = () => Math.random().toString(36).slice(2, 9);
// 단계별 다음 복습까지 날짜 (0단계 = 오늘 다시)
const INTERVAL = [0, 1, 2, 4, 7, 15, 30];
const MAX_BOX = INTERVAL.length - 1;
const LS_TAB = 'qo-study-tab';

function Pips({ box }) {
  return (
    <span className="st-pips" aria-label={`암기 단계 ${box} / ${MAX_BOX}`}>
      {Array.from({ length: MAX_BOX }, (_, i) => <i key={i} className={i < box ? 'on' : ''} />)}
    </span>
  );
}

// ---------- 오피스 미리보기 (실제 오피스 그대로, 꾸미기만 바꿔 끼움) ----------
function OfficePreview({ equip }) {
  const ref = useRef(null);
  const off = useRef(null);
  useEffect(() => {
    const c = ref.current;
    const o = createOffice(c);
    off.current = o;
    const h = new Date().getHours();
    o.setEnv({ phase: h >= 7 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night', night: h >= 22 || h < 6, dark: new Set() });
    const ro = new ResizeObserver(() => {
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.max(W, Math.round(r.width * dpr));
      c.height = Math.round((c.width * H) / W);
    });
    ro.observe(c);
    return () => {
      ro.disconnect();
      o.destroy();
    };
  }, []);
  useEffect(() => {
    off.current && off.current.setDecor(equip);
  }, [equip]);
  return <canvas ref={ref} className="st-office" width={W} height={H} aria-label="꾸민 오피스 미리보기" />;
}

export default function Study({ api, header }) {
  const today = ymdOf(new Date());
  const { data, sync, update } = usePlannerStore(api);
  const [tab, setTab0] = useState(() => {
    try {
      return localStorage.getItem(LS_TAB) || 'cards';
    } catch {
      return 'cards';
    }
  });
  const setTab = (t) => {
    setTab0(t);
    try {
      localStorage.setItem(LS_TAB, t);
    } catch {
      /* 무시 */
    }
  };
  const study = data.study || {};
  const decks = study.decks || [];
  const log = study.log || {};
  const room = data.room || {};
  const owned = new Set(room.owned || []);
  const equip = room.equip || {};
  const coins = coinsOf(data);
  const [deckId, setDeckId] = useState(() => decks[0]?.id || 'all');
  const deck = decks.find((d) => d.id === deckId);
  const setStudy = (fn) => update((d) => ({ ...d, study: fn({ decks: [], log: {}, ...(d.study || {}) }) }));
  const setRoom = (fn) => update((d) => ({ ...d, room: fn({ owned: [], equip: {}, ...(d.room || {}) }) }));

  // ---------- 복습 ----------
  const pool = useMemo(() => (deckId === 'all' ? decks.flatMap((d) => (d.cards || []).map((c) => ({ ...c, deck: d.id, deckName: d.name }))) : (deck?.cards || []).map((c) => ({ ...c, deck: deck.id, deckName: deck.name }))), [decks, deck, deckId]);
  const dueAll = pool.filter((c) => !c.due || c.due <= today);
  const [queue, setQueue] = useState(null);
  const [flip, setFlip] = useState(false);
  const [done, setDone] = useState(0);
  useEffect(() => {
    setQueue(null);
    setFlip(false);
    setDone(0);
  }, [deckId]);
  const q = (queue ?? dueAll.map((c) => c.id).sort((a, b) => {
    const A = pool.find((c) => c.id === a);
    const B = pool.find((c) => c.id === b);
    return (A.box || 0) - (B.box || 0) || String(A.due || '').localeCompare(String(B.due || ''));
  })).filter((id) => pool.some((c) => c.id === id));
  const cur = pool.find((c) => c.id === q[0]);
  const answer = (grade) => {
    if (!cur) return;
    const box0 = cur.box || 0;
    let box = box0;
    let due = today;
    if (grade === 0) box = 0;
    else if (grade === 1) {
      box = Math.max(1, box0);
      due = addDays(today, Math.max(1, Math.floor(INTERVAL[box] / 2)));
    } else {
      box = Math.min(MAX_BOX, box0 + 1);
      due = addDays(today, INTERVAL[box]);
    }
    setStudy((s) => ({
      ...s,
      decks: s.decks.map((d) => (d.id !== cur.deck ? d : { ...d, cards: d.cards.map((c) => (c.id === cur.id ? { ...c, box, due, seen: (c.seen || 0) + 1, ok: (c.ok || 0) + (grade === 2 ? 1 : 0) } : c)) })),
      log: { ...s.log, [today]: (s.log[today] || 0) + 1 },
    }));
    const rest = q.slice(1);
    setQueue(grade === 0 ? [...rest, cur.id] : rest);
    setFlip(false);
    setDone((n) => n + 1);
  };
  useEffect(() => {
    if (tab !== 'cards') return undefined;
    const onKey = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
      if (!cur) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setFlip((f) => !f);
      } else if (flip && ['1', '2', '3'].includes(e.key)) answer(+e.key - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- 덱 · 카드 편집 ----------
  const [newDeck, setNewDeck] = useState('');
  const addDeck = () => {
    const name = newDeck.trim();
    if (!name) return;
    const id = uid();
    setStudy((s) => ({ ...s, decks: [...s.decks, { id, name, cards: [] }] }));
    setNewDeck('');
    setDeckId(id);
  };
  const renameDeck = (name) => setStudy((s) => ({ ...s, decks: s.decks.map((d) => (d.id === deckId ? { ...d, name } : d)) }));
  const delDeck = () => {
    if (!deck || !window.confirm(`"${deck.name}" 덱과 카드 ${deck.cards.length}장을 지울까요? (복습 기록 코인은 남아요)`)) return;
    setStudy((s) => ({ ...s, decks: s.decks.filter((d) => d.id !== deckId) }));
    setDeckId('all');
  };
  const addCards = (cards) =>
    setStudy((s) => ({ ...s, decks: s.decks.map((d) => (d.id === deckId ? { ...d, cards: [...d.cards, ...cards.map((c) => ({ id: uid(), q: c.q, a: c.a, box: 0, due: today, added: today }))] } : d)) }));
  const editCard = (id, patch) => setStudy((s) => ({ ...s, decks: s.decks.map((d) => (d.id === deckId ? { ...d, cards: d.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : d)) }));
  const delCard = (id) => setStudy((s) => ({ ...s, decks: s.decks.map((d) => (d.id === deckId ? { ...d, cards: d.cards.filter((c) => c.id !== id) } : d)) }));
  const [fq, setFq] = useState('');
  const [fa, setFa] = useState('');
  const frontRef = useRef(null);
  const addOne = () => {
    if (!fq.trim() || !fa.trim()) return;
    addCards([{ q: fq.trim(), a: fa.trim() }]);
    setFq('');
    setFa('');
    frontRef.current && frontRef.current.focus();
  };

  // ---------- AI 카드 ----------
  const [aiText, setAiText] = useState('');
  const [aiN, setAiN] = useState(10);
  const [ai, setAi] = useState({ s: 'idle' });
  const runAi = async () => {
    setAi({ s: 'busy' });
    try {
      const r = await api('/api/study/cards', { method: 'POST', body: { text: aiText, n: aiN }, ms: 90000 });
      setAi({ s: 'ok', cards: r.cards.map((c) => ({ ...c, pick: true })), by: r.provider });
    } catch (e) {
      setAi({ s: 'bad', err: e.message });
    }
  };

  // ---------- 오늘 · 연속 ----------
  const todayN = log[today] || 0;
  let streak = 0;
  for (let d = todayN ? today : addDays(today, -1); log[d] > 0; d = addDays(d, -1)) streak++;
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const weekMax = Math.max(EARN.goalCards, ...week.map((d) => log[d] || 0));
  const totalCards = decks.reduce((a, d) => a + (d.cards || []).length, 0);
  const mastered = decks.reduce((a, d) => a + (d.cards || []).filter((c) => (c.box || 0) >= 4).length, 0);

  // ---------- 상점 ----------
  const [peek, setPeek] = useState(null);
  const shown = useMemo(() => {
    if (!peek) return equip;
    const it = ITEM[peek];
    const eq = { ...equip, [it.slot]: peek };
    if (it.needs && !isPlaced(eq, it.needs)) eq[it.needs] = ITEMS.find((x) => x.slot === it.needs).id;
    return eq;
  }, [peek, equip]);
  const buy = (it) => {
    if (coins.balance < it.price) return;
    setRoom((rm) => ({ ...rm, owned: [...new Set([...rm.owned, it.id])], equip: { ...rm.equip, [it.slot]: it.id } }));
  };
  const toggleEquip = (it) =>
    setRoom((rm) => {
      const eq = { ...rm.equip };
      if (eq[it.slot] === it.id) delete eq[it.slot];
      else eq[it.slot] = it.id;
      return { ...rm, equip: eq };
    });

  const mascot = AGENT_IDS[(new Date().getDate() + 2) % AGENT_IDS.length];

  return (
    <div className="app pn-app st-app">
      {header}
      <main className="left">
        <section className="win pn-main">
          <h2 className="win-title">공부방 <span className="dim">{tab === 'cards' ? '암기 카드' : '오피스 꾸미기'}</span></h2>
          <div className="pn-bar">
            <div className="right-tabs pn-modes" role="tablist" aria-label="공부방 메뉴">
              <button type="button" role="tab" aria-selected={tab === 'cards'} className={tab === 'cards' ? 'on' : ''} onClick={() => setTab('cards')}>암기 카드</button>
              <button type="button" role="tab" aria-selected={tab === 'shop'} className={tab === 'shop' ? 'on' : ''} onClick={() => setTab('shop')}>오피스 꾸미기</button>
            </div>
            <span className={`pn-sync ${sync.s}`} role="status">{sync.t}</span>
          </div>

          {tab === 'cards' && (
            <>
              <div className="st-decks" role="tablist" aria-label="덱">
                <button type="button" role="tab" aria-selected={deckId === 'all'} className={deckId === 'all' ? 'on' : ''} onClick={() => setDeckId('all')}>
                  전체 <small>{decks.reduce((a, d) => a + (d.cards || []).filter((c) => !c.due || c.due <= today).length, 0)}</small>
                </button>
                {decks.map((d) => (
                  <button key={d.id} type="button" role="tab" aria-selected={deckId === d.id} className={deckId === d.id ? 'on' : ''} onClick={() => setDeckId(d.id)}>
                    {d.name} <small>{(d.cards || []).filter((c) => !c.due || c.due <= today).length}</small>
                  </button>
                ))}
                <form className="st-newdeck" onSubmit={(e) => (e.preventDefault(), addDeck())}>
                  <input value={newDeck} onChange={(e) => setNewDeck(e.target.value)} placeholder="새 덱 이름" aria-label="새 덱 이름" maxLength={24} />
                  <button type="submit" disabled={!newDeck.trim()}>+ 덱</button>
                </form>
              </div>

              {/* 복습 카드 */}
              <div className="st-stage">
                {!decks.length ? (
                  <div className="st-empty">
                    <AgentPix id="ju" pose="book" scale={4} />
                    <div>
                      <b>덱부터 만들어요</b>
                      <p className="dim">위 칸에 "영어 단어", "정보처리기사"처럼 이름을 적고 + 덱을 누르세요. 카드는 직접 적거나 공부 내용을 붙여 넣어 AI로 만들 수 있어요.</p>
                    </div>
                  </div>
                ) : cur ? (
                  <>
                    <div className="st-progress dim">
                      <span>{deckId === 'all' && <em>{cur.deckName} · </em>}남은 카드 {q.length}장</span>
                      <span>오늘 {todayN}장 복습</span>
                    </div>
                    <button type="button" className={`st-card ${flip ? 'flip' : ''}`} onClick={() => setFlip((f) => !f)} aria-label={flip ? '앞면 보기' : '답 보기'}>
                      <span className="st-side">{flip ? '뒷면' : '앞면'}</span>
                      <span className="st-q">{cur.q}</span>
                      {flip ? <span className="st-a">{cur.a}</span> : <span className="st-hint dim">눌러서 답 보기 · Space</span>}
                      <Pips box={cur.box || 0} />
                    </button>
                    <div className="st-grade" aria-hidden={!flip}>
                      <button type="button" className="g0" disabled={!flip} onClick={() => answer(0)}>
                        몰랐어 <small>1 · 오늘 다시</small>
                      </button>
                      <button type="button" className="g1" disabled={!flip} onClick={() => answer(1)}>
                        헷갈려 <small>2 · {Math.max(1, Math.floor(INTERVAL[Math.max(1, cur.box || 0)] / 2))}일 뒤</small>
                      </button>
                      <button type="button" className="g2" disabled={!flip} onClick={() => answer(2)}>
                        알았어 <small>3 · {INTERVAL[Math.min(MAX_BOX, (cur.box || 0) + 1)]}일 뒤</small>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="st-empty">
                    <AgentPix id={mascot} pose={done ? 'cheer' : 'coffee'} scale={4} />
                    <div>
                      <b>{done ? `오늘 복습 끝! ${done}장 +${done}코인` : pool.length ? '오늘 복습할 카드가 없어요' : '아직 카드가 없어요'}</b>
                      <p className="dim">
                        {pool.length
                          ? `다음 복습: ${pool.map((c) => c.due).filter(Boolean).sort()[0] || '-'} · ${agentName(mascot)}: "${todayN >= EARN.goalCards ? '오늘 목표 달성! 쉬어도 돼요' : '새 카드를 넣으면 바로 복습할 수 있어요'}"`
                          : '아래에서 카드를 추가하세요.'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {deck && (
                <>
                  <div className="st-addrow">
                    <input ref={frontRef} value={fq} onChange={(e) => setFq(e.target.value)} placeholder="앞면 (질문 · 단어)" aria-label="앞면" onKeyDown={(e) => e.key === 'Enter' && addOne()} />
                    <input value={fa} onChange={(e) => setFa(e.target.value)} placeholder="뒷면 (답 · 뜻)" aria-label="뒷면" onKeyDown={(e) => e.key === 'Enter' && addOne()} />
                    <button type="button" onClick={addOne} disabled={!fq.trim() || !fa.trim()}>카드 추가</button>
                  </div>

                  <details className="st-ai" open={ai.s === 'ok' || undefined}>
                    <summary>
                      <AgentPix id="ju" pose="laptop" scale={1.5} /> 요셉에게 카드 만들기 맡기기 <span className="dim">공부 내용을 붙여 넣으면 질문·답으로 정리해요</span>
                    </summary>
                    <textarea className="pn-area" value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder={'예) 교재 한 단락, 강의 필기, 단어 목록\napple 사과\nborrow 빌리다'} maxLength={6000} />
                    <div className="st-ai-bar">
                      <label className="dim">
                        최대{' '}
                        <select value={aiN} onChange={(e) => setAiN(+e.target.value)}>
                          {[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n}장</option>)}
                        </select>
                      </label>
                      <span className="dim">{aiText.length} / 6000자</span>
                      <button type="button" onClick={runAi} disabled={ai.s === 'busy' || aiText.trim().length < 10}>{ai.s === 'busy' ? '만드는 중…' : '카드 만들기'}</button>
                    </div>
                    {ai.s === 'bad' && <p className="st-err">{ai.err}</p>}
                    {ai.s === 'ok' && (
                      <div className="st-ai-out">
                        <ul>
                          {ai.cards.map((c, i) => (
                            <li key={i}>
                              <button type="button" className="pn-tick" aria-pressed={c.pick} aria-label="이 카드 넣기" onClick={() => setAi((a) => ({ ...a, cards: a.cards.map((x, j) => (j === i ? { ...x, pick: !x.pick } : x)) }))}>{c.pick ? '✓' : ''}</button>
                              <b>{c.q}</b>
                              <span>{c.a}</span>
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          className="st-primary"
                          disabled={!ai.cards.some((c) => c.pick)}
                          onClick={() => {
                            addCards(ai.cards.filter((c) => c.pick));
                            setAi({ s: 'idle' });
                            setAiText('');
                          }}
                        >
                          고른 {ai.cards.filter((c) => c.pick).length}장 "{deck.name}"에 넣기
                        </button>
                      </div>
                    )}
                  </details>

                  <div className="st-listhead">
                    <input className="st-deckname" value={deck.name} onChange={(e) => renameDeck(e.target.value)} aria-label="덱 이름" maxLength={24} />
                    <span className="dim">{deck.cards.length}장</span>
                    <button type="button" className="st-del" onClick={delDeck}>덱 지우기</button>
                  </div>
                  {deck.cards.length > 0 && (
                    <ul className="st-list">
                      {deck.cards.map((c) => (
                        <li key={c.id}>
                          <input value={c.q} onChange={(e) => editCard(c.id, { q: e.target.value })} aria-label="앞면" />
                          <input value={c.a} onChange={(e) => editCard(c.id, { a: e.target.value })} aria-label="뒷면" />
                          <Pips box={c.box || 0} />
                          <span className="st-due dim">{!c.due || c.due <= today ? '오늘' : `${+c.due.slice(5, 7)}/${+c.due.slice(8)}`}</span>
                          <button type="button" className="pn-del" onClick={() => delCard(c.id)} aria-label={`${c.q} 지우기`}>×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}

          {tab === 'shop' && (
            <>
              <div className="st-officewrap">
                <OfficePreview equip={shown} />
                {peek && <span className="st-peek">미리 놓아보는 중: {ITEM[peek].name}</span>}
              </div>
              <p className="dim st-shopnote">오피스는 책상만 있는 빈 사무실에서 시작해요. 산 물건은 트레이딩 화면 오피스에도 그대로 놓이고, 커피머신·냉장고·소파 같은 걸 놓으면 쉬는 직원들이 거기로 가요. 카드에 마우스를 올리면 위 오피스에 미리 놓아 봐요.</p>
              <div className="st-shop">
                {GROUPS.map(([g, gname]) => {
                  const list = ITEMS.filter((it) => SLOTS[it.slot].group === g);
                  const placed = list.filter((it) => equip[it.slot] === it.id).length;
                  return (
                    <section key={g} className="st-slot">
                      <h3 className="pn-h">
                        {gname} <span className="dim">· {placed ? `${placed}개 놓음` : '비어 있음'}</span>
                      </h3>
                      <div className="st-items">
                        {list.map((it) => {
                          const have = owned.has(it.id);
                          const on = equip[it.slot] === it.id;
                          const short = coins.balance < it.price;
                          const shared = ITEMS.filter((x) => x.slot === it.slot).length > 1;
                          const blocked = it.needs && !isPlaced(equip, it.needs);
                          return (
                            <div key={it.id} className={`st-item ${on ? 'on' : ''} ${have ? 'have' : ''}`} onMouseEnter={() => !on && setPeek(it.id)} onMouseLeave={() => setPeek(null)} onFocus={() => !on && setPeek(it.id)} onBlur={() => setPeek(null)}>
                              <ItemPix id={it.id} scale={it.box ? 2 : it.slot === 'sill' || it.slot === 'poster' ? 3 : 2} animate={['pet', 'floorC', 'sill'].includes(it.slot)} />
                              <b>{it.name}</b>
                              {(shared || blocked) && <small className={blocked ? 'need' : 'dim'}>{blocked ? `${SLOTS[it.needs].name}이 있어야 보여요` : `${SLOTS[it.slot].name} 자리`}</small>}
                              {have ? (
                                <button type="button" className={on ? 'placed' : ''} onClick={() => toggleEquip(it)}>{on ? '치우기' : '놓기'}</button>
                              ) : (
                                <button type="button" className="buy" disabled={short} onClick={() => buy(it)} title={short ? `${it.price - coins.balance}코인 더 필요해요` : undefined}>
                                  <Coin size={12} /> {it.price}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </main>

      <aside className="right pn-side">
        <section className="win st-wallet">
          <h2 className="win-title">코인 지갑</h2>
          <div className="st-bal">
            <Coin size={32} />
            <b>{coins.balance.toLocaleString()}</b>
            <span className="dim">코인</span>
          </div>
          <table className="st-earn">
            <tbody>
              <tr><td>플래너 할 일 완료</td><td>{coins.parts.todo} × {EARN.todo}</td></tr>
              <tr><td>리스트 체크</td><td>{coins.parts.list} × {EARN.list}</td></tr>
              <tr><td>습관 체크</td><td>{coins.parts.habit} × {EARN.habit}</td></tr>
              <tr><td>카드 복습</td><td>{coins.parts.reviews} × {EARN.review}</td></tr>
              <tr><td>하루 {EARN.goalCards}장 보너스</td><td>{coins.parts.goalDays} × {EARN.goalBonus}</td></tr>
              {coins.spent > 0 && <tr className="spent"><td>꾸미기에 씀</td><td>−{coins.spent}</td></tr>}
            </tbody>
          </table>
          <p className="dim st-earn-note">체크를 풀면 그만큼 코인도 빠져요.</p>
        </section>

        <section className="win">
          <h2 className="win-title">오늘 공부</h2>
          <div className="st-today">
            <AgentPix id={mascot} pose={todayN >= EARN.goalCards ? 'cheer' : todayN ? 'book' : 'sleep'} scale={3} />
            <div>
              <b>{todayN} / {EARN.goalCards}장</b>
              <div className="st-meter" role="meter" aria-valuemin={0} aria-valuemax={EARN.goalCards} aria-valuenow={Math.min(todayN, EARN.goalCards)} aria-label="오늘 복습">
                {Array.from({ length: 10 }, (_, i) => <i key={i} className={todayN >= ((i + 1) * EARN.goalCards) / 10 ? 'on' : ''} />)}
              </div>
              <p className="dim">{streak ? `${streak}일 연속 복습 중` : '오늘 첫 복습을 시작해요'}</p>
            </div>
          </div>
          <div className="st-week" aria-label="최근 7일 복습 수">
            {week.map((d) => (
              <span key={d} className={d === today ? 'today' : ''} title={`${d}: ${log[d] || 0}장`}>
                <i style={{ height: `${Math.round(((log[d] || 0) / weekMax) * 100)}%` }} className={(log[d] || 0) >= EARN.goalCards ? 'goal' : ''} />
                <small>{'일월화수목금토'[new Date(`${d}T00:00`).getDay()]}</small>
              </span>
            ))}
          </div>
          <p className="dim st-sum">카드 {totalCards}장 · 4단계 이상 외운 카드 {mastered}장</p>
        </section>
      </aside>
    </div>
  );
}
