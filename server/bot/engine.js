// 퀀트 오피스 매매 봇 (서버 상주)
//
// 브라우저와 무관하게 서버(도커 컨테이너)에서 24시간 돈다. 장 시간은 뉴욕 시각으로 자동 판단.
//   정규장: 시세·5분봉 수집 → S티어 스캔 → 노아/아브라함(규칙 + AI) → 여호수아 매수
//           보유 종목은 매 틱 모세가 감시 → 강제 손절선/AI 판단 → 안심 체결 엔진으로 매도
//   장전·장후: 계좌·시세만 가끔 갱신 / 주말·휴장: 대기
// 화면에 보이는 모든 숫자는 KIS에서 받은 값이다. 받기 전에는 비어 있다.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { marketPhase, barStart, clockNow } from './session.js';
import { createExecutor } from './executor.js';
import { judgeExit, ACTION_LABEL } from './moses.js';
import * as journal from './journal.js';
import * as risk from './risk.js';
import * as rvol from './rvol.js';
import { createSamuel } from './samuel.js';
import * as equity from './equity.js';
import { createAlphaVantage } from '../news/alphavantage.js';
import { createYahoo } from '../news/yahoo.js';
import * as watch from '../watchlist.js';
import { evaluateSTier, sizePosition, closedOnly, sessionInfo, ALL_STRATEGIES as STRATEGIES, expectedMovePct, checkD } from '../../src/strategy/sTier.js';
import { evaluateCandidates, EXIT_PROFILES } from '../../src/strategy/candidates.js';
import { evaluatePromotions, evaluateRetirements } from './promotion.js';
import { createRegistry } from './registry.js';
import { qqqRegime, breadthOf, snap as regimeSnap, SECTOR_ETFS, BREADTH_EXTRA, ETF_EX } from './regime.js';

const SETTINGS_FILE = path.resolve(process.env.BOT_SETTINGS_FILE || 'data/bot-settings.json');
const GUARD_FILE = path.resolve(process.env.BOT_GUARD_FILE || 'data/bot-guard.json');
const GAP_FILE = path.resolve(process.env.BOT_GAP_FILE || 'data/gap-candidates.json');
// 장세 기록 (날짜별 QQQ·시장 폭·VIXY, 캘린더용)
const REGIME_FILE = path.resolve(process.env.BOT_REGIME_FILE || 'data/regime-days.json');
const SETTINGS_VERSION = 3;
const SHADOW_FILE = path.resolve(process.env.BOT_SHADOW_FILE || 'data/shadow-open.json');
// 가상 전용 종목: 고정(기준선) + 그날 자동(장 시작 전 거래량 상위, 하루 동안 고정). 실매수는 절대 안 함
const SHADOW_UNI_FILE = path.resolve(process.env.BOT_SHADOW_UNI_FILE || 'data/shadow-universe.json');
// 가상 기록 초기화 버전: 올리면 다음 시작 때 기존 가상 기록을 백업 파일로 옮기고 새로 시작
const SHADOW_EPOCH = 2;
const SHADOW_EPOCH_FILE = path.resolve(process.env.BOT_SHADOW_EPOCH_FILE || 'data/shadow-epoch.json');
const SHADOW_FIXED_EX = { SPY: 'AMS', DIA: 'AMS', IWM: 'AMS' };
const TICK_MS = Number(process.env.BOT_TICK_MS || 10_000);
const DEFAULT_SETTINGS = {
  autoTrade: process.env.BOT_AUTO_TRADE !== 'false', // 신규 매수 자동 집행 (매도·손절은 항상 동작)
  control: 'auto', // auto: AI 판단 / manual: 사용자 고정 손절·익절, 신규 매수는 제안만
  david: false, // 다윗 전시장 탐색 모드
  useAi: true, // 노아·아브라함·다윗 AI 판단 사용 (키가 있을 때)
  rules: {
    buyHalt: false,
    maxW: 50, // 종목당 최대 비중 %
    stop: -2, // 수동 모드 손절선 %
    take: 5, // 수동 모드 익절선 %
    hardStopPct: Number(process.env.HARD_STOP_PCT || 3), // 강제 손절선 (모든 모드)
    arkDropPct: 1.5, // QQQ가 전일 대비 이만큼 빠지거나 장중 고점 대비 이만큼 밀리면 방주 닫힘
    flattenAtClose: true, // 장 마감 5분 전 봇 포지션 전량 청산 (갭 종목 밤샘 보유 금지)
    noEntryLastMin: 60, // 마감 N분 전부터 신규 매수 안 함
    // --- 비용을 넘는 거래만 (1번) ---
    feePct: Number(process.env.KIS_FEE_PCT || 0.25), // 매매 수수료 한 방향 %
    slipBufferPct: 0.1, // 슬리피지·SEC Fee 여유 %
    minTargetPct: 3.0, // 이만큼 움직일 여지가 있는 종목만 진입, 이 수익부터 트레일링 익절
    holdBars: 36, // 보유 예정 5분봉 수 (36 = 3시간). 예상 변동폭 = ATR% × √holdBars
    lossCutPct: 1.5, // AI 손절 기준 손실폭 (강제 손절선과 별개)
    // --- 동시 신호 우선 매수: A·B·C 중 N개 이상 켜지면 켈리·AI 결재 없이 매수 ---
    // --- 트랙 1: 장전 갭 스캐너 + 시가 범위 돌파 (D) ---
    gapScan: true,
    gapMinPct: 4, // 프리마켓 갭 하한 %
    gapMaxPct: 25, // 갭 상한 % (넘으면 펌프 앤 덤프 위험)
    gapMinPrice: 5,
    gapMaxPrice: 30, // 계좌가 작아 1주가 종목당 한도 안에 들어오는 가격대
    gapMinPreVol: 500000, // 프리마켓 거래량 하한 (주)
    gapMinPreAmtM: 5, // 또는 프리마켓 거래대금 하한 ($M)
    gapMinMcapM: 300, // 시가총액 하한 ($M) = 상장주식수 × 주가
    gapTopN: 5,
    orbBars: 3, // 시가 범위 = 개장 후 첫 3개 5분봉 (15분)
    orbEndMin: 90, // 개장 후 이 분까지만 진입
    gapMaxMovePct: 30, // 갭 후보는 변동폭 상한을 따로 (일반 12%)
    // 매수 비중 방식: tier = 예상 승률 단계 (소액 계좌용, 임시) / fixed = 기존 방식 (종목당 trackPct 고정, 최대 fixedMaxW, 실거래·계좌 조건 충족 시 하프 켈리)
    sizeMode: 'tier',
    sizeTierUntilEquity: 0, // 총 평가금액이 이 금액($) 이상이 되면 자동으로 기존 방식으로 (0이면 자동 전환 안 함)
    trackPct: 10, // 기존 방식: 종목당 고정 비중 %
    fixedMaxW: 15, // 기존 방식: 종목당 최대 비중 %
    // --- 승률 단계별 매수 비중: 예상 승률이 본전 승률보다 얼마나 높은지로 정함 ---
    sizeUnverifiedPct: 25, // 표본 부족(가상+실거래 sizeMinSamples건 미만)일 때
    sizeBasePct: 33, // 본전 승률 + sizeEdgeBase%p 이상: 계좌의 1/3 (보유 3종목 기준)
    sizeHighPct: 45, // 본전 승률 + sizeEdgeHigh%p 이상
    sizeLowPct: 15, // 그 밖 (본전 근처)
    sizeEdgeBase: 3,
    sizeEdgeHigh: 10,
    sizeMinSamples: 20,
    minObservedForKelly: 20, // 전략별 실거래가 이 건수 이상이고
    kellyMinEquity: 2000, // 총 평가금액이 이 금액($) 이상이면 고정 비중 대신 하프 켈리
    // --- 위험 상품·위험 구간 제외 ---
    // --- 상대 거래량 · 뉴스 · 전략 자동 선택 ---
    rvolMin: 2, // 다윗 탐색: 평소 대비 오늘 거래량이 이 배수 미만이면 관심종목에 안 넣음 (0이면 끔)
    rvolMinEntry: 1.5, // 장중 매수: 이 배수 미만이면 매수 안 함 (갭 후보 D는 제외, 0이면 끔)
    newsCheck: true, // 사무엘 뉴스 재료 확인 (악재 제목이면 매수·갭 후보 제외)
    candidates: true, // 후보 전략(E~I) 가상 거래 기록 + 승격
    shadowEntrySlipPct: 0.1, // 가상 거래 진입·시간 청산 미끄러짐 %
    shadowStopSlipPct: 0.2, // 가상 거래 손절 미끄러짐 %
    promoteMin: 40, // 승격: 가상 거래 최소 건수
    promoteExp: 0.3, // 승격: 비용 뺀 기대값 % 이상
    shadowFixed: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'TSLA', 'SPY', 'QQQ'], // 가상 전용 고정 종목 (기준선)
    shadowAutoN: 5, // 가상 전용 자동 종목 수 (장 시작 전 거래량 상위에서 뽑아 그날 고정)
    shadowGap: true, // 갭 후보에서도 A~I 가상 기록 (관심 종목은 가상 기록 안 함)
    promotePF: 1.3, // 승격: Profit Factor 이상
    promoteDays: 15, // 승격: 서로 다른 거래일 이상
    promoteBaseSlots: 8, // 후보가 이 수를 넘으면 2개마다 승격 기준 상향 (기대값 +0.1%p, 건수 +10)
    retireMin: 100, // 은퇴: 가장 나은 청산도 가상 이만큼 이상
    retireDays: 30, // 은퇴: 거래일 이만큼 이상
    retireExp: -0.1, // 은퇴: 기대값 이 값 이하 (확실한 마이너스만)
    retireSparseDays: 60, // 은퇴: 이만큼 지나도 40건 미만이면 신호 부족
    retireStaleDays: 90, // 은퇴: 이만큼 지나도 승격 못 하면 가능성 없음
    autoToggleMin: 30, // 전략별 실거래 이만큼 쌓이면 성과로 자동 끄기/켜기
    minDollarVolM: 5, // 오늘 정규장 거래대금(5분봉 합계)이 이 값($M) 미만이면 매수 안 함 (얇은 호가·슬리피지)
    maxMovePct: 12, // 예상 변동폭이 이보다 크면 매수 안 함 (급등락 잡주·이벤트 종목)
    // --- 계좌 보호 잠금 (3번) ---
    dailyLossPct: 5, // 오늘 계좌 손실이 이만큼이면 그날 매매 셧다운
    maxPositions: 3, // 동시 보유 종목 최대 개수
    flattenOnShutdown: true, // 셧다운 시 봇 포지션 청산
  },
  discoverEveryMin: 5,
  strategyModes: { A: 'auto', B: 'auto', C: 'auto', D: 'auto', E: 'auto', F: 'auto', G: 'auto', H: 'auto', I: 'auto', J: 'auto', K: 'auto', L: 'auto', M: 'auto', N: 'auto' }, // auto: 성과로 자동, on: 항상 켬, off: 항상 끔
  version: SETTINGS_VERSION,
};

const costPct = (r) => 2 * r.feePct + r.slipBufferPct; // 왕복 비용 %
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const toBar = (k) => ({ o: k.open, h: k.high, l: k.low, c: k.close, v: k.volume || 0, t: k.t, time: k.time });

function loadSettings() {
  let out;
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    out = { ...DEFAULT_SETTINGS, ...s, rules: { ...DEFAULT_SETTINGS.rules, ...(s.rules || {}) }, strategyModes: { ...DEFAULT_SETTINGS.strategyModes, ...(s.strategyModes || {}) } };
  } catch {
    out = structuredClone(DEFAULT_SETTINGS);
  }
  // 설정 버전 2: 트랙 1 도입과 함께 보유 3종목·마감 청산·마감 60분 전 매수 금지로 한 번 바꿈 (이후 사용자가 바꾼 값은 유지)
  if ((out.version || 1) < SETTINGS_VERSION) {
    if ((out.version || 1) < 2) Object.assign(out.rules, { maxPositions: 3, flattenAtClose: true, noEntryLastMin: 60 });
    // 버전 3: 승률 단계별 비중(최대 45%)을 쓰려면 종목당 최대 비중을 50%로
    if ((out.rules.maxW ?? 15) < 50) out.rules.maxW = 50;
    out.version = SETTINGS_VERSION;
    try {
      fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(out, null, 2));
    } catch {
      /* 저장 실패해도 메모리 값으로 동작 */
    }
  }
  // .env에 적은 값은 저장된 설정보다 우선 (재시작 때마다 반영)
  const envNum = (k) => (process.env[k] != null && process.env[k] !== '' && Number.isFinite(+process.env[k]) ? +process.env[k] : null);
  if (envNum('KIS_FEE_PCT') != null) out.rules.feePct = envNum('KIS_FEE_PCT');
  if (envNum('BOT_MIN_TARGET_PCT') != null) out.rules.minTargetPct = envNum('BOT_MIN_TARGET_PCT');
  if (envNum('BOT_LOSS_CUT_PCT') != null) out.rules.lossCutPct = envNum('BOT_LOSS_CUT_PCT');
  if (envNum('BOT_HOLD_BARS') != null) out.rules.holdBars = envNum('BOT_HOLD_BARS');
  if (envNum('HARD_STOP_PCT') != null) out.rules.hardStopPct = envNum('HARD_STOP_PCT');
  if (envNum('BOT_DISCOVER_MIN') != null) out.discoverEveryMin = Math.min(60, Math.max(3, Math.round(envNum('BOT_DISCOVER_MIN'))));
  return out;
}

