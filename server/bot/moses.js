// 모세: 보유 종목 매도 판단 (서버 탑재, 실데이터만 사용)
//
// 1) 강제 손절선 (하드 스톱): 평단 대비 -HARD_STOP_PCT% 이하면 다른 조건과 무관하게 즉시 손절.
//    AI 판단·수동 모드·네트워크 상태와 상관없이 서버가 집행한다.
// 2) AI 모드: 실제 5분봉(이평·MACD·RSI) + 실제 1호가 잔량 비율 + 지수(QQQ) 하락 압력으로 판단
// 3) 수동 모드: 사용자가 정한 고정 손절/익절선
import { rsiSeries, sma, macdHist } from '../../src/strategy/sTier.js';
import { roundUsPrice } from '../kis/exchanges.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * @param {{symbol, price, avg, qty, peak, trimmed, candles:Array<{c:number}>, book?:{vbid:number, vask:number}|null, market:{stress:boolean, qqqChangePct:number|null}}} x
 * @param {{mode:'auto'|'manual', hardStopPct:number, stopPct:number, takePct:number,
 *          minTargetPct?:number, lossCutPct?:number, costPct?:number, maxHoldMin?:number}} rules
 *   minTargetPct: 이 수익부터 트레일링 시작 (진입 필터의 목표와 같음)
 *   lossCutPct  : AI 손절 기준 손실폭 (백테스트 손절과 같음)
 *   costPct     : 왕복 비용. 트레일링 스톱은 평단 + 비용 아래로 내려가지 않는다 (수익 보호)
 *   maxHoldMin  : 봇 포지션 보유 시간 한도 (x.botPosition일 때만). 넘으면 비용 이상 수익이 아니면 정리
 */
