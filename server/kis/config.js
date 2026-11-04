// .env 로딩과 검증. 키/시크릿은 여기서만 읽고, 로그에는 마스킹된 값만 남긴다.
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const ENVS = {
  real: { rest: 'https://openapi.koreainvestment.com:9443', ws: 'ws://ops.koreainvestment.com:21000' },
  demo: { rest: 'https://openapivts.koreainvestment.com:29443', ws: 'ws://ops.koreainvestment.com:31000' },
};

function required(name) {
  const v = (process.env[name] || '').trim();
  if (!v) throw new Error(`[KIS] .env에 ${name} 값이 없습니다. .env.example을 참고해 채워주세요.`);
  return v;
}

export function mask(v = '') {
  return v.length <= 6 ? '***' : `${v.slice(0, 3)}***${v.slice(-3)}`;
}

function loadConfig() {
  const env = (process.env.KIS_ENV || 'demo').trim().toLowerCase();
  if (!ENVS[env]) throw new Error(`[KIS] KIS_ENV는 real 또는 demo여야 합니다. (현재: ${env})`);

  // 계좌번호: "12345678-01", "1234567801", 또는 CANO=12345678 + ACNT_PRDT_CD=01
  const rawCano = required('CANO').replace(/\s/g, '');
  let cano = rawCano;
  let prdt = (process.env.ACNT_PRDT_CD || '').trim();
  const m = rawCano.match(/^(\d{8})-?(\d{2})$/);
  if (m) {
    cano = m[1];
    prdt = prdt || m[2];
  }
  if (!/^\d{8}$/.test(cano)) throw new Error('[KIS] CANO는 계좌번호 앞 8자리(또는 8-2 형식)여야 합니다.');
  prdt = prdt || '01';
  if (!/^\d{2}$/.test(prdt)) throw new Error('[KIS] ACNT_PRDT_CD는 계좌번호 뒤 2자리여야 합니다.');

  const cfg = Object.freeze({
    env,
    isReal: env === 'real',
    appKey: required('APP_KEY'),
    appSecret: required('APP_SECRET'),
    cano,
    acntPrdtCd: prdt,
    // 테스트용 목 서버 등으로 바꿔야 할 때만 KIS_REST_BASE / KIS_WS_BASE 사용
    restBase: (process.env.KIS_REST_BASE || ENVS[env].rest).replace(/\/$/, ''),
    wsBase: (process.env.KIS_WS_BASE || ENVS[env].ws).replace(/\/$/, ''),
    // 실전 주문은 명시적으로 켜야만 나간다 (에이전트 자동매매 사고 방지)
    // HTS ID: 한투 관심종목 조회에 필요 (선택)
    htsId: (process.env.KIS_HTS_ID || '').trim(),
    enableRealOrders: process.env.KIS_ENABLE_REAL_ORDERS === 'true',
    maxOrderUsd: Number(process.env.KIS_MAX_ORDER_USD || 5000),
    marketSlippage: Number(process.env.KIS_MARKET_SLIPPAGE || 0.005),
    tokenCacheDir: process.env.KIS_TOKEN_CACHE_DIR || '.kis-cache',
    // 요청 간격: 모의 0.5초, 실전 0.05초 (공식 kis_auth.py smart_sleep 값)
    minIntervalMs: Number(process.env.KIS_MIN_INTERVAL_MS || (env === 'real' ? 50 : 500)),
  });
  return cfg;
}

export const config = loadConfig();

export function describeConfig() {
  return `[KIS] env=${config.env} appKey=${mask(config.appKey)} account=${config.cano.slice(0, 2)}******-${config.acntPrdtCd} realOrders=${config.isReal ? config.enableRealOrders : 'n/a(demo)'}`;
}
