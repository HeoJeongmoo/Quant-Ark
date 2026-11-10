// 공부·일 플래너 (주식과 별개) — 퀀트 오피스 디자인 그대로 (픽셀 폰트, .win 창, 앰버·민트)
//   보기: 월간 · 주간 · 연간 · 리스트 / 오른쪽 창: 이달 목표·메모, 이번 주 할 일·습관·메모
//   저장: 봇 서버 data/planner.json (PC·폰 같은 내용), 브라우저에도 사본
import React, { useEffect, useState } from 'react';
import { usePlannerStore } from './store';
import { AgentPix, ItemPix, AGENT_IDS, agentName } from '../pixel';
import { ITEM } from '../decor';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const HOLIDAYS = {
  '2026-01-01': '신정', '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴', '2026-03-01': '삼일절', '2026-03-02': '대체공휴일',
  '2026-05-05': '어린이날', '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일', '2026-06-03': '지방선거', '2026-06-06': '현충일',
  '2026-08-15': '광복절', '2026-08-17': '대체공휴일', '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴',
  '2026-10-03': '개천절', '2026-10-05': '대체공휴일', '2026-10-09': '한글날', '2026-12-25': '성탄절',
};
const LS_VIEW = 'qo-planner-view';
const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const addDays = (ymd, n) => {
  const [a, b, c] = ymd.split('-').map(Number);
  return ymdOf(new Date(a, b - 1, c + n));
};
const mondayOf = (ymd) => {
  const [a, b, c] = ymd.split('-').map(Number);
  const d = new Date(a, b - 1, c);
  d.setDate(c - ((d.getDay() + 6) % 7));
  return ymdOf(d);
};
const red = (ymd, dow) => dow === 0 || !!HOLIDAYS[ymd];
const fmtMD = (ymd) => `${+ymd.slice(5, 7)}/${+ymd.slice(8)}`;

// ---------- 원형 하루 계획표 (24시간 시계) ----------
const PIE_COLORS = ['#ffc94a', '#57e3c9', '#4d9bff', '#ff5a5a', '#c08bff', '#8e9198'];
const hm = (m) => `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`;
const TIMES = Array.from({ length: 48 }, (_, i) => i * 30);
const nowMin = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};
const R = 118;
const RI = 44;
const pt = (m, r) => {
  const a = ((m / 1440) * 360 - 90) * (Math.PI / 180);
  return [+(r * Math.cos(a)).toFixed(2), +(r * Math.sin(a)).toFixed(2)];
};
const arc = (s, e) => {
  const span = e - s;
  if (span >= 1440) return `M0 ${-R}A${R} ${R} 0 1 1 0 ${R}A${R} ${R} 0 1 1 0 ${-R}M0 ${-RI}A${RI} ${RI} 0 1 0 0 ${RI}A${RI} ${RI} 0 1 0 0 ${-RI}Z`;
  const big = span > 720 ? 1 : 0;
  const [x1, y1] = pt(s, R);
  const [x2, y2] = pt(e, R);
  const [x3, y3] = pt(e, RI);
  const [x4, y4] = pt(s, RI);
  return `M${x1} ${y1}A${R} ${R} 0 ${big} 1 ${x2} ${y2}L${x3} ${y3}A${RI} ${RI} 0 ${big} 0 ${x4} ${y4}Z`;
};
const spanOf = (b) => {
  const e = b.e <= b.s ? b.e + 1440 : b.e;
  return [b.s, e];
};
const inBlock = (b, m) => {
  const [s, e] = spanOf(b);
  return (m >= s && m < e) || (m + 1440 >= s && m + 1440 < e);
};

