// 전략 명부: 후보 자리(active) · 대기열(queued) · 은퇴(retired, 영구 결번)
//   D는 명부 밖 (트랙 1 기본 전략, 실거래 기준 자동 끄기만 적용)
//   은퇴하면 그 알파벳은 다시 쓰지 않고, 대기열 맨 앞 전략이 빈자리에 들어온다.
import fs from 'node:fs';
import path from 'node:path';
import { STRATEGY_ORDER } from '../../src/strategy/candidates.js';

const FILE = path.resolve(process.env.BOT_REGISTRY_FILE || 'data/strategy-registry.json');
export const DEFAULT_SLOTS = 10;
const QUEUED_AT_START = ['L', 'M', 'N'];

export function createRegistry({ today }) {
  let R;
  try {
    R = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    R = null;
  }
  if (!R || !R.s) {
    const d = today();
    R = { slots: DEFAULT_SLOTS, s: {} };
    for (const id of STRATEGY_ORDER) R.s[id] = QUEUED_AT_START.includes(id) ? { status: 'queued' } : { status: 'active', since: d };
  }
  // 코드에 새로 추가된 전략은 대기열 끝에 붙임
  for (const id of STRATEGY_ORDER) if (!R.s[id]) R.s[id] = { status: 'queued' };
  const save = () => {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(R, null, 2));
    } catch {
      /* 무시 */
    }
  };
  const byStatus = (st) => STRATEGY_ORDER.filter((id) => R.s[id]?.status === st);
  // 빈자리 채우기
  const fill = () => {
    const added = [];
    while (byStatus('active').length < R.slots && byStatus('queued').length) {
      const id = byStatus('queued')[0];
      R.s[id] = { status: 'active', since: today() };
      added.push(id);
    }
    return added;
  };
  fill();
  save();
  return {
    active: () => byStatus('active'),
    queued: () => byStatus('queued'),
    retired: () => byStatus('retired').map((id) => ({ id, ...R.s[id] })),
    since: (id) => R.s[id]?.since || null,
    view: () => ({ slots: R.slots, active: byStatus('active'), queued: byStatus('queued'), retired: byStatus('retired').map((id) => ({ id, ...R.s[id] })) }),
    /** 은퇴 → 결번. 대기열 맨 앞이 들어온 목록을 돌려줌 */
    retire(id, reason) {
      if (R.s[id]?.status !== 'active') return [];
      R.s[id] = { ...R.s[id], status: 'retired', retiredAt: today(), reason };
      const added = fill();
      save();
      return added;
    },
  };
}
