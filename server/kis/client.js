// REST 공통 호출부: 헤더 구성, 초당 호출 제한, 토큰 만료/과호출 재시도, 오류 정규화
import { config } from './config.js';
import { TokenManager } from './token.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class KisApiError extends Error {
  constructor({ status, trId, path, rtCd, msgCd, msg }) {
    super(`[KIS ${trId}] ${msgCd || status}: ${msg || '요청 실패'}`);
    Object.assign(this, { status, trId, path, rtCd, msgCd });
  }
}

export class KisClient {
  constructor(cfg = config, { fetchImpl = fetch, tokens } = {}) {
    this.cfg = cfg;
    this.fetch = fetchImpl;
    this.tokens = tokens || new TokenManager(cfg, { fetchImpl });
    this.queue = Promise.resolve();
    this.lastCall = 0;
  }

  // 모든 호출을 한 줄로 세워 최소 간격을 지킨다 (EGW00201 초당 거래건수 초과 방지)
  #throttle() {
    const turn = this.queue.then(async () => {
      const wait = this.lastCall + this.cfg.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastCall = Date.now();
    });
    this.queue = turn.catch(() => {});
    return turn;
  }

  /**
   * @param {'GET'|'POST'} method
   * @param {string} path  예: /uapi/overseas-price/v1/quotations/price
   * @param {{trId:string, params?:object, body?:object, trCont?:string}} opts
   * @returns {Promise<{body:any, trCont:string}>}
   */
  async request(method, path, { trId, params, body, trCont = '' }) {
    for (let attempt = 1; ; attempt++) {
      await this.#throttle();
      const token = await this.tokens.getAccessToken();
      const url = new URL(this.cfg.restBase + path);
      if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v ?? '');
      const res = await this.fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          authorization: `Bearer ${token}`,
          appkey: this.cfg.appKey,
          appsecret: this.cfg.appSecret,
          tr_id: trId,
          tr_cont: trCont,
          custtype: 'P',
        },
        body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      const msgCd = data.msg_cd || data.error_code;

      if (res.ok && data.rt_cd === '0') return { body: data, trCont: res.headers.get('tr_cont') || '' };

      // 토큰 만료/무효 → 1회 강제 재발급 후 재시도
      if ((msgCd === 'EGW00123' || msgCd === 'EGW00121' || res.status === 401) && attempt === 1) {
        await this.tokens.forceRefresh();
        continue;
      }
      // 초당 거래건수 초과 → 잠시 쉬고 최대 3회 재시도 (주문은 중복 체결 위험이 있어 재시도하지 않음)
      if (msgCd === 'EGW00201' && method === 'GET' && attempt <= 3) {
        await sleep(400 * attempt);
        continue;
      }
      throw new KisApiError({ status: res.status, trId, path, rtCd: data.rt_cd, msgCd, msg: data.msg1 || data.error_description });
    }
  }

  get(path, opts) {
    return this.request('GET', path, opts);
  }
  post(path, opts) {
    return this.request('POST', path, opts);
  }
}
