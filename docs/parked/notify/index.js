// 휴대폰 알림: 텔레그램 봇 또는 ntfy 앱으로 중요한 봇 이벤트만 보낸다
//   .env  TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID   (텔레그램, 추천: 나만 받음)
//         NTFY_TOPIC (+ NTFY_URL)                 (ntfy 앱, 가입 없음: 주제 이름을 아무도 모를 긴 문자열로)
//         NOTIFY_LEVEL = important | normal | all  (기본 normal)
//   키·토큰은 서버에서만 쓰고 화면이나 로그에 그대로 내보내지 않는다.
const LEVELS = {
  important: new Set(['fill', 'shutdown', 'emergency', 'alarm', 'order-error']),
  normal: new Set(['fill', 'shutdown', 'emergency', 'alarm', 'order-error', 'exit', 'strategy', 'report', 'recover', 'ark', 'gap']),
  all: null, // 전부 (gate·ai·discover 같은 잦은 이벤트는 그래도 뺌)
};
const NOISY = new Set(['gate', 'ai', 'ai-error', 'discover', 'kelly', 'settings', 'phase', 'boot', 'journal', 'order', 'order-cancel', 'order-dry', 'user', 'error']);
const EMOJI = { fill: '✅', shutdown: '⛔', emergency: '🚨', alarm: '⚠️', 'order-error': '⚠️', exit: '📤', strategy: '🏅', report: '📊', recover: '🟢', ark: '🛶', gap: '🌅', signal: '📡' };
const PRIO = { shutdown: 5, emergency: 5, alarm: 5, fill: 4, 'order-error': 4, exit: 3 };

export function createNotifier({ bus, journal, fetchImpl = fetch } = {}) {
  const tgToken = process.env.TELEGRAM_BOT_TOKEN || '';
  const tgChat = process.env.TELEGRAM_CHAT_ID || '';
  const ntfyTopic = process.env.NTFY_TOPIC || '';
  const ntfyBase = (process.env.NTFY_URL || 'https://ntfy.sh').replace(/\/$/, '');
  const level = LEVELS[process.env.NOTIFY_LEVEL] !== undefined ? process.env.NOTIFY_LEVEL : 'normal';
  const channels = [tgToken && tgChat ? 'telegram' : null, ntfyTopic ? 'ntfy' : null].filter(Boolean);
  const stat = { sent: 0, failed: 0, lastError: null, lastAt: null };
  const recent = []; // 분당 20건 제한
  const seen = new Map(); // 같은 문구 5분 안 중복 방지

  const wanted = (ev) => {
    if (NOISY.has(ev.type) && level !== 'all') return false;
    if (ev.type === 'gap' && !/확정/.test(ev.text)) return false; // 갭 스캔은 장전 확정만
    if (ev.type === 'exit' && ev.level !== 'warn') return false; // 매도 판단은 손절(경고)만, 체결은 fill로
    if (level === 'all') return !['gate', 'ai', 'ai-error', 'discover', 'kelly'].includes(ev.type);
    return LEVELS[level].has(ev.type);
  };

  function decorate(ev) {
    let text = ev.text.split('\n').slice(0, 4).join('\n');
    // 매도 체결이면 방금 끝난 거래 손익을 붙인다
    if (ev.type === 'fill' && ev.data?.order?.side === 'sell' && journal) {
      const t = journal.readLines('trades', { limit: 20 }).reverse().find((x) => x.symbol === ev.data.order.symbol && Date.now() - Date.parse(x.closedAt) < 120_000);
      if (t) text += `\n손익 ${t.pnl >= 0 ? '+' : ''}$${t.pnl} (${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct}%)`;
    }
    return `${EMOJI[ev.type] || '•'} ${text}`;
  }

  async function post(text, prio = 3) {
    const jobs = [];
    if (channels.includes('telegram')) {
      jobs.push(
        fetchImpl(`https://api.telegram.org/bot${tgToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: tgChat, text: `퀀트 오피스\n${text}`, disable_web_page_preview: true }) }).then(async (r) => {
          if (!r.ok) throw new Error(`텔레그램 HTTP ${r.status} ${(await r.text()).slice(0, 80)}`);
        })
      );
    }
    if (channels.includes('ntfy')) {
      jobs.push(
        fetchImpl(`${ntfyBase}/${encodeURIComponent(ntfyTopic)}`, { method: 'POST', headers: { Title: 'Quant Office', Priority: String(prio) }, body: text }).then((r) => {
          if (!r.ok) throw new Error(`ntfy HTTP ${r.status}`);
        })
      );
    }
    const res = await Promise.allSettled(jobs);
    const bad = res.filter((x) => x.status === 'rejected');
    if (bad.length) {
      stat.failed++;
      stat.lastError = String(bad[0].reason?.message || bad[0].reason).replace(tgToken || '\u0000', '***');
    } else stat.sent++;
    stat.lastAt = new Date().toISOString();
    return { ok: !bad.length, error: stat.lastError };
  }

  function onEvent(ev) {
    if (!channels.length || !wanted(ev)) return;
    const now = Date.now();
    const key = ev.text.slice(0, 80);
    if (seen.has(key) && now - seen.get(key) < 5 * 60_000) return;
    seen.set(key, now);
    if (seen.size > 300) seen.delete(seen.keys().next().value);
    while (recent.length && now - recent[0] > 60_000) recent.shift();
    if (recent.length >= 20) return;
    recent.push(now);
    post(decorate(ev), PRIO[ev.type] || 3).catch(() => null);
  }

  if (bus) bus.on('event', onEvent);
  return {
    status: () => ({ channels, level, ...stat }),
    test: () => (channels.length ? post('🔔 테스트 알림입니다. 이게 보이면 휴대폰 알림이 연결된 거예요.', 3) : Promise.resolve({ ok: false, error: '.env에 TELEGRAM_BOT_TOKEN·TELEGRAM_CHAT_ID 또는 NTFY_TOPIC이 없습니다.' })),
  };
}
