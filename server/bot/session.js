// 뉴욕 증시 시간표 (서머타임 자동: America/New_York 시간대 사용)
//   장전 07:00–09:30 / 정규장 09:30–16:00 (조기폐장일 13:00) / 그 외 장후·야간 / 주말·휴장일
// 휴장일은 NYSE 공식 일정 기준. 다른 날을 추가하려면 .env US_MARKET_HOLIDAYS=2027-12-31,... 
const HOLIDAYS = new Set([
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
  ...(process.env.US_MARKET_HOLIDAYS || '').split(',').map((s) => s.trim()).filter(Boolean),
]);
const EARLY_CLOSE = new Set(['2026-11-27', '2026-12-24', '2027-11-26', ...(process.env.US_MARKET_EARLY_CLOSE || '').split(',').map((s) => s.trim()).filter(Boolean)]);

// 테스트용: BOT_TIME_OFFSET_MS 로 봇 시계를 옮길 수 있다 (실사용 시 비워 둘 것)
const OFFSET = Number(process.env.BOT_TIME_OFFSET_MS || 0);
export const clockNow = () => Date.now() + OFFSET;

const FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', timeZoneName: 'short' });

export function nyParts(ms = clockNow()) {
  const p = Object.fromEntries(FMT.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const hour = +p.hour % 24;
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    ymdCompact: `${p.year}${p.month}${p.day}`,
    hour,
    minute: +p.minute,
    second: +p.second,
    min: hour * 60 + +p.minute,
    weekday: p.weekday, // Mon..Sun
    tz: p.timeZoneName, // EST | EDT
  };
}

/**
 * @returns {{phase:'pre'|'open'|'post'|'closed', reason:string, ny:ReturnType<typeof nyParts>, closeMin:number, minutesToClose:number|null}}
 *   pre: 장전 준비 / open: 정규장(주문 가능) / post: 장 마감 후 정산·야간 / closed: 주말·휴장일
 */
export function marketPhase(ms = clockNow()) {
  const ny = nyParts(ms);
  const closeMin = EARLY_CLOSE.has(ny.ymd) ? 13 * 60 : 16 * 60;
  if (ny.weekday === 'Sat' || ny.weekday === 'Sun') return { phase: 'closed', reason: '주말 휴장', ny, closeMin, minutesToClose: null };
  if (HOLIDAYS.has(ny.ymd)) return { phase: 'closed', reason: '미국 증시 휴장일', ny, closeMin, minutesToClose: null };
  if (ny.min >= 9 * 60 + 30 && ny.min < closeMin) return { phase: 'open', reason: closeMin < 960 ? '정규장 (조기폐장 13:00)' : '정규장', ny, closeMin, minutesToClose: closeMin - ny.min };
  if (ny.min >= 7 * 60 && ny.min < 9 * 60 + 30) return { phase: 'pre', reason: '장 시작 전', ny, closeMin, minutesToClose: null };
  return { phase: 'post', reason: ny.min >= closeMin ? '장 마감 후' : '야간', ny, closeMin, minutesToClose: null };
}

// 5분봉 경계: 현재 진행 중인 봉의 시작 시각(ms)
export const barStart = (ms = clockNow(), intervalMin = 5) => Math.floor(ms / (intervalMin * 60000)) * intervalMin * 60000;
