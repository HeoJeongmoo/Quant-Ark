import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createOffice, statusText, W, H, PODS } from './office';
import { AGENTS, DEPTS, makeAvatar } from './sprites';
import { STRATEGIES } from './strategy/sTier';
import { fmtTok, fmtUsd } from './tokens';
import { clockText, usd, pct } from './format';

// 퀀트 오피스 대시보드
// 매매는 서버의 봇(server/bot)이 한다. 이 화면은 봇 상태와 이벤트를 보여 주고 설정·직접 주문만 보낸다.
// 서버가 없으면 아무 시세도 만들지 않고 "미연결"로 둔다.

const AG = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
const DEPT = Object.fromEntries(DEPTS.map((d) => [d.id, d]));
const UP = '#ff5a5a';
const DOWN = '#4d9bff';
const tone = (n) => (n > 0 ? UP : n < 0 ? DOWN : '#b8bbc1');
const MAX_WATCH = 20;
const MAX_AI = 15;
const EMPTY_MSG = '현재 관심 종목이 없습니다. 종목을 추가해주세요.';
const ACTION_LABEL = { HOLD: '보유', TRIM: '부분 익절', EXIT_STOP: '손절', EXIT_TAKE: '익절' };
const levelOf = (j) => (j.action !== 'HOLD' ? 'exit' : j.pressure >= 2 ? 'watch' : 'calm');

// 봇 서버 주소: 봇 서버가 화면을 직접 띄운 경우(localhost:8787, 내부 IP, Tailscale 주소 등) 항상 같은 주소를 쓴다.
// 개발 서버(:5173)나 파일로 연 경우만 저장값(kisApi) → 127.0.0.1:8787
const KIS_API = (() => {
  if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && location.port !== '5173') return location.origin;
  try {
    const saved = localStorage.getItem('kisApi');
    if (saved) return saved;
  } catch {
    /* 무시 */
  }
  return 'http://127.0.0.1:8787';
})();

// LOCAL_API_TOKEN을 켠 경우: 처음 401이 나면 토큰을 한 번 묻고 이 브라우저에만 저장
const TOKEN_KEY = 'qo-api-token';
const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
};
async function api(path, { method = 'GET', body, ms = 8000, retried = false } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    const tok = getToken();
    if (tok) headers['x-api-token'] = tok;
    const r = await fetch(KIS_API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ac.signal });
    if (r.status === 401 && !retried) {
      const v = window.prompt('봇 서버 접근 토큰(LOCAL_API_TOKEN)을 입력하세요. 이 브라우저에만 저장됩니다.');
      if (v) {
        try {
          localStorage.setItem(TOKEN_KEY, v.trim());
        } catch {
          /* 저장 불가 브라우저 */
        }
        return api(path, { method, body, ms, retried: true });
      }
    }
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  } finally {
    clearTimeout(timer);
  }
}

export const MODES = [
  { id: 'pre', no: '01', name: '장전 준비', range: '07:00~09:30', start: 420 },
  { id: 'open', no: '02', name: '정규장 매매', range: '09:30~16:00', start: 570 },
  { id: 'post', no: '03', name: '장후 정산 및 야간', range: '16:00~07:00', start: 960 },
];
const MODE = Object.fromEntries(MODES.map((m) => [m.id, m]));
const TIMELINE = [
  { mode: 'post', from: 0, to: 420 },
  { mode: 'pre', from: 420, to: 570 },
  { mode: 'open', from: 570, to: 960 },
  { mode: 'post', from: 960, to: 1440 },
];
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const NY_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour12: false, year: 'numeric', month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', timeZoneName: 'short',
});
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function nyNow() {
  const p = Object.fromEntries(NY_FMT.formatToParts(new Date()).map((x) => [x.type, x.value]));
  const h = +p.hour % 24;
  const day = WD[p.weekday];
  return { min: h * 60 + +p.minute + +p.second / 60, weekend: day === 0 || day === 6, tz: p.timeZoneName === 'EDT' ? 'EDT' : 'EST', label: `${p.month}.${String(p.day).padStart(2, '0')} (${WEEKDAYS[day]})` };
}
const modeAt = (min, weekend) => (weekend ? 'post' : min >= 420 && min < 570 ? 'pre' : min >= 570 && min < 960 ? 'open' : 'post');
const skyPhase = (min) => (min >= 420 && min < 1020 ? 'day' : min >= 1020 && min < 1200 ? 'dusk' : 'night');
const dutyFor = (mode) => Object.fromEntries(AGENTS.map((a) => [a.id, a.duty[mode]]));
const crewOf = (mode) => AGENTS.filter((a) => a.duty[mode]);
const tsText = (iso) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '');

// 봇 상태 → 화면용 묶음 (값을 만들지 않고 모양만 바꾼다)
function viewOf(st, equity) {
  if (!st) return { tickers: [], stier: {}, pf: { cash: null, pos: {}, equity: [], start: null }, account: null, ark: 'unknown', arkReason: '봇 미연결', moses: {}, focus: [], orders: [] };
  const tickers = st.tickers.map((t) => ({
    code: t.symbol,
    name: t.symbol,
    kr: t.kr,
    exchange: t.exchange,
    list: t.list,
    reason: t.reason,
    price: t.price,
    prevClose: t.prevClose,
    open: t.prevClose || t.price,
    candles: t.candles || [],
    cur: null,
    signal: t.stier?.fired ? 'S' : '관망',
    err: t.err,
    priceAt: t.priceAt,
    expMovePct: t.expMovePct,
    risk: t.risk,
    rvol: t.rvol,
    news: t.news,
  }));
  const pos = {};
  for (const h of st.account?.holdings || []) if (h.qty > 0) pos[h.symbol] = { qty: h.qty, avg: h.avgPrice, price: h.price, sellable: h.sellableQty };
  return {
    tickers,
    stier: Object.fromEntries(st.tickers.map((t) => [t.symbol, t.stier])),
    pf: { cash: st.account?.cash?.deposit ?? null, pos, equity, start: equity[0] ?? null },
    account: st.account,
    ark: st.ark?.state || 'unknown',
    arkReason: st.ark?.reason || '',
    index: st.index,
    moses: st.moses || {},
    focus: [],
    orders: st.orders || [],
    guard: st.guard,
    rules: st.settings?.rules,
    costPct: st.costPct,
    health: st.health || {},
    strategyModes: st.settings?.strategyModes || {},
  };
}