export function createBot({ kis, llm }) {
  const env = kis.config.env;
  const realOrders = env === 'demo' || kis.config.enableRealOrders;
  const bus = new EventEmitter();
  bus.setMaxListeners(50);
  const events = [];
  let seq = 0;
  let settings = loadSettings();
  const saveSettings = () => {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  };

  function emit(type, agent, text, data = {}, level = 'info') {
    const ev = { id: ++seq, at: new Date().toISOString(), type, agent, text, level, data };
    events.push(ev);
    if (events.length > 300) events.shift();
    bus.emit('event', ev);
    const tag = level === 'error' ? '‼' : level === 'warn' ? '!' : '·';
    console.log(`[bot ${ev.at.slice(11, 19)}] ${tag} ${agent} ${text.split('\n')[0]}`);
    return ev;
  }

  const S = {
    phase: null,
    phaseInfo: null,
    tickers: new Map(), // symbol → 시세·봉·신호
    index: { symbol: 'QQQ', exchange: 'NAS', price: null, prevClose: null, candles: [], dayHigh: null },
    ark: { state: 'unknown', reason: '지수 데이터 수집 전' },
    account: null,
    accountError: null,
    accountAt: 0,
    accountFails: 0,
    priceFails: 0,
    emergency: null,
    moses: {},
    handled: {}, // symbol → 처리한 봉 키
    exitLock: {}, // symbol → 마지막 체결 시각 (그 뒤 잔고가 갱신되기 전엔 다시 팔지 않음)
    cooldown: {}, // symbol → 마지막 매수 시도 시각
    lastBar: 0,
    candlesAt: 0,
    discoverAt: 0,
    discover: null,
    govBusy: false,
    lastTick: 0,
    tickCount: 0,
    rr: 0,
    running: false,
    startedAt: Date.now(),
    gap: (() => {
      try {
        return JSON.parse(fs.readFileSync(GAP_FILE, 'utf8'));
      } catch {
        return { date: null, items: [], finalized: false, scans: 0 };
      }
    })(),
    gapScanAt: 0,
    gapBusy: false,
    orbDone: {}, // symbol → 날짜 (하루 한 번만 진입 시도)
    health: {}, // 전략별 자동 켜기/끄기 상태
    promo: {}, // 후보 전략 승격 상태
    candHandled: {}, // symbol → 후보 전략 가상 거래를 연 봉
    shadowUni: (() => {
      try {
        return JSON.parse(fs.readFileSync(SHADOW_UNI_FILE, 'utf8'));
      } catch {
        return { date: null, auto: [] };
      }
    })(),
    shadowUniAt: 0,
    regime: { date: null, qqq: null, breadth: null, at: 0 },
    regimeDays: (() => {
      try {
        return JSON.parse(fs.readFileSync(REGIME_FILE, 'utf8'));
      } catch {
        return {};
      }
    })(),
    qqqAvgRange: { date: null, pct: null },
    etfEx: {},
    breadthAt: 0,
    shadows: (() => {
      try {
        return journal.dedupeShadows(JSON.parse(fs.readFileSync(SHADOW_FILE, 'utf8')));
      } catch {
        return [];
      }
    })(),
    guard: (() => {
      try {
        return JSON.parse(fs.readFileSync(GUARD_FILE, 'utf8'));
      } catch {
        return { date: null, startEquity: null, shutdown: false, reason: '', dayPnlPct: null };
      }
    })(),
  };
  const saveShadows = () => {
    try {
      fs.mkdirSync(path.dirname(SHADOW_FILE), { recursive: true });
      fs.writeFileSync(SHADOW_FILE, JSON.stringify(S.shadows));
    } catch {
      /* 무시 */
    }
  };
  const saveRegimeDays = () => {
    try {
      const keys = Object.keys(S.regimeDays).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete S.regimeDays[k];
      fs.mkdirSync(path.dirname(REGIME_FILE), { recursive: true });
      fs.writeFileSync(REGIME_FILE, JSON.stringify(S.regimeDays));
    } catch {
      /* 무시 */
    }
  };
  const registry = createRegistry({ today: () => marketPhase().ny.ymd });
  const botDaysSince = (ymd) => (ymd ? Object.keys(S.regimeDays).filter((k) => k >= ymd).length : 0);
  // 후보가 기본 자리(8개)를 넘으면 2개마다 승격 기준을 올림 (운으로 승격될 위험을 원래 수준 근처로)
  const promoBar = () => {
    const R0 = settings.rules;
    const extra = Math.max(0, Math.ceil((registry.active().length - (R0.promoteBaseSlots ?? 8)) / 2));
    return { minTrades: R0.promoteMin + 10 * extra, minExp: Math.round((R0.promoteExp + 0.1 * extra) * 100) / 100, minPF: R0.promotePF, minDays: R0.promoteDays, extra, active: registry.active().length, base: R0.promoteBaseSlots ?? 8 };
  };
  // 실매수에 쓰는 승격인지 (장세 한정 승격은 오늘 QQQ 방향이 맞을 때만)
  const isLive = (p) => p?.status === 'promoted' || (p?.status === 'regime' && S.regime.date === S.phaseInfo?.ny?.ymd && (p.dirs || []).includes(S.regime.qqq?.dir));
  const saveShadowUni = () => {
    try {
      fs.mkdirSync(path.dirname(SHADOW_UNI_FILE), { recursive: true });
      fs.writeFileSync(SHADOW_UNI_FILE, JSON.stringify(S.shadowUni, null, 2));
    } catch {
      /* 무시 */
    }
  };
  // 가상 기록 초기화 (버전이 오르면 한 번만): 기존 기록은 지우지 않고 백업 파일로 옮김
  (() => {
    let cur = 0;
    try {
      cur = JSON.parse(fs.readFileSync(SHADOW_EPOCH_FILE, 'utf8')).epoch || 0;
    } catch {
      /* 처음 */
    }
    if (cur >= SHADOW_EPOCH) return;
    const moved = journal.archiveShadow(`epoch${SHADOW_EPOCH}`);
    S.shadows = [];
    saveShadows();
    try {
      fs.mkdirSync(path.dirname(SHADOW_EPOCH_FILE), { recursive: true });
      fs.writeFileSync(SHADOW_EPOCH_FILE, JSON.stringify({ epoch: SHADOW_EPOCH, at: new Date().toISOString(), backup: moved }));
    } catch {
      /* 무시 */
    }
    S.shadowReset = { at: new Date().toISOString(), backup: moved };
  })();
  const samuel = createSamuel({ kis, llm, aiReady: () => aiReady(), emit, clockNow, av: createAlphaVantage({ clockNow }), yahoo: createYahoo() });
  const saveGap = () => {
    fs.mkdirSync(path.dirname(GAP_FILE), { recursive: true });
    fs.writeFileSync(GAP_FILE, JSON.stringify(S.gap, null, 2));
  };
  const saveGuard = () => {
    fs.mkdirSync(path.dirname(GUARD_FILE), { recursive: true });
    fs.writeFileSync(GUARD_FILE, JSON.stringify(S.guard, null, 2));
  };

  // ---------------- 계좌 보호 잠금 ----------------
  // 거래일(뉴욕 날짜)의 첫 계좌 조회(장전 또는 정규장) 평가금액을 기준으로 오늘 손익을 잰다.
  // 손실이 dailyLossPct에 닿으면 그날은 신규 매수를 전면 금지하고(사용자 매수 포함), 봇 포지션을 청산한다.
  // 손절·매도는 계속 동작. 다음 거래일 첫 조회 때 자동 해제.
  async function updateGuard() {
    const ph = marketPhase();
    const total = S.account?.totals?.total;
    if (!(total > 0)) return;
    const g = S.guard;
    if (g.date !== ph.ny.ymd && (ph.phase === 'pre' || ph.phase === 'open')) {
      const wasShut = g.shutdown;
      S.guard = { date: ph.ny.ymd, startEquity: total, startedAt: new Date().toISOString(), shutdown: false, reason: '', dayPnlPct: 0 };
      saveGuard();
      emit('guard', 'kang', `새 거래일 ${ph.ny.ymd}: 기준 평가금액 $${total.toFixed(2)}, 셧다운 한도 -${settings.rules.dailyLossPct}%${wasShut ? ' (어제 셧다운 해제)' : ''}`, { guard: S.guard });
      return;
    }
    if (g.date !== ph.ny.ymd || !(g.startEquity > 0)) return;
    g.dayPnlPct = r2((total / g.startEquity - 1) * 100);
    if (!g.shutdown && g.dayPnlPct <= -Math.abs(settings.rules.dailyLossPct)) {
      g.shutdown = true;
      g.at = new Date().toISOString();
      g.reason = `오늘 계좌 ${g.dayPnlPct}% (한도 -${settings.rules.dailyLossPct}%)`;
      saveGuard();
      emit('shutdown', 'kang', `⛔ 계좌 보호 셧다운: ${g.reason}. 오늘은 더 이상 매수하지 않습니다.${settings.rules.flattenOnShutdown ? ' 봇 포지션을 청산합니다.' : ''}`, { guard: g }, 'error');
    }
  }

  const exec = createExecutor({
    kis,
    emit,
    getEnv: () => env,
    nyYmd: () => marketPhase().ny.ymdCompact,
    dryRunFor: () => !realOrders,
    // 체결 즉시 내 계좌 보기를 고쳐 두고(중복 매도 방지), 다음 틱에 KIS 잔고로 다시 맞춘다
    onFill: (o, qty, px) => {
      S.exitLock[o.symbol] = Date.now();
      S.accountAt = 0;
      const a = S.account;
      if (!a) return;
      let h = a.holdings.find((x) => x.symbol === o.symbol);
      if (o.side === 'sell' && h) {
        h.qty = Math.max(0, h.qty - qty);
        h.sellableQty = Math.max(0, (h.sellableQty ?? h.qty) - qty);
        a.cash.deposit = (a.cash.deposit || 0) + qty * px;
      } else if (o.side === 'buy') {
        if (!h) a.holdings.push((h = { symbol: o.symbol, name: o.symbol, quoteExchange: o.exchange, qty: 0, sellableQty: 0, avgPrice: px, price: px }));
        h.avgPrice = (h.avgPrice * h.qty + px * qty) / (h.qty + qty);
        h.qty += qty;
        h.sellableQty = (h.sellableQty || 0) + qty;
        a.cash.deposit = (a.cash.deposit || 0) - qty * px;
      }
    },
  });

  // ---------------- 데이터 수집 ----------------
  function tracked() {
    const w = watch.load();
    const want = new Map();
    for (const m of w.manual) want.set(m.code, { ...m, list: 'manual' });
    for (const a of w.ai) if (!want.has(a.code)) want.set(a.code, { ...a, list: 'ai' });
    // 트랙 1: 오늘의 갭 후보 (수동 관심종목에 있으면 수동이 우선이지만 D 판정은 함께 함)
    const today = marketPhase().ny.ymd;
    S.gapToday = new Set(S.gap.date === today ? S.gap.items.map((g) => g.symbol) : []);
    if (S.gap.date === today) for (const g of S.gap.items) if (!want.has(g.symbol) || want.get(g.symbol).list === 'ai') want.set(g.symbol, { code: g.symbol, exchange: g.exchange, kr: g.name, reason: `갭 +${g.gapPct}% · 프리마켓 ${Math.round((g.preVol || 0) / 1000)}K주 · 시총 $${g.mcapM ?? '-'}M`, list: 'gap' });
    for (const h of S.account?.holdings || []) if (!want.has(h.symbol)) want.set(h.symbol, { code: h.symbol, exchange: h.quoteExchange, kr: h.name, list: 'held' });
    // 가상 전용 종목 (이미 다른 목록에 있으면 그 목록이 우선)
    for (const sym of settings.rules.shadowFixed || []) if (!want.has(sym)) want.set(sym, { code: sym, exchange: S.shadowUni.ex?.[sym] || SHADOW_FIXED_EX[sym] || 'NAS', reason: '가상 전용 · 고정', list: 'shadow' });
    if (S.shadowUni.date === today) for (const a of S.shadowUni.auto || []) if (!want.has(a.symbol)) want.set(a.symbol, { code: a.symbol, exchange: a.exchange, kr: a.name, reason: `가상 전용 · 자동 (${a.why || '거래량 상위'})`, list: 'shadow' });
    // 보유 중인 종목이 가상 전용 목록에도 있으면 보유 목록으로 두되 가상 기록은 계속 남김
    const shadowSyms = new Set([...(settings.rules.shadowFixed || []), ...(S.shadowUni.date === today ? (S.shadowUni.auto || []).map((a) => a.symbol) : [])]);
    // 맵 갱신 (빠진 종목 제거, 새 종목 추가)
    for (const sym of [...S.tickers.keys()]) if (!want.has(sym)) S.tickers.delete(sym);
    for (const [sym, w2] of want) {
      const t = S.tickers.get(sym);
      if (t) Object.assign(t, { list: w2.list, kr: w2.kr || t.kr, reason: w2.reason || '', exchange: w2.exchange || t.exchange });
      else S.tickers.set(sym, { symbol: sym, exchange: w2.exchange || 'NAS', list: w2.list, kr: w2.kr || '', reason: w2.reason || '', price: null, prevClose: null, candles: [], stier: null, book: null });
    }
    for (const t of S.tickers.values()) t.shadowAlso = t.list === 'held' && shadowSyms.has(t.symbol);
    return w;
  }
  const scanList = () => [...S.tickers.values()].filter((t) => t.list === 'manual' || t.list === 'gap' || t.list === 'shadow' || t.shadowAlso || (t.list === 'ai' && settings.david));
  const heldSymbols = () => new Set((S.account?.holdings || []).filter((h) => h.qty > 0).map((h) => h.symbol));

  async function refreshAccount() {
    try {
      const a = await kis.getAccount();
      S.account = a;
      S.accountAt = Date.now();
      S.accountError = null;
      if (S.accountFails >= 3 && S.emergency === '잔고') leaveEmergency();
      S.accountFails = 0;
      const ph0 = marketPhase();
      if (ph0.phase !== 'closed') equity.record(ph0.ny.ymd, a.totals?.total);
      await updateGuard();
      const lastPrice = Object.fromEntries([...S.tickers.values()].map((t) => [t.symbol, t.price]));
      const closed = journal.reconcile(a.holdings, env, lastPrice, exec.busySymbols());
      for (const c of closed) emit('journal', 'kang', `${c.symbol} 포지션이 계좌에서 사라져 외부 청산으로 기록 (${c.pnl >= 0 ? '+' : ''}$${c.pnl})`, { trade: c }, 'warn');
    } catch (e) {
      S.accountFails++;
      S.accountError = e.message;
      if (S.accountFails >= 3) enterEmergency('잔고', e.message);
    }
  }

  async function refreshPrice(t) {
    try {
      const p = await kis.getPrice(t.symbol, t.exchange);
      if (p.last > 0) {
        t.price = p.last;
        t.prevClose = p.prevClose;
        t.ratePct = p.rate;
        t.dayVolume = p.volume; // 당일 누적 거래량 (현재가 API tvol)
        t.dayAmount = p.amount; // 당일 누적 거래대금 (현재가 API tamt)
        t.priceAt = Date.now();
        t.err = null;
        journal.updatePeak(t.symbol, p.last);
        return true;
      }
      t.err = '현재가 없음 (거래 정지 또는 종목코드 확인 필요)';
    } catch (e) {
      t.err = e.message;
    }
    return false;
  }

  async function refreshCandles(t) {
    try {
      const cs = await kis.getMinuteCandles(t.symbol, t.exchange, { interval: 5, count: 120 });
      t.candles = cs.map(toBar);
      t.candleAt = Date.now();
      const si = sessionInfo(t.candles);
      t.dayOpen = si.dayOpen;
      t.sessionBars = si.sessionBars;
    } catch (e) {
      t.err = e.message;
    }
  }

  async function refreshIndex(withCandles) {
    const q = S.index;
    try {
      const p = await kis.getPrice('QQQ', 'NAS');
      q.price = p.last;
      q.prevClose = p.prevClose;
      q.at = Date.now();
      if (withCandles || !q.candles.length) {
        q.candles = (await kis.getMinuteCandles('QQQ', 'NAS', { interval: 5, count: 80 })).map(toBar);
        const si = sessionInfo(q.candles);
        q.dayOpen = si.dayOpen;
        const today = q.candles.filter((k) => k.time && si.date && k.time.startsWith(si.date) && k.time.slice(11) >= '09:30');
        q.dayHigh = today.length ? Math.max(...today.map((k) => k.h), q.price || 0) : q.price;
      } else if (q.price > (q.dayHigh || 0)) q.dayHigh = q.price;
    } catch (e) {
      q.err = e.message;
    }
    // 노아의 방주: 실제 지수만으로 판단 (VIX 대신 QQQ)
    const drop = Math.abs(settings.rules.arkDropPct);
    if (!(q.price > 0 && q.prevClose > 0)) {
      S.ark = { state: 'unknown', reason: '지수(QQQ) 시세 없음: 신규 매수 보류' };
      return;
    }
    const chg = (q.price / q.prevClose - 1) * 100;
    const dd = q.dayHigh ? (q.price / q.dayHigh - 1) * 100 : 0;
    q.changePct = r2(chg);
    q.drawdownPct = r2(dd);
    q.gap = q.dayOpen && q.prevClose ? q.dayOpen / q.prevClose - 1 : 0;
    const prev = S.ark.state;
    const closeNow = chg <= -drop || dd <= -drop;
    const reopen = chg > -drop * 0.7 && dd > -drop * 0.7;
    if (closeNow) S.ark = { state: 'closed', reason: chg <= -drop ? `QQQ 전일 대비 ${chg.toFixed(2)}%` : `QQQ 장중 고점 대비 ${dd.toFixed(2)}%` };
    else if (prev !== 'closed' || reopen) S.ark = { state: 'open', reason: `QQQ ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` };
    if (prev !== S.ark.state && prev !== 'unknown') {
      emit('ark', 'na', S.ark.state === 'closed' ? `방주를 닫습니다. ${S.ark.reason}. 신규 매수 중지.` : `방주를 엽니다. ${S.ark.reason}.`, { ark: S.ark });
    }
  }

  // 장세: 정규장 5분봉이 닫힐 때마다 QQQ로 계산 (시장 폭은 10분마다 따로)
  async function updateRegime(ymd) {
    const q = S.index;
    if (S.qqqAvgRange.date !== ymd) {
      try {
        const bars = (await kis.getDailyBars('QQQ', 'NAS', { count: 25 })).filter((b) => b.date < ymd);
        const rs = [];
        for (let i = 1; i < bars.length; i++) if (bars[i - 1].c > 0) rs.push(((bars[i].h - bars[i].l) / bars[i - 1].c) * 100);
        const last = rs.slice(-20);
        S.qqqAvgRange = { date: ymd, pct: last.length ? last.reduce((a, b) => a + b, 0) / last.length : null };
      } catch {
        S.qqqAvgRange = { date: ymd, pct: null };
      }
    }
    const session = closedOnly(q.candles || [], clockNow()).filter((k) => k.time && k.time.startsWith(ymd) && k.time.slice(11) >= '09:30' && k.time.slice(11) < '16:00');
    const qq = qqqRegime({ session, prevClose: q.prevClose, price: q.price, avgRangePct: S.qqqAvgRange.pct });
    if (!qq) return;
    S.regime = { date: ymd, qqq: qq, breadth: S.regime.date === ymd ? S.regime.breadth : null, at: Date.now() };
    S.regimeDays[ymd] = { qqq: qq, breadth: S.regime.breadth };
    saveRegimeDays();
  }
  async function refreshBreadth(ymd) {
    const rates = {};
    for (const sym of [...SECTOR_ETFS, ...BREADTH_EXTRA]) {
      let p = await kis.getPrice(sym, S.etfEx[sym] || ETF_EX).catch(() => null);
      if (!(p?.last > 0) && !S.etfEx[sym]) {
        const r = await kis.resolveSymbol(sym).catch(() => null);
        if (r?.exchange) {
          S.etfEx[sym] = r.exchange;
          p = { last: r.last, prevClose: r.prevClose };
        }
      } else if (p?.last > 0) S.etfEx[sym] ||= ETF_EX;
      if (p?.last > 0 && p.prevClose > 0) rates[sym] = (p.last / p.prevClose - 1) * 100;
    }
    const b = breadthOf(rates, S.index.changePct ?? null);
    if (S.regime.date !== ymd) S.regime = { date: ymd, qqq: null, breadth: null, at: 0 };
    S.regime.breadth = b;
    S.regimeDays[ymd] = { ...(S.regimeDays[ymd] || {}), breadth: b };
    saveRegimeDays();
  }

  function enterEmergency(what, why) {
    if (S.emergency) return;
    S.emergency = what;
    emit('emergency', 'system', what === '잔고' ? '비상: KIS API 잔고 조회 실패, 대기 모드 전환' : `비상: KIS API ${what} 조회 실패, 대기 모드 전환`, { why }, 'error');
  }
  function leaveEmergency() {
    if (!S.emergency) return;
    S.emergency = null;
    emit('recover', 'system', 'KIS API 복구 확인, 대기 모드 해제');
  }

  // ---------------- 매수: S티어 → 노아 → 아브라함 → 여호수아 ----------------
  const aiReady = () => settings.useAi && llm?.health().ready;

  // 예상 승률: 신호를 낸 전략들 중 표본이 가장 많은 것 기준. 승격 전략은 그 청산 규칙(P1~P3)의 가상 거래, D는 D 가상 거래, 실거래는 2배 가중
  function estimateWin(hits, pEx, tgt, sl, cost) {
    const be = (sl + cost) / (tgt + sl); // 본전 승률: 이길 때 +tgt, 질 때 −sl, 왕복 비용 cost
    const fb = journal.kellyFeedback(env);
    let best = { win: 0, n: 0, be };
    for (const h of hits) {
      const sh = h.promoted && h.profile ? S.promo[h.id]?.profiles?.[h.profile] : S.health[h.id]?.shadow;
      const sN = sh?.trades || 0;
      const sW = sh?.wins || 0;
      const rN = fb[h.id]?.trades || 0;
      const rW = fb[h.id]?.wins || 0;
      const n = sN + rN;
      const win = n ? (sW + 2 * rW) / (sN + 2 * rN) : 0;
      if (n > best.n) best = { win, n, be, id: h.id };
    }
    return best;
  }

  async function govern(t, r0) {
    let r = r0;
    const ph = S.phaseInfo;
    const names = r.hits.map((h) => `[${h.id} ${STRATEGIES[h.id].name}]`).join(' ');
    const sig = { symbol: t.symbol, list: t.list, track: r.hits.some((h) => h.id === 'D') ? 'gap' : 'intraday', hits: r.hits.map((h) => h.id), price: t.price, bar: r.barKey, env };
    emit('signal', 'crawlA', `S티어 신호 포착! ${t.symbol} ${names}\n${r.hits.map((h) => `${h.id}: ${h.detail}`).join('\n')}`, { symbol: t.symbol, hits: r.hits, results: r.results });
    const block = (who, why, extra = {}) => {
      emit('gate', who, `${t.symbol} 매수 보류: ${why}`, { symbol: t.symbol, why, ...extra }, 'warn');
      journal.recordSignal({ ...sig, result: 'blocked', by: who, why });
    };
    // 전략 자동 선택: 성과가 나빠 꺼진 전략의 신호는 빼고 판단 (가상 거래로는 계속 기록)
    const offHits = r.hits.filter((h) => S.health[h.id]?.status === 'off');
    if (offHits.length) {
      const on = r.hits.filter((h) => S.health[h.id]?.status !== 'off');
      if (!on.length) return block('kang', `전략 ${offHits.map((h) => h.id).join('·')} 꺼짐: ${S.health[offHits[0].id].reason}`);
      r = { ...r, hits: on };
    }
    if (settings.control === 'manual' || !settings.autoTrade) return block('na', settings.control === 'manual' ? '사용자 수동 제어 중 (신호만 기록)' : '자동 매수 꺼짐 (BOT_AUTO_TRADE)');
    if (settings.rules.buyHalt) return block('na', '사용자 매수 중단 지침');
    if (S.emergency) return block('na', `비상 대기 (KIS ${S.emergency} 장애)`);
    if (S.ark.state !== 'open') return block('na', `방주 ${S.ark.state === 'closed' ? '닫힘' : '판단 불가'}: ${S.ark.reason}`);
    if (!S.account) return block('na', '실계좌 잔고 미확인');
    if (ph.minutesToClose != null && ph.minutesToClose <= settings.rules.noEntryLastMin) return block('na', `마감 ${ph.minutesToClose}분 전`);
    if (exec.busySymbols().has(t.symbol)) return block('trA', '같은 종목 주문 진행 중');
    if (S.guard.shutdown) return block('kang', `계좌 보호 셧다운: ${S.guard.reason}`);
    const R0 = settings.rules;
    const heldNow = heldSymbols();
    const pending = new Set(exec.active().filter((o) => o.side === 'buy').map((o) => o.symbol));
    const slots = new Set([...heldNow, ...pending]);
    if (!slots.has(t.symbol) && slots.size >= R0.maxPositions) return block('kang', `동시 보유 한도 ${R0.maxPositions}종목 (현재 ${slots.size})`);
    // 비용을 넘을 만큼 움직이는 종목인가: 5분봉 ATR% × √보유봉수 ≥ 목표 수익
    const isD = r.hits.some((h) => h.id === 'D');
    const dHit = r.hits.find((h) => h.id === 'D');
    const promoHit = r.hits.find((h) => h.promoted && h.exit);
    const closed0 = closedOnly(t.candles, clockNow());
    // 승격된 후보 전략만 신호를 낸 경우엔 그 전략의 청산 규칙(목표·보유 시간)으로 변동폭을 본다
    const pEx = !isD && promoHit ? promoHit.exit : null; // D가 아니면 승격 전략의 청산 규칙을 쓴다
    const tgt = pEx ? pEx.tpPct : R0.minTargetPct;
    const move = expectedMovePct(closed0, t.price, pEx ? pEx.holdBars : R0.holdBars);
    const cost = costPct(R0);
    if (tgt <= cost) return block('na', `목표 수익 ${tgt}%가 왕복 비용 ${cost.toFixed(2)}% 이하 (설정 확인)`);
    if (move == null) return block('na', 'ATR 계산용 5분봉 부족');
    if (move < tgt) return block('na', `예상 변동폭 ${move.toFixed(2)}% < 목표 ${tgt}% (왕복 비용 ${cost.toFixed(2)}%)`);
    const moveCap = isD ? R0.gapMaxMovePct : R0.maxMovePct;
    if (move > moveCap) return block('na', `예상 변동폭 ${move.toFixed(2)}% > 상한 ${moveCap}% (변동성 과다${isD ? ', 갭 후보 기준' : ''})`);
    const dv = dollarVolumeToday(t);
    if (dv != null && dv < R0.minDollarVolM * 1e6) {
      const cv = candleDollarVolume(t);
      return block('na', `오늘 거래대금 $${(dv / 1e6).toFixed(1)}M < 최소 $${R0.minDollarVolM}M (유동성 부족) [현재가 API 거래량 ${t.dayVolume ?? '-'}주, 5분봉 합계 $${cv == null ? '-' : (cv / 1e6).toFixed(1)}M]`);
    }
    if (!isD && R0.rvolMinEntry > 0 && t.rvol != null && t.rvol < R0.rvolMinEntry) return block('na', `상대 거래량 ${t.rvol}배 < ${R0.rvolMinEntry}배 (평소 대비 거래가 안 몰림)`);
    const rk = await risk.classify(kis, t.symbol, t.exchange, t.kr);
    t.risk = rk;
    if (rk.risky) return block('na', `위험 상품 제외: ${rk.reasons.join(', ')}`);
    if (R0.newsCheck) {
      const pi = risk.cached(t.symbol);
      const nw = await samuel.check(t.symbol, { ymd: S.phaseInfo.ny.ymd, names: [t.kr, pi?.name, pi?.engName] });
      t.news = nw;
      if (nw.block) return block('crawlB', nw.why);
      if (nw.ok && nw.catalyst !== 'none') emit('gate', 'crawlB', `${t.symbol} 뉴스 확인: ${nw.why}`, { symbol: t.symbol, news: nw });
    }

    const total = S.account.totals.total;
    const h = S.account.holdings.find((x) => x.symbol === t.symbol);
    const curW = h && total ? (h.qty * (t.price || h.price)) / total : 0;
    const tierMode = R0.sizeMode !== 'fixed' && !(R0.sizeTierUntilEquity > 0 && total >= R0.sizeTierUntilEquity);
    const capW = tierMode ? R0.maxW : Math.min(R0.maxW, R0.fixedMaxW);
    const room = Math.max(0, capW / 100 - curW);
    // 켈리는 참고용으로 늘 계산하고, 실거래가 충분히 쌓이고 계좌가 커졌을 때만 실제 수량에 쓴다
    const slUse = pEx ? pEx.slPct : R0.lossCutPct;
    const netPayoff = Math.max(0.05, (tgt - cost) / (slUse + cost));
    const sized = sizePosition({
      hits: r.hits, candles: closed0, totalEquity: total, price: t.price, currentWeight: curW, maxWeight: R0.maxW / 100, fraction: 0.5,
      observed: journal.kellyFeedback(env),
      bt: { hold: pEx ? pEx.holdBars : R0.holdBars, tpPct: tgt / 100, slPct: slUse / 100, cost: cost / 100, kellyOpts: { payoffOverride: netPayoff } },
    });
    const b = sized.best;
    const fb = journal.kellyFeedback(env);
    const observed = Math.max(0, ...r.hits.map((x) => fb[x.id]?.trades || 0));
    const useKelly = observed >= R0.minObservedForKelly && total >= R0.kellyMinEquity;
    emit('gate', 'na', `${t.symbol} 규칙 점검 통과. 예상 변동폭 ${move.toFixed(2)}% (목표 ${tgt}%, 비용 ${cost.toFixed(2)}%)`, { symbol: t.symbol });
    let w;
    let how;
    if (useKelly) {
      if (b.f <= 0) return block('kang', `실거래 ${observed}건 반영 켈리 ${(b.f * 100).toFixed(1)}% (기대값 0 이하) → 매수 안 함`, { kelly: { t: t.symbol, price: t.price, total, curW, maxW: R0.maxW / 100, cost, ...sized } });
      w = Math.min(sized.weight, room);
      how = `하프 켈리 ${(w * 100).toFixed(1)}% (실거래 ${observed}건)`;
    } else if (!tierMode) {
      w = Math.min(R0.trackPct / 100, room);
      how = `기존 방식 고정 비중 ${(w * 100).toFixed(0)}%${R0.sizeMode !== 'fixed' ? ` (계좌 $${total.toFixed(0)} ≥ $${R0.sizeTierUntilEquity}라 자동 전환)` : ''}`;
    } else {
      // 승률 단계: 이 신호에 쓰일 청산 규칙 기준 예상 승률(가상+실거래, 실거래 2배 가중) vs 본전 승률
      const est = estimateWin(r.hits, pEx, tgt, slUse, cost);
      let pct;
      let tier;
      if (est.n < R0.sizeMinSamples) {
        pct = R0.sizeUnverifiedPct;
        tier = `표본 ${est.n}/${R0.sizeMinSamples}건 (검증 전)`;
      } else {
        const edge = (est.win - est.be) * 100;
        if (edge >= R0.sizeEdgeHigh) [pct, tier] = [R0.sizeHighPct, '높음'];
        else if (edge >= R0.sizeEdgeBase) [pct, tier] = [R0.sizeBasePct, '보통'];
        else [pct, tier] = [R0.sizeLowPct, '본전 근처'];
        tier = `예상 승률 ${(est.win * 100).toFixed(0)}% vs 본전 ${(est.be * 100).toFixed(0)}% (${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%p, ${est.n}건) → ${tier}`;
      }
      w = Math.min(pct / 100, room);
      how = `${tier} · 비중 ${(w * 100).toFixed(0)}%${w < pct / 100 ? ` (종목당 한도 ${R0.maxW}%)` : ''}`;
    }
    let qty = Math.floor((total * w) / t.price);
    let oneShare = false;
    if (qty < 1 && t.price <= total * room) {
      qty = 1;
      oneShare = true;
    }
    if (qty < 1) return block('kang', `1주 가격 $${t.price}가 종목당 한도 ${capW}% ($${(total * room).toFixed(2)})를 넘음 (1주 = 계좌의 ${((t.price / total) * 100).toFixed(1)}%)`);
    const cash = S.account.cash.deposit || 0;
    if (qty * t.price > cash) {
      qty = Math.floor(cash / (t.price * 1.003));
      if (qty < 1) return block('kang', `예수금 부족 ($${cash.toFixed(2)})`);
    }
    const kellyCard = { t: t.symbol, price: t.price, total, curW, maxW: capW / 100, cost, ...sized, qty, weight: w, reason: null };
    emit('kelly', 'kang', `${t.symbol} 수량: ${how} → ${qty}주 ($${(qty * t.price).toFixed(2)})${oneShare ? ' · 0주라 1주' : ''}${useKelly ? '' : ` · 참고 켈리 ${(b.f * 100).toFixed(1)}% (실거래 ${observed}/${R0.minObservedForKelly}건${total < R0.kellyMinEquity ? `, 계좌 $${R0.kellyMinEquity} 미만` : ''}이라 켈리 미적용)`}`, { kelly: kellyCard });

    // AI 위험 점검 (노아 한 번, 막기만 함)
    const hitsIn = r.hits.map((x) => ({ id: x.id, detail: x.detail }));
    const kellyIn = { fullKelly: sized.fullKelly, weight: w, curW, maxW: R0.maxW / 100, qty, price: t.price, win: b.win, payoff: b.payoff };
    let noahAi = null;
    if (aiReady()) {
      try {
        const res = await llm.run('na', 'risk_gate', { symbol: t.symbol, exchange: t.exchange, hits: hitsIn, kelly: kellyIn });
        noahAi = res.output;
        emit('ai', 'na', `${noahAi.decision === 'BLOCK' ? '진입 차단' : '진입 허용'} (위험 ${noahAi.risk}). ${noahAi.say}\n${noahAi.reasons.map((x) => `· ${x}`).join('\n')}`, { ai: { model: res.model, fallback: res.fallback, usage: res.usage, task: '위험 점검' } });
        if (noahAi.decision === 'BLOCK') return block('na', `AI 위험 점검 차단 (${res.model})`);
      } catch (e) {
        emit('ai-error', 'na', `AI 위험 점검 실패 (${e.message}). 규칙 판단으로 진행.`, {}, 'warn');
      }
    }

    // 주문 직전 재확인
    if (settings.control === 'manual' || S.emergency || S.ark.state !== 'open' || S.phase !== 'open') return block('trA', '주문 직전 상태 변경');
    // 실제로 살 수 있는 수량 확인 (예수금이 있어도 미체결 주문·수수료·결제 전 금액 때문에 더 적을 수 있음)
    const limitPx = Math.round(t.price * 1.003 * 100) / 100;
    try {
      const bp = await kis.getBuyingPower({ symbol: t.symbol, exchange: t.exchange, price: limitPx });
      const can = bp.qty ?? bp.maxQty;
      if (can != null && can < qty) {
        if (can < 1) {
          const afterEx = bp.afterExchangeQty > 0 ? ` (원화 환전하면 ${bp.afterExchangeQty}주 가능: 통합증거금 미신청이거나 원화로만 있음)` : '';
          return block('kang', `주문가능금액 부족: KIS 주문가능 외화 $${bp.orderableUsd ?? '-'}, ${t.symbol} $${limitPx} × ${qty}주 = $${(limitPx * qty).toFixed(2)} 필요 (잔고 예수금 $${(S.account.cash.deposit || 0).toFixed(2)})${afterEx}`);
        }
        emit('gate', 'kang', `${t.symbol} KIS 주문가능수량 ${can}주라 ${qty}주 → ${can}주로 줄임 (주문가능 외화 $${bp.orderableUsd ?? '-'})`, { symbol: t.symbol, buyingPower: bp });
        qty = can;
      }
    } catch (e) {
      emit('gate', 'kang', `${t.symbol} 매수가능금액 조회 실패 (${e.message}). 잔고 예수금 기준으로 진행`, {}, 'warn');
    }
    S.cooldown[t.symbol] = Date.now();
    const track = isD ? 'gap' : 'intraday';
    const meta = { track };
    if (isD) {
      // 손절가: 시가 범위 저가와 -2% 중 가까운 쪽 (더 높은 가격)
      const pctStop = Math.round(t.price * 0.98 * 100) / 100;
      const orLow = dHit?.orLow || 0;
      meta.stopPrice = Math.max(orLow, pctStop);
      meta.stopReason = meta.stopPrice === orLow ? `시가 범위 저가 $${orLow}` : `진입가 -2% ($${pctStop})`;
      meta.orHigh = dHit?.orHigh;
      meta.orLow = orLow;
    } else if (promoHit?.exit) {
      // 승격 전략은 가상 거래에서 검증된 청산 규칙 그대로 (목표·손절·보유 시간)
      const ex = promoHit.exit;
      meta.track = 'candidate';
      meta.profile = promoHit.profile;
      meta.targetPct = ex.tpPct;
      meta.lossCutPct = ex.slPct;
      meta.holdBars = ex.holdBars;
      meta.stopPrice = Math.round(t.price * (1 - ex.slPct / 100) * 100) / 100;
      meta.stopReason = `승격 전략 ${promoHit.id} 손절 -${ex.slPct}%`;
    }
    const res = await exec.submit({ side: 'buy', symbol: t.symbol, exchange: t.exchange, qty, maxPrice: limitPx, strategies: r.hits.map((x) => x.id), meta, reason: `S티어 ${names}${isD ? ' (트랙 1)' : ''}${useKelly ? ' (켈리)' : ''}`, agent: '여호수아' });
    journal.recordSignal({ ...sig, track, result: res.ok ? 'ordered' : res.dryRun ? 'dry-run' : 'order-failed', qty, sizing: useKelly ? 'kelly' : 'fixed', oneShare, expectedMovePct: Math.round(move * 100) / 100, kelly: { f: sized.fullKelly, w: sized.weight }, ai: noahAi ? noahAi.decision : null, error: res.error });
  }

  // 오늘 거래대금: 현재가 API의 당일 누적 거래대금(tamt) → 없으면 현재가 × 당일 거래량(tvol) → 없으면 5분봉 합계
  function candleDollarVolume(t) {
    const si = sessionInfo(t.candles || []);
    if (!si.date) return null;
    return t.candles.filter((k) => k.time && k.time.startsWith(si.date) && k.time.slice(11) >= '09:30').reduce((s2, k) => s2 + k.c * (k.v || 0), 0);
  }
  function dollarVolumeToday(t) {
    if (t.dayAmount > 0) return t.dayAmount;
    if (t.dayVolume > 0 && t.price > 0) return t.dayVolume * t.price;
    return candleDollarVolume(t);
  }

  // 전략별 자동 켜기/끄기 (봉마다 다시 계산, 바뀌면 알림)
  function refreshHealth() {
    const R0 = settings.rules;
    const prevPromo = S.promo;
    const bar = promoBar();
    S.promoBar = bar;
    S.promo = evaluatePromotions(env, { ids: registry.active(), modes: settings.strategyModes, minTrades: bar.minTrades, minExp: bar.minExp, minPF: bar.minPF, minDays: bar.minDays });
    for (const [id, p] of Object.entries(S.promo)) {
      const p0 = prevPromo[id];
      if (p0 && (p0.status !== p.status || p0.profile !== p.profile)) emit('strategy', 'kang', `후보 전략 ${id} ${p.name} ${p.status === 'promoted' ? `S티어 승격 (청산 ${p.profile} ${p.exit.name}: 목표 +${p.exit.tpPct}% / 손절 -${p.exit.slPct}%)` : p.status === 'regime' ? `장세 한정 승격 (${(p.dirs || []).join('/')} · 청산 ${p.profile})` : '관찰로 내림'}: ${p.reason}`, { promo: p }, p.status === 'watch' ? 'warn' : 'info');
    }
    // 은퇴 판정 (30분마다): 은퇴 → 영구 결번, 대기열 맨 앞이 빈자리로
    if (Date.now() - (S.retireAt || 0) > 30 * 60_000) {
      S.retireAt = Date.now();
      const r = evaluateRetirements(env, { ids: registry.active(), promo: S.promo, modes: settings.strategyModes, elapsed: (id) => botDaysSince(registry.since(id)), minN: R0.retireMin, minDays: R0.retireDays, maxExp: R0.retireExp, sparseDays: R0.retireSparseDays, staleDays: R0.retireStaleDays });
      for (const x of r) {
        const added = registry.retire(x.id, x.reason);
        emit('strategy', 'kang', `전략 ${x.id} ${STRATEGIES[x.id]?.name} 은퇴 (결번): ${x.reason}${added.length ? ` → 대기열에서 ${added.map((a) => `${a} ${STRATEGIES[a]?.name}`).join(', ')} 투입` : ''}`, { retire: x, added }, 'warn');
      }
      if (r.length) {
        S.retireAt = 0;
        return refreshHealth();
      }
    }
    const prev = S.health;
    S.health = journal.strategyHealth(env, { modes: settings.strategyModes, minTrades: settings.rules.autoToggleMin });
    for (const [id, h] of Object.entries(S.health)) {
      const p0 = prev[id];
      if (p0 && p0.status !== h.status) emit('strategy', 'kang', `전략 ${id} ${STRATEGIES[id].name} ${h.status === 'off' ? '끔' : '다시 켬'}: ${h.reason}`, { health: h }, h.status === 'off' ? 'warn' : 'info');
    }
  }

  // 그림자 거래: 신호가 난 봉 종가에 샀다고 보고 목표·손절·보유 시간으로 끝까지 따라간다
  // 하루 1회: 같은 종목·전략·청산 방식은 뉴욕 기준 하루 한 번만 가상 매수 (재시작해도 기록·진행 중 목록으로 확인)
  let shadowSeen = null;
  const shadowSeenSet = () => {
    if (!shadowSeen) {
      shadowSeen = new Set();
      for (const x of journal.readLines('shadow', { limit: 3000 })) shadowSeen.add(journal.shadowDayKey(x));
      for (const x of S.shadows) shadowSeen.add(journal.shadowDayKey(x));
    }
    return shadowSeen;
  };
  const tryOpenShadow = (row) => {
    const k = journal.shadowDayKey(row);
    const seen = shadowSeenSet();
    if (seen.has(k)) return false;
    seen.add(k);
    // 매수 순간의 장세 (나중에 필터로 쓸 수 있는 정보만: 그 시점까지의 QQQ·시장 폭)
    if (S.regime.date === S.phaseInfo?.ny?.ymd) row.regime = regimeSnap(S.regime);
    S.shadows.push(row);
    return true;
  };
  const shadowTimeOk = () => S.phaseInfo?.minutesToClose == null || S.phaseInfo.minutesToClose > settings.rules.noEntryLastMin;
  function openCandShadows(t, hit, closed) {
    const last = closed[closed.length - 1];
    for (const pf of Object.values(EXIT_PROFILES)) {
      tryOpenShadow({ id: `${t.symbol}-${last.t}-${hit.id}-${pf.id}`, kind: 'candidate', env, symbol: t.symbol, exchange: t.exchange, strategies: [hit.id], profile: pf.id, track: 'intraday', entry: last.c, barT: last.t, openedAt: new Date(last.t + 5 * 60_000).toISOString(), tpPct: pf.tpPct, slPct: pf.slPct, holdBars: pf.holdBars, cost: costPct(settings.rules) });
    }
    if (S.shadows.length > 600) S.shadows.splice(0, S.shadows.length - 600);
    saveShadows();
  }
  function openShadow(t, r, closed) {
    if (!shadowTimeOk()) return;
    const R0 = settings.rules;
    const last = closed[closed.length - 1];
    const d = r.hits.find((h) => h.id === 'D');
    const entry = last.c;
    const slPct = d?.orLow ? Math.min(Math.max((entry - Math.max(d.orLow, entry * 0.98)) / entry, 0.002), 0.05) * 100 : R0.lossCutPct;
    const hitsAD = r.hits.filter((h) => !h.promoted);
    if (!hitsAD.length) return;
    tryOpenShadow({ id: `${t.symbol}-${last.t}`, env, symbol: t.symbol, exchange: t.exchange, strategies: hitsAD.map((h) => h.id), track: d ? 'gap' : 'intraday', entry, barT: last.t, openedAt: new Date(last.t + 5 * 60_000).toISOString(), tpPct: R0.minTargetPct, slPct: Math.round(slPct * 100) / 100, holdBars: R0.holdBars, cost: costPct(R0) });
    if (S.shadows.length > 600) S.shadows.splice(0, S.shadows.length - 600);
    saveShadows();
  }
  const loadShadowRecent = () => journal.dedupeShadows(journal.readLines('shadow', { limit: 300 }).reverse().filter((x) => (!x.env || x.env === env) && !x.skipped)).slice(0, 40).map((x) => ({ symbol: x.symbol, strategies: x.strategies, profile: x.profile || null, entry: x.entryFill ?? x.entry, exit: x.exit, why: x.why, pnlPct: x.pnlPct, bars: x.bars, openedAt: x.openedAt, closedAt: x.closedAt }));
  async function evaluateShadows() {
    if (!S.shadows.length) return;
    let fetched = 0;
    let filled = false;
    const done = [];
    for (const x of S.shadows) {
      let cs = S.tickers.get(x.symbol)?.candles;
      if ((!cs || !cs.some((k) => k.t > x.barT)) && fetched < 5) {
        fetched++;
        cs = (await kis.getMinuteCandles(x.symbol, x.exchange, { interval: 5, count: 120 }).catch(() => [])).map(toBar);
      }
      const after = closedOnly(cs || [], clockNow()).filter((k) => k.t > x.barT);
      // 보수적 체결 가정 (실제 주문 방식에 맞춤)
      //   진입: 신호 다음 봉 시가 + 미끄러짐. 시가가 신호가 +0.3%(실제 매수 지정가 상한)를 넘으면 실제로도 못 샀을 것 → 미체결로 버림
      //   손절: 손절가 − 미끄러짐, 시가부터 손절가 아래로 갭이 나면 시가 − 미끄러짐 / 같은 봉에서 손절·목표가 모두 닿으면 손절로 봄
      //   목표: 고가가 목표가를 0.05% 넘어서야 체결 (딱 닿기만 한 건 못 판 것으로)
      const R0 = settings.rules;
      const eSlip = (R0.shadowEntrySlipPct ?? 0.1) / 100;
      const sSlip = (R0.shadowStopSlipPct ?? 0.2) / 100;
      let exit = null;
      let why = '';
      let n = 0;
      let entry = x.fill || null;
      for (const k of after) {
        if (entry == null) {
          if (k.o > x.entry * 1.003) {
            journal.recordShadow({ ...x, kind: 'missed', origKind: x.kind || null, exit: null, bars: 0, why: '미체결 (시가가 매수 상한 +0.3% 초과)', pnlPct: null, skipped: true, closedAt: new Date(k.t).toISOString() });
            done.push(x.id);
            exit = 'skip';
            break;
          }
          entry = k.o * (1 + eSlip);
          x.fill = entry;
          filled = true;
        }
        n++;
        const stop = entry * (1 - x.slPct / 100);
        const target = entry * (1 + x.tpPct / 100);
        const day = k.time ? k.time.slice(0, 10) : null;
        if (k.o <= stop && n > 1) {
          exit = k.o * (1 - sSlip);
          why = '손절 (갭)';
        } else if (k.l <= stop) {
          exit = stop * (1 - sSlip);
          why = '손절';
        } else if (k.h >= target * 1.0005) {
          exit = target;
          why = '목표';
        } else if (n >= x.holdBars) {
          exit = k.c * (1 - eSlip);
          why = '보유 시간 만료';
        } else if (k.time && k.time.slice(11) >= '15:55') {
          exit = k.c * (1 - eSlip);
          why = '장 마감';
        } else if (day && day > new Date(x.barT).toISOString().slice(0, 10) && n === 1) {
          exit = k.o * (1 - eSlip);
          why = '장 마감';
        }
        if (exit != null) {
          const pnlPct = Math.round(((exit / entry - 1) * 100 - x.cost) * 1000) / 1000;
          journal.recordShadow({ ...x, model: 'conservative', entryFill: Math.round(entry * 10000) / 10000, exit: Math.round(exit * 10000) / 10000, bars: n, why, pnlPct, closedAt: new Date(k.t + 5 * 60_000).toISOString() });
          done.push(x.id);
          break;
        }
      }
      if (exit === 'skip') continue;
      if (exit == null && clockNow() - x.barT > 3 * 86400_000) done.push(x.id); // 봉을 못 받는 종목은 3일 뒤 버림
    }
    if (done.length) {
      S.shadows = S.shadows.filter((x) => !done.includes(x.id));
      saveShadows();
      S.shadowRecent = loadShadowRecent();
    }
  }

  async function updateRvol(t, ymd, nowMin) {
    const a = await rvol.avgVolume(kis, t.symbol, t.exchange, ymd);
    t.avgVol = a?.avgVol ?? null;
    t.rvol = rvol.rvolAt(t.dayVolume, t.avgVol, nowMin);
  }

  async function scanSignals() {
    const nowMin = S.phaseInfo.ny.min;
    const ymd = S.phaseInfo.ny.ymd;
    const R0 = settings.rules;
    refreshHealth();
    for (const t of scanList()) {
      const closed = closedOnly(t.candles, clockNow());
      if (!(t.price > 0)) await refreshPrice(t); // 새로 들어온 종목은 현재가가 아직 없을 수 있음
      await updateRvol(t, ymd, nowMin);
      // 트랙 1: 오늘의 갭 후보는 시가 범위 돌파(D)를 따로 본다 (하루 한 번만 진입 시도)
      let dRes = null;
      if (S.gapToday?.has(t.symbol)) {
        const session = closed.filter((k) => k.time && k.time.startsWith(ymd) && k.time.slice(11) >= '09:30' && k.time.slice(11) < '16:00');
        dRes = checkD({ session, prevClose: t.prevClose, nowMin, orbBars: R0.orbBars, endMin: 570 + R0.orbEndMin });
        if (S.orbDone[t.symbol] === ymd) dRes = { ...dRes, fired: false, reason: '오늘 이미 진입 시도함' };
      }
      if (closed.length < 16 && !dRes?.fired) {
        t.stier = { fired: false, hits: [], results: [], pending: `5분봉 ${closed.length}/16개 수집` };
        continue;
      }
      if (!(t.price > 0)) {
        t.stier = { fired: false, hits: [], results: [], pending: t.err ? '현재가 조회 실패' : '현재가 수집 중' };
        continue;
      }
      const r = closed.length >= 16 ? evaluateSTier(closed, { nowMin, prevClose: t.prevClose, dayOpen: t.dayOpen, indexGap: S.index.gap || 0, sessionBars: t.sessionBars }) : { fired: false, hits: [], results: [] };
      // A·B·C도 후보 전략과 같은 승격 기준: 신호는 가상 거래로 기록하고, 승격된 것만 매수 신호로 쓴다 (D는 기본 활성)
      const activeSet = new Set(registry.active());
      const abcFired = r.hits.filter((h) => activeSet.has(h.id)); // 은퇴한 A·B·C는 가상 기록도 안 함
      r.hits = [];
      r.fired = false;
      if (dRes) {
        r.results.push(dRes);
        if (dRes.fired) {
          r.hits.push(dRes);
          r.fired = true;
        }
      }
      const last = closed[closed.length - 1];
      r.barKey = String(last.t);
      // 후보 전략(E~I): 오늘 정규장 봉에서만 판정 → 신호마다 청산 규칙 3종으로 가상 거래, 승격된 것만 매수 신호에 합침
      let cands = [];
      const lastIsToday = last.time && last.time.startsWith(ymd) && last.time.slice(11) >= '09:30' && last.time.slice(11) < '16:00';
      if (R0.candidates && lastIsToday) {
        const session = closed.filter((k) => k.time && k.time.startsWith(ymd) && k.time.slice(11) >= '09:30' && k.time.slice(11) < '16:00');
        cands = evaluateCandidates({ session, closed, prevClose: t.prevClose, active: registry.active().filter((id) => !'ABC'.includes(id)) });
        const fired = [...abcFired, ...cands.filter((c) => c.fired)];
        const shadowOk = t.list === 'shadow' || t.shadowAlso || (t.list === 'gap' && R0.shadowGap !== false); // 관심 종목·AI 추천은 가상 기록 안 함
        if (shadowOk && fired.length && S.candHandled[t.symbol] !== r.barKey && shadowTimeOk()) {
          S.candHandled[t.symbol] = r.barKey;
          for (const c of fired) openCandShadows(t, c, closed);
        }
        for (const c of fired) {
          const p = S.promo[c.id];
          if (isLive(p)) {
            r.hits.push({ ...c, profile: p.profile, exit: p.exit, promoted: true });
            r.fired = true;
          }
        }
      }
      if (!(R0.candidates && lastIsToday)) for (const c of abcFired) if (isLive(S.promo[c.id])) {
        r.hits.push({ ...c, profile: S.promo[c.id].profile, exit: S.promo[c.id].exit, promoted: true });
        r.fired = true;
      }
      if (t.list === 'shadow' || t.shadowAlso) {
        r.hits = []; // 가상 전용 종목은 실매수 신호로 쓰지 않음
        r.fired = false;
      }
      t.stier = { fired: r.fired, hits: r.hits, results: r.results, cands: cands.map((c) => ({ id: c.id, fired: c.fired, detail: c.detail, reason: c.reason, promoted: isLive(S.promo[c.id]) })), promo: Object.fromEntries(Object.entries(S.promo).map(([k, v]) => [k, isLive(v)])), barKey: r.barKey, at: Date.now() };
      if (!r.fired || S.handled[t.symbol] === r.barKey) continue;
      if (Date.now() - (S.cooldown[t.symbol] || 0) < 30 * 60 * 1000) continue;
      S.handled[t.symbol] = r.barKey;
      if (dRes?.fired) S.orbDone[t.symbol] = ymd;
      openShadow(t, r, closed);
      if (S.govBusy) {
        journal.recordSignal({ symbol: t.symbol, hits: r.hits.map((h) => h.id), result: 'skipped', why: '다른 신호 결재 중', env });
        continue;
      }
      S.govBusy = true;
      govern(t, r)
        .catch((e) => emit('error', 'kang', `${t.symbol} 결재 중 오류: ${e.message}`, {}, 'error'))
        .finally(() => (S.govBusy = false));
    }
  }

  // ---------------- 매도: 모세 ----------------
  async function watchExits() {
    const busy = exec.busySymbols();
    const metas = journal.getPositions();
    const view = {};
    S.moses = view;
    const R0 = settings.rules;
    const rules = { mode: settings.control, hardStopPct: R0.hardStopPct, stopPct: R0.stop, takePct: R0.take, minTargetPct: R0.minTargetPct, lossCutPct: R0.lossCutPct, costPct: costPct(R0), maxHoldMin: R0.holdBars * 5 * 2 };
    for (const h of S.account?.holdings || []) {
      if (!(h.qty > 0)) continue;
      const t = S.tickers.get(h.symbol);
      const price = t?.price || h.price;
      if (!(price > 0)) continue;
      const meta = metas[h.symbol] || {};
      const pr = meta.targetPct ? { ...rules, fixedTake: true, minTargetPct: meta.targetPct, lossCutPct: meta.lossCutPct ?? rules.lossCutPct, maxHoldMin: meta.holdBars ? meta.holdBars * 5 * 2 : rules.maxHoldMin } : rules;
      const j = judgeExit({ symbol: h.symbol, price, avg: h.avgPrice, qty: h.qty, peak: meta.peak, trimmed: meta.trimmed, botPosition: !!(meta.strategies || []).length, stopPrice: meta.stopPrice || 0, stopReason: meta.stopReason, ageMin: meta.openedAt ? (Date.now() - Date.parse(meta.openedAt)) / 60000 : 0, candles: t ? closedOnly(t.candles, clockNow()) : [], book: t?.book ? { vbid: t.book.bidQty, vask: t.book.askQty } : null, market: { stress: (S.index.changePct ?? 0) <= -1, qqqChangePct: S.index.changePct } }, pr);
      j.at = Date.now();
      view[h.symbol] = j;
      if (j.action === 'HOLD' || busy.has(h.symbol)) continue;
      if ((S.exitLock[h.symbol] || 0) >= S.accountAt) continue; // 체결 후 잔고 재확인 전
      const sellable = h.sellableQty ?? h.qty;
      const qty = j.action === 'TRIM' ? Math.max(1, Math.floor(sellable / 2)) : sellable;
      if (qty < 1) continue;
      emit('exit', 'trB', `${h.symbol} ${j.hard ? '강제 손절' : ACTION_LABEL[j.action]} 판단 (${j.pnlPct >= 0 ? '+' : ''}${j.pnlPct.toFixed(2)}%) → ${qty}주 매도\n${j.reasons.slice(0, 3).map((x) => `· ${x}`).join('\n')}`, { symbol: h.symbol, judgment: j }, j.action === 'EXIT_STOP' ? 'warn' : 'info');
      const res = await exec.submit({ side: 'sell', symbol: h.symbol, exchange: h.quoteExchange, qty, urgency: j.urgency, reason: j.hard ? '강제 손절' : ACTION_LABEL[j.action], agent: '모세', action: j.action });
      if (j.action === 'TRIM' && (res.ok || res.dryRun)) journal.markTrimmed(h.symbol);
    }
  }

  // ---------------- 다윗 탐색 ----------------
  async function discoverRound() {
    S.discoverAt = Date.now();
    const w = watch.load();
    let r;
    try {
      r = await kis.discover({ limit: 15, exclude: w.manual.map((m) => m.code) });
    } catch (e) {
      emit('discover', 'crawlA', `탐색 API 실패: ${e.message}`, {}, 'warn');
      return;
    }
    if (r.errors?.length && !r.candidates.length) {
      emit('discover', 'crawlA', `탐색 API 응답 없음: ${r.errors[0]}`, {}, 'warn');
      return;
    }
    // 공식 분류(상품기본정보)로 위험 상품 제외
    const dropped = [];
    const safe = [];
    for (const c of r.candidates) {
      const rk = await risk.classify(kis, c.symbol, c.exchange, `${c.name} ${c.ename || ''}`);
      if (rk.risky) dropped.push(`${c.symbol}(${rk.reasons[0]})`);
      else safe.push(c);
    }
    // 목표 수익에 닿을 만큼 움직이는지(예상 변동폭), 거래가 충분한지 5분봉으로 확인한 뒤에만 넣는다
    const R0 = settings.rules;
    const weak = [];
    const fit = [];
    for (const c of safe) {
      let cs = [];
      try {
        cs = (await kis.getMinuteCandles(c.symbol, c.exchange, { interval: 5, count: 120 })).map(toBar);
      } catch {
        /* 봉이 없으면 판단 불가 → 제외 */
      }
      const closed = closedOnly(cs, clockNow());
      const mv = expectedMovePct(closed, c.last, R0.holdBars);
      const dv = dollarVolumeToday({ candles: cs, dayAmount: c.amount, dayVolume: c.volume, price: c.last });
      if (mv == null) weak.push(`${c.symbol}(5분봉 ${closed.length}개)`);
      else if (mv < R0.minTargetPct) weak.push(`${c.symbol}(변동 ${mv.toFixed(1)}%)`);
      else if (mv > R0.maxMovePct) weak.push(`${c.symbol}(변동 ${mv.toFixed(1)}% 과다)`);
      else if (dv != null && dv < R0.minDollarVolM * 1e6) weak.push(`${c.symbol}(대금 $${(dv / 1e6).toFixed(1)}M)`);
      else if (S.account && c.last > S.account.totals.total * (R0.maxW / 100)) weak.push(`${c.symbol}(1주 $${c.last} > 종목당 한도)`);
      else if (R0.rvolMin > 0 && (c.rvol = rvol.rvolAt(c.volume, (await rvol.avgVolume(kis, c.symbol, c.exchange, marketPhase().ny.ymd))?.avgVol, marketPhase().ny.min)) != null && c.rvol < R0.rvolMin) weak.push(`${c.symbol}(RVol ${c.rvol}배)`);
      else {
        c._candles = cs;
        c.expMove = mv;
        fit.push(c);
      }
    }
    r.candidates = fit;
    r.candidates.sort((a, b) => (b.rvol ?? 0) - (a.rvol ?? 0));
    const items = r.candidates.map((c) => ({ code: c.symbol, exchange: c.exchange, kr: c.name, score: c.score, reason: [c.rvol != null ? `RVol ${c.rvol}배` : '', c.surgeRate != null ? `거래량 +${Math.round(c.surgeRate)}%` : '', c.power != null ? `체결강도 ${Math.round(c.power)}` : '', `거래대금 $${((c.amount || 0) / 1e6).toFixed(0)}M`].filter(Boolean).join(' · ') }));
    let summary = '';
    if (aiReady() && items.length) {
      try {
        const res = await llm.run('crawlA', 'discover', { candidates: r.candidates });
        const views = new Map(res.output.picks.map((p) => [p.symbol, p]));
        for (const it of items) {
          const v = views.get(it.code);
          if (v) it.reason = `${v.view === 'focus' ? '★ ' : v.view === 'skip' ? '(제외 의견) ' : ''}${v.note || ''} · ${it.reason}`;
        }
        // AI가 제외(skip)한 종목은 넣지 않는다
        const skip = new Set(res.output.picks.filter((p) => p.view === 'skip').map((p) => p.symbol));
        for (let i = items.length - 1; i >= 0; i--) if (skip.has(items[i].code)) items.splice(i, 1);
        summary = `\n${res.output.summary}`;
        emit('ai', 'crawlA', res.output.say || res.output.summary, { ai: { model: res.model, fallback: res.fallback, usage: res.usage, task: '탐색 요약' } });
      } catch (e) {
        emit('ai-error', 'crawlA', `AI 탐색 요약 실패 (${e.message}). 규칙 결과만 씁니다.`, {}, 'warn');
      }
    }
    const keep = new Set([...heldSymbols(), ...[...S.tickers.values()].filter((t) => t.stier?.fired).map((t) => t.symbol)]);
    // 기존 AI 관심종목 중 목표 변동폭에 못 미치는 종목은 정리 (보유·신호 종목은 유지)
    const pruned = [];
    for (const t of [...S.tickers.values()].filter((x) => x.list === 'ai' && !keep.has(x.symbol))) {
      const mv = expectedMovePct(closedOnly(t.candles, clockNow()), t.price, settings.rules.holdBars);
      if (mv != null && mv < settings.rules.minTargetPct) {
        watch.remove('ai', t.symbol);
        pruned.push(t.symbol);
      }
    }
    watch.upsertAi(items, keep);
    tracked();
    // 새로 들어온 종목은 방금 받은 5분봉을 그대로 쓰고 현재가만 채운다
    for (const c of r.candidates) {
      const t = S.tickers.get(c.symbol);
      if (!t) continue;
      if (!t.candles.length && c._candles?.length) {
        t.candles = c._candles;
        const si = sessionInfo(t.candles);
        t.dayOpen = si.dayOpen;
        t.sessionBars = si.sessionBars;
      }
      if (!(t.price > 0)) await refreshPrice(t);
    }
    S.discover = { at: new Date().toISOString(), found: r.candidates.length, added: items.length, filters: r.filters };
    emit('discover', 'crawlA', `시장 탐색: 조건 통과 ${r.candidates.length}개 → AI 관심종목 ${items.length}개 반영${dropped.length ? `\n위험 상품 제외 ${dropped.length}개: ${dropped.slice(0, 4).join(', ')}${dropped.length > 4 ? ' …' : ''}` : ''}${pruned.length ? `\n기존 관망 종목 정리 ${pruned.length}개 (변동성 부족): ${pruned.slice(0, 5).join(', ')}` : ''}${weak.length ? `\n변동성·거래대금 부족 제외 ${weak.length}개: ${weak.slice(0, 4).join(', ')}${weak.length > 4 ? ' …' : ''}` : ''}${summary}`, { discover: S.discover, items, dropped, weak });
  }

  // ---------------- 트랙 1: 장전 갭 스캐너 ----------------
  // 뉴욕 08:30~09:25 10분마다 상승률 순위(updown-rate)에서 갭 +4~25%, $5~30, 프리마켓 거래량·대금, 시가총액, 위험 상품을 거른다.
  // 09:25 결과로 오늘의 후보를 확정. 장전 스캔을 놓쳤으면 개장 직후(09:30~09:44) 한 번 정규장 등락률로 대신 만든다.
  async function pickShadowAuto(ymd) {
    const R0 = settings.rules;
    const w = watch.load();
    const exclude = [...(R0.shadowFixed || []), ...w.manual.map((m) => m.code), ...(S.gap.date === ymd ? S.gap.items.map((g) => g.symbol) : [])];
    const r = await kis.discover({ limit: 20, exclude });
    const picks = (r.candidates || []).slice(0, R0.shadowAutoN).map((c) => ({ symbol: c.symbol, exchange: c.exchange, name: c.name || '', why: `거래대금 $${Math.round((c.amount || 0) / 1e6)}M` }));
    if (!picks.length) throw new Error(r.errors?.[0] || '후보 없음');
    S.shadowUni = { ...S.shadowUni, date: ymd, auto: picks, at: new Date().toISOString() };
    saveShadowUni();
    tracked();
    emit('discover', 'crawlA', `가상 전용 자동 종목 ${picks.length}개 (오늘 고정): ${picks.map((p) => p.symbol).join(', ')}`, { picks }, 'info');
  }

  async function gapScanRound({ final = false, source = 'pre' } = {}) {
    const R0 = settings.rules;
    const today = marketPhase().ny.ymd;
    S.gapScanAt = Date.now();
    let r;
    try {
      r = await kis.premarketGappers({ minGap: R0.gapMinPct, maxGap: R0.gapMaxPct, minPrice: R0.gapMinPrice, maxPrice: R0.gapMaxPrice, minVol: R0.gapMinPreVol, minAmount: R0.gapMinPreAmtM * 1e6 });
    } catch (e) {
      emit('gap', 'crawlA', `갭 스캔 실패: ${e.message}`, {}, 'warn');
      return;
    }
    const dropped = [];
    const pool = [];
    // 점수 상위부터 후보의 3배수까지 자세히 본다 (시총·프리마켓 RVol·뉴스)
    for (const c of r.candidates.slice(0, R0.gapTopN * 3)) {
      const rk = await risk.classify(kis, c.symbol, c.exchange, `${c.name} ${c.ename || ''}`);
      if (rk.risky) {
        dropped.push(`${c.symbol}(${rk.reasons[0]})`);
        continue;
      }
      let shares = null;
      try {
        shares = (await kis.getProductInfo(c.symbol, c.exchange))?.shares || null;
      } catch {
        /* 시가총액 확인 실패 → 표시만 '-' */
      }
      const mcapM = shares ? Math.round((shares * c.last) / 1e6) : null;
      if (mcapM != null && mcapM < R0.gapMinMcapM) {
        dropped.push(`${c.symbol}(시총 $${mcapM}M)`);
        continue;
      }
      // 프리마켓 RVol: 프리마켓 거래량 ÷ 평소 하루 거래량 (보통 0.05 안팎, 0.3 이상이면 매우 많이 몰림)
      const avg = await rvol.avgVolume(kis, c.symbol, c.exchange, today);
      const preRvol = avg?.avgVol && c.volume ? Math.round((c.volume / avg.avgVol) * 100) / 100 : null;
      let news = null;
      if (R0.newsCheck) {
        const pi = risk.cached(c.symbol);
        news = await samuel.check(c.symbol, { ymd: today, useAi: final, priority: final ? 'gap-final' : 'gap', names: [c.name, c.ename, pi?.name, pi?.engName] });
        if (news.block) {
          dropped.push(`${c.symbol}(악재 뉴스)`);
          continue;
        }
      }
      // 점수: 기존(갭·거래대금) + 프리마켓 RVol + 좋은 재료 + 상장주식수가 적으면(유통 물량이 가벼움) 가산
      const bonus = (preRvol ? Math.log2(Math.max(1, preRvol * 20)) * 0.3 : 0) + (news?.catalyst === 'positive' ? 0.5 : news?.catalyst === 'news' ? 0.15 : 0) + (shares && shares < 50e6 ? 0.3 : shares && shares < 150e6 ? 0.1 : 0);
      pool.push({ symbol: c.symbol, exchange: c.exchange, name: c.name || c.ename || '', last: c.last, gapPct: Math.round(c.rate * 100) / 100, preVol: c.volume ?? null, preAmtM: c.amount ? Math.round(c.amount / 1e5) / 10 : null, mcapM, sharesM: shares ? Math.round(shares / 1e5) / 10 : null, preRvol, avgVol: avg?.avgVol ?? null, news: news ? { catalyst: news.catalyst, why: news.why, top: news.headlines?.[0]?.title || null, ai: news.ai?.verdict || null } : null, score: Math.round((c.score + bonus) * 100) / 100 });
    }
    pool.sort((a, b) => b.score - a.score);
    const items = pool.slice(0, R0.gapTopN);
    const phaseNow = marketPhase().phase;
    // 장중 수동 스캔: 오늘 확정된 장전 후보는 지우지 않고 참고 결과만 따로 남긴다 (갭·거래량이 장전 기준이 아니게 되므로)
    if (source === 'manual' && phaseNow !== 'pre' && S.gap.date === today && S.gap.finalized) {
      S.gapPreview = { at: new Date(clockNow()).toISOString(), phase: phaseNow, items, dropped };
      emit('gap', 'crawlA', `장중 참고 스캔 (오늘 후보는 그대로): ${items.map((g) => `${g.symbol} +${g.gapPct}%`).join(', ') || '없음'}`, { preview: S.gapPreview });
      return;
    }
    const prevSet = new Set(S.gap.date === today ? S.gap.items.map((g) => g.symbol) : []);
    S.gap = { phase: phaseNow, date: today, items, finalized: final, scans: (S.gap.date === today ? S.gap.scans || 0 : 0) + 1, at: new Date(clockNow()).toISOString(), source, scanned: r.scanned, passed: r.candidates.length, filters: r.filters, errors: r.errors, dropped };
    saveGap();
    tracked();
    const changed = items.some((g) => !prevSet.has(g.symbol)) || items.length !== prevSet.size;
    if (changed || final) {
      const list = items.map((g) => `${g.symbol} +${g.gapPct}% $${g.last}${g.mcapM ? ` 시총 $${g.mcapM}M` : ''}${g.preRvol != null ? ` 프리 RVol ${g.preRvol}` : ''}${g.news?.catalyst === 'positive' ? ' [재료]' : ''}`).join(', ');
      emit('gap', 'crawlA', `${final ? '오늘의 갭 후보 확정' : '갭 스캔'}${source === 'open' ? ' (장전 스캔을 놓쳐 개장 직후 등락률로)' : ''}: ${items.length ? list : '조건 맞는 종목 없음'}${dropped.length ? `\n제외 ${dropped.length}개: ${dropped.slice(0, 5).join(', ')}` : ''}${r.errors?.length ? `\n오류: ${r.errors[0]}` : ''}`, { gap: S.gap });
    }
  }

  // ---------------- 메인 루프 ----------------
  async function tick() {
    const ph = marketPhase();
    S.phaseInfo = ph;
    if (ph.phase !== S.phase) {
      const prev = S.phase;
      S.phase = ph.phase;
      const label = { pre: '01. 장전 준비 (ET 07:00)', open: '02. 정규장 시작, 스캔·매매 가동', post: '03. 장 마감, 정산 및 야간 대기', closed: `휴장 (${ph.reason})` }[ph.phase];
      emit('phase', 'system', `${label}  · 뉴욕 ${String(ph.ny.hour).padStart(2, '0')}:${String(ph.ny.minute).padStart(2, '0')} ${ph.ny.tz}`, { phase: ph.phase });
      if (prev === 'open' && ph.phase === 'post') {
        const st = journal.stats({ env, since: new Date(Date.now() - 20 * 3600 * 1000).toISOString() });
        emit('report', 'kang', `오늘 정산: 청산 ${st.overall.trades}건, 승 ${st.overall.wins} / 패 ${st.overall.losses}, 순손익 $${st.overall.netPnl ?? 0}`, { stats: st });
      }
      if (ph.phase === 'open') S.handled = {};
    }
    tracked();
    const now = Date.now();
    const open = ph.phase === 'open';

    // 뉴스 속보 창: KIS 전체 뉴스 3분마다, 보유·갭·수동 관심종목 뉴스 10분마다 (Alpha Vantage는 안 씀)
    if (settings.rules.newsCheck && !S.newsBusy && ph.phase !== 'closed' && now - (S.newsAt || 0) > 3 * 60_000) {
      S.newsBusy = true;
      S.newsAt = now;
      (async () => {
        await samuel.refreshFeed();
        const pick = [...S.tickers.values()].filter((t) => t.list !== 'ai' && t.list !== 'shadow').slice(0, 8);
        for (const t of pick) {
          const pi = risk.cached(t.symbol);
          await samuel.check(t.symbol, { ymd: ph.ny.ymd, names: [t.kr, pi?.name, pi?.engName], useAi: false, priority: 'gap' }).catch(() => null);
        }
      })()
        .catch(() => null)
        .finally(() => (S.newsBusy = false));
    }

    // 트랙 1 갭 스캔 (뒤에서)
    if (settings.rules.gapScan && !S.gapBusy) {
      const m = ph.ny.min;
      const today = ph.ny.ymd;
      const finalizedToday = S.gap.date === today && S.gap.finalized;
      let job = null;
      if (ph.phase === 'pre' && m >= 510 && m < 565 && now - S.gapScanAt >= 10 * 60_000) job = { final: false };
      else if (ph.phase === 'pre' && m >= 565 && !finalizedToday) job = { final: true };
      else if (open && m < 585 && S.gap.date !== today && now - S.gapScanAt >= 5 * 60_000) job = { final: true, source: 'open' };
      if (job) {
        S.gapBusy = true;
        gapScanRound(job)
          .catch((e) => emit('gap', 'crawlA', `갭 스캔 오류: ${e.message}`, {}, 'warn'))
          .finally(() => (S.gapBusy = false));
      }
    }

    // 시장 폭·VIXY (섹터 ETF 11개 + RSP·SPY·VIXY): 정규장 10분마다, 뒤에서
    if (ph.phase === 'open' && !S.breadthBusy && now - S.breadthAt > 10 * 60_000) {
      S.breadthBusy = true;
      S.breadthAt = now;
      refreshBreadth(ph.ny.ymd)
        .catch(() => null)
        .finally(() => (S.breadthBusy = false));
    }

    // 가상 전용 자동 종목: 뉴욕 09:20 이후 오늘 것이 없으면 거래량 상위에서 뽑고 그날은 고정 (실패하면 10분 뒤 다시)
    if ((ph.phase === 'pre' || open) && ph.ny.min >= 560 && S.shadowUni.date !== ph.ny.ymd && !S.shadowUniBusy && now - S.shadowUniAt > 10 * 60_000 && (settings.rules.shadowAutoN || 0) > 0) {
      S.shadowUniBusy = true;
      S.shadowUniAt = now;
      pickShadowAuto(ph.ny.ymd)
        .catch((e) => emit('discover', 'crawlA', `가상 종목 자동 선정 실패: ${e.message}`, {}, 'warn'))
        .finally(() => (S.shadowUniBusy = false));
    }

    // 계좌
    const acctEvery = open ? 30_000 : ph.phase === 'pre' ? 120_000 : 600_000;
    if (now - S.accountAt >= acctEvery || (!S.account && now - S.accountAt >= 30_000)) await refreshAccount();

    // 시세
    const all = [...S.tickers.values()];
    const held = heldSymbols();
    let ok = 0;
    let tried = 0;
    if (open) {
      const heldT = all.filter((t) => held.has(t.symbol));
      const others = all.filter((t) => !held.has(t.symbol) && t.list !== 'shadow' && (t.list !== 'ai' || settings.david));
      const n = Math.max(1, Math.ceil(others.length / 3));
      const chunk = others.length ? Array.from({ length: Math.min(n, others.length) }, (_, i) => others[(S.rr + i) % others.length]) : [];
      S.rr = (S.rr + n) % Math.max(1, others.length);
      for (const t of [...heldT, ...chunk]) {
        tried++;
        if (await refreshPrice(t)) ok++;
      }
      // 가상 전용 종목은 5분봉으로 판정 → 현재가는 10분마다 (전일 종가·시가 확인용), 한 번에 2개씩
      let sh = 0;
      for (const t of all) if (t.list === 'shadow' && !held.has(t.symbol) && now - (t.priceAt || 0) > 10 * 60_000 && sh < 2) {
        sh++;
        // 고정 종목 거래소를 모르면 한 번 확인해서 저장 (NAS → NYS → AMS 순)
        if (!S.shadowUni.ex?.[t.symbol] && !SHADOW_FIXED_EX[t.symbol] && (settings.rules.shadowFixed || []).includes(t.symbol)) {
          const r = await kis.resolveSymbol(t.symbol, t.exchange).catch(() => null);
          if (r?.exchange) {
            S.shadowUni = { ...S.shadowUni, ex: { ...(S.shadowUni.ex || {}), [t.symbol]: r.exchange } };
            t.exchange = r.exchange;
            saveShadowUni();
          }
        }
        await refreshPrice(t);
      }
      // 보유 종목 1호가 (30초마다)
      for (const t of heldT) if (now - (t.bookAt || 0) > 30_000) {
        t.bookAt = now;
        t.book = await kis.getOrderbook(t.symbol, t.exchange).catch(() => t.book);
      }
    } else {
      const every = ph.phase === 'closed' ? 30 * 60_000 : 2 * 60_000;
      for (const t of all) if (now - (t.priceAt || 0) > every) {
        tried++;
        if (await refreshPrice(t)) ok++;
      }
    }
    if (tried) {
      if (ok === 0) S.priceFails++;
      else {
        if (S.emergency === '시세') leaveEmergency();
        S.priceFails = 0;
      }
      if (S.priceFails >= 3) enterEmergency('시세', all[0]?.err);
    }

    // 5분봉: 정규장은 봉이 닫힐 때마다, 그 외는 30분마다
    const bar = barStart();
    const needBars = open ? bar !== S.lastBar && clockNow() - bar > 8000 : now - S.candlesAt > 30 * 60_000;
    if (needBars) {
      S.lastBar = bar;
      S.candlesAt = now;
      await refreshIndex(true);
      if (open) await updateRegime(ph.ny.ymd).catch(() => null);
      const want = all.filter((t) => t.list !== 'ai' || settings.david || held.has(t.symbol));
      for (const t of want) await refreshCandles(t);
      if (open) {
        await scanSignals();
        await evaluateShadows().catch((e) => emit('error', 'system', `가상 거래 평가 오류: ${e.message}`, {}, 'warn'));
        // 한투에 방금 닫힌 봉이 아직 안 올라온 종목은 20초 뒤 한 번 더 받아서 판정 (한 봉 놓치지 않게)
        const expect = bar - 5 * 60_000;
        S.staleRetry = { bar, symbols: want.filter((t) => !t.candles.some((k) => k.t === expect)).map((t) => t.symbol) };
      }
    } else if (open && S.staleRetry?.bar === bar && S.staleRetry.symbols.length && clockNow() - bar > 28_000) {
      const syms = S.staleRetry.symbols;
      S.staleRetry.symbols = [];
      for (const sym of syms) {
        const t = S.tickers.get(sym);
        if (t) await refreshCandles(t);
      }
      await scanSignals();
    } else if (open && now - (S.index.at || 0) > 30_000) await refreshIndex(false);

    if (open) {
      if (S.guard.shutdown && settings.rules.flattenOnShutdown && !S.guard.flattened) {
        S.guard.flattened = true;
        saveGuard();
        await flattenBotPositions('계좌 보호 셧다운');
      }
      await watchExits();
      if (settings.rules.flattenAtClose && ph.minutesToClose != null && ph.minutesToClose <= 5) await flattenBotPositions('장 마감 전 청산');
      // 다윗 탐색은 뒤에서 따로 돌린다 (AI 요약·후보 5분봉 조회가 판정·손절 감시를 붙잡지 않게)
      if (settings.david && !S.discovering && now - S.discoverAt > settings.discoverEveryMin * 60_000) {
        S.discovering = true;
        discoverRound()
          .catch((e) => emit('discover', 'crawlA', `탐색 중 오류: ${e.message}`, {}, 'warn'))
          .finally(() => (S.discovering = false));
      }
    }
    await exec.poll();
    S.lastTick = Date.now();
    S.tickCount++;
  }

  async function flattenBotPositions(reason, all = false) {
    const metas = journal.getPositions();
    const busy = exec.busySymbols();
    for (const h of S.account?.holdings || []) {
      if (!(h.qty > 0) || busy.has(h.symbol)) continue;
      if (!all && !(metas[h.symbol]?.strategies || []).length) continue;
      emit('exit', 'trB', `${h.symbol} ${reason}: ${h.sellableQty ?? h.qty}주 매도`, { symbol: h.symbol }, 'warn');
      await exec.submit({ side: 'sell', symbol: h.symbol, exchange: h.quoteExchange, qty: h.sellableQty ?? h.qty, urgency: 'stop', reason, agent: '모세', action: 'EXIT_STOP' });
    }
  }

  async function loop() {
    S.running = true;
    try {
      refreshHealth();
    } catch {
      /* 기록 파일이 없으면 기본값 */
    }
    emit('boot', 'system', `봇 가동 · KIS ${env === 'real' ? '실전' : '모의투자'} · 주문 ${realOrders ? '실제 전송' : '잠금(주문안만)'} · AI ${llm?.health().ready ? '사용' : '꺼짐'} · 강제 손절선 -${settings.rules.hardStopPct}%`, { env, realOrders });
    while (S.running) {
      const t0 = Date.now();
      try {
        await tick();
      } catch (e) {
        emit('error', 'system', `봇 루프 오류: ${e.message}`, {}, 'error');
      }
      await sleep(Math.max(1000, TICK_MS - (Date.now() - t0)));
    }
  }

  // ---------------- 외부 API ----------------
  function state() {
    const metas = journal.getPositions();
    return {
      env,
      realOrders,
      phase: S.phase,
      phaseInfo: S.phaseInfo && { reason: S.phaseInfo.reason, ny: S.phaseInfo.ny, minutesToClose: S.phaseInfo.minutesToClose, closeMin: S.phaseInfo.closeMin },
      settings,
      emergency: S.emergency,
      guard: { ...S.guard, limitPct: settings.rules.dailyLossPct, maxPositions: settings.rules.maxPositions, positions: new Set([...heldSymbols(), ...exec.active().filter((o) => o.side === 'buy').map((o) => o.symbol)]).size },
      costPct: costPct(settings.rules),
      ark: S.ark,
      index: { symbol: 'QQQ', price: S.index.price, prevClose: S.index.prevClose, changePct: S.index.changePct ?? null, drawdownPct: S.index.drawdownPct ?? null },
      account: S.account && { env: S.account.env, fetchedAt: S.account.fetchedAt, cash: S.account.cash, totals: S.account.totals, holdings: S.account.holdings },
      accountError: S.accountError,
      health: S.health,
      promo: S.promo,
      promoBar: S.promoBar || null,
      registry: registry.view(),
      news: samuel.status(),
      shadowOpen: S.shadows.length,
      regime: S.regime.date === S.phaseInfo?.ny?.ymd ? S.regime : null,
      shadowUni: { fixed: settings.rules.shadowFixed || [], autoN: settings.rules.shadowAutoN, date: S.shadowUni.date, auto: S.shadowUni.date === S.phaseInfo?.ny?.ymd ? S.shadowUni.auto || [] : [], reset: S.shadowReset || null },
      shadows: {
        open: S.shadows.slice(-60).reverse().map((x) => ({ id: x.id, symbol: x.symbol, strategies: x.strategies, profile: x.profile || null, entry: x.entry, tpPct: x.tpPct, slPct: x.slPct, openedAt: x.openedAt, price: S.tickers.get(x.symbol)?.price ?? null })),
        recent: S.shadowRecent || (S.shadowRecent = loadShadowRecent()),
      },
      tickers: [...S.tickers.values()].map((t) => ({ rvol: t.rvol ?? null, avgVol: t.avgVol ?? null, news: (() => { const n = t.news || samuel.cached(t.symbol); return n ? { catalyst: n.catalyst, why: n.why, headlines: (n.headlines || []).slice(0, 3), ai: n.ai ? { verdict: n.ai.verdict, say: n.ai.say } : null } : null; })(), symbol: t.symbol, exchange: t.exchange, list: t.list, kr: t.kr, reason: t.reason, price: t.price, prevClose: t.prevClose, ratePct: t.ratePct ?? null, priceAt: t.priceAt || null, candles: t.list === 'shadow' ? [] : t.candles.slice(-90), stier: t.list === 'shadow' ? null : t.stier, err: t.err || null, risk: (() => { const i = risk.cached(t.symbol); const q = risk.quickCheck(t.symbol, `${t.kr} ${i?.name || ''} ${i?.engName || ''}`); return t.risk || (i || q.length ? { risky: q.length > 0 || (i && ((i.etpMultiple != null && i.etpMultiple !== 0 && i.etpMultiple !== 1) || i.ptp || i.delisted)), reasons: q, className: i?.className || null } : null); })(), expMovePct: (() => { const v = expectedMovePct(closedOnly(t.candles, clockNow()), t.price, settings.rules.holdBars); return v == null ? null : Math.round(v * 100) / 100; })() })),
      moses: S.moses,
      positions: metas,
      orders: exec.all().slice(-15),
      discover: S.discover,
      gap: { ...S.gap, today: S.gap.date === S.phaseInfo?.ny?.ymd, busy: S.gapBusy, orbDone: S.orbDone, preview: S.gapPreview || null },
      llm: llm ? llm.health() : null,
      lastTick: S.lastTick,
      tickCount: S.tickCount,
      startedAt: S.startedAt,
    };
  }

  function updateSettings(patch = {}) {
    const next = structuredClone(settings);
    for (const k of ['autoTrade', 'david', 'useAi']) if (typeof patch[k] === 'boolean') next[k] = patch[k];
    if (patch.control === 'auto' || patch.control === 'manual') next.control = patch.control;
    if (patch.strategyModes && typeof patch.strategyModes === 'object') for (const id of Object.keys(STRATEGIES)) if (['auto', 'on', 'off'].includes(patch.strategyModes[id])) next.strategyModes = { ...next.strategyModes, [id]: patch.strategyModes[id] };
    if (Number.isFinite(+patch.discoverEveryMin)) next.discoverEveryMin = Math.min(60, Math.max(3, Math.round(+patch.discoverEveryMin)));
    if (patch.rules && typeof patch.rules === 'object') {
      const R = patch.rules;
      const num = (v, lo, hi) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : undefined);
      const set = (k, v) => v !== undefined && (next.rules[k] = v);
      if (typeof R.buyHalt === 'boolean') next.rules.buyHalt = R.buyHalt;
      if (typeof R.flattenAtClose === 'boolean') next.rules.flattenAtClose = R.flattenAtClose;
      if (typeof R.flattenOnShutdown === 'boolean') next.rules.flattenOnShutdown = R.flattenOnShutdown;
      set('minTargetPct', num(R.minTargetPct, 0.5, 20));
      set('holdBars', num(R.holdBars, 3, 78));
      set('lossCutPct', num(R.lossCutPct, 0.3, 10));
      set('feePct', num(R.feePct, 0, 2));
      set('slipBufferPct', num(R.slipBufferPct, 0, 2));
      set('dailyLossPct', num(R.dailyLossPct, 0.5, 50));
      set('minDollarVolM', num(R.minDollarVolM, 0, 1000));
      set('maxMovePct', num(R.maxMovePct, 1, 100));
      if (Number.isFinite(+R.maxPositions)) next.rules.maxPositions = Math.min(50, Math.max(1, Math.round(+R.maxPositions)));
      set('maxW', num(R.maxW, 1, 100));
      set('stop', num(R.stop, -20, -0.5));
      set('take', num(R.take, 0.5, 50));
      set('hardStopPct', num(R.hardStopPct, 0.5, 20));
      set('arkDropPct', num(R.arkDropPct, 0.3, 10));
      set('noEntryLastMin', num(R.noEntryLastMin, 0, 120));
      if (typeof R.gapScan === 'boolean') next.rules.gapScan = R.gapScan;
      if (typeof R.newsCheck === 'boolean') next.rules.newsCheck = R.newsCheck;
      if (typeof R.candidates === 'boolean') next.rules.candidates = R.candidates;
      if (Number.isFinite(+R.promoteMin)) next.rules.promoteMin = Math.min(500, Math.max(10, Math.round(+R.promoteMin)));
      set('promoteExp', num(R.promoteExp, 0, 5));
      if (Number.isFinite(+R.promoteBaseSlots)) next.rules.promoteBaseSlots = Math.min(20, Math.max(1, Math.round(+R.promoteBaseSlots)));
      if (Number.isFinite(+R.retireMin)) next.rules.retireMin = Math.min(1000, Math.max(40, Math.round(+R.retireMin)));
      if (Number.isFinite(+R.retireDays)) next.rules.retireDays = Math.min(250, Math.max(5, Math.round(+R.retireDays)));
      set('retireExp', num(R.retireExp, -5, 0));
      if (Number.isFinite(+R.retireSparseDays)) next.rules.retireSparseDays = Math.min(500, Math.max(10, Math.round(+R.retireSparseDays)));
      if (Number.isFinite(+R.retireStaleDays)) next.rules.retireStaleDays = Math.min(500, Math.max(10, Math.round(+R.retireStaleDays)));
      if (typeof R.shadowGap === 'boolean') next.rules.shadowGap = R.shadowGap;
      if (Number.isFinite(+R.shadowAutoN)) next.rules.shadowAutoN = Math.min(10, Math.max(0, Math.round(+R.shadowAutoN)));
      if (Array.isArray(R.shadowFixed)) next.rules.shadowFixed = [...new Set(R.shadowFixed.map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z][A-Z.\-]{0,9}$/.test(x)))].slice(0, 15);
      set('shadowEntrySlipPct', num(R.shadowEntrySlipPct, 0, 2));
      set('shadowStopSlipPct', num(R.shadowStopSlipPct, 0, 5));
      set('promotePF', num(R.promotePF, 1, 5));
      if (Number.isFinite(+R.promoteDays)) next.rules.promoteDays = Math.min(60, Math.max(1, Math.round(+R.promoteDays)));
      set('rvolMin', num(R.rvolMin, 0, 20));
      set('rvolMinEntry', num(R.rvolMinEntry, 0, 20));
      if (Number.isFinite(+R.autoToggleMin)) next.rules.autoToggleMin = Math.min(500, Math.max(5, Math.round(+R.autoToggleMin)));
      set('gapMinPct', num(R.gapMinPct, 1, 50));
      set('gapMaxPct', num(R.gapMaxPct, 2, 200));
      set('gapMinPrice', num(R.gapMinPrice, 0.5, 500));
      set('gapMaxPrice', num(R.gapMaxPrice, 1, 2000));
      set('gapMinPreVol', num(R.gapMinPreVol, 0, 1e8));
      set('gapMinPreAmtM', num(R.gapMinPreAmtM, 0, 1000));
      set('gapMinMcapM', num(R.gapMinMcapM, 0, 1e6));
      if (Number.isFinite(+R.gapTopN)) next.rules.gapTopN = Math.min(10, Math.max(1, Math.round(+R.gapTopN)));
      if (Number.isFinite(+R.orbBars)) next.rules.orbBars = Math.min(6, Math.max(1, Math.round(+R.orbBars)));
      set('orbEndMin', num(R.orbEndMin, 20, 390));
      set('gapMaxMovePct', num(R.gapMaxMovePct, 5, 100));
      set('trackPct', num(R.trackPct, 1, 50));
      set('kellyMinEquity', num(R.kellyMinEquity, 0, 1e7));
      if (R.sizeMode === 'tier' || R.sizeMode === 'fixed') next.rules.sizeMode = R.sizeMode;
      set('sizeTierUntilEquity', num(R.sizeTierUntilEquity, 0, 1e7));
      set('fixedMaxW', num(R.fixedMaxW, 1, 100));
      for (const k of ['sizeUnverifiedPct', 'sizeBasePct', 'sizeHighPct', 'sizeLowPct']) set(k, num(R[k], 1, 100));
      set('sizeEdgeBase', num(R.sizeEdgeBase, 0, 50));
      set('sizeEdgeHigh', num(R.sizeEdgeHigh, 0, 50));
      if (Number.isFinite(+R.sizeMinSamples)) next.rules.sizeMinSamples = Math.min(500, Math.max(0, Math.round(+R.sizeMinSamples)));
      if (Number.isFinite(+R.minObservedForKelly)) next.rules.minObservedForKelly = Math.min(200, Math.max(0, Math.round(+R.minObservedForKelly)));
      if (next.rules.gapMaxPct <= next.rules.gapMinPct) next.rules.gapMaxPct = next.rules.gapMinPct + 1;
      if (next.rules.gapMaxPrice <= next.rules.gapMinPrice) next.rules.gapMaxPrice = next.rules.gapMinPrice + 1;
    }
    const changes = [];
    if (next.control !== settings.control) changes.push(next.control === 'manual' ? '사용자 수동 제어 (고정 손절·익절, 신규 매수는 제안만)' : 'AI 자동 모드');
    if (next.david !== settings.david) changes.push(`다윗 탐색 ${next.david ? 'ON' : 'OFF'}`);
    if (JSON.stringify(next.rules) !== JSON.stringify(settings.rules)) changes.push('운용 지침 변경');
    if (next.autoTrade !== settings.autoTrade) changes.push(`자동 매수 ${next.autoTrade ? 'ON' : 'OFF'}`);
    if (next.useAi !== settings.useAi) changes.push(`AI 판단 ${next.useAi ? 'ON' : 'OFF'}`);
    if (JSON.stringify(next.strategyModes) !== JSON.stringify(settings.strategyModes)) changes.push(`전략 모드 ${Object.entries(next.strategyModes).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    settings = next;
    saveSettings();
    refreshHealth();
    if (next.david) S.discoverAt = 0;
    if (changes.length) emit('settings', 'system', `설정 변경: ${changes.join(', ')}`, { settings });
    return settings;
  }

  async function userOrder({ symbol, exchange, side, qty }) {
    const sym = String(symbol || '').toUpperCase();
    const q = Math.floor(Number(qty));
    if (!/^[A-Z][A-Z.\-]{0,9}$/.test(sym) || !(q > 0) || !['buy', 'sell'].includes(side)) throw Object.assign(new Error('symbol, side(buy|sell), qty가 필요합니다.'), { status: 400 });
    if (S.phase !== 'open') throw Object.assign(new Error('정규장(뉴욕 09:30~16:00)에만 주문할 수 있습니다.'), { status: 400 });
    const t0 = S.tickers.get(sym);
    const t = S.tickers.get(sym);
    const ex = exchange || t?.exchange || S.account?.holdings.find((h) => h.symbol === sym)?.quoteExchange || 'NAS';
    if (side === 'buy') {
      if (S.guard.shutdown) throw Object.assign(new Error(`계좌 보호 셧다운 중이라 오늘은 매수할 수 없습니다 (${S.guard.reason})`), { status: 400 });
      const slots = new Set([...heldSymbols(), ...exec.active().filter((o) => o.side === 'buy').map((o) => o.symbol)]);
      if (!slots.has(sym) && slots.size >= settings.rules.maxPositions) throw Object.assign(new Error(`동시 보유 한도 ${settings.rules.maxPositions}종목에 도달했습니다.`), { status: 400 });
      const rk = await risk.classify(kis, sym, exchange || t0?.exchange || 'NAS', t0?.kr || '');
      if (rk.risky) throw Object.assign(new Error(`위험 상품이라 매수할 수 없습니다: ${rk.reasons.join(', ')}`), { status: 400 });
    }
    emit('user', 'system', `사용자 직접 주문: ${sym} ${side === 'buy' ? '매수' : '매도'} ${q}주`, {});
    if (side === 'buy') return exec.submit({ side, symbol: sym, exchange: ex, qty: q, maxPrice: t?.price ? Math.round(t.price * 1.005 * 100) / 100 : undefined, strategies: [], reason: '사용자 직접 주문', agent: '사용자' });
    return exec.submit({ side, symbol: sym, exchange: ex, qty: q, urgency: 'take', reason: '사용자 직접 주문', agent: '사용자', action: 'USER' });
  }

  return {
    start() {
      if (!S.running) loop();
    },
    stop() {
      S.running = false;
    },
    state,
    gapScan: (final = false) => gapScanRound({ final, source: 'manual' }),
    news: (limit = 60) => ({ items: samuel.feedList({ limit, symbols: [...S.tickers.values()].map((t) => ({ symbol: t.symbol, names: [t.kr, risk.cached(t.symbol)?.name, risk.cached(t.symbol)?.engName] })) }), status: samuel.status(), at: new Date().toISOString() }),
    shadowCalendar: (month) => ({ ...journal.shadowCalendar(env, month), regime: Object.fromEntries(Object.entries(S.regimeDays).filter(([k]) => k.startsWith(month))) }),
    calendar: (month) => equity.calendar(month, journal.readLines('trades', { limit: Infinity }).filter((t) => t.env === env)),
    events: () => events,
    bus,
    updateSettings,
    userOrder,
    liquidate: async () => {
      if (S.phase !== 'open') throw Object.assign(new Error('정규장에만 청산할 수 있습니다.'), { status: 400 });
      await flattenBotPositions('사용자 전량 청산 지시', true);
      return { ok: true };
    },
    discoverNow: discoverRound,
    healthy: () => S.running && Date.now() - S.lastTick < Math.max(120_000, TICK_MS * 6),
  };
}