function DayClock({ items, onChange }) {
  const blocks = items || [];
  const [now, setNow] = useState(nowMin);
  const [sel, setSel] = useState(null);
  useEffect(() => {
    const t = setInterval(() => setNow(nowMin()), 30000);
    return () => clearInterval(t);
  }, []);
  const order = blocks.map((b, i) => ({ ...b, i })).sort((a, b) => a.s - b.s);
  const cur = order.find((b) => inBlock(b, now));
  const set = (i, patch) => onChange(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const del = (i) => {
    onChange(blocks.filter((_, j) => j !== i));
    setSel(null);
  };
  const add = () => {
    const last = order[order.length - 1];
    const s = last ? spanOf(last)[1] % 1440 : 420;
    onChange([...blocks, { s, e: (s + 60) % 1440, t: '', c: blocks.length % PIE_COLORS.length }]);
    setSel(blocks.length);
  };
  const [hx, hy] = pt(now, R + 6);
  const [ix, iy] = pt(now, RI);
  return (
    <div className="pn-clock">
      <svg viewBox="-150 -150 300 300" className="pn-pie" role="img" aria-label={`하루 계획표 · 지금 ${hm(now)}${cur ? ` ${cur.t || '이름 없음'}` : ''}`}>
        <circle r={R} fill="var(--ink)" />
        {Array.from({ length: 24 }, (_, h) => {
          const [a1, b1] = pt(h * 60, R);
          const [a2, b2] = pt(h * 60, h % 6 ? R - 5 : R - 10);
          return <line key={h} x1={a1} y1={b1} x2={a2} y2={b2} stroke="var(--edge)" strokeWidth={h % 6 ? 1 : 2} />;
        })}
        {order.map((b) => {
          const [s, e] = spanOf(b);
          const col = PIE_COLORS[b.c % PIE_COLORS.length];
          const on = sel === b.i || (sel === null && cur?.i === b.i);
          const [lx, ly] = pt((s + e) / 2, (R + RI) / 2);
          const label = (b.t || '').trim();
          const room = e - s;
          return (
            <g key={b.i} className={`pn-seg ${on ? 'on' : ''}`} role="button" tabIndex={0} aria-label={`${hm(s)}~${hm(e)} ${label || '이름 없음'}`} onClick={() => setSel(b.i)} onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), setSel(b.i))}>
              <path d={arc(s, e)} fill={col} fillOpacity={on ? 1 : 0.55} stroke="var(--ink)" strokeWidth="2" />
              {label && room >= 60 && (
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" className="pn-seg-t">{room >= 150 ? label.slice(0, 6) : label.slice(0, 3)}</text>
              )}
            </g>
          );
        })}
        <circle r={RI} fill="var(--panel)" stroke="var(--edge)" strokeWidth="2" />
        {[0, 6, 12, 18].map((h) => {
          const [x, y] = pt(h * 60, R + 18);
          return <text key={h} x={x} y={y} textAnchor="middle" dominantBaseline="central" className="pn-hour">{h}</text>;
        })}
        {[3, 9, 15, 21].map((h) => {
          const [x, y] = pt(h * 60, R + 16);
          return <text key={h} x={x} y={y} textAnchor="middle" dominantBaseline="central" className="pn-hour sm">{h}</text>;
        })}
        <line x1={ix} y1={iy} x2={hx} y2={hy} stroke="var(--text)" strokeWidth="3" className="pn-hand" />
        <circle cx={hx} cy={hy} r="3" fill="var(--text)" />
        <text y="-12" textAnchor="middle" className="pn-now">{hm(now)}</text>
        <text y="8" textAnchor="middle" className="pn-cur">{cur ? (cur.t || '이름 없음').slice(0, 6) : '빈 시간'}</text>
      </svg>

      <ul className="pn-blocks">
        {order.map((b) => (
          <li key={b.i} className={sel === b.i ? 'on' : ''} onFocus={() => setSel(b.i)}>
            <button type="button" className="pn-sw" style={{ background: PIE_COLORS[b.c % PIE_COLORS.length] }} onClick={() => set(b.i, { c: (b.c + 1) % PIE_COLORS.length })} aria-label="색 바꾸기" title="색 바꾸기" />
            <select value={b.s} onChange={(e) => set(b.i, { s: +e.target.value })} aria-label="시작">
              {TIMES.map((m) => <option key={m} value={m}>{hm(m)}</option>)}
            </select>
            <span className="dim">~</span>
            <select value={b.e} onChange={(e) => set(b.i, { e: +e.target.value })} aria-label="끝">
              {TIMES.map((m) => <option key={m} value={m}>{hm(m)}</option>)}
            </select>
            <input value={b.t} placeholder="할 일" onChange={(e) => set(b.i, { t: e.target.value })} aria-label="할 일" />
            <button type="button" className="pn-del" onClick={() => del(b.i)} aria-label={`${b.t || '이 시간'} 지우기`}>×</button>
          </li>
        ))}
      </ul>
      {!order.length && <p className="dim pn-count">시간을 추가하면 원에 칸이 생겨요 · 자정을 넘기면(23:00~07:00) 그대로 이어서 그려요</p>}
      <button type="button" className="pn-add" onClick={add}>+ 시간 추가</button>
    </div>
  );
}