let msgId = 0;
export default function App() {
  const officeRef = useRef(null);
  const [st, setSt] = useState(null); // 봇 상태
  const [conn, setConn] = useState('connecting'); // connecting | online | offline
  const [messages, setMessages] = useState([]);
  const [bubbles, setBubbles] = useState({});
  const [openAgent, setOpenAgent] = useState(null);
  const [ticker, setTicker] = useState('');
  const [wlTab, setWlTab] = useState('manual');
  const [wlMsg, setWlMsg] = useState(null);
  const [wlBusy, setWlBusy] = useState(false);
  const [stats, setStats] = useState(null);
  const [clock, setClock] = useState(nyNow);
  const equityRef = useRef([]);
  const reportsRef = useRef({});
  const lastEventRef = useRef(0);
  const avatars = useMemo(() => Object.fromEntries(AGENTS.map((a) => [a.id, makeAvatar(a, 4)])), []);

  const mode = st ? (st.phase === 'closed' ? 'post' : st.phase || modeAt(clock.min, clock.weekend)) : modeAt(clock.min, clock.weekend);
  const closedDay = st ? st.phase === 'closed' : clock.weekend;
  const control = st?.settings?.control || 'auto';
  const davidOn = !!st?.settings?.david;
  const m = viewOf(st, equityRef.current);

  const say = (text, kind = 'info') => setWlMsg({ text, kind, key: Date.now() });

  // ---------- 시계 + 사무실 조명·근무표 (실제 뉴욕 시각) ----------
  useEffect(() => {
    const iv = setInterval(() => setClock(nyNow()), 1000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    const o = officeRef.current;
    if (!o) return;
    o.setSchedule(dutyFor(mode), 'lounge');
  }, [mode]);
  useEffect(() => {
    const o = officeRef.current;
    if (!o) return;
    const phase = skyPhase(clock.min);
    const night = phase === 'night';
    const dark = new Set(mode === 'post' ? DEPTS.filter((d) => !AGENTS.some((a) => a.dept === d.id && a.duty.post)).map((d) => d.id) : []);
    if (night) DEPTS.forEach((d) => !AGENTS.some((a) => a.dept === d.id && a.duty[mode]) && dark.add(d.id));
    o.setEnv({ phase, night, dark });
    o.setManual(control === 'manual');
  }, [Math.floor(clock.min), mode, control]);

  // ---------- 봇 상태 폴링 ----------
  const refresh = useCallback(async () => {
    try {
      const d = await api('/api/bot/state', { ms: 5000 });
      setSt(d);
      setConn('online');
      const total = d.account?.totals?.total;
      if (total > 0) {
        const eq = equityRef.current;
        if (eq[eq.length - 1] !== total) eq.push(total);
        if (eq.length > 400) eq.shift();
      }
    } catch {
      setConn((c) => (c === 'online' ? 'offline' : c === 'connecting' ? 'offline' : c));
    }
  }, []);
  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 3000);
    return () => clearInterval(iv);
  }, [refresh]);
  useEffect(() => {
    if (conn !== 'online') return undefined;
    let alive = true;
    const pull = () => api('/api/bot/stats', { ms: 5000 }).then((d) => alive && setStats(d)).catch(() => {});
    pull();
    const iv = setInterval(pull, 60000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [conn]);

  // ---------- 봇 이벤트 → 메신저·말풍선·보고서 ----------
  const onEvent = useCallback((ev) => {
    if (ev.id <= lastEventRef.current) return;
    lastEventRef.current = ev.id;
    const ny = NY_FMT.formatToParts(new Date(ev.at));
    const hh = ny.find((x) => x.type === 'hour')?.value;
    const mm = ny.find((x) => x.type === 'minute')?.value;
    const time = `${String(+hh % 24).padStart(2, '0')}:${mm}`;
    const isAgent = !!AG[ev.agent];
    const msg = {
      id: ++msgId,
      from: isAgent ? ev.agent : 'system',
      text: ev.text,
      time,
      sys: !isAgent,
      mode: ['phase', 'boot', 'recover', 'settings'].includes(ev.type),
      warn: ev.level === 'warn' || ev.level === 'error',
      stier: ev.type === 'signal',
      side: ev.type === 'fill' ? (ev.data?.order?.side === 'buy' ? '매수' : '매도') : undefined,
      ai: ev.data?.ai ? { model: `${ev.data.ai.model}${ev.data.ai.fallback ? ' · 폴백' : ''}`, task: ev.data.ai.task, usage: ev.data.ai.usage } : null,
      kelly: ev.data?.kelly || null,
    };
    setMessages((ms) => [...ms.slice(-200), msg]);
    if (isAgent) {
      const o = officeRef.current;
      if (o) {
        o.say(ev.agent, ev.text.split('\n').slice(0, 2).join('\n'), 5200);
        o.setBusy(ev.agent, true);
        setTimeout(() => officeRef.current && officeRef.current.setBusy(ev.agent, false), 2500);
      }
      if (ev.type === 'signal') reportsRef.current[ev.agent] = { kind: 'stier', t: ev.data.symbol, results: ev.data.results || [], time };
      else if (ev.type === 'kelly') reportsRef.current[ev.agent] = { kind: 'kelly', ...ev.data.kelly, time };
      else reportsRef.current[ev.agent] = { kind: 'event', text: ev.text, type: ev.type, time };
    }
    if (['fill', 'order', 'settings', 'discover', 'exit'].includes(ev.type)) refresh();
  }, [refresh]);

  useEffect(() => {
    if (conn !== 'online') return undefined;
    let es;
    try {
      es = new EventSource(`${KIS_API}/api/bot/events?since=${lastEventRef.current}`);
      es.onmessage = (e) => {
        try {
          onEvent(JSON.parse(e.data));
        } catch {
          /* 무시 */
        }
      };
    } catch {
      /* SSE 미지원 */
    }
    return () => es && es.close();
  }, [conn, onEvent]);

  // ---------- 사용자 조작 → 봇 서버 ----------
  const setSettings = async (patch) => {
    try {
      await api('/api/bot/settings', { method: 'POST', body: patch });
      refresh();
    } catch (e) {
      say(`설정 저장 실패: ${e.message}`, 'err');
    }
  };
  const toggleControl = (next) => setSettings({ control: next });
  const toggleDavid = (on) => setSettings({ david: on });
  const applyRules = (rules) => setSettings({ rules });

  const addSymbol = async (raw) => {
    const sym = String(raw || '').trim().toUpperCase();
    if (!/^[A-Z][A-Z.\-]{0,9}$/.test(sym)) return say('영문 티커를 입력하세요. 예: META, BRK.B', 'err'), false;
    setWlBusy(true);
    try {
      const d = await api('/api/watchlist/manual', { method: 'POST', body: { code: sym } });
      say(d.added === false ? `${sym}: 이미 관심 종목에 있어요.` : `${sym} 추가됨 (${d.resolved.exchange}, $${d.resolved.last})`, d.added === false ? 'info' : 'ok');
      refresh();
      return true;
    } catch (e) {
      say(`${sym}: ${e.message}`, 'err');
      return false;
    } finally {
      setWlBusy(false);
    }
  };
  const listAction = async (method, path, okText) => {
    try {
      await api(path, { method });
      say(okText, 'ok');
      refresh();
    } catch (e) {
      say(e.message, 'err');
    }
  };
  const removeSymbol = (code) => listAction('DELETE', `/api/watchlist/manual/${code}`, `${code} 삭제됨`);
  const promoteSymbol = (code) => listAction('POST', `/api/watchlist/ai/${code}/promote`, `${code}: 수동 관심종목으로 옮겼어요.`);
  const dropAi = (code) => listAction('DELETE', `/api/watchlist/ai/${code}`, `${code}: AI 관심종목에서 삭제했어요.`);
  const userOrder = async ({ code, side, qty }) => {
    try {
      const r = await api('/api/bot/order', { method: 'POST', body: { symbol: code, side: side === '매수' ? 'buy' : 'sell', qty }, ms: 20000 });
      if (r.error) throw new Error(r.error);
      if (r.skipped) say(r.skipped, 'err');
    } catch (e) {
      say(`주문 실패: ${e.message}`, 'err');
    }
    refresh();
  };
  const requestLiquidate = async () => {
    try {
      await api('/api/bot/liquidate', { method: 'POST', ms: 30000 });
    } catch (e) {
      say(`청산 실패: ${e.message}`, 'err');
    }
    refresh();
  };

  // ---------- 화면 ----------
  const acct = m.account;
  let stockValue = 0;
  let stockCost = 0;
  for (const p of Object.values(m.pf.pos)) {
    stockValue += p.qty * (p.price || p.avg);
    stockCost += p.qty * p.avg;
  }
  const stockPnl = stockValue - stockCost;
  const sel = m.tickers.find((x) => x.code === ticker) || m.tickers.find((x) => x.list !== 'ai') || m.tickers[0] || null;
  const manualList = m.tickers.filter((x) => x.list !== 'ai' && x.list !== 'gap');
  const aiList = m.tickers.filter((x) => x.list === 'ai');
  const gapList = m.tickers.filter((x) => x.list === 'gap' || st?.gap?.today && (st.gap.items || []).some((g) => g.symbol === x.code));
  const shownList = wlTab === 'ai' ? aiList : wlTab === 'gap' ? gapList : manualList;
  const runGapScan = async () => {
    try {
      await api('/api/bot/gapscan', { method: 'POST', ms: 60000 });
      say('갭 스캔을 한 번 돌렸어요.', 'ok');
      refresh();
    } catch (e) {
      say(e.message, 'err');
    }
  };
  const working = (m.orders || []).filter((o) => o.status === 'working');
  const tickAge = st?.lastTick ? Math.round((Date.now() - st.lastTick) / 1000) : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src={avatars.kang} alt="" className="brand-icon" />
          <div>
            <h1>퀀트 오피스</h1>
            <p>KIS 실데이터로만 움직이는 8인 에이전트 매매 데스크</p>
          </div>
        </div>
        <ControlToggle control={control} onChange={toggleControl} disabled={conn !== 'online'} />
        <div className="top-stats">
          <div className="clock">
            <span className={`led-dot ${mode === 'open' && !closedDay ? '' : 'idle'}`} />
            <span className="clock-state">{closedDay ? (st?.phaseInfo?.reason || '주말 휴장') : mode === 'open' ? '장중' : mode === 'pre' ? '장 시작 전' : clock.min >= 960 && clock.min < 1200 ? '장 마감' : '야간'}</span>
            <span className="tz">{clock.tz}</span>
            <span className="city">뉴욕</span>
            <b>{clockText(clock.min)}<small>:{String(Math.floor((clock.min % 1) * 60)).padStart(2, '0')}</small></b>
            <span className="date">{clock.label}</span>
          </div>
          {conn === 'online' ? (
            <div className={`pill live ${st.realOrders ? '' : 'locked'}`} title={`봇 마지막 동작 ${tickAge ?? '-'}초 전`}>
              KIS {st.env === 'real' ? '실전' : '모의투자'} · 주문 {st.realOrders ? '전송' : '잠금'}
            </div>
          ) : (
            <div className="pill off">{conn === 'connecting' ? '봇 연결 중' : '봇 서버 미연결'}</div>
          )}
        </div>
      </header>

      <Scheduler mode={mode} clock={clock.min} weekend={closedDay} officeRef={officeRef} onPick={setOpenAgent} />

      <main className="left">
        <OfficePanel officeRef={officeRef} bubbles={bubbles} setBubbles={setBubbles} onPick={setOpenAgent} market={m} mode={mode} control={control} emergency={st?.emergency} offline={conn !== 'online'} shutdown={st?.guard?.shutdown ? st.guard.reason : null} />
        <Messenger messages={messages} avatars={avatars} onPick={setOpenAgent} offline={conn !== 'online'} />
        <NewsFeed live={conn === 'online'} mine={m.tickers.map((t) => t.code)} onSelect={setTicker} />
        <TokenMonitor live={conn === 'online'} llm={st?.llm} onPick={setOpenAgent} avatars={avatars} />
      </main>

      <aside className="right">
        {conn !== 'online' && <OfflineCard conn={conn} />}
        {conn === 'online' &&
          (control === 'manual' ? (
            <OverridePanel applied={st.settings.rules} onApply={applyRules} onLiquidate={requestLiquidate} mode={mode} hasPos={Object.keys(m.pf.pos).length > 0} market={m} onOrder={userOrder} />
          ) : (
            <button className="ovr-locked" onClick={() => toggleControl('manual')}>
              <span className="lock" aria-hidden="true">🔒</span>
              <span>
                <b>전략 & 오버라이드 패널 잠김</b>
                <small>봇이 AI 자동 모드로 운용 중입니다. 눌러서 사용자 수동 제어로 바꾸면 패널이 열립니다. 강제 손절선(-{st.settings.rules.hardStopPct}%)은 어느 모드에서나 서버가 집행합니다.</small>
              </span>
            </button>
          ))}

        <section className="win">
          <h2 className="win-title">포트폴리오 {acct && <span className="src src-kis">KIS 실계좌{acct.env === 'demo' ? ' (모의투자)' : ''}</span>}</h2>
          {!acct ? (
            <div className="acct-down" role="alert">
              <b>{conn !== 'online' ? '봇 서버에 연결되지 않아 계좌를 표시할 수 없어요' : st.accountError ? '⚠️ KIS 계좌를 불러오지 못했어요' : '실제 계좌를 불러오는 중이에요'}</b>
              {st?.accountError && <p>{st.accountError}</p>}
              <p className="dim">예수금·보유 종목은 KIS에서 받은 값만 표시합니다.</p>
            </div>
          ) : (
            <>
              <div className="pf-head">
                <div>
                  <div className="label">총 평가금액</div>
                  <div className="big">{usd(acct.totals.total)}</div>
                </div>
                <div className="ret" style={{ color: tone(acct.totals.pnl) }}>
                  <div className="label">평가 수익률</div>
                  <div className="big">{pct((acct.totals.pnlRate || 0) / 100)}</div>
                </div>
              </div>
              <p className="pf-formula">= 외화 예수금 <b>{usd(acct.cash.deposit)}</b> + 보유 주식 <b>{usd(acct.totals.stocks)}</b></p>
              {m.pf.equity.length > 1 ? <EquityChart data={m.pf.equity} base={m.pf.equity[0]} /> : <p className="wl-empty">평가금액 추이는 화면을 연 뒤부터 쌓입니다.</p>}
              <dl className="kv">
                <div><dt>외화 예수금</dt><dd>{usd(acct.cash.deposit)}</dd></div>
                <div><dt>평가손익</dt><dd style={{ color: tone(stockPnl) }}>{stockPnl > 0 ? '+' : ''}{usd(stockPnl)}</dd></div>
                <div><dt>출금가능</dt><dd>{acct.cash.withdrawable != null ? usd(acct.cash.withdrawable) : '-'}</dd></div>
              </dl>
              <p className={`acct-sync ${st.accountError ? 'err' : ''}`}>{st.accountError ? `⚠️ 갱신 실패, ${tsText(acct.fetchedAt)} 데이터 표시 중` : `KIS 계좌 ${tsText(acct.fetchedAt)} 갱신`}</p>
            </>
          )}
          {st?.guard && <GuardBox g={st.guard} />}
          <div className={`ark ark-${m.ark}`} onClick={() => setOpenAgent('na')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenAgent('na')}>
            <ArkIcon closed={m.ark !== 'open'} />
            <div>
              <b>노아의 방주 {m.ark === 'open' ? '열림' : m.ark === 'closed' ? '닫힘' : '판단 대기'}</b>
              <span>{m.ark === 'open' ? `신규 매수 가능 · ${m.arkReason}` : m.arkReason}</span>
            </div>
            <div className="vix"><span>QQQ</span><b style={{ color: tone(m.index?.changePct) }}>{m.index?.changePct != null ? `${m.index.changePct > 0 ? '+' : ''}${m.index.changePct.toFixed(2)}%` : '-'}</b></div>
          </div>
          {working.length > 0 && (
            <ul className="orders">
              {working.map((o) => (
                <li key={o.id}>
                  <b className={o.side === 'buy' ? 'buy' : 'sell'}>{o.side === 'buy' ? '매수' : '매도'}</b> {o.symbol} {o.remaining}/{o.qty}주 @ {usd(o.price)}
                  <small>{o.side === 'sell' ? `${(o.stage || 0) + 1}단계 · ${o.reason}` : o.reason}</small>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="win">
          <h2 className="win-title">관심 종목 <span className="dim">수동 {manualList.filter((x) => x.list === 'manual').length}/{MAX_WATCH} · AI {aiList.length}/{MAX_AI}</span></h2>
          <DavidSwitch on={davidOn} info={st?.discover} mode={mode} disabled={conn !== 'online'} onToggle={toggleDavid} />
          <div className="wl-tabs" role="tablist" aria-label="관심 종목 구분">
            <button type="button" role="tab" aria-selected={wlTab === 'manual'} className={wlTab === 'manual' ? 'on' : ''} onClick={() => setWlTab('manual')}>
              수동 관심종목 <b>{manualList.length}</b>
            </button>
            <button type="button" role="tab" aria-selected={wlTab === 'ai'} className={wlTab === 'ai' ? 'on' : ''} onClick={() => setWlTab('ai')}>
              AI 관심종목 (관망) <b>{aiList.length}</b>
            </button>
            <button type="button" role="tab" aria-selected={wlTab === 'gap'} className={wlTab === 'gap' ? 'on' : ''} onClick={() => setWlTab('gap')}>
              갭 후보 (오늘) <b>{gapList.length}</b>
            </button>
          </div>
          {wlTab === 'manual' ? (
            <WatchlistTools live={conn === 'online'} busy={wlBusy} msg={wlMsg} onAdd={addSymbol} />
          ) : wlTab === 'gap' ? (
            <GapInfo gap={st?.gap} rules={m.rules} disabled={conn !== 'online'} onScan={runGapScan} msg={wlMsg} news={st?.news} />
          ) : (
            <>
              <p className="wl-msg">{davidOn ? '다윗이 KIS 순위 API로 발굴해 관망 중인 종목이에요. 마음에 들면 수동으로 옮기세요.' : '탐색 모드가 꺼져 있어 이 목록은 S티어 스캔과 시세 갱신에서 빠져 있어요.'}</p>
              {wlMsg && <p key={wlMsg.key} className={`wl-msg ${wlMsg.kind}`} role="status">{wlMsg.text}</p>}
            </>
          )}
          {shownList.length === 0 ? (
            <p className="wl-empty">{conn !== 'online' ? '봇 서버에 연결되면 관심 종목이 표시됩니다.' : wlTab === 'manual' ? EMPTY_MSG : wlTab === 'gap' ? '오늘의 갭 후보가 아직 없어요. 장전(한국 22:30~23:25, 서머타임 21:30~22:25)에 10분마다 찾아요.' : davidOn ? '아직 발굴한 종목이 없어요. 정규장 중 주기적으로 탐색해요.' : 'AI 관심종목이 비어 있어요. 다윗 탐색 모드를 켜면 채워집니다.'}</p>
          ) : (
            <table className="watch">
              <tbody>
                {shownList.map((t) => {
                  const ch = t.price && t.prevClose ? t.price / t.prevClose - 1 : null;
                  const held = m.pf.pos[t.code];
                  const isAi = t.list === 'ai';
                  return (
                    <tr key={t.code} className={`${t.code === sel?.code ? 'on' : ''} ${isAi ? 'ai' : ''} ${isAi && !davidOn ? 'paused' : ''}`} onClick={() => setTicker(t.code)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setTicker(t.code)}>
                      <td className="nm">
                        {t.name}
                        {held && <span className="held" title="보유 중">◆</span>}
                        {m.stier[t.code]?.fired && <span className="focus" title="S티어 신호">S</span>}
                        {t.risk?.risky && <span className="risk-tag" title={(t.risk.reasons || []).join(', ')}>위험</span>}
                        {t.rvol != null && <span className={`rv-tag ${t.rvol >= 2 ? 'hot' : t.rvol < 1 ? 'cold' : ''}`} title="상대 거래량: 평소 이 시각 대비 오늘 거래량">{t.rvol}x</span>}
                        {t.news?.catalyst === 'positive' && <span className="news-tag pos" title={t.news.why}>재료</span>}
                        {t.news?.catalyst === 'negative' && <span className="news-tag neg" title={t.news.why}>악재</span>}
                        <small className="kr">{t.risk?.risky ? `매수 제외: ${(t.risk.reasons || [])[0] || '위험 상품'}` : t.err ? `⚠ ${t.err}` : isAi || t.list === 'gap' ? t.reason || t.kr : t.list === 'held' ? '보유 종목 (관심종목 외)' : t.kr}</small>
                      </td>
                      <td className="num">{t.price ? usd(t.price) : '수집 중'}</td>
                      <td className="num" style={{ color: tone(ch) }}>{ch == null ? '-' : pct(ch)}</td>
                      {isAi ? (
                        <td className="ai-act" colSpan={2}>
                          <button type="button" className="promote" title="수동 관심종목으로 옮기기" onClick={(e) => { e.stopPropagation(); promoteSymbol(t.code); }}>↑수동</button>
                          <button type="button" className="x" aria-label={`${t.code} AI 관심종목에서 삭제`} disabled={!!held} onClick={(e) => { e.stopPropagation(); dropAi(t.code); }}>×</button>
                        </td>
                      ) : (
                        <>
                          <td><span className={`sig sig-${t.signal}`}>{t.signal}</span></td>
                          <td className="rm">
                            {t.list === 'manual' && (
                              <button type="button" aria-label={`${t.code} 관심 종목에서 빼기`} title="관심 종목에서 빼기" onClick={(e) => { e.stopPropagation(); removeSymbol(t.code); }}>×</button>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="win">
          <h2 className="win-title">S티어 스캐너 <span className="dim">A·B·C 중 하나면 매수 후보</span></h2>
          <STierPanel market={m} mode={mode} onSelect={setTicker} davidOn={davidOn} />
        </section>

        <section className="win">
          {sel && sel.candles.length ? (
            <>
              <h2 className="win-title">{sel.name} 5분봉 <span className="dim">KIS</span></h2>
              <CandleChart t={sel} live />
              <div className="chart-foot">
                <span>현재가 <b style={{ color: tone(sel.price - sel.open) }}>{usd(sel.price)}</b></span>
                <span><i className="sw sw-ma" />5봉 평균</span>
              </div>
            </>
          ) : (
            <>
              <h2 className="win-title">5분봉</h2>
              <p className="wl-empty">{!sel ? EMPTY_MSG : `${sel.name} 5분봉을 KIS에서 받는 중이에요.`}</p>
            </>
          )}
        </section>

        <section className="win">
          <h2 className="win-title">보유 종목 <span className="dim">{control === 'manual' ? '사용자 지침 + 강제 손절선' : '모세 판단 + 강제 손절선'}</span></h2>
          <ul className="holds">
            {!acct && <li className="dim">계좌를 불러오면 표시됩니다.</li>}
            {acct && Object.keys(m.pf.pos).length === 0 && <li className="dim">보유 종목이 없어요.</li>}
            {acct &&
              Object.entries(m.pf.pos).map(([code, p]) => {
                const t = m.tickers.find((x) => x.code === code);
                const price = t?.price || p.price;
                const r = price / p.avg - 1;
                const j = m.moses[code];
                const lv = j ? levelOf(j) : 'calm';
                return (
                  <li key={code} className="hold-ai">
                    <span>{code}</span>
                    <span className="dim">{p.qty}주</span>
                    <span style={{ color: tone(r) }}>{pct(r)}</span>
                    <span className={`mj mj-${lv}`} title={j ? j.reasons.join(', ') : ''}>
                      {j ? (j.hard ? '강제 손절' : lv === 'watch' ? '주의' : ACTION_LABEL[j.action] === '보유' ? '보유' : `${ACTION_LABEL[j.action]} 판단`) : '대기'}
                    </span>
                    {j && (
                      <small className="mj-note">
                        {j.trailStop ? <>트레일링 스톱 <b>{usd(j.trailStop)}</b></> : <>하락 압력 <b>{j.pressure}</b></>}
                        <span>{j.reasons[0]}</span>
                      </small>
                    )}
                  </li>
                );
              })}
          </ul>
          <p className="mj-legend">{st ? `강제 손절선 -${st.settings.rules.hardStopPct}%는 브라우저와 상관없이 서버가 집행합니다. ${control === 'manual' ? `수동 지침: 손절 ${st.settings.rules.stop}% / 익절 +${st.settings.rules.take}%.` : '그 위에서 모세가 실제 5분봉·1호가·QQQ로 손절/익절을 판단합니다.'}` : '봇 서버 연결 후 표시됩니다.'}</p>
        </section>

        <PnlCalendar live={conn === 'online'} env={st?.env} />
        <StatsPanel stats={stats} env={st?.env} health={m.health} modes={m.strategyModes} onMode={(id, v) => setSettings({ strategyModes: { [id]: v } })} />
      </aside>

      {openAgent && <AgentModal id={openAgent} onClose={() => setOpenAgent(null)} officeRef={officeRef} avatars={avatars} messages={messages} reports={reportsRef.current} moses={m.moses} />}
    </div>
  );
}

function GuardBox({ g }) {
  const pnl = g.dayPnlPct;
  const used = pnl != null && pnl < 0 ? Math.min(100, (-pnl / g.limitPct) * 100) : 0;
  return (
    <div className={`guard-box ${g.shutdown ? 'shut' : ''}`} role={g.shutdown ? 'alert' : undefined}>
      <div className="gb-row">
        <span>오늘 계좌 손익</span>
        <b style={{ color: tone(pnl) }}>{pnl == null ? '기준 대기' : `${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}%`}</b>
        <span className="dim">셧다운 -{g.limitPct}%</span>
      </div>
      <span className="gb-bar" aria-hidden="true"><i style={{ width: `${used}%` }} /></span>
      <div className="gb-row">
        <span>동시 보유</span>
        <b style={{ color: g.positions >= g.maxPositions ? UP : undefined }}>{g.positions} / {g.maxPositions}종목</b>
        <span className="dim">{g.startEquity ? `기준 ${usd(g.startEquity)}` : '장전 첫 조회 때 기준 설정'}</span>
      </div>
      {g.shutdown && <p className="gb-shut">⛔ 오늘 매매 셧다운: {g.reason}. 신규 매수(직접 주문 포함) 금지, 손절·매도만 동작. 다음 거래일 자동 해제.</p>}
    </div>
  );
}

function OfflineCard({ conn }) {
  return (
    <section className="win offline-card">
      <h2 className="win-title">봇 서버 {conn === 'connecting' ? '연결 중' : '미연결'}</h2>
      <p>이 화면은 매매 봇 서버의 실제 상태만 보여 줍니다. 서버가 없으면 시세·계좌·신호를 만들어 내지 않아요.</p>
      <ol>
        <li><code>docker compose up -d</code> 후 <b>http://localhost:8787</b> 접속</li>
        <li>또는 <code>npm run server</code> + <code>npm run dev</code></li>
      </ol>
      <p className="dim">연결 주소: {KIS_API}</p>
    </section>
  );
}

function GapInfo({ gap, rules, disabled, onScan, msg, news }) {
  const R = rules || {};
  const items = gap?.today ? gap.items || [] : [];
  return (
    <div className="gap-info">
      <p className="wl-msg">
        트랙 1: 장전에 갭 +{R.gapMinPct ?? 4}~{R.gapMaxPct ?? 25}%, ${R.gapMinPrice ?? 5}~{R.gapMaxPrice ?? 30}, 프리마켓 {Math.round((R.gapMinPreVol ?? 500000) / 1000)}K주 또는 ${R.gapMinPreAmtM ?? 5}M 이상, 시총 ${R.gapMinMcapM ?? 300}M 이상인 종목 상위 {R.gapTopN ?? 5}개. 개장 후 {(R.orbBars ?? 3) * 5}분 시가 범위 고가를 거래량과 함께 넘으면 매수(D), 손절은 범위 저가와 -2% 중 가까운 쪽, {R.orbEndMin ?? 90}분 이후엔 진입 안 함.
      </p>
      <p className="wl-msg dim">
        {gap?.today ? `${tsShort(gap.at)} ${gap.finalized ? '확정' : `스캔 ${gap.scans}회째`}${gap.source === 'open' ? ' (개장 직후 등락률 기준)' : gap.source === 'manual' ? ' (수동 실행)' : ''} · 순위 ${gap.scanned ?? '-'}개 중 조건 통과 ${gap.passed ?? '-'}개` : '오늘 스캔 전'}
        {R.gapScan === false && ' · 갭 스캔 꺼짐'}
        {news && ` · 뉴스: ${news.alphaVantage?.enabled ? `Alpha Vantage 오늘 ${news.alphaVantage.used}/${news.alphaVantage.limit}회` : 'Alpha Vantage 키 없음'}${news.yahoo?.enabled ? (news.yahoo.blocked ? ' · 야후 잠시 차단됨' : ' · 야후') : ''} · KIS`}
        {' '}
        <button type="button" className="mini" disabled={disabled || gap?.busy} onClick={onScan}>{gap?.busy ? '스캔 중…' : '지금 스캔'}</button>
      </p>
      {items.length > 0 && (
        <table className="gap-tbl">
          <thead>
            <tr><th>종목</th><th>갭</th><th>가격</th><th>프리마켓</th><th>프리 RVol</th><th>시총</th><th>뉴스</th></tr>
          </thead>
          <tbody>
            {items.map((g) => (
              <tr key={g.symbol}>
                <td>{g.symbol}{gap.orbDone?.[g.symbol] === gap.date && <small className="dim"> 진입 시도함</small>}</td>
                <td style={{ color: UP }}>+{g.gapPct}%</td>
                <td>{usd(g.last)}</td>
                <td>{g.preVol != null ? `${Math.round(g.preVol / 1000)}K주` : '-'}{g.preAmtM != null ? ` · $${g.preAmtM}M` : ''}</td>
                <td title="프리마켓 거래량 ÷ 평소 하루 거래량">{g.preRvol != null ? g.preRvol : '-'}</td>
                <td title={g.sharesM ? `상장주식수 ${g.sharesM}M주` : ''}>{g.mcapM != null ? `$${g.mcapM}M` : '-'}</td>
                <td className={`news ${g.news?.catalyst || ''}`} title={g.news ? `${g.news.why}${g.news.top ? `\n${g.news.top}` : ''}` : '뉴스 확인 안 함'}>{!g.news ? '-' : g.news.catalyst === 'positive' ? '재료' : g.news.catalyst === 'news' ? '있음' : g.news.catalyst === 'unknown' ? '조회 실패' : '없음'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {gap?.today && gap.dropped?.length > 0 && <p className="wl-msg dim">제외: {gap.dropped.slice(0, 6).join(', ')}</p>}
      {msg && <p key={msg.key} className={`wl-msg ${msg.kind}`} role="status">{msg.text}</p>}
    </div>
  );
}

function StrategySwitches({ health, modes, onMode }) {
  const ex = (x) => (x?.expectancyPct == null ? '-' : `${x.expectancyPct > 0 ? '+' : ''}${x.expectancyPct.toFixed(2)}%`);
  return (
    <div className="strat-sw">
      <p className="wl-msg">전략 자동 선택: 실거래가 쌓이면 성과가 나쁜 전략을 끄고, 꺼진 뒤에도 신호는 가상 거래로 계속 재서 좋아지면 다시 켭니다.</p>
      <table className="stats">
        <thead>
          <tr><th>전략</th><th>상태</th><th>실거래(최근)</th><th>가상 거래</th><th>모드</th></tr>
        </thead>
        <tbody>
          {['A', 'B', 'C', 'D'].map((id) => {
            const h = health?.[id];
            const mode = modes?.[id] || 'auto';
            return (
              <tr key={id} title={h?.reason || ''}>
                <td>{id} {STRATEGIES[id].name}</td>
                <td><b className={`st-chip ${h?.status === 'off' ? 'off' : 'on'}`}>{h?.status === 'off' ? '꺼짐' : '켜짐'}</b></td>
                <td>{h ? `${h.real.trades}건 ${ex(h.real)}` : '-'}</td>
                <td>{h ? `${h.shadow.trades}건 ${h.shadow.winRate == null ? '' : `승 ${Math.round(h.shadow.winRate * 100)}% `}${ex(h.shadow)}` : '-'}</td>
                <td className="mode-btns">
                  {[['auto', '자동'], ['on', '켬'], ['off', '끔']].map(([v, l]) => (
                    <button key={v} type="button" className={mode === v ? 'on' : ''} onClick={() => onMode(id, v)}>{l}</button>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatsPanel({ stats, env, health, modes, onMode }) {
  const S = stats;
  const f = (x, d = 1) => (x == null ? '-' : `${x.toFixed ? x.toFixed(d) : x}`);
  return (
    <section className="win">
      <h2 className="win-title">전략 성과 <span className="dim">{env === 'real' ? '실전' : env === 'demo' ? '모의투자' : ''} 체결 기록 기준</span></h2>
      <StrategySwitches health={health} modes={modes} onMode={onMode} />
      {!S ? (
        <p className="wl-empty">봇 서버 연결 후 표시됩니다.</p>
      ) : !S.overall.trades ? (
        <p className="wl-empty">아직 청산된 봇 거래가 없어요. 진입부터 청산까지 끝난 거래가 쌓이면 전략별 승률·손익비가 계산되고 켈리 입력값에 반영됩니다.</p>
      ) : (
        <>
          <table className="stats">
            <thead>
              <tr><th>전략</th><th>거래</th><th>승률</th><th>손익비</th><th>PF</th><th>기대값</th></tr>
            </thead>
            <tbody>
              {[['전체', S.overall], ...['A', 'B', 'C', 'D'].map((id) => [`${id} ${STRATEGIES[id].name}`, S.byStrategy[id]]), ...(S.byStrategy.multi ? [['2개 이상 동시', S.byStrategy.multi]] : []), ...(S.byTrack ? [['트랙 1 (갭 돌파)', S.byTrack.gap], ['장중 스캔', S.byTrack.intraday]] : [])].filter(([, x]) => x).map(([name, x]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{x.trades}</td>
                  <td>{x.winRate == null ? '-' : `${Math.round(x.winRate * 100)}%`}</td>
                  <td>{f(x.payoff, 2)}</td>
                  <td>{f(x.profitFactor, 2)}</td>
                  <td style={{ color: tone(x.expectancyPct) }}>{x.expectancyPct == null ? '-' : `${x.expectancyPct > 0 ? '+' : ''}${x.expectancyPct.toFixed(2)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mj-legend">
            손익비 = 평균 이익률 ÷ 평균 손실률, PF = 총이익 ÷ 총손실. 켈리 계산에 실거래 {Object.values(S.kellyFeedback || {}).reduce((s, x) => s + x.trades, 0)}건이 2배 가중으로 반영 중. 순손익 <b style={{ color: tone(S.overall.netPnl) }}>{usd(S.overall.netPnl)}</b>
          </p>
        </>
      )}
    </section>
  );
}
function DavidSwitch({ on, info, mode, disabled, onToggle }) {
  return (
    <div className={`david-sw ${on ? 'on' : ''}`}>
      <button type="button" role="switch" aria-checked={on} onClick={() => onToggle(!on)} className="sw-btn" disabled={disabled}>
        <i />
      </button>
      <div className="david-txt">
        <b>다윗 전시장 탐색 {on ? 'ON' : 'OFF'}</b>
        <small>
          {disabled
            ? '봇 서버 연결 후 사용'
            : !on
              ? '수동 관심종목만 S티어 스캔'
              : mode !== 'open'
                ? '정규장(09:30~16:00 ET)에 주기적으로 탐색'
                : info
                  ? `${tsShort(info.at)} 조건 통과 ${info.found}개 · AI 관심종목 반영 ${info.added}개`
                  : 'KIS 거래량급증 · 체결강도 순위 탐색 대기'}
        </small>
      </div>
    </div>
  );
}
const tsShort = (iso) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');

function WatchlistTools({ live, busy, msg, onAdd }) {
  const [v, setV] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (await onAdd(v)) setV('');
  };
  return (
    <div className="wl-tools">
      <form className="wl-add" onSubmit={submit}>
        <input value={v} onChange={(e) => setV(e.target.value.toUpperCase())} placeholder={live ? '티커 추가 (예: META)' : '봇 서버 연결 후 추가'} aria-label="관심 종목 티커" maxLength={10} disabled={!live} />
        <button type="submit" disabled={!live || !v.trim() || busy}>{busy ? '확인 중' : '추가'}</button>
      </form>
      <p className="wl-msg dim">KIS 시세로 실제 거래소를 확인한 뒤 서버 관심종목 파일에 저장해요. 보유 종목은 자동으로 감시됩니다.</p>
      {msg && <p key={msg.key} className={`wl-msg ${msg.kind}`} role="status">{msg.text}</p>}
    </div>
  );
}

function ControlToggle({ control, onChange, disabled }) {
  return (
    <div className={`control ${control}`} role="radiogroup" aria-label="매매 제어 모드">
      <button role="radio" aria-checked={control !== 'manual'} className={control !== 'manual' ? 'on' : ''} onClick={() => onChange('auto')} disabled={disabled}>
        <span className="ic">🤖</span>
        <span><b>AI 자동 모드</b><small>봇이 판단하고 집행</small></span>
      </button>
      <button role="radio" aria-checked={control === 'manual'} className={control === 'manual' ? 'on' : ''} onClick={() => onChange('manual')} disabled={disabled}>
        <span className="ic">👤</span>
        <span><b>사용자 수동 제어</b><small>Override, 사용자 최우선</small></span>
      </button>
    </div>
  );
}

function ManualOrder({ market, mode, onOrder }) {
  const [code, setCode] = useState(market.tickers[0]?.code || '');
  const [side, setSide] = useState('매수');
  const [qty, setQty] = useState(10);
  const [busy, setBusy] = useState(false);
  const t = market.tickers.find((x) => x.code === code) || market.tickers[0];
  if (!t) {
    return (
      <div className="ovr-group manual-order">
        <h3>직접 주문</h3>
        <p className="wl-empty">{EMPTY_MSG}</p>
      </div>
    );
  }
  const held = market.pf.pos[t.code]?.qty || 0;
  const maxQty = side === '매수' ? (t.price > 0 && market.pf.cash > 0 ? Math.floor(market.pf.cash / t.price) : 0) : held;
  const canTrade = mode === 'open';
  const ok = canTrade && qty > 0 && qty <= maxQty && !busy;
  const submit = async (e) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    await onOrder({ code: t.code, side, qty });
    setBusy(false);
  };
  return (
    <form className="ovr-group manual-order" onSubmit={submit}>
      <h3>직접 주문 <span className="dim">최우선 권한, 방주와 한도 무시</span></h3>
      <div className="mo-row">
        <select value={t.code} onChange={(e) => setCode(e.target.value)} aria-label="종목">
          {market.tickers.map((x) => (
            <option key={x.code} value={x.code}>{x.name} {usd(x.price)}</option>
          ))}
        </select>
        <div className="seg-ctl side" role="radiogroup" aria-label="매매 구분">
          <button type="button" role="radio" aria-checked={side === '매수'} className={side === '매수' ? 'on buy' : ''} onClick={() => setSide('매수')}>매수</button>
          <button type="button" role="radio" aria-checked={side === '매도'} className={side === '매도' ? 'on sell' : ''} onClick={() => setSide('매도')}>매도</button>
        </div>
      </div>
      <div className="mo-row">
        <div className="st-ctl qty">
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - (q > 20 ? 10 : 1)))} aria-label="수량 줄이기">-</button>
          <input type="number" min="1" value={qty} onChange={(e) => setQty(Math.max(0, parseInt(e.target.value || '0', 10)))} aria-label="수량" />
          <button type="button" onClick={() => setQty((q) => q + (q >= 20 ? 10 : 1))} aria-label="수량 늘리기">+</button>
        </div>
        <span className="dim mo-est">주 = {usd(qty * t.price)}<br />가능 {maxQty.toLocaleString()}주{side === '매도' ? ' (보유)' : ''}</span>
      </div>
      <button type="submit" className={`order ${side === '매수' ? 'buy' : 'sell'}`} disabled={!ok}>
        {busy ? '집행 중' : !canTrade ? '장중에만 주문 가능' : qty > maxQty ? (side === '매수' ? '예수금 부족' : '보유 수량 부족') : `${t.name} ${qty}주 ${side} 주문`}
      </button>
    </form>
  );
}

const remainText = (mode, clock, weekend) => {
  if (weekend) return { long: '월요일 07:00 재개', short: '월 07:00' };
  const end = mode === 'pre' ? 570 : mode === 'open' ? 960 : clock >= 960 ? 1440 + 420 : 420;
  const left = Math.max(0, Math.ceil(end - clock));
  const h = Math.floor(left / 60);
  const m = left % 60;
  return { long: `${h ? `${h}시간 ` : ''}${m}분 남음`, short: `${h}:${String(m).padStart(2, '0')}` };
};

// read-only duty board: who works and who rests in each shift
function Scheduler({ mode, clock, weekend, officeRef, onPick }) {
  const pos = Math.min(1, Math.max(0, clock / 1440));
  const o = officeRef.current;
  return (
    <section className="sched win" aria-label="근무 현황판">
      <h2 className="win-title">근무 현황판</h2>
      <div className="sched-sync">
        <span className="sync"><i />뉴욕 현지 시각(ET) 자동 운영{weekend ? ', 주말 휴장' : ''}</span>
      </div>
      <div className="modes">
        {MODES.map((md) => {
          const crew = crewOf(md.id);
          const rest = AGENTS.filter((a) => !a.duty[md.id]);
          const now = mode === md.id;
          return (
            <article key={md.id} className={`mode ${now ? 'on' : ''}`} aria-current={now ? 'step' : undefined}>
              <header className="mode-h">
                <span className="no">{md.no}</span>
                <div className="mh-top">
                  <b className="title">{md.name}</b>
                  {now && (() => {
                    const r = remainText(md.id, clock, weekend);
                    return (
                      <span className="live" title={r.long}>
                        진행 중<em className="long">{r.long}</em><em className="short">{r.short}</em>
                      </span>
                    );
                  })()}
                </div>
                <div className="mh-sub">
                  <span className="range">{md.range}</span>
                  <span className="cnt on">근무 {crew.length}명</span>
                  <span className="cnt">휴식 {rest.length}명</span>
                </div>
              </header>
              <div className="duty-row">
                <span className="lbl">근무 {crew.length}</span>
                <div className="names">
                  {crew.map((a) => {
                    const ag = o && o.byId[a.id];
                    const busy = now && ag && ag.busy;
                    return (
                      <button key={a.id} className={`dn ${busy ? 'busy' : ''}`} style={{ '--c': a.color }} onClick={() => onPick(a.id)} title={now && ag ? statusText(ag) : a.role}>
                        <i />{a.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="duty-row rest">
                <span className="lbl">휴식 {rest.length}</span>
                <div className="names">
                  {rest.length ? rest.map((a) => <span key={a.id} className="dn off">{a.name}</span>) : <span className="dn none">없음, 전원 근무</span>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <div className="tl-wrap" aria-hidden="true">
        <div className="timeline">
          {TIMELINE.map((sg, i) => (
            <span key={i} className={`seg seg-${sg.mode} ${mode === sg.mode && clock >= sg.from && clock < sg.to ? 'on' : ''}`} style={{ flex: sg.to - sg.from }} />
          ))}
          <span className="now" style={{ left: `${pos * 100}%` }} />
        </div>
        <div className="tl-labels">
          {['00', '07', '09:30', '12', '16', '20', '24'].map((h) => {
            const [hh, mm] = h.split(':');
            const min = +hh * 60 + (+mm || 0);
            return <span key={h} style={{ left: `${(min / 1440) * 100}%` }}>{h}</span>;
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------- ark icon ----------------
function ArkIcon({ closed }) {
  const rows = closed
    ? ['....oooo....', '....o##o....', '..oooooooo..', '.o########o.', 'oo########oo', 'o##########o', '.o########o.', '..oooooooo..', '~~~~~~~~~~~~', '~.~~.~~.~~.~']
    : ['............', '.....o......', '....oo......', '...o.o......', '..oooooooo..', '.o########o.', 'o##########o', '.o########o.', '..oooooooo..', '~.~~.~~.~~.~'];
  const rects = [];
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={ch === 'o' ? '#141517' : ch === '#' ? (closed ? '#8a5a3a' : '#b07c4f') : '#4d9bff'} />);
    })
  );
  return (
    <svg className="ark-icon" viewBox="0 0 12 10" width="36" height="30" shapeRendering="crispEdges" aria-hidden="true">{rects}</svg>
  );
}

function STierPanel({ market, mode, onSelect, davidOn }) {
  const rows = market.tickers.filter((t) => t.list === 'manual' || t.list === 'gap' || (t.list === 'ai' && davidOn)).map((t) => ({ t, r: market.stier?.[t.code] }));
  if (!rows.length) return <p className="wl-empty">{EMPTY_MSG}</p>;
  return (
    <div className="stier">
      <div className="stier-legend">
        {Object.values(STRATEGIES).map((x) => (
          <span key={x.id}><b>{x.id}</b> {x.name}</span>
        ))}
      </div>
      {mode !== 'open' && <p className="wl-msg">정규장(09:30~16:00 ET)에만 판정해요. 장 밖에서는 마지막 판정이 그대로 남아 있어요.</p>}
      {market.rules && <p className="wl-msg">예상 변동폭이 목표 {market.rules.minTargetPct}% 이상인 종목만 진입 (왕복 비용 {market.costPct?.toFixed(2)}%). 초록 = 통과, 회색 = 변동성 부족</p>}
      <table>
        <tbody>
          {rows.map(({ t, r }) => (
            <tr key={t.code} className={r?.fired ? 'hit' : ''} onClick={() => onSelect(t.code)}>
              <td className="nm">{t.code}{t.list === 'ai' && <small className="ai-tag">AI</small>}{t.list === 'gap' && <small className="ai-tag gap">갭</small>}</td>
              {['A', 'B', 'C', 'D'].map((id) => {
                const x = r?.results?.find((y) => y.id === id);
                return (
                  <td key={id} title={x ? (x.fired ? x.detail : x.reason || x.detail) : id === 'D' ? '갭 후보만 판정' : '데이터 부족'}>
                    <i className={`lamp ${x?.fired ? 'on' : x?.reason ? 'na' : ''}`}>{id}</i>
                  </td>
                );
              })}
              <td className={`mv ${t.expMovePct == null ? '' : t.expMovePct >= (market.rules?.minTargetPct ?? 2) ? 'ok' : 'low'}`} title="5분봉 ATR% × √보유봉수: 이 종목이 보유 시간 동안 움직일 것으로 보는 폭. 목표 이상이어야 진입">{t.expMovePct == null ? '-' : `${t.expMovePct.toFixed(1)}%`}</td>
              <td className={`mv ${t.rvol == null ? '' : t.rvol >= (market.rules?.rvolMinEntry ?? 1.5) ? 'ok' : 'low'}`} title="상대 거래량 (평소 이 시각 대비)">{t.rvol == null ? '-' : `${t.rvol}x`}</td>
              <td className="st">{r?.fired ? '매수 신호' : r?.pending ? r.pending : r ? '대기' : '판정 전'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KellyCard({ k }) {
  const pctS = (x) => (x == null || !Number.isFinite(x) ? '-' : `${(x * 100).toFixed(1)}%`);
  const best = k.best || (k.kellies || [])[0] || {};
  const raw = best.f; // 계산된 f* (음수 그대로)
  const negative = raw != null && raw <= 0;
  return (
    <div className={`kelly ${negative ? 'neg' : ''}`}>
      <div className="kelly-h">켈리 사이징 <span>{k.t}</span></div>
      <table>
        <tbody>
          {(k.kellies || []).map((x) => (
            <tr key={x.id} className={x.id === best.id ? 'best' : ''}>
              <td>{x.id} {STRATEGIES[x.id].name}</td>
              <td>승률 {Math.round(x.win * 100)}%</td>
              <td>손익비 {x.payoff}</td>
              <td style={{ color: x.f > 0 ? UP : DOWN }}>f* {pctS(x.f)}</td>
              <td className="dim">실거래 {x.observed || 0}건</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="kelly-f">
        f* = 승률 − (1 − 승률) ÷ 손익비 = {best.win != null ? `${best.win} − ${(1 - best.win).toFixed(3)} ÷ ${best.payoff}` : '-'} = <b style={{ color: negative ? DOWN : UP }}>{pctS(raw)}</b>
        {k.cost != null && <span className="dim"> (왕복 비용 {k.cost.toFixed(2)}% 반영)</span>}
      </p>
      {negative ? (
        <p className="kelly-q">
          <b style={{ color: DOWN }}>0 이하 → 매수 안 함.</b> 손익비 {best.payoff}이면 승률이 {best.payoff ? `${Math.round((1 / (1 + best.payoff)) * 100)}%` : '-'} 이상이어야 기대값이 플러스예요.
        </p>
      ) : (
        <p className="kelly-q">
          ½ 켈리 {pctS(k.fullKelly * (k.fraction ?? 0.5))}{k.cappedBy ? ` → 한도로 ${pctS(k.weight)}` : ''} · ({usd(k.total)} × {pctS(k.weight)}) ÷ {usd(k.price)} = <b>{k.qty}주</b>
          {k.reason && <em> {k.reason}</em>}
        </p>
      )}
    </div>
  );
}

function OfficePanel({ officeRef, bubbles, setBubbles, onPick, market, mode, control, emergency, offline, shutdown }) {
  const canvasRef = useRef(null);
  const bubbleRefs = useRef({});

  useEffect(() => {
    const canvas = canvasRef.current;
    const office = createOffice(canvas, {
      onBubble: (id, text) => setBubbles((b) => ({ ...b, [id]: text })),
      onFrame: (agents) => {
        for (const a of agents) {
          const el = bubbleRefs.current[a.id];
          const top = office.headTop(a) - 2;
          if (el) {
            el.style.left = `${(a.x / W) * 100}%`;
            el.style.top = `${(top / H) * 100}%`;
          }
        }
      },
    });
    officeRef.current = office;
    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(W, Math.round(r.width * dpr));
      canvas.height = Math.max(H, Math.round(r.height * dpr));
    });
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      office.destroy();
    };
  }, []);

  const toLogical = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  const onMove = (e) => {
    const id = officeRef.current.hit(...toLogical(e));
    officeRef.current.setHover(id);
    canvasRef.current.style.cursor = id ? 'pointer' : 'default';
  };
  const onClick = (e) => {
    const id = officeRef.current.hit(...toLogical(e));
    if (id) onPick(id);
  };

  const tape = market.tickers.filter((t) => t.list !== 'ai' && t.price > 0).map((t) => {
    const ch = t.prevClose ? t.price / t.prevClose - 1 : 0;
    return { name: t.name, price: usd(t.price), ch, s: pct(ch) };
  });

  return (
    <section className="win office-win">
      <h2 className="win-title">오피스</h2>
      <div className="office-stage">
        <div className="office-frame">
          <canvas ref={canvasRef} width={W} height={H} onMouseMove={onMove} onMouseLeave={() => officeRef.current && officeRef.current.setHover(null)} onClick={onClick} aria-label="픽셀 오피스. 캐릭터를 클릭하면 상세 정보가 열립니다" />
          <div className="led" aria-hidden="true">
            <div className="led-track">
              {[0, 1].map((k) => (
                <span key={k} className="led-run">
                  {mode !== 'open' && <span className="led-item">{mode === 'pre' ? '장 시작 전' : '장 마감'}</span>}
                  {!tape.length && <span className="led-item">{offline ? '봇 서버 미연결 · 시세 없음' : market.tickers.length ? 'KIS 시세 수집 중' : '관심 종목 없음 · 종목을 추가해주세요'}</span>}
                  {tape.map((x) => (
                    <span key={x.name + k} className="led-item">
                      {x.name} <b>{x.price}</b> <em style={{ color: tone(x.ch) }}>{x.ch > 0 ? '▲' : x.ch < 0 ? '▼' : '-'}{x.s.replace(/[+-]/, '')}</em>
                    </span>
                  ))}
                </span>
              ))}
            </div>
          </div>
          {PODS.map((p) => {
            const d = DEPT[p.dept];
            const working = AGENTS.filter((a) => a.dept === p.dept && a.duty[mode]).length;
            return (
              <div key={p.dept} className={`dept-tag ${working ? '' : 'off'}`} style={{ left: `${((p.x + 50) / W) * 100}%`, top: `${((p.y - 25) / H) * 100}%`, '--c': d.color }}>
                <i />
                {d.name} <span>{d.model}</span>
                {p.dept === 'risk' && <em className={`tag-ark ${market.ark === 'open' ? 'open' : 'closed'}`}>방주 {market.ark === 'open' ? '열림' : market.ark === 'closed' ? '닫힘' : '대기'}</em>}
                {control === 'manual' && (p.dept === 'risk' || p.dept === 'exec') && <em className="tag-manual">수동 대기</em>}
              </div>
            );
          })}
          {AGENTS.map((a) => (
            <div key={a.id} className={`bubble ${bubbles[a.id] ? 'show' : ''}`} ref={(el) => (bubbleRefs.current[a.id] = el)}>
              {bubbles[a.id] && (
                <div className="bubble-in" onClick={() => onPick(a.id)}>
                  <span className="bubble-name" style={{ background: a.color }}>{a.name}</span>
                  <p>{bubbles[a.id]}</p>
                </div>
              )}
            </div>
          ))}
          {emergency && (
            <div className="emergency-banner" role="alert">
              비상 대기 모드: KIS {emergency} 조회 장애, 신규 주문 중지
            </div>
          )}
          {control === 'manual' && (
            <div className="manual-banner" role="status">
              <span>👤</span> 사용자 수동 제어 중. AI 자동 매매 일시 중지
            </div>
          )}
          {shutdown && (
            <div className="emergency-banner" role="alert">
              ⛔ 계좌 보호 셧다운: {shutdown}
            </div>
          )}
          {offline && (
            <div className="emergency-banner offline" role="status">
              봇 서버 미연결 · 실제 이벤트 대기 중
            </div>
          )}
        </div>
      </div>
      <div className="roster">
        {DEPTS.map((d) => (
          <div key={d.id} className="dept-col" style={{ '--c': d.color }}>
            <div className="dept-h">
              {d.name} <small>{d.motto}</small> <span>{d.model}</span>
            </div>
            {AGENTS.filter((a) => a.dept === d.id).map((a) => (
              <RosterChip key={a.id} a={a} officeRef={officeRef} onPick={onPick} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function RosterChip({ a, officeRef, onPick }) {
  const o = officeRef.current;
  const ag = o && o.byId[a.id];
  const on = ag ? ag.onDuty : true;
  return (
    <button className={`chip ${on ? '' : 'off'}`} onClick={() => onPick(a.id)} onMouseEnter={() => o && o.setHover(a.id)} onMouseLeave={() => o && o.setHover(null)}>
      <i style={{ background: a.color }} />
      <b>{a.name} <small>{a.role}</small></b>
      <span>{ag ? statusText(ag) : ''}</span>
    </button>
  );
}

// ---------------- charts ----------------
function usePixelCanvas(draw, deps, w, h) {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = ref.current.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    draw(ctx);
  }, deps);
  return ref;
}

function EquityChart({ data, base }) {
  const w = 160, h = 48;
  const ref = usePixelCanvas(
    (ctx) => {
      const min = Math.min(base, ...data);
      const max = Math.max(base, ...data);
      const span = max - min || 1;
      const yOf = (v) => Math.round(h - 3 - ((v - min) / span) * (h - 8));
      const last = data[data.length - 1];
      const col = last >= base ? UP : DOWN;
      const by = yOf(base);
      ctx.fillStyle = '#3d3f45';
      for (let x = 0; x < w; x += 4) ctx.fillRect(x, by, 2, 1);
      const n = data.length;
      let prev = null;
      for (let x = 0; x < w; x++) {
        const i = Math.floor((x / w) * n);
        if (i >= n) break;
        const y = yOf(data[i]);
        ctx.fillStyle = col + '33';
        const top = Math.min(y, by), bot = Math.max(y, by);
        for (let yy = top; yy <= bot; yy++) if ((x + yy) % 2 === 0) ctx.fillRect(x, yy, 1, 1);
        ctx.fillStyle = col;
        if (prev !== null) ctx.fillRect(x, Math.min(prev, y), 1, Math.abs(prev - y) + 1);
        else ctx.fillRect(x, y, 1, 1);
        prev = y;
      }
      ctx.fillStyle = '#efe6d2';
      ctx.fillRect(w - 3, yOf(last) - 1, 3, 3);
    },
    [data.length, data[data.length - 1]],
    w,
    h
  );
  return <canvas ref={ref} width={w} height={h} className="px-chart" aria-label="평가금액 추이" />;
}

// 5분봉 + 한투 스타일 툴팁: PC는 마우스 호버, 모바일은 길게 누르기
function CandleChart({ t, clock, live }) {
  const w = 168, h = 72;
  const cs = [...t.candles.slice(-41), t.cur].filter(Boolean);
  const [hov, setHov] = useState(null);
  const press = useRef({ timer: null, active: false, x: 0, y: 0 });
  const wrapRef = useRef(null);
  const ref = usePixelCanvas(
    (ctx) => {
      if (!cs.length) return;
      const lo = Math.min(...cs.map((k) => k.l));
      const hi = Math.max(...cs.map((k) => k.h));
      const span = hi - lo || 1;
      const yOf = (v) => Math.round(h - 4 - ((v - lo) / span) * (h - 8));
      ctx.fillStyle = '#2b2d31';
      for (let y = 8; y < h; y += 16) for (let x = 0; x < w; x += 3) ctx.fillRect(x, y, 1, 1);
      cs.forEach((k, i) => {
        const x = i * 4 + 2;
        const up = k.c >= k.o;
        ctx.fillStyle = up ? UP : DOWN;
        if (hov != null && i !== hov) ctx.globalAlpha = 0.45;
        ctx.fillRect(x + 1, yOf(k.h), 1, yOf(k.l) - yOf(k.h) + 1);
        const top = yOf(Math.max(k.o, k.c));
        const bot = yOf(Math.min(k.o, k.c));
        ctx.fillRect(x, top, 3, Math.max(1, bot - top + 1));
        ctx.globalAlpha = 1;
      });
      const c = cs.map((k) => k.c);
      ctx.fillStyle = '#ffc94a';
      c.forEach((_, i) => {
        if (i < 4) return;
        const v = c.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5;
        ctx.fillRect(i * 4 + 3, yOf(v), 2, 1);
      });
      if (hov != null && cs[hov]) {
        // 십자선: 세로선 + 종가 가로선
        ctx.fillStyle = 'rgba(239,230,210,.55)';
        const cx = hov * 4 + 3;
        for (let y = 0; y < h; y += 2) ctx.fillRect(cx, y, 1, 1);
        const cy = yOf(cs[hov].c);
        for (let x = 0; x < w; x += 2) ctx.fillRect(x, cy, 1, 1);
      }
    },
    [t.code, t.price, t.candles.length, hov],
    w,
    h
  );

  const idxAt = (clientX) => {
    const r = ref.current.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * w;
    return Math.max(0, Math.min(cs.length - 1, Math.floor((x - 2) / 4)));
  };

  // 터치: 0.35초 길게 누르면 툴팁, 누른 채로 좌우로 움직이면 따라감, 떼면 사라짐
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const P = press.current;
    const cancel = () => {
      clearTimeout(P.timer);
      P.timer = null;
      P.active = false;
      setHov(null);
    };
    const onStart = (e) => {
      if (e.touches.length !== 1) return cancel();
      const tt = e.touches[0];
      P.x = tt.clientX;
      P.y = tt.clientY;
      clearTimeout(P.timer);
      P.timer = setTimeout(() => {
        P.active = true;
        setHov(idxAt(P.x));
        if (navigator.vibrate) navigator.vibrate(8);
      }, 350);
    };
    const onMove = (e) => {
      const tt = e.touches[0];
      if (P.active) {
        e.preventDefault(); // 툴팁 중에는 화면 스크롤 막기
        setHov(idxAt(tt.clientX));
      } else if (Math.hypot(tt.clientX - P.x, tt.clientY - P.y) > 8) {
        clearTimeout(P.timer); // 길게 누르기 전에 움직이면 일반 스크롤
      }
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', cancel);
    el.addEventListener('touchcancel', cancel);
    return () => {
      clearTimeout(P.timer);
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', cancel);
      el.removeEventListener('touchcancel', cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cs.length]);

  const k = hov != null ? cs[hov] : null;
  let tip = null;
  if (k) {
    const isCur = k === t.cur;
    let when;
    if (k.time) when = k.time.slice(5).replace('-', '/'); // MM/DD HH:MM (ET)
    else {
      const end = Math.floor((clock ?? 0) / 5) * 5;
      const mm = ((end - (cs.length - 1 - hov) * 5) % 1440 + 1440) % 1440;
      when = `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
    }
    const prev = hov > 0 ? cs[hov - 1].c : t.prevClose || k.o;
    const ch = prev ? k.c / prev - 1 : 0;
    const leftSide = (hov * 4 + 3) / w > 0.55;
    tip = (
      <div className={`ctip ${leftSide ? 'l' : 'r'}`} style={{ [leftSide ? 'right' : 'left']: `${leftSide ? 100 - ((hov * 4 + 1) / w) * 100 : ((hov * 4 + 6) / w) * 100}%` }} role="status">
        <div className="ctip-h">
          {when}
          <small>{isCur ? '진행 중' : k.time ? 'ET' : 'ET · 모의'}</small>
        </div>
        <dl>
          <dt>시가</dt><dd>{usd(k.o)}</dd>
          <dt>고가</dt><dd style={{ color: UP }}>{usd(k.h)}</dd>
          <dt>저가</dt><dd style={{ color: DOWN }}>{usd(k.l)}</dd>
          <dt>종가</dt><dd style={{ color: tone(ch) }}>{usd(k.c)} <small>{pct(ch)}</small></dd>
          <dt>거래량</dt><dd>{Math.round(k.v || 0).toLocaleString()}{live ? '' : <small> 모의</small>}</dd>
        </dl>
      </div>
    );
  }
  return (
    <div className="chart-wrap" ref={wrapRef} onContextMenu={(e) => e.preventDefault()}>
      <canvas
        ref={ref}
        width={w}
        height={h}
        className="px-chart"
        aria-label={`${t.name} 캔들 차트. 마우스를 올리거나 길게 누르면 봉 정보가 보입니다`}
        onMouseMove={(e) => setHov(idxAt(e.clientX))}
        onMouseLeave={() => setHov(null)}
      />
      {tip}
    </div>
  );
}

// ---------------- 토큰 사용량 모니터 ----------------
function TokenMonitor({ live, llm, onPick, avatars }) {
  const [measured, setMeasured] = useState(null);
  const [flash, setFlash] = useState(null);
  useEffect(() => {
    if (!live) return undefined;
    let alive = true;
    let es = null;
    let poll = null;
    const pull = () => api('/api/usage', { ms: 5000 }).then((d) => alive && setMeasured(d)).catch(() => {});
    try {
      es = new EventSource(`${KIS_API}/api/usage/stream`);
      es.addEventListener('snapshot', (e) => alive && setMeasured(JSON.parse(e.data)));
      es.addEventListener('call', (e) => {
        if (!alive) return;
        const d = JSON.parse(e.data);
        setMeasured(d.snapshot);
        if (d.entry?.agent) {
          setFlash(d.entry.agent);
          setTimeout(() => alive && setFlash(null), 1600);
        }
      });
      es.onerror = () => {
        if (!poll) poll = setInterval(pull, 30000);
      };
    } catch {
      poll = setInterval(pull, 30000);
    }
    pull();
    return () => {
      alive = false;
      es && es.close();
      clearInterval(poll);
    };
  }, [live]);

  const rows = Object.fromEntries(AGENTS.map((a) => [a.id, measured?.by?.[a.id] || { calls: 0, failed: 0, prompt: 0, completion: 0, cost: 0, models: {} }]));
  const sum = Object.values(rows).reduce((s, r) => ({ calls: s.calls + r.calls, prompt: s.prompt + r.prompt, completion: s.completion + r.completion, cost: s.cost + (r.cost || 0) }), { calls: 0, prompt: 0, completion: 0, cost: 0 });
  const maxTok = Math.max(1, ...AGENTS.map((a) => rows[a.id].prompt + rows[a.id].completion));
  const today = measured?.today?.cost || 0;

  return (
    <section className="win tok-win">
      <h2 className="win-title">
        AI 토큰 사용량 <span className="dim">Claude·Gemini 실제 응답의 usage 기준</span>
      </h2>
      {!live ? (
        <p className="wl-empty">봇 서버에 연결되면 실제 호출 기록이 표시됩니다.</p>
      ) : (
        <>
          <p className="tok-note">
            {llm?.ready ? `AI 사용 중 · 노아·아브라함 결재와 다윗 탐색 요약에서만 호출합니다.` : 'AI 꺼짐: .env에 ANTHROPIC_API_KEY 또는 GEMINI_API_KEY가 없거나 LLM_ENABLED=false. 매매는 규칙 기반으로만 동작합니다.'}
          </p>
          <div className="tok-sum">
            <div><small>호출</small><b>{sum.calls.toLocaleString()}회</b></div>
            <div><small>입력</small><b className="tp">{fmtTok(sum.prompt)}</b></div>
            <div><small>출력</small><b className="tc">{fmtTok(sum.completion)}</b></div>
            <div><small>누적 비용</small><b className="cost">{fmtUsd(sum.cost)}</b></div>
          </div>
          {llm && (
            <p className="tok-budget">
              오늘(UTC) <b>{fmtUsd(today)}</b> / 예산 ${llm.budget.dailyUsd}
              <span className="bar"><i style={{ width: `${Math.min(100, (today / llm.budget.dailyUsd) * 100)}%` }} /></span>
            </p>
          )}
          <ul className="tok-list">
            {AGENTS.map((a) => {
              const r = rows[a.id];
              const tot = r.prompt + r.completion;
              const topModel = Object.entries(r.models || {}).sort((x, y) => y[1] - x[1])[0]?.[0];
              const route = llm?.routes?.[a.id]?.chain?.[0]?.model;
              return (
                <li key={a.id} className={flash === a.id ? 'flash' : ''}>
                  <button type="button" className="tok-who" onClick={() => onPick(a.id)} aria-label={`${a.name} 상세 보기`}>
                    <img src={avatars[a.id]} alt="" />
                    <span>
                      <b style={{ color: a.color }}>{a.name}</b>
                      <small>{topModel || route || '-'}{r.failed ? ` · 실패 ${r.failed}` : ''}</small>
                    </span>
                  </button>
                  <div className="tok-bar" title={`입력 ${r.prompt.toLocaleString()} · 출력 ${r.completion.toLocaleString()} 토큰`}>
                    <i className="tp" style={{ width: `${(r.prompt / maxTok) * 100}%` }} />
                    <i className="tc" style={{ width: `${(r.completion / maxTok) * 100}%` }} />
                  </div>
                  <span className="tok-n">{fmtTok(tot)}<small>{r.calls}회</small></span>
                  <span className="tok-c">{fmtUsd(r.cost || 0)}</span>
                </li>
              );
            })}
          </ul>
          <div className="tok-legend">
            <span><i className="tp" />입력</span>
            <span><i className="tc" />출력 (생각 토큰 포함)</span>
          </div>
          {measured?.recent?.length > 0 && (
            <table className="tok-recent">
              <tbody>
                {measured.recent.slice(0, 6).map((e) => (
                  <tr key={e.at + e.agent} className={e.ok ? '' : 'bad'}>
                    <td>{e.at.slice(11, 19)}</td>
                    <td style={{ color: AG[e.agent]?.color }}>{AG[e.agent]?.name || e.agent}</td>
                    <td>{e.task}</td>
                    <td className="m">{e.model}</td>
                    <td className="n">{fmtTok(e.input)} / {fmtTok(e.output)}</td>
                    <td className="n c">{fmtUsd(e.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="tok-note tok-real-note">비용은 서버 단가표(server/llm/pricing.js) 기준 추정 청구액이에요. 캐시·배치 할인은 반영하지 않습니다.</p>
        </>
      )}
    </section>
  );
}

// ---------------- 뉴스 속보 ----------------
function NewsFeed({ live, mine, onSelect }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('all');
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!live) return undefined;
    let stop = false;
    const load = () =>
      api('/api/news?limit=80')
        .then((d) => !stop && (setData(d), setErr(null)))
        .catch((e) => !stop && setErr(e.message));
    load();
    const id = setInterval(load, 60_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [live]);
  const mineSet = new Set(mine);
  const items = (data?.items || []).filter((n) => (tab === 'mine' ? n.symbol && mineSet.has(n.symbol) : tab === 'alert' ? n.tone === 'negative' || n.tone === 'positive' : true));
  // 시각은 한국 시각으로 표시 (서버가 출처별 시각을 epoch로 맞춰 줌)
  const KST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const kst = (at) => {
    const p = Object.fromEntries(KST.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
    return { d: `${p.year}-${p.month}-${p.day}`, t: `${String(+p.hour % 24).padStart(2, '0')}:${p.minute}` };
  };
  const todayK = kst(Date.now()).d;
  const when = (n) => {
    if (!n.at) return n.time ? `${n.date ? `${n.date.slice(5)} ` : ''}${n.time} ET` : '';
    const k = kst(n.at);
    return k.d === todayK ? k.t : `${k.d.slice(5)} ${k.t}`;
  };
  const fresh = (n) => n.at && Date.now() - n.at < 30 * 60_000;
  const st = data?.status;
  return (
    <section className="win news-win">
      <h2 className="win-title">뉴스 속보 <span className="dim">한국 시각 · {st ? `KIS${st.yahoo?.enabled ? ' · 야후' : ''}${st.alphaVantage?.enabled ? ` · Alpha Vantage ${st.alphaVantage.used}/${st.alphaVantage.limit}` : ''}` : ''}</span></h2>
      <div className="wl-tabs" role="tablist" aria-label="뉴스 구분">
        {[['all', '전체'], ['mine', '내 종목'], ['alert', '재료·악재']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="news-list" role="log" aria-live="polite">
        {!live ? <p className="empty">봇 서버에 연결되면 뉴스가 올라옵니다.</p> : err ? <p className="empty">뉴스를 불러오지 못했어요: {err}</p> : !items.length ? <p className="empty">{tab === 'mine' ? '관심·보유 종목 관련 뉴스가 아직 없어요.' : '뉴스 수집 중이에요 (3분마다 갱신).'}</p> : null}
        {items.map((n, i) => (
          <div key={`${n.title}-${i}`} className={`news-item ${n.tone}`}>
            <span className="time">{when(n)}</span>
            {fresh(n) && <b className="news-tag new">속보</b>}
            {n.tone === 'negative' && <b className="news-tag neg">악재</b>}
            {n.tone === 'positive' && <b className="news-tag pos">재료</b>}
            {n.symbol && (
              <button type="button" className="sym" onClick={() => onSelect(n.symbol)}>{n.symbol}</button>
            )}
            {n.url ? (
              <a href={n.url} target="_blank" rel="noreferrer noopener">{n.title}</a>
            ) : (
              <span>{n.title}</span>
            )}
            <small className="src">{n.source}{n.sentiment != null ? ` · 감성 ${n.sentiment > 0 ? '+' : ''}${n.sentiment}` : ''}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------- 손익 캘린더 ----------------
function PnlCalendar({ live, env }) {
  const nyMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).slice(0, 7);
  const [month, setMonth] = useState(nyMonth);
  const [data, setData] = useState(null);
  const [mode, setMode] = useState('equity'); // equity: 평가금액 변화, realized: 실현 손익
  const [sel, setSel] = useState(null);
  useEffect(() => {
    if (!live) return undefined;
    let stop = false;
    const load = () => api(`/api/bot/calendar?month=${month}`).then((d) => !stop && setData(d)).catch(() => null);
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [live, month]);
  const shift = (k) => {
    const [y, mo] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, mo - 1 + k, 1));
    setMonth(d.toISOString().slice(0, 7));
    setSel(null);
  };
  const [y, mo] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
  const nDays = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const byDate = Object.fromEntries((data?.days || []).map((d) => [d.date, d]));
  const cells = [...Array(first).fill(null), ...Array.from({ length: nDays }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const val = (d) => (mode === 'equity' ? d?.pnl : d?.realized);
  const maxAbs = Math.max(1, ...(data?.days || []).map((d) => Math.abs(val(d) || 0)));
  const T = data?.total;
  const today = nyMonth() === month ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) : null;
  const money = (v) => (v == null ? '' : `${v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.abs(v) >= 100 ? Math.round(Math.abs(v)) : Math.abs(v).toFixed(2)}`);
  const s = sel && byDate[sel];
  return (
    <section className="win cal-win">
      <h2 className="win-title">손익 캘린더 <span className="dim">{env === 'real' ? '실전' : env === 'demo' ? '모의투자' : ''} · 뉴욕 거래일 기준</span></h2>
      <div className="cal-head">
        <button type="button" onClick={() => shift(-1)} aria-label="이전 달">◀</button>
        <b>{y}년 {mo}월</b>
        <button type="button" onClick={() => shift(1)} aria-label="다음 달" disabled={month >= nyMonth()}>▶</button>
        <span className="cal-mode">
          {[['equity', '평가금액'], ['realized', '실현 손익']].map(([k, l]) => (
            <button key={k} type="button" className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>
          ))}
        </span>
      </div>
      {T && (
        <div className="cal-sum">
          <span>이번 달 <b style={{ color: tone(mode === 'equity' ? T.pnl : T.realized) }}>{money(mode === 'equity' ? T.pnl : T.realized) || '$0'}</b>{mode === 'equity' && T.pnlPct != null && <b style={{ color: tone(T.pnlPct) }}> ({T.pnlPct > 0 ? '+' : ''}{T.pnlPct}%)</b>}</span>
          <span className="dim">오른 날 {T.upDays} · 내린 날 {T.downDays} · 청산 {T.trades}건</span>
        </div>
      )}
      <div className="cal-grid" role="grid" aria-label={`${y}년 ${mo}월 손익`}>
        {['일', '월', '화', '수', '목', '금', '토'].map((w, i) => (
          <div key={w} className={`cal-w ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}`}>{w}</div>
        ))}
        {cells.map((k, i) => {
          if (!k) return <div key={`e${i}`} className="cal-d empty" />;
          const d = byDate[k];
          const v = val(d);
          const a = v == null ? 0 : Math.min(1, Math.abs(v) / maxAbs);
          const bg = v == null || v === 0 ? undefined : v > 0 ? `rgba(255,90,90,${0.12 + a * 0.45})` : `rgba(77,166,255,${0.12 + a * 0.45})`;
          return (
            <button key={k} type="button" role="gridcell" className={`cal-d ${k === today ? 'today' : ''} ${k === sel ? 'sel' : ''}`} style={{ background: bg }} onClick={() => setSel(k === sel ? null : k)} title={d ? `${k}\n평가금액 ${d.equity != null ? `$${d.equity}` : '-'}\n손익 ${money(d.pnl) || '-'} ${d.pnlPct != null ? `(${d.pnlPct}%)` : ''}\n실현 ${money(d.realized) || '-'} · 청산 ${d.trades}건` : k}>
              <span className="n">{+k.slice(8)}</span>
              {v != null && <span className="v">{money(v)}</span>}
              {mode === 'equity' && d?.pnlPct != null && <span className="p">{d.pnlPct > 0 ? '+' : ''}{d.pnlPct}%</span>}
              {mode === 'realized' && d?.trades > 0 && <span className="p">{d.wins}/{d.trades}승</span>}
            </button>
          );
        })}
      </div>
      {s && (
        <p className="cal-detail">
          <b>{sel}</b> 평가금액 {s.equity != null ? usd(s.equity) : '-'} (전 거래일 {s.base != null ? usd(s.base) : '-'}) · 손익 <b style={{ color: tone(s.pnl) }}>{money(s.pnl) || '-'}{s.pnlPct != null ? ` (${s.pnlPct > 0 ? '+' : ''}${s.pnlPct}%)` : ''}</b> · 실현 <b style={{ color: tone(s.realized) }}>{money(s.realized) || '-'}</b> · 청산 {s.trades}건 (승 {s.wins})
        </p>
      )}
      <p className="mj-legend">{data?.note || '봇이 계좌를 조회한 날부터 기록됩니다.'} 빨강 = 이익, 파랑 = 손실.</p>
    </section>
  );
}

// ---------------- messenger ----------------
function Messenger({ messages, avatars, onPick, offline }) {
  const listRef = useRef(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    const el = listRef.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [messages.length, follow]);
  const onScroll = () => {
    const el = listRef.current;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  };
  return (
    <section className="win msg-win">
      <h2 className="win-title">사내 메신저 <span className="dim">#트레이딩룸</span></h2>
      <div className="msg-ro">
        <span className="ro-badge">읽기 전용</span>
        <span className="dim">서버 봇이 실제로 한 일(신호, 결재, 주문, 체결, 손절)만 기록됩니다. 연출용 대사는 없습니다.</span>
      </div>
      <div className="msg-list" ref={listRef} onScroll={onScroll} aria-live="polite" role="log">
        {messages.length === 0 && <p className="empty">{offline ? '봇 서버에 연결되면 실제 이벤트(신호, 결재, 주문, 체결, 손절)가 여기에 올라옵니다.' : '아직 봇 이벤트가 없어요.'}</p>}
        {messages.map((m) => {
          if (m.sys)
            return (
              <div key={m.id} className={`msg sys ${m.mode ? 'modechg' : ''} ${m.override ? 'override' : ''} ${m.warn ? 'warn' : ''} ${m.suggest ? 'suggest' : ''} ${m.stier ? 'stier' : ''} ${m.side === '매수' ? 'buy' : m.side === '매도' ? 'sell' : ''}`}>
                <span className="time">{m.time}</span> {m.text}
              </div>
            );
          const a = AG[m.from];
          return (
            <div key={m.id} className="msg">
              <button className="ava" onClick={() => onPick(a.id)} aria-label={`${a.name} 상세 보기`}>
                <img src={avatars[a.id]} alt="" />
              </button>
              <div className="body">
                <div className="who" style={{ color: a.color }}>
                  {a.name} <span className="time">{m.time}</span>
                  {m.ai && <span className="ai-badge" title={`${m.ai.task} · 입력 ${m.ai.usage?.input ?? '-'} / 출력 ${m.ai.usage?.output ?? '-'} 토큰`}>AI · {m.ai.model}</span>}
                </div>
                <p>{m.text}</p>
                {m.kelly && <KellyCard k={m.kelly} />}
              </div>
            </div>
          );
        })}
      </div>
      {!follow && (
        <button className="msg-jump" onClick={() => setFollow(true)}>최신 기록으로 이동</button>
      )}
    </section>
  );
}

// ---------------- strategy & override panel ----------------
function Stepper({ label, value, onChange, step, min, max, fmt, color }) {
  const set = (v) => onChange(Math.round(Math.min(max, Math.max(min, v)) * 10) / 10);
  return (
    <div className="stepper">
      <span className="dim">{label}</span>
      <div className="st-ctl">
        <button type="button" onClick={() => set(value - step)} disabled={value <= min} aria-label={`${label} 낮추기`}>-</button>
        <b style={color ? { color } : undefined}>{fmt(value)}</b>
        <button type="button" onClick={() => set(value + step)} disabled={value >= max} aria-label={`${label} 높이기`}>+</button>
      </div>
    </div>
  );
}

function OverridePanel({ applied, onApply, onLiquidate, mode, hasPos, market, onOrder }) {
  const [draft, setDraft] = useState(applied);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setDraft(applied), [JSON.stringify(applied)]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const up = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <section className="win ovr">
      <h2 className="win-title">전략 & 오버라이드</h2>
      <p className="ovr-lead">수동 제어 중에는 봇이 신규 매수를 하지 않고(신호만 기록), 보유 종목은 아래 고정 손절·익절선으로 서버가 매도합니다.</p>
      <ManualOrder market={market} mode={mode} onOrder={onOrder} />

      <div className="ovr-group">
        <h3>매수</h3>
        <label className={`halt ${draft.buyHalt ? 'on' : ''}`}>
          <input type="checkbox" checked={draft.buyHalt} onChange={(e) => up('buyHalt')(e.target.checked)} />
          <span className="box" />
          <span>
            <b>신규 매수 전면 중단</b>
            <small>AI 모드로 돌아가도 해제 전까지 매수하지 않습니다</small>
          </span>
        </label>
        <div className="grid2">
          <Stepper label="종목당 최대 비중" value={draft.maxW} onChange={up('maxW')} step={1} min={1} max={50} fmt={(v) => `${v}%`} />
          <Stepper label="마감 전 매수 금지" value={draft.noEntryLastMin} onChange={up('noEntryLastMin')} step={5} min={0} max={120} fmt={(v) => `${v}분`} />
          <Stepper label="방주 QQQ 하락 기준" value={draft.arkDropPct} onChange={up('arkDropPct')} step={0.1} min={0.3} max={10} fmt={(v) => `-${v.toFixed(1)}%`} />
        </div>
      </div>

      <div className="ovr-group">
        <h3>비용을 넘는 거래만 <span className="dim">왕복 비용 {(2 * draft.feePct + draft.slipBufferPct).toFixed(2)}%</span></h3>
        <div className="grid2">
          <Stepper label="목표 수익 (진입 필터)" value={draft.minTargetPct} onChange={up('minTargetPct')} step={0.25} min={0.5} max={20} fmt={(v) => `+${v.toFixed(2)}%`} color={UP} />
          <Stepper label="AI 손절 기준" value={draft.lossCutPct} onChange={up('lossCutPct')} step={0.25} min={0.3} max={10} fmt={(v) => `-${v.toFixed(2)}%`} color={DOWN} />
          <Stepper label="최소 거래대금 (오늘)" value={draft.minDollarVolM} onChange={up('minDollarVolM')} step={1} min={0} max={1000} fmt={(v) => `$${v}M`} />
          <Stepper label="변동폭 상한" value={draft.maxMovePct} onChange={up('maxMovePct')} step={1} min={1} max={100} fmt={(v) => `${v}%`} />
          <Stepper label="보유 예정 시간" value={draft.holdBars} onChange={up('holdBars')} step={3} min={3} max={78} fmt={(v) => `${v * 5}분`} />
          <Stepper label="매매 수수료(편도)" value={draft.feePct} onChange={up('feePct')} step={0.01} min={0} max={2} fmt={(v) => `${v.toFixed(2)}%`} />
        </div>
        <p className="dim ovr-note">5분봉 ATR% × √(보유 봉 수)가 목표 수익 이상인 종목만 진입합니다. 목표에 닿으면 트레일링 익절을 시작하고, 스톱은 평단 + 왕복 비용 아래로 내려가지 않아요. 보유 시간의 2배가 지나도 비용을 못 넘기면 정리합니다.</p>
        <label className={`halt ${draft.confluenceBuy ? 'on' : ''}`}>
          <input type="checkbox" checked={!!draft.confluenceBuy} onChange={(e) => up('confluenceBuy')(e.target.checked)} />
          <span className="box" />
          <span>
            <b>A·B·C 중 {draft.confluenceMin ?? 2}개 이상 동시 신호면 켈리·AI 결재 없이 매수</b>
            <small>총 평가금액의 {draft.confluencePct ?? 10}%(종목당 한도 안), 0주면 1주. 셧다운·보유 한도·위험 상품·거래대금·변동폭 필터는 그대로 적용</small>
          </span>
        </label>
        <div className="grid2">
          <Stepper label="동시 신호 매수 비중" value={draft.confluencePct ?? 10} onChange={up('confluencePct')} step={1} min={1} max={50} fmt={(v) => `${v}%`} />
          <Stepper label="동시 신호 개수" value={draft.confluenceMin ?? 2} onChange={up('confluenceMin')} step={1} min={2} max={3} fmt={(v) => `${v}개 이상`} />
        </div>
        <label className={`halt ${draft.probeInDemo ? 'on' : ''}`}>
          <input type="checkbox" checked={draft.probeInDemo} onChange={(e) => up('probeInDemo')(e.target.checked)} />
          <span className="box" />
          <span>
            <b>모의투자 표본 수집 (${draft.probeUsd})</b>
            <small>비용 후 기대값이 0 이하여도 모의투자에서만 소액 진입해 실제 승률을 모읍니다. 실전에서는 동작하지 않음</small>
          </span>
        </label>
      </div>

      <div className="ovr-group">
        <h3>상대 거래량 · 뉴스 · 전략 자동 선택</h3>
        <div className="grid2">
          <Stepper label="탐색 RVol 하한" value={draft.rvolMin ?? 2} onChange={up('rvolMin')} step={0.5} min={0} max={20} fmt={(v) => (v ? `${v}배` : '끔')} />
          <Stepper label="매수 RVol 하한" value={draft.rvolMinEntry ?? 1.5} onChange={up('rvolMinEntry')} step={0.25} min={0} max={20} fmt={(v) => (v ? `${v}배` : '끔')} />
          <Stepper label="자동 끄기 판단 건수" value={draft.autoToggleMin ?? 30} onChange={up('autoToggleMin')} step={5} min={5} max={500} fmt={(v) => `${v}건`} />
        </div>
        <label className={`halt ${draft.newsCheck !== false ? 'on' : ''}`}>
          <input type="checkbox" checked={draft.newsCheck !== false} onChange={(e) => up('newsCheck')(e.target.checked)} />
          <span className="box" />
          <span>
            <b>사무엘 뉴스 확인</b>
            <small>매수 직전과 갭 후보 선정 때 Alpha Vantage(감성 점수)·야후·KIS 뉴스를 봅니다. 유상증자·공모·희석·역분할·상장폐지 같은 악재면 막고, 좋은 재료는 갭 후보 점수에 더합니다. 밀어서 사게 하지는 않습니다</small>
          </span>
        </label>
      </div>

      <div className="ovr-group">
        <h3>트랙 1 · 장전 갭 + 시가 범위 돌파</h3>
        <label className={`halt ${draft.gapScan !== false ? 'on' : ''}`}>
          <input type="checkbox" checked={draft.gapScan !== false} onChange={(e) => up('gapScan')(e.target.checked)} />
          <span className="box" />
          <span>
            <b>장전 갭 스캔 (뉴욕 08:30~09:25, 10분마다)</b>
            <small>상위 {draft.gapTopN ?? 5}개를 오늘의 후보로 두고 개장 후 시가 범위 돌파(D)만 봅니다. 실거래 {draft.minObservedForKelly ?? 20}건까지는 고정 비중 {draft.trackPct ?? 10}%, 이후 켈리</small>
          </span>
        </label>
        <div className="grid2">
          <Stepper label="갭 하한" value={draft.gapMinPct ?? 4} onChange={up('gapMinPct')} step={0.5} min={1} max={50} fmt={(v) => `+${v}%`} color={UP} />
          <Stepper label="갭 상한" value={draft.gapMaxPct ?? 25} onChange={up('gapMaxPct')} step={1} min={2} max={200} fmt={(v) => `+${v}%`} color={UP} />
          <Stepper label="최저가" value={draft.gapMinPrice ?? 5} onChange={up('gapMinPrice')} step={1} min={0.5} max={500} fmt={(v) => `$${v}`} />
          <Stepper label="최고가" value={draft.gapMaxPrice ?? 30} onChange={up('gapMaxPrice')} step={5} min={1} max={2000} fmt={(v) => `$${v}`} />
          <Stepper label="프리마켓 거래량" value={draft.gapMinPreVol ?? 500000} onChange={up('gapMinPreVol')} step={100000} min={0} max={1e8} fmt={(v) => `${Math.round(v / 1000)}K주`} />
          <Stepper label="또는 프리마켓 대금" value={draft.gapMinPreAmtM ?? 5} onChange={up('gapMinPreAmtM')} step={1} min={0} max={1000} fmt={(v) => `$${v}M`} />
          <Stepper label="시가총액 하한" value={draft.gapMinMcapM ?? 300} onChange={up('gapMinMcapM')} step={50} min={0} max={1e6} fmt={(v) => `$${v}M`} />
          <Stepper label="후보 개수" value={draft.gapTopN ?? 5} onChange={up('gapTopN')} step={1} min={1} max={10} fmt={(v) => `${v}개`} />
          <Stepper label="시가 범위" value={draft.orbBars ?? 3} onChange={up('orbBars')} step={1} min={1} max={6} fmt={(v) => `${v * 5}분`} />
          <Stepper label="진입 마감 (개장 후)" value={draft.orbEndMin ?? 90} onChange={up('orbEndMin')} step={15} min={20} max={390} fmt={(v) => `${v}분`} />
          <Stepper label="갭 후보 변동폭 상한" value={draft.gapMaxMovePct ?? 30} onChange={up('gapMaxMovePct')} step={1} min={5} max={100} fmt={(v) => `${v}%`} />
          <Stepper label="트랙 1 고정 비중" value={draft.trackPct ?? 10} onChange={up('trackPct')} step={1} min={1} max={50} fmt={(v) => `${v}%`} />
          <Stepper label="켈리 전환 건수" value={draft.minObservedForKelly ?? 20} onChange={up('minObservedForKelly')} step={5} min={0} max={200} fmt={(v) => `${v}건`} />
        </div>
      </div>

      <div className="ovr-group lockdown">
        <h3>계좌 보호 잠금</h3>
        <div className="grid2">
          <Stepper label="하루 손실 셧다운" value={draft.dailyLossPct} onChange={up('dailyLossPct')} step={0.5} min={0.5} max={50} fmt={(v) => `-${v.toFixed(1)}%`} color={DOWN} />
          <Stepper label="동시 보유 최대" value={draft.maxPositions} onChange={up('maxPositions')} step={1} min={1} max={50} fmt={(v) => `${v}종목`} />
        </div>
        <label className={`halt ${draft.flattenOnShutdown ? 'on' : ''}`}>
          <input type="checkbox" checked={draft.flattenOnShutdown} onChange={(e) => up('flattenOnShutdown')(e.target.checked)} />
          <span className="box" />
          <span>
            <b>셧다운 시 봇 포지션 청산</b>
            <small>끄면 신규 매수만 멈추고 보유 종목은 모세가 계속 관리합니다</small>
          </span>
        </label>
      </div>

      <div className="ovr-group">
        <h3>매도</h3>
        <div className="grid2">
          <Stepper label="수동 손절선" value={draft.stop} onChange={up('stop')} step={0.5} min={-20} max={-0.5} fmt={(v) => `${v.toFixed(1)}%`} color={DOWN} />
          <Stepper label="수동 익절선" value={draft.take} onChange={up('take')} step={0.5} min={0.5} max={50} fmt={(v) => `+${v.toFixed(1)}%`} color={UP} />
          <Stepper label="강제 손절선 (모든 모드)" value={draft.hardStopPct} onChange={up('hardStopPct')} step={0.5} min={0.5} max={20} fmt={(v) => `-${v.toFixed(1)}%`} color={DOWN} />
        </div>
        <label className={`halt ${draft.flattenAtClose ? 'on' : ''}`}>
          <input type="checkbox" checked={draft.flattenAtClose} onChange={(e) => up('flattenAtClose')(e.target.checked)} />
          <span className="box" />
          <span>
            <b>장 마감 5분 전 봇 포지션 청산</b>
            <small>봇이 연 포지션만 해당 (직접 산 종목 제외)</small>
          </span>
        </label>
        <div className="row liq">
          {!confirm ? (
            <button type="button" className="danger" disabled={mode !== 'open' || !hasPos} onClick={() => setConfirm(true)}>보유 전량 청산</button>
          ) : (
            <>
              <span>보유 종목을 모두 매도할까요?</span>
              <button type="button" className="danger" onClick={() => { onLiquidate(); setConfirm(false); }}>청산 집행</button>
              <button type="button" onClick={() => setConfirm(false)}>취소</button>
            </>
          )}
          {mode !== 'open' && !confirm && <small className="dim">정규장에만 가능</small>}
        </div>
      </div>

      <div className="ovr-foot">
        <button type="button" className="apply" disabled={!dirty} onClick={() => onApply(draft)}>{dirty ? '서버에 적용' : '적용됨'}</button>
        {dirty && <button type="button" className="ghost" onClick={() => setDraft(applied)}>되돌리기</button>}
        <span className="ovr-status"><span className="dim">설정은 서버(data/bot-settings.json)에 저장돼 브라우저를 꺼도 유지됩니다.</span></span>
      </div>
    </section>
  );
}

// ---------------- agent modal ----------------
function AgentModal({ id, onClose, officeRef, avatars, messages, reports, moses }) {
  const a = AG[id];
  const d = DEPT[a.dept];
  const o = officeRef.current;
  const ag = o.byId[id];
  const [, force] = useState(0);
  useEffect(() => {
    o.setSelected(id);
    const iv = setInterval(() => force((x) => x + 1), 500);
    const key = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => {
      o.setSelected(null);
      clearInterval(iv);
      window.removeEventListener('keydown', key);
    };
  }, [id]);
  const logs = messages.filter((m) => m.from === id).slice(-10).reverse();
  const rep = id === 'trB' && Object.keys(moses || {}).length ? { kind: 'moses', views: moses } : reports[id];

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal win" role="dialog" aria-modal="true" aria-label={`${a.name} 상세`} onClick={(e) => e.stopPropagation()}>
        <h2 className="win-title" style={{ color: a.color }}>{a.name} <span className="en">{a.en}</span></h2>
        <button className="close" onClick={onClose} aria-label="닫기" autoFocus>×</button>
        <div className="m-head">
          <img src={avatars[id]} alt="" className="m-ava" style={{ borderColor: a.color }} />
          <div>
            <div className="m-dept" style={{ '--c': d.color }}><i />{d.name} "{d.motto}" <span>{d.model}</span></div>
            <div className="m-role">{a.role}</div>
            <div className="m-status"><span className={`dot ${!ag.onDuty ? 'away' : ag.state === 'seat' ? (ag.busy ? 'busy' : 'on') : 'away'}`} />{statusText(ag)}</div>
          </div>
        </div>
        <p className="persona">{a.persona}</p>
        <h3>담당 업무</h3>
        <ul className="tasks">
          {a.tasks.map((x) => <li key={x}>{x}</li>)}
        </ul>
        <h3>근무표</h3>
        <ul className="duty">
          {MODES.map((md) => (
            <li key={md.id} className={a.duty[md.id] ? 'on' : ''}>
              <span className="no">{md.no}</span> {md.name}
              <b>{a.duty[md.id] ? '근무' : '휴식'}</b>
            </li>
          ))}
        </ul>
        {id === 'trB' && (
          <details className="prompt">
            <summary>모세의 매도 규칙 (server/bot/moses.js)</summary>
            <p>1) 강제 손절선: 평단 대비 설정값 이하면 즉시 손절 (모든 모드, AI 판단 없이).</p>
            <p>2) AI 모드: 실제 5분봉의 5·20봉 이평, MACD 히스토그램, RSI(14), 1호가 잔량 비율, QQQ 등락으로 하락 압력을 세고, 손실 폭과 겹치면 손절. 수익 1% 이상이면 고점 대비 트레일링 스톱(0.6~3%).</p>
            <p>3) 수동 모드: 사용자 고정 손절·익절선.</p>
            <p className="dim">매도는 안심 체결 엔진이 체결을 확인하며, 미체결이면 취소 후 더 낮은 가격으로 다시 냅니다 (손절: -0.2% → -1% → -3%).</p>
          </details>
        )}
        <h3>최근 보고</h3>
        <div className="report">{rep ? <Report r={rep} /> : <p className="dim">아직 이 에이전트의 실제 이벤트가 없어요.</p>}</div>

        <h3>대화 로그</h3>
        <ul className="m-log">
          {logs.length === 0 && <li className="dim">아직 남긴 메시지가 없어요.</li>}
          {logs.map((m) => (
            <li key={m.id}><span className="time">{m.time}</span>{m.text}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Report({ r }) {
  switch (r.kind) {
    case 'stier':
      return (
        <>
          <p className="r-title">{r.t} S티어 신호 ({r.time})</p>
          <ul className="mj-list">
            {r.results.map((x) => (
              <li key={x.id}>
                <div><b>{x.id} {STRATEGIES[x.id].name}</b> <span className={`mj ${x.fired ? 'mj-exit' : 'mj-calm'}`}>{x.fired ? '충족' : '미충족'}</span></div>
                <small>{x.fired ? x.detail : x.reason || x.detail}</small>
              </li>
            ))}
          </ul>
        </>
      );
    case 'kelly':
      return (
        <>
          <p className="r-title">켈리 사이징 ({r.time})</p>
          <KellyCard k={r} />
        </>
      );
    case 'moses':
      return (
        <>
          <p className="r-title">보유 종목 매도 판단 (실시간)</p>
          <ul className="mj-list">
            {Object.entries(r.views).map(([code, j]) => (
              <li key={code}>
                <div><b>{code}</b> <span style={{ color: tone(j.pnlPct) }}>{j.pnlPct >= 0 ? '+' : ''}{j.pnlPct.toFixed(2)}%</span> <span className={`mj mj-${levelOf(j)}`}>{j.hard ? '강제 손절' : ACTION_LABEL[j.action]}</span> <span className="dim">신뢰도 {Math.round(j.confidence * 100)}%</span></div>
                <small>{j.trailStop ? `트레일링 스톱 ${usd(j.trailStop)}. ` : ''}{j.reasons.join(', ')}</small>
              </li>
            ))}
          </ul>
        </>
      );
    default:
      return (
        <>
          <p className="r-title">최근 이벤트 ({r.time})</p>
          <p style={{ whiteSpace: 'pre-line' }}>{r.text}</p>
        </>
      );
  }
}

