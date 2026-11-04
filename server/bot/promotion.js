// 후보 전략 승격 (Holly식): 가상 거래 성적이 기준을 모두 통과한 (전략, 청산 규칙)만 S티어로 올린다.
//   기준 (모두 만족):  최근 가상 거래 ≥ minTrades(40)건 · 비용 뺀 기대값 ≥ minExp(+0.3%) · PF ≥ minPF(1.3)
//                      · 앞쪽 절반과 뒤쪽 절반 모두 기대값 플러스 (한 시기의 운을 거른다)
//                      · 서로 다른 거래일 ≥ minDays(15)일 (운 좋은 한 주로 승격되지 않게)
//   최근 window(80)건으로 계속 다시 계산하므로, 성적이 나빠지면 자동으로 내려간다.
//   사용자 모드: auto(기준대로) / on(무조건 승격, 최고 성적 청산 규칙) / off(관찰만)
import { shadowRows, summarize, shadowYmd } from './journal.js';
import { EXIT_PROFILES } from '../../src/strategy/candidates.js';
import { ALL_STRATEGIES } from '../../src/strategy/sTier.js';

// 승격 대상: D(트랙 1, 기본 활성)를 뺀 전부 (실제로는 명부의 후보 자리 전략만 평가)
export const PROMOTABLE = ['A', 'B', 'C', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
export const DIRS = ['강세', '보합', '약세'];
// 예전 A·B·C 가상 거래(청산 규칙 표시 없음)는 당시 목표·손절이 같은 청산 규칙으로 센다
const profileOf = (t) => t.profile || Object.values(EXIT_PROFILES).find((p) => p.tpPct === t.tpPct && p.slPct === t.slPct)?.id || null;

export function evaluatePromotions(env, { ids = PROMOTABLE, modes = {}, minTrades = 40, minExp = 0.3, minPF = 1.3, minDays = 15, window = 80 } = {}) {
  const sh = shadowRows().filter((t) => (!t.env || t.env === env) && (t.kind === 'candidate' || (!t.kind && (t.strategies || []).some((x) => 'ABC'.includes(x)))));
  const out = {};
  const judge = (rows) => {
    const all = summarize(rows);
    const half = Math.floor(rows.length / 2);
    const h1 = summarize(rows.slice(0, half));
    const h2 = summarize(rows.slice(half));
    const days = new Set(rows.map(shadowYmd).filter(Boolean)).size;
    const checks = {
      trades: rows.length >= minTrades,
      exp: (all.expectancyPct ?? -1) >= minExp,
      pf: (all.profitFactor ?? (all.losses === 0 && all.wins > 0 ? 99 : 0)) >= minPF,
      halves: rows.length >= 2 && (h1.expectancyPct ?? -1) > 0 && (h2.expectancyPct ?? -1) > 0,
      days: days >= minDays,
    };
    return { ...all, days, h1: h1.expectancyPct, h2: h2.expectancyPct, checks, pass: Object.values(checks).every(Boolean) };
  };
  for (const id of ids) {
    if (!ALL_STRATEGIES[id]) continue;
    const profiles = {};
    for (const pid of Object.keys(EXIT_PROFILES)) {
      const rows = sh.filter((t) => (t.kind === 'candidate' ? t.strategies?.[0] === id : t.strategies.includes(id)) && profileOf(t) === pid).slice(-window);
      profiles[pid] = judge(rows);
      // 장세 한정: 매수 순간의 QQQ 방향(강세/보합/약세)별로도 같은 기준을 본다
      const allRows = sh.filter((t) => (t.kind === 'candidate' ? t.strategies?.[0] === id : t.strategies.includes(id)) && profileOf(t) === pid);
      profiles[pid].dirPass = DIRS.filter((d) => judge(allRows.filter((t) => t.regime?.dir === d).slice(-window)).pass);
    }
    const mode = modes[id] || 'auto';
    const ranked = Object.entries(profiles).sort((a, b) => (b[1].expectancyPct ?? -99) - (a[1].expectancyPct ?? -99));
    const bestPass = ranked.find(([, p]) => p.pass);
    let status = 'watch';
    let profile = null;
    let dirs = null;
    let reason;
    const dirBest = !bestPass && ranked.find(([, p]) => p.dirPass?.length);
    if (mode === 'off') reason = '사용자가 관찰만으로 고정';
    else if (mode === 'on') {
      status = 'promoted';
      profile = (bestPass || ranked[0])[0];
      reason = `사용자가 승격으로 고정 (청산 ${profile})`;
    } else if (bestPass) {
      status = 'promoted';
      profile = bestPass[0];
      const p = bestPass[1];
      reason = `승격: 청산 ${profile} 가상 ${p.trades}건 ${p.days}일 기대값 +${p.expectancyPct}% PF ${p.profitFactor ?? '∞'} (앞 +${p.h1}% / 뒤 +${p.h2}%)`;
    } else if (dirBest) {
      status = 'regime';
      profile = dirBest[0];
      dirs = dirBest[1].dirPass;
      reason = `장세 한정 승격: 청산 ${profile} · ${dirs.join('/')}일 때만 매수`;
    } else {
      const [pid, p] = ranked[0];
      const miss = [!p.checks.trades && `${p.trades}/${minTrades}건`, !p.checks.days && `${p.days}/${minDays}일`, p.checks.trades && !p.checks.exp && `기대값 ${p.expectancyPct}%`, p.checks.trades && !p.checks.pf && `PF ${p.profitFactor ?? '-'}`, p.checks.trades && !p.checks.halves && '앞뒤 절반 중 마이너스'].filter(Boolean);
      reason = `관찰 중 (가장 나은 청산 ${pid}: ${miss.join(', ') || '기준 미달'})`;
    }
    out[id] = { id, name: ALL_STRATEGIES[id].name, mode, status, profile, dirs, exit: profile ? EXIT_PROFILES[profile] : null, reason, profiles };
  }
  return out;
}

/**
 * 은퇴 판정 (모두 만족하면 은퇴 → 영구 결번)
 *   부진: 가장 나은 청산의 가상 ≥ minN(100)건 · ≥ minDays(30)일 · 기대값 ≤ maxExp(−0.1%) · 최근 recent(50)건도 마이너스
 *   신호 부족: 후보 자리에 든 뒤 봇 가동 sparseDays(60)일이 지났는데 가장 많은 청산도 sparseMin(40)건 미만
 *   가능성 없음: 봇 가동 staleDays(90)일이 지났는데 승격도 장세 한정 승격도 못 받음
 *   승격·장세 한정 승격 중이거나 사용자가 '승격'으로 고정한 전략은 은퇴하지 않는다.
 * @param elapsed (id) => 후보 자리에 든 뒤 봇이 돌아간 거래일 수
 */
export function evaluateRetirements(env, { ids, promo = {}, modes = {}, elapsed, minN = 100, minDays = 30, maxExp = -0.1, recent = 50, sparseDays = 60, sparseMin = 40, staleDays = 90 } = {}) {
  const sh = shadowRows().filter((t) => (!t.env || t.env === env) && t.kind === 'candidate');
  const out = [];
  for (const id of ids) {
    const p = promo[id];
    if (!p || p.status === 'promoted' || p.status === 'regime' || modes[id] === 'on') continue;
    const per = Object.keys(EXIT_PROFILES).map((pid) => {
      const rows = sh.filter((t) => t.strategies?.[0] === id && t.profile === pid);
      const all = summarize(rows);
      return { pid, n: rows.length, days: new Set(rows.map(shadowYmd).filter(Boolean)).size, exp: all.expectancyPct, recentExp: summarize(rows.slice(-recent)).expectancyPct };
    });
    const judged = per.filter((x) => x.n >= 40);
    const best = judged.sort((a, b) => (b.exp ?? -99) - (a.exp ?? -99))[0];
    const days = elapsed(id);
    const maxN = Math.max(0, ...per.map((x) => x.n));
    if (best && best.n >= minN && best.days >= minDays && (best.exp ?? 0) <= maxExp && (best.recentExp ?? 0) < 0) out.push({ id, kind: 'poor', reason: `부진: 가장 나은 청산 ${best.pid}도 ${best.n}건 ${best.days}일 기대값 ${best.exp}% · 최근 ${Math.min(recent, best.n)}건 ${best.recentExp}%` });
    else if (days >= sparseDays && maxN < sparseMin) out.push({ id, kind: 'sparse', reason: `신호 부족: ${days}거래일 동안 최대 ${maxN}건` });
    else if (days >= staleDays) out.push({ id, kind: 'stale', reason: `가능성 없음: ${days}거래일 동안 승격 못 함` });
  }
  return out;
}
