// 토큰 수·비용 표시용 포맷 (실제 사용량은 서버 /api/usage 에서 받는다)
export const fmtTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n || 0)));
export const fmtUsd = (x) => (x >= 1 ? `$${x.toFixed(2)}` : x >= 0.01 ? `$${x.toFixed(3)}` : `$${(x || 0).toFixed(4)}`);