export function judgeExit(x, rules) {
  const pnl = x.price / x.avg - 1;
  const peak = Math.max(x.peak || x.avg, x.price);
  const base = { pnlPct: pnl * 100, peak, trailStop: null, pressure: 0, reasons: [], inputs: {} };

  // 1) 하드 스톱
  if (pnl * 100 <= -Math.abs(rules.hardStopPct)) {
    return { ...base, action: 'EXIT_STOP', urgency: 'stop', hard: true, confidence: 1, reasons: [`강제 손절선 -${rules.hardStopPct}% 도달 (${(pnl * 100).toFixed(2)}%)`] };
  }

  // 1-b) 진입 때 정한 손절가 (예: 갭 후보 시가 범위 저가)
  if (x.stopPrice > 0 && x.price <= x.stopPrice) {
    return { ...base, action: 'EXIT_STOP', urgency: 'stop', confidence: 0.95, reasons: [`진입 손절가 $${x.stopPrice} 이탈 (${x.stopReason || '시가 범위 저가'})`] };
  }

  // 3) 수동 모드: 고정선
  if (rules.mode === 'manual') {
    if (pnl * 100 <= rules.stopPct) return { ...base, action: 'EXIT_STOP', urgency: 'stop', confidence: 1, reasons: [`사용자 손절선 ${rules.stopPct}% 도달`] };
    if (pnl * 100 >= rules.takePct) return { ...base, action: 'EXIT_TAKE', urgency: 'take', confidence: 1, reasons: [`사용자 익절선 +${rules.takePct}% 도달`] };
    return { ...base, action: 'HOLD', confidence: 1, reasons: [`사용자 지침 범위 안 (${rules.stopPct}% ~ +${rules.takePct}%)`] };
  }

  const cut = rules.lossCutPct ?? 1.5;
  const target = (rules.minTargetPct ?? 1.5) / 100;
  const cost = (rules.costPct ?? 0.6) / 100;

  // 시간 손절: 진입 필터가 기대한 시간(보유 예정 봉 수의 2배)이 지나도 비용을 못 넘기면 정리
  if (x.botPosition && rules.maxHoldMin && x.ageMin >= rules.maxHoldMin && pnl < cost) {
    return { ...base, action: pnl < 0 ? 'EXIT_STOP' : 'EXIT_TAKE', urgency: 'take', confidence: 0.7, reasons: [`보유 ${Math.round(x.ageMin)}분 경과, 수익 ${(pnl * 100).toFixed(2)}%가 비용 ${(cost * 100).toFixed(2)}% 미만 (시간 손절)`] };
  }

  // 2) AI 판단 (실데이터 지표)
  const closes = [...x.candles.map((k) => k.c), x.price];
  if (closes.length < 21) return { ...base, action: 'HOLD', confidence: 0.3, reasons: [`5분봉 ${x.candles.length}개 수집 중: 지표 판단 보류 (강제 손절선만 감시)`] };
  const ma5 = sma(closes, 5);
  const ma20 = sma(closes, 20);
  const rsiArr = rsiSeries(closes, 14);
  const rsi = rsiArr[rsiArr.length - 1];
  const hist = macdHist(closes);
  const ratio = x.book && x.book.vbid > 0 && x.book.vask > 0 ? x.book.vbid / x.book.vask : null;
  const trend = ma5 > ma20 ? 1 : -1;
  const mom = hist == null ? 0 : hist > 0 ? 1 : -1;
  const flow = ratio == null ? 0 : ratio > 1.3 ? 1 : ratio < 0.7 ? -1 : 0; // 1호가 잔량만 보므로 기준을 넓게
  const reasons = [];
  if (trend < 0) reasons.push('5봉선이 20봉선 아래 (역배열)');
  if (mom < 0) reasons.push('MACD 히스토그램 음수');
  if (flow < 0) reasons.push(`1호가 잔량 매도 우위 (${ratio.toFixed(2)})`);
  if (flow > 0) reasons.push(`1호가 잔량 매수 우위 (${ratio.toFixed(2)})`);
  if (x.market?.stress) reasons.push(`지수(QQQ) 하락 압력 ${x.market.qqqChangePct?.toFixed(2)}%`);
  const pressure = (trend < 0 ? 1 : 0) + (mom < 0 ? 1 : 0) + (flow < 0 ? 1 : 0) + (x.market?.stress ? 1 : 0) + (rsi != null && rsi < 35 ? 0.5 : 0);
  const loss = -pnl * 100;
  const inputs = { ma5, ma20, rsi, macdHist: hist, bookRatio: ratio, qqqChangePct: x.market?.qqqChangePct ?? null };
  const b2 = { ...base, pressure, reasons, inputs };

  if ((loss >= cut * 0.5 && pressure >= 3) || (loss >= cut && pressure >= 1) || loss >= cut * 1.5) {
    return { ...b2, action: 'EXIT_STOP', urgency: 'stop', confidence: clamp(0.55 + pressure * 0.1, 0, 0.95), reasons: [`손실 ${loss.toFixed(2)}%에 하락 압력 ${pressure}개 겹침`, ...reasons] };
  }
  if (pnl >= target || (x.peak && x.peak / x.avg - 1 >= target)) {
    let trail = 0.012;
    if (trend > 0 && mom > 0) trail += 0.008;
    if (flow > 0) trail += 0.004;
    if (rsi > 72) trail -= 0.005;
    if (flow < 0) trail -= 0.004;
    trail = clamp(trail, 0.006, 0.03);
    // 트레일링은 평단 + 왕복 비용 아래로 내려가지 않음 (목표에 닿은 거래를 손실로 끝내지 않기)
    const trailStop = roundUsPrice(Math.max(peak * (1 - trail), x.avg * (1 + cost)), 'down');
    const r2 = [`트레일링 폭 ${(trail * 100).toFixed(1)}% (고점 $${peak.toFixed(2)})`, ...reasons];
    if (x.price <= trailStop) return { ...b2, action: 'EXIT_TAKE', urgency: 'take', trailStop, confidence: 0.8, reasons: [`고점 대비 ${((1 - x.price / peak) * 100).toFixed(2)}% 되밀림`, ...r2] };
    if (rsi > 78 && flow < 0 && !x.trimmed && x.qty >= 2) return { ...b2, action: 'TRIM', urgency: 'take', trailStop, confidence: 0.7, reasons: [`RSI ${rsi.toFixed(0)} 과열에 매도 우위`, ...r2] };
    return { ...b2, action: 'HOLD', trailStop, confidence: clamp(0.6 + (trend + mom) * 0.1, 0.4, 0.9), reasons: r2 };
  }
  return { ...b2, action: 'HOLD', confidence: clamp(0.7 - pressure * 0.1, 0.3, 0.9), reasons: reasons.length ? reasons : ['특이 신호 없음'] };
}

export const ACTION_LABEL = { HOLD: '보유', TRIM: '부분 익절', EXIT_STOP: '손절', EXIT_TAKE: '익절' };