function Checks({ items, onChange, rows, placeholder }) {
  const list = Array.from({ length: Math.max(rows, (items || []).length + 1) }, (_, i) => (items || [])[i] || { t: '', done: false });
  const set = (i, patch) => {
    const next = list.map((x, j) => (j === i ? { ...x, ...patch } : x));
    while (next.length && !next[next.length - 1].t && !next[next.length - 1].done) next.pop();
    onChange(next);
  };
  const left = list.filter((x) => x.t && !x.done).length;
  return (
    <>
      <ul className="pn-checks">
        {list.map((x, i) => (
          <li key={i} className={x.done ? 'done' : ''}>
            <button type="button" className="pn-tick" aria-pressed={x.done} aria-label={x.done ? '완료 취소' : '완료'} onClick={() => x.t && set(i, { done: !x.done })}>{x.done ? '✓' : ''}</button>
            <input value={x.t} placeholder={i === 0 ? placeholder : ''} onChange={(e) => set(i, { t: e.target.value })} />
          </li>
        ))}
      </ul>
      {list.some((x) => x.t) && <p className="pn-count dim">남은 일 {left}개</p>}
    </>
  );
}

export default function Planner({ api, header }) {
  const today = ymdOf(new Date());
  const [view, setView] = useState(() => {
    try {
      return { mode: 'month', y: +today.slice(0, 4), m: +today.slice(5, 7) - 1, wk: mondayOf(today), ...JSON.parse(localStorage.getItem(LS_VIEW) || '{}') };
    } catch {
      return { mode: 'month', y: +today.slice(0, 4), m: +today.slice(5, 7) - 1, wk: mondayOf(today) };
    }
  });
  const { data, sync, update } = usePlannerStore(api);
  const [edit, setEdit] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(LS_VIEW, JSON.stringify(view));
    } catch {
      /* 무시 */
    }
  }, [view]);

  const days = data.days || {};
  const setDay = (ymd, v) => update((d) => ({ ...d, days: { ...(d.days || {}), [ymd]: v } }));
  const mKey = `${view.y}-${pad(view.m + 1)}`;
  const month = (data.months || {})[mKey] || {};
  const setMonth = (p) => update((d) => ({ ...d, months: { ...(d.months || {}), [mKey]: { ...((d.months || {})[mKey] || {}), ...p } } }));
  const wk = view.wk;
  const week = (data.weeks || {})[wk] || {};
  const setWeek = (p) => update((d) => ({ ...d, weeks: { ...(d.weeks || {}), [wk]: { ...((d.weeks || {})[wk] || {}), ...p } } }));
  const lists = data.lists || {};
  const setList = (k, v) => update((d) => ({ ...d, lists: { ...(d.lists || {}), [k]: v } }));
  const goals = (data.goals || {})[view.y] || [];
  const setGoal = (i, v) =>
    update((d) => {
      const g = [...((d.goals || {})[view.y] || [])];
      g[i] = v;
      return { ...d, goals: { ...(d.goals || {}), [view.y]: g } };
    });

  const go = (p) => setView((v) => ({ ...v, ...p }));
  const shiftMonth = (k) => {
    const d = new Date(view.y, view.m + k, 1);
    go({ y: d.getFullYear(), m: d.getMonth() });
  };
  const shiftWeek = (k) => {
    const n = addDays(wk, 7 * k);
    go({ wk: n, y: +n.slice(0, 4), m: +n.slice(5, 7) - 1 });
  };
  const goToday = () => go({ y: +today.slice(0, 4), m: +today.slice(5, 7) - 1, wk: mondayOf(today) });

  // ---------- 월간 ----------
  const monthGrid = () => {
    const first = new Date(view.y, view.m, 1).getDay();
    const n = daysIn(view.y, view.m);
    const cells = [...Array(first).fill(null), ...Array.from({ length: n }, (_, i) => i + 1)];
    while (cells.length % 7) cells.push(null);
    // 빈칸 꾸미기: 달마다 다른 직원이 쉬고 있고, 산 반려동물이 있으면 마지막 빈칸에 앉아 있다
    const empties = cells.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
    const seed = view.y * 12 + view.m;
    const POSES = ['coffee', 'book', 'sleep', 'wave', 'laptop'];
    const pet = ['cat', 'dog', 'fishbowl'].includes(data.room?.equip?.pet) ? data.room.equip.pet : null;
    const thisMonth = mKey === today.slice(0, 7);
    const left = Object.keys(days).filter((k) => k.startsWith(mKey) && k >= today && days[k]).length;
    const lines = thisMonth
      ? [left ? `남은 일정 ${left}개!` : '이번 달 일정 비었어요', '오늘도 화이팅', '커피 한 잔 하고 해요']
      : view.y * 12 + view.m < +today.slice(0, 4) * 12 + +today.slice(5, 7) - 1
        ? ['지난달 수고했어요', '다 끝냈나요?']
        : ['다음 달 미리 준비!', '계획 세우는 중'];
    const fill = {};
    empties.forEach((i, k) => {
      fill[i] = { id: AGENT_IDS[(seed * 5 + k * 3) % AGENT_IDS.length], pose: POSES[(seed + k) % POSES.length] };
    });
    if (empties.length) fill[empties[0]].line = lines[seed % lines.length];
    if (pet && empties.length > 1) fill[empties[empties.length - 1]] = { pet };
    return (
      <div className="pn-month" role="grid" aria-label={`${view.y}년 ${view.m + 1}월`}>
        {DOW.map((d, i) => <div key={d} className={`pn-dow ${i === 0 ? 'red' : i === 6 ? 'sat' : ''}`}>{d}</div>)}
        {cells.map((dd, i) => {
          if (!dd) {
            const f = fill[i];
            return (
              <div key={`e${i}`} className="pn-cell empty pn-fill" aria-hidden="true">
                {f?.line && <span className="pn-say">{f.line}</span>}
                {f?.pet ? <ItemPix id={f.pet} scale={2.5} animate className="pn-pet" /> : f && <AgentPix id={f.id} pose={f.pose} scale={3} />}
              </div>
            );
          }
          const ymd = `${mKey}-${pad(dd)}`;
          const lines = (days[ymd] || '').split('\n').filter(Boolean);
          return (
            <button key={ymd} type="button" role="gridcell" className={`pn-cell ${ymd === today ? 'today' : ''} ${lines.length ? 'has' : ''}`} onClick={() => setEdit(ymd)} aria-label={`${view.m + 1}월 ${dd}일${HOLIDAYS[ymd] ? ` ${HOLIDAYS[ymd]}` : ''}${lines.length ? ` · ${lines.join(', ')}` : ''}`}>
              <span className={`pn-dn ${red(ymd, i % 7) ? 'red' : i % 7 === 6 ? 'sat' : ''}`}>{dd}</span>
              {HOLIDAYS[ymd] && <span className="pn-hol">{HOLIDAYS[ymd]}</span>}
              {lines.slice(0, 3).map((l, k) => <span key={k} className="pn-line">{l}</span>)}
              {lines.length > 3 && <span className="pn-more">+{lines.length - 3}</span>}
            </button>
          );
        })}
      </div>
    );
  };

  // ---------- 주간 ----------
  const weekBoxes = () => (
    <div className="pn-week">
      {Array.from({ length: 7 }, (_, i) => {
        const ymd = addDays(wk, i);
        const dow = (i + 1) % 7;
        return (
          <label key={ymd} className={`pn-wday ${ymd === today ? 'today' : ''}`}>
            <span className={`pn-wday-k ${red(ymd, dow) ? 'red' : dow === 6 ? 'sat' : ''}`}>
              <b>{DOW[dow]}</b>
              <span>{fmtMD(ymd)}</span>
              {HOLIDAYS[ymd] && <small>{HOLIDAYS[ymd]}</small>}
            </span>
            <textarea value={days[ymd] || ''} onChange={(e) => setDay(ymd, e.target.value)} placeholder={ymd === today ? '오늘 할 일' : ''} />
          </label>
        );
      })}
    </div>
  );

  // ---------- 연간 ----------
  const yearGrid = () => (
    <div className="pn-year">
      {Array.from({ length: 12 }, (_, m) => {
        const first = new Date(view.y, m, 1).getDay();
        const n = daysIn(view.y, m);
        const filled = Object.keys(days).filter((k) => k.startsWith(`${view.y}-${pad(m + 1)}-`) && days[k]).length;
        return (
          <button key={m} type="button" className="pn-mini" onClick={() => go({ mode: 'month', m })} aria-label={`${m + 1}월 열기 · 일정 있는 날 ${filled}일`}>
            <span className="pn-mini-h"><b>{m + 1}월</b>{filled > 0 && <small>{filled}일</small>}</span>
            <span className="pn-mini-g">
              {Array.from({ length: first }, (_, i) => <i key={`e${i}`} />)}
              {Array.from({ length: n }, (_, i) => {
                const ymd = `${view.y}-${pad(m + 1)}-${pad(i + 1)}`;
                return <i key={i} className={`${red(ymd, (first + i) % 7) ? 'red' : ''} ${ymd === today ? 'today' : ''} ${days[ymd] ? 'has' : ''}`}>{i + 1}</i>;
              })}
            </span>
          </button>
        );
      })}
    </div>
  );

  const title =
    view.mode === 'week'
      ? `${fmtMD(wk)} ~ ${fmtMD(addDays(wk, 6))}`
      : view.mode === 'year'
        ? `${view.y}년`
        : view.mode === 'list'
          ? '리스트'
          : `${view.y}년 ${view.m + 1}월`;
  const shift = view.mode === 'week' ? shiftWeek : view.mode === 'year' ? (k) => go({ y: view.y + k }) : view.mode === 'month' ? shiftMonth : null;

  return (
    <div className="app pn-app">
      {header}
      <main className="left">
        <section className="win pn-main">
          <h2 className="win-title">플래너 <span className="dim">공부 · 일</span></h2>
          <div className="pn-bar">
            <div className="right-tabs pn-modes" role="tablist" aria-label="보기">
              {[['month', '월간'], ['week', '주간'], ['year', '연간'], ['list', '리스트']].map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={view.mode === k} className={view.mode === k ? 'on' : ''} onClick={() => go({ mode: k, ...(k === 'week' && view.mode === 'month' && !wk.startsWith(mKey) ? { wk: mondayOf(`${mKey}-01`) } : {}) })}>{l}</button>
              ))}
            </div>
            <div className="cal-head pn-nav">
              {shift && <button type="button" onClick={() => shift(-1)} aria-label="이전">◀</button>}
              <b>{title}</b>
              {shift && <button type="button" onClick={() => shift(1)} aria-label="다음">▶</button>}
              {shift && <button type="button" className="pn-today" onClick={goToday}>오늘</button>}
            </div>
            <span className={`pn-sync ${sync.s}`} role="status">{sync.t}</span>
          </div>
          {view.mode === 'month' && monthGrid()}
          {view.mode === 'week' && weekBoxes()}
          {view.mode === 'year' && yearGrid()}
          {view.mode === 'list' && (
            <div className="pn-lists">
              <div>
                <h3 className="pn-h">체크리스트</h3>
                <Checks items={lists.check} onChange={(v) => setList('check', v)} rows={10} placeholder="해야 할 일" />
              </div>
              <div>
                <h3 className="pn-h">위시리스트</h3>
                <Checks items={lists.wish} onChange={(v) => setList('wish', v)} rows={10} placeholder="하고 싶은 것" />
              </div>
              <div className="pn-note">
                <h3 className="pn-h">노트</h3>
                <textarea value={lists.note || ''} onChange={(e) => setList('note', e.target.value)} placeholder="자유롭게 적기" />
              </div>
            </div>
          )}
        </section>
      </main>

      <aside className="right pn-side">
        {(view.mode === 'month' || view.mode === 'list') && (
          <section className="win">
            <h2 className="win-title">{view.m + 1}월 목표</h2>
            <textarea className="pn-area" value={month.goal || ''} onChange={(e) => setMonth({ goal: e.target.value })} placeholder="이번 달에 끝낼 것" aria-label="이달의 목표" />
            <h3 className="pn-h">메모</h3>
            <textarea className="pn-area" value={month.memo || ''} onChange={(e) => setMonth({ memo: e.target.value })} aria-label="이달의 메모" />
          </section>
        )}
        {(view.mode === 'month' || view.mode === 'list') && (
          <section className="win">
            <h2 className="win-title">하루 계획표 <span className="dim">24시간</span></h2>
            <DayClock items={data.routine} onChange={(v) => update((d) => ({ ...d, routine: v }))} />
          </section>
        )}
        {view.mode === 'week' && (
          <>
            <section className="win">
              <h2 className="win-title">이번 주 할 일</h2>
              <Checks items={week.todo} onChange={(v) => setWeek({ todo: v })} rows={7} placeholder="할 일" />
            </section>
            <section className="win">
              <h2 className="win-title">습관 체크</h2>
              <div className="pn-habit pn-habit-h">
                <span />
                {['월', '화', '수', '목', '금', '토', '일'].map((x, i) => <span key={i} className={i === 6 ? 'red' : i === 5 ? 'sat' : ''}>{x}</span>)}
              </div>
              {Array.from({ length: 3 }, (_, r) => {
                const h = (week.habits || [])[r] || { name: '', d: [] };
                const setH = (p) => {
                  const hs = Array.from({ length: 3 }, (_, k) => (week.habits || [])[k] || { name: '', d: [] });
                  hs[r] = { ...hs[r], ...p };
                  setWeek({ habits: hs });
                };
                return (
                  <div key={r} className="pn-habit">
                    <input value={h.name} placeholder={r === 0 ? '습관 이름' : ''} onChange={(e) => setH({ name: e.target.value })} aria-label={`습관 ${r + 1}`} />
                    {Array.from({ length: 7 }, (_, i) => (
                      <button key={i} type="button" className="pn-tick" aria-pressed={!!h.d?.[i]} aria-label={`${h.name || `습관 ${r + 1}`} ${['월', '화', '수', '목', '금', '토', '일'][i]}`} onClick={() => { const dd = [...(h.d || [])]; dd[i] = !dd[i]; setH({ d: dd }); }}>{h.d?.[i] ? '✓' : ''}</button>
                    ))}
                  </div>
                );
              })}
            </section>
            <section className="win">
              <h2 className="win-title">이번 주 메모</h2>
              <textarea className="pn-area" value={week.memo || ''} onChange={(e) => setWeek({ memo: e.target.value })} aria-label="이번 주 메모" />
            </section>
          </>
        )}
        {view.mode === 'year' && (
          <section className="win">
            <h2 className="win-title">{view.y}년 목표</h2>
            <ol className="pn-goals">
              {Array.from({ length: 5 }, (_, i) => (
                <li key={i}>
                  <input value={goals[i] || ''} onChange={(e) => setGoal(i, e.target.value)} placeholder={i === 0 ? '올해 꼭 이룰 것' : ''} aria-label={`목표 ${i + 1}`} />
                </li>
              ))}
            </ol>
          </section>
        )}
      </aside>

      {edit && (
        <div className="modal-back" onClick={() => setEdit(null)}>
          <div className="modal win pn-edit" role="dialog" aria-modal="true" aria-label={`${edit} 일정`} onClick={(e) => e.stopPropagation()}>
            <h2 className="win-title">{+edit.slice(5, 7)}월 {+edit.slice(8)}일 ({DOW[new Date(`${edit}T00:00`).getDay()]}){HOLIDAYS[edit] ? ` · ${HOLIDAYS[edit]}` : ''}</h2>
            <button type="button" className="modal-x" onClick={() => setEdit(null)} aria-label="닫기">×</button>
            <textarea autoFocus className="pn-area" value={days[edit] || ''} onChange={(e) => setDay(edit, e.target.value)} placeholder="한 줄에 하나씩" />
            <div className="pn-edit-b">
              <button type="button" onClick={() => setEdit(addDays(edit, -1))}>◀ 전날</button>
              <button type="button" onClick={() => setEdit(null)}>닫기</button>
              <button type="button" onClick={() => setEdit(addDays(edit, 1))}>다음날 ▶</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
