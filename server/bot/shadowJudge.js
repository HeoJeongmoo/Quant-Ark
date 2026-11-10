// 가상 거래 한 건을 진입 뒤 5분봉으로 끝까지 따라가 판정 (보수적 체결 가정)
//   진입: 신호 다음 봉 시가 + eSlip. 시가가 신호가 +0.3%(실제 매수 지정가 상한)를 넘으면 미체결
//   손절: 손절가 − sSlip, 시가부터 손절가 아래로 갭이면 시가 − sSlip / 한 봉에서 손절·목표 모두 닿으면 손절
//   목표: 고가가 목표가를 0.05% 넘어야 체결
//   마감: 실제 봇처럼 마감 5분 전(15:55, 조기폐장 12:55)에 정리 → 그 봉 시가 − eSlip (그 봉의 손절·목표는 보지 않음)
//         마감 봉이 빠진 채 시간외·다음 날 봉이 오면, 시간외 가격으로 손절·목표를 보지 않고 마지막 정규장 봉 종가로 정리
/**
 * @returns {{kind:'open'|'missed'|'closed', why?:string, entry?:number, exit?:number, bars?:number, closedAtMs?:number, fill?:number}}
 */
export function judgeShadow(x, after, { eSlip = 0.001, sSlip = 0.002, entryDay, closeAt = '16:00' } = {}) {
  const lastBarAt = closeAt === '13:00' ? '12:55' : '15:55';
  let entry = x.fill || null;
  let n = 0;
  let lastReg = null;
  for (const k of after) {
    const day = k.time ? k.time.slice(0, 10) : null;
    const hm = k.time ? k.time.slice(11, 16) : '';
    if (day && entryDay && (day > entryDay || hm >= closeAt || hm < '09:30')) {
      if (entry == null) return { kind: 'missed', why: '미체결 (마감 직전 신호)', closedAtMs: k.t };
      return { kind: 'closed', why: '장 마감', entry, exit: (lastReg ? lastReg.c : entry) * (1 - eSlip), bars: n, closedAtMs: lastReg ? lastReg.t + 5 * 60_000 : k.t };
    }
    lastReg = k;
    if (hm >= lastBarAt) {
      if (entry == null) return { kind: 'missed', why: '미체결 (마감 직전 신호)', closedAtMs: k.t };
      return { kind: 'closed', why: '장 마감', entry, exit: k.o * (1 - eSlip), bars: n, closedAtMs: k.t };
    }
    if (entry == null) {
      if (k.o > x.entry * 1.003) return { kind: 'missed', why: '미체결 (시가가 매수 상한 +0.3% 초과)', closedAtMs: k.t };
      entry = k.o * (1 + eSlip);
    }
    n++;
    const stop = entry * (1 - x.slPct / 100);
    const target = entry * (1 + x.tpPct / 100);
    let exit = null;
    let why = '';
    if (k.o <= stop && n > 1) [exit, why] = [k.o * (1 - sSlip), '손절 (갭)'];
    else if (k.l <= stop) [exit, why] = [stop * (1 - sSlip), '손절'];
    else if (k.h >= target * 1.0005) [exit, why] = [target, '목표'];
    else if (n >= x.holdBars) [exit, why] = [k.c * (1 - eSlip), '보유 시간 만료'];
    if (exit != null) return { kind: 'closed', why, entry, exit, bars: n, closedAtMs: k.t + 5 * 60_000 };
  }
  return { kind: 'open', fill: entry };
}
