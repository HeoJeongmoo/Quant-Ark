// 플래너·공부방이 함께 쓰는 저장소 (화면을 바꿔도 같은 사본 하나)
//   서버 data/planner.json ↔ 브라우저 사본(localStorage). 고치고 0.8초 뒤 저장, 저장은 한 번에 하나씩.
import { useEffect, useSyncExternalStore } from 'react';

const LS_DATA = 'qo-planner-cache';
let snap = {
  data: (() => {
    try {
      return JSON.parse(localStorage.getItem(LS_DATA)) || {};
    } catch {
      return {};
    }
  })(),
  sync: { s: 'load', t: '불러오는 중' },
};
const subs = new Set();
let apiFn = null;
let base;
let dirty = false;
let timer = null;
let inflight = false;
let pending = null;
let lastPull = 0;

const emit = (patch) => {
  snap = { ...snap, ...patch };
  subs.forEach((f) => f());
};

async function pull() {
  if (!apiFn) return;
  lastPull = Date.now();
  try {
    const r = await apiFn('/api/planner', { ms: 10000 });
    base = r.updatedAt || undefined;
    if (!dirty && !inflight) emit({ data: r.data || {}, sync: { s: 'ok', t: '저장됨' } });
  } catch {
    emit({ sync: { s: 'bad', t: '서버 연결 안 됨 · 이 기기에만 저장' } });
  }
}

async function push(d) {
  if (inflight) {
    pending = d;
    return;
  }
  inflight = true;
  try {
    const r = await apiFn('/api/planner', { method: 'PUT', body: { data: d, base }, ms: 15000 });
    base = r.updatedAt;
    if (!pending) {
      dirty = false;
      emit({ sync: { s: 'ok', t: '저장됨' } });
    }
  } catch (e) {
    pending = null;
    dirty = false;
    if (/먼저 수정|409/.test(e.message)) {
      emit({ sync: { s: 'warn', t: '다른 기기에서 먼저 고침 · 새로 불러옴' } });
      inflight = false;
      pull();
    } else emit({ sync: { s: 'bad', t: '저장 실패 · 이 기기에만 저장됨' } });
  } finally {
    inflight = false;
    const next = pending;
    pending = null;
    if (next) push(next);
  }
}

export function update(fn) {
  const next = fn(structuredClone(snap.data));
  try {
    localStorage.setItem(LS_DATA, JSON.stringify(next));
  } catch {
    /* 무시 */
  }
  dirty = true;
  emit({ data: next, sync: { s: 'busy', t: '저장 중' } });
  clearTimeout(timer);
  timer = setTimeout(() => push(next), 800);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !dirty && subs.size) pull();
  });
}

export function usePlannerStore(api) {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => snap,
  );
  useEffect(() => {
    apiFn = api;
    if (!dirty && Date.now() - lastPull > 3000) pull();
  }, [api]);
  return { data: s.data, sync: s.sync, update };
}

// 트레이딩 화면(오피스 꾸미기 반영)처럼 화면 없이 한 번 읽을 때
export function peekPlanner(api) {
  apiFn = apiFn || api;
  return pull().then(() => snap.data);
}
export const plannerSnapshot = () => snap.data;
