// 표시용 포맷터 (데이터 생성 없음)
export function clockText(min) {
  const h = Math.floor(min / 60);
  const mm = Math.floor(min % 60);
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
export const usd = (n) => (n == null || !Number.isFinite(Number(n)) ? '-' : `${n < 0 ? '-' : ''}$${Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const pct = (n, d = 2) => (n == null || !Number.isFinite(n) ? '-' : `${n > 0 ? '+' : ''}${(n * 100).toFixed(d)}%`);
