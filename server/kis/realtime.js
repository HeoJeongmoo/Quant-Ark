// 해외주식 실시간지연체결가 [실시간-007] tr_id HDFSCNT0 (미국은 무료 0분 지연)
// tr_key: "D" + 시세거래소코드 + 종목  예) DNASAAPL / 미국 주간거래는 "R" + BAQ|BAY|BAA + 종목
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { config } from './config.js';
import { toQuoteExchange } from './exchanges.js';

const TR_ID = 'HDFSCNT0';
export const HDFSCNT0_COLUMNS = ['SYMB', 'ZDIV', 'TYMD', 'XYMD', 'XHMS', 'KYMD', 'KHMS', 'OPEN', 'HIGH', 'LOW', 'LAST', 'SIGN', 'DIFF', 'RATE', 'PBID', 'PASK', 'VBID', 'VASK', 'EVOL', 'TVOL', 'TAMT', 'BIVL', 'ASVL', 'STRN', 'MTYP'];
const MAX_SUBS = 40;

function decrypt(keyStr, ivStr, b64) {
  const d = crypto.createDecipheriv('aes-256-cbc', Buffer.from(keyStr, 'utf8'), Buffer.from(ivStr, 'utf8'));
  return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
}

export function trKeyFor(symbol, exchange = 'NAS', { dayTrading = false } = {}) {
  const ex = toQuoteExchange(exchange);
  const dayMap = { NAS: 'BAQ', NYS: 'BAY', AMS: 'BAA' };
  return dayTrading ? `R${dayMap[ex] || ex}${symbol.toUpperCase()}` : `D${ex}${symbol.toUpperCase()}`;
}

// "0|HDFSCNT0|002|a^b^c^...^a^b^c..." → 레코드 배열 (한 메시지에 여러 건이 붙어 올 수 있음)
export function parseTickFrame(raw, keys = {}) {
  const parts = raw.split('|');
  if (parts.length < 4) return null;
  const [enc, trId, cnt] = parts;
  let data = parts.slice(3).join('|');
  if (enc === '1') {
    if (!keys.key || !keys.iv) return null;
    data = decrypt(keys.key, keys.iv, data);
  }
  const f = data.split('^');
  const n = Math.max(1, Number(cnt) || 1);
  const w = HDFSCNT0_COLUMNS.length;
  const rows = [];
  for (let i = 0; i < n && (i + 1) * w <= f.length; i++) {
    const r = Object.fromEntries(HDFSCNT0_COLUMNS.map((c, j) => [c, f[i * w + j]]));
    const down = r.SIGN === '4' || r.SIGN === '5';
    rows.push({
      trId,
      symbol: (r.SYMB || '').replace(/^[DR](NAS|NYS|AMS|BAQ|BAY|BAA)/, ''),
      localDate: r.XYMD,
      localTime: r.XHMS,
      open: +r.OPEN,
      high: +r.HIGH,
      low: +r.LOW,
      last: +r.LAST,
      diff: Math.abs(+r.DIFF) * (down ? -1 : 1),
      rate: +r.RATE,
      bid: +r.PBID,
      ask: +r.PASK,
      bidQty: +r.VBID,
      askQty: +r.VASK,
      volume: +r.EVOL, // 체결량
      totalVolume: +r.TVOL,
      strength: +r.STRN, // 체결강도
      side: r.MTYP, // 시장구분/체결구분
    });
  }
  return rows;
}

/**
 * const rt = new KisRealtime(tokens); rt.on('tick', t => ...); await rt.subscribe('AAPL', 'NAS');
 * 이벤트: tick, open, close, error, subscribed
 */
export class KisRealtime extends EventEmitter {
  constructor(tokens, cfg = config) {
    super();
    this.tokens = tokens;
    this.cfg = cfg;
    this.subs = new Set();
    this.keys = {};
    this.ws = null;
    this.backoff = 1000;
    this.closedByUser = false;
  }

  async connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    this.closedByUser = false;
    const approval = await this.tokens.getApprovalKey();
    this.approval = approval;
    const ws = new WebSocket(`${this.cfg.wsBase}/tryitout`);
    this.ws = ws;
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    this.backoff = 1000;
    this.emit('open');
    ws.on('message', (buf) => this.#onMessage(buf.toString()));
    ws.on('close', () => {
      this.emit('close');
      if (!this.closedByUser) this.#reconnect();
    });
    ws.on('error', (e) => this.emit('error', e));
    for (const k of this.subs) this.#send(k, '1');
  }

  #reconnect() {
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 30000);
    setTimeout(() => this.connect().catch((e) => this.emit('error', e)), wait);
  }

  #send(trKey, trType) {
    this.ws?.send(
      JSON.stringify({
        header: { approval_key: this.approval, custtype: 'P', tr_type: trType, 'content-type': 'utf-8' },
        body: { input: { tr_id: TR_ID, tr_key: trKey } },
      })
    );
  }

  #onMessage(raw) {
    if (raw[0] === '0' || raw[0] === '1') {
      const rows = parseTickFrame(raw, this.keys[TR_ID]);
      if (rows) for (const r of rows) this.emit('tick', r);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const trId = msg.header?.tr_id;
    if (trId === 'PINGPONG') {
      this.ws.pong(raw); // 공식 예제와 동일하게 응답
      return;
    }
    const b = msg.body;
    if (b?.output?.key) this.keys[trId] = { key: b.output.key, iv: b.output.iv };
    if (b && b.rt_cd !== '0') this.emit('error', new Error(`[KIS 실시간] ${b.msg_cd} ${b.msg1}`));
    else if (b) this.emit('subscribed', { trId, trKey: msg.header?.tr_key, msg: b.msg1 });
  }

  async subscribe(symbol, exchange = 'NAS', opts) {
    const k = trKeyFor(symbol, exchange, opts);
    if (this.subs.has(k)) return k;
    if (this.subs.size >= MAX_SUBS) throw new Error(`[KIS 실시간] 동시 구독은 최대 ${MAX_SUBS}개입니다.`);
    this.subs.add(k);
    const wasOpen = this.ws && this.ws.readyState === WebSocket.OPEN;
    await this.connect(); // 새로 연결되면 connect()가 구독 목록 전체를 보낸다
    if (wasOpen) this.#send(k, '1');
    return k;
  }

  unsubscribe(symbol, exchange = 'NAS', opts) {
    const k = trKeyFor(symbol, exchange, opts);
    if (this.subs.delete(k)) this.#send(k, '2');
  }

  close() {
    this.closedByUser = true;
    this.ws?.close();
  }
}
