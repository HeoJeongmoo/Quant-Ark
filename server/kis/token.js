// OAuth 접근 토큰(REST)과 웹소켓 접속키(approval_key) 관리.
// - 토큰 유효기간 24시간, 발급은 1분당 1회로 제한 → 메모리 + 파일 캐시로 재사용
// - 만료 10분 전부터 자동 갱신, 동시 요청은 하나의 발급 요청을 공유(single-flight)
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const REFRESH_MARGIN_MS = 10 * 60 * 1000;
const ISSUE_COOLDOWN_MS = 61 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// KIS는 만료일시를 "YYYY-MM-DD HH:MM:SS"(한국시간)로 준다
function parseKstDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s || '');
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +m[6]);
}

export class TokenManager {
  constructor(cfg = config, { fetchImpl = fetch, now = () => Date.now() } = {}) {
    this.cfg = cfg;
    this.fetch = fetchImpl;
    this.now = now;
    this.token = null; // { value, expiresAt }
    this.inflight = null;
    this.lastIssueAt = 0;
    this.file = path.join(cfg.tokenCacheDir, `token-${cfg.env}-${cfg.appKey.slice(-6)}.json`);
    this.#loadCache();
  }

  #loadCache() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved.value && saved.expiresAt > this.now() + REFRESH_MARGIN_MS) this.token = saved;
    } catch {
      /* 캐시 없음 */
    }
  }

  #saveCache() {
    try {
      fs.mkdirSync(this.cfg.tokenCacheDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.file, JSON.stringify(this.token), { mode: 0o600 });
    } catch (e) {
      console.warn('[KIS] 토큰 캐시 저장 실패(메모리로만 유지):', e.message);
    }
  }

  isValid() {
    return !!this.token && this.token.expiresAt - this.now() > REFRESH_MARGIN_MS;
  }

  async getAccessToken() {
    if (this.isValid()) return this.token.value;
    if (!this.inflight) this.inflight = this.#issue().finally(() => (this.inflight = null));
    return this.inflight;
  }

  // 서버가 토큰 만료(EGW00123 등)를 알렸을 때 강제 재발급
  async forceRefresh() {
    this.token = null;
    return this.getAccessToken();
  }

  async #issue() {
    const wait = this.lastIssueAt + ISSUE_COOLDOWN_MS - this.now();
    if (wait > 0) await sleep(wait);
    for (let attempt = 1; attempt <= 3; attempt++) {
      this.lastIssueAt = this.now();
      const res = await this.fetch(`${this.cfg.restBase}/oauth2/tokenP`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ grant_type: 'client_credentials', appkey: this.cfg.appKey, appsecret: this.cfg.appSecret }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.access_token) {
        const exp = parseKstDate(data.access_token_token_expired) ?? this.now() + (Number(data.expires_in) || 86400) * 1000;
        this.token = { value: data.access_token, expiresAt: exp };
        this.#saveCache();
        return this.token.value;
      }
      // EGW00133: 1분당 1회 발급 제한
      if (data.error_code === 'EGW00133' && attempt < 3) {
        await sleep(ISSUE_COOLDOWN_MS);
        continue;
      }
      throw new Error(`[KIS] 접근 토큰 발급 실패 (${res.status}) ${data.error_code || ''} ${data.error_description || data.msg1 || ''}`.trim());
    }
  }

  // 실시간 웹소켓 접속키. 요청 필드명이 appsecret이 아니라 secretkey인 점에 주의
  async getApprovalKey() {
    if (this.approval && this.approval.expiresAt > this.now()) return this.approval.value;
    const res = await this.fetch(`${this.cfg.restBase}/oauth2/Approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ grant_type: 'client_credentials', appkey: this.cfg.appKey, secretkey: this.cfg.appSecret }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.approval_key) throw new Error(`[KIS] 웹소켓 접속키 발급 실패 (${res.status}) ${data.error_description || ''}`);
    this.approval = { value: data.approval_key, expiresAt: this.now() + 23 * 3600 * 1000 };
    return this.approval.value;
  }
}
