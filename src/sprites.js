// Pixel sprite definitions (12 x 18 body, drawn into 16 x 24 frames with 2,4 offset)
export const OUT = '#1a1326';

const HEAD_D = [
  '...oooooo...',
  '..ohhHHhhho.',
  '.ohhhhhhhhho',
  '.ohhhhhhhhho',
  '.ohsssssssho',
  '.ossesssesso',
  '.osbsssssbso',
  '..osssssso..',
];
const HEAD_U = [
  '...oooooo...',
  '..ohhHHhhho.',
  '.ohhhhhhhhho',
  '.ohhhhhhhhho',
  '.ohhhhhhhhho',
  '.ohhhhhhhhho',
  '.oshhhhhhhso',
  '..ohhhhhho..',
];
const TORSO_D = [
  '..ottaatto..',
  '.otttaattto.',
  'osttTaaTttso',
  'osttttttttso',
  '.oppppppppo.',
];
const TORSO_U = TORSO_D.map((r) => r.replace(/a/g, 't'));
const TORSO_SIT = [
  '..ottaatto..',
  '.otttaattto.',
  'otttTaaTttto',
  'otttttttttto',
  '.oppppppppo.',
];
const LEGS = {
  stand: ['..oppppppo..', '..oppo.oppo.', '..oppo.oppo.', '..offo.offo.', '...oo...oo..'],
  A: ['..oppppppo..', '..oppo.oppo.', '..offo.oppo.', '...oo..offo.', '........oo..'],
  B: ['..oppppppo..', '..oppo.oppo.', '..oppo.offo.', '..offo..oo..', '...oo.......'],
};

function paint(ctx, rows, pal, ox, oy) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (c === '.') continue;
      ctx.fillStyle = c === 'o' ? OUT : c === 'f' ? '#24181a' : pal[c];
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  });
}

function px(ctx, color, pts, ox, oy) {
  ctx.fillStyle = color;
  pts.forEach(([x, y]) => ctx.fillRect(ox + x, oy + y, 1, 1));
}

function accessories(ctx, kind, view, ox, oy, pal) {
  const glow = (pal && pal.g) || '#57e3c9';
  if (kind === 'antenna') {
    px(ctx, '#8e9bbd', [[6, -1], [6, -2], [6, -3]], ox, oy);
    px(ctx, glow, [[5, -4], [6, -4], [5, -5], [6, -5]], ox, oy);
    if (view === 'down') {
      px(ctx, '#163a44', [[2, 5], [3, 5], [5, 5], [6, 5], [7, 5], [9, 5]], ox, oy);
      px(ctx, glow, [[4, 5], [8, 5]], ox, oy);
    }
  }
  if (kind === 'glasses' && view === 'down') {
    px(ctx, '#2a2238', [[3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [3, 5], [5, 5], [7, 5], [9, 5]], ox, oy);
    px(ctx, '#bfe8ff', [[4, 5], [8, 5]], ox, oy);
    px(ctx, OUT, [[4, 6], [8, 6]], ox, oy);
  }
  if (kind === 'headset') {
    px(ctx, '#2b2b38', [[0, 3], [1, 3], [0, 4], [1, 4], [0, 5], [1, 5], [10, 3], [11, 3], [10, 4], [11, 4], [10, 5], [11, 5], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0]], ox, oy);
    if (view === 'down') {
      px(ctx, '#2b2b38', [[2, 6], [3, 7], [4, 7]], ox, oy);
      px(ctx, '#ff5a5a', [[5, 7]], ox, oy);
    }
  }
  if (kind === 'longhair') {
    const h = pal.h;
    if (view === 'down') {
      const side = [];
      for (let y = 4; y <= 10; y++) side.push([1, y], [10, y]);
      px(ctx, h, side, ox, oy);
      const o = [];
      for (let y = 4; y <= 11; y++) o.push([0, y], [11, y]);
      o.push([1, 11], [10, 11]);
      px(ctx, OUT, o, ox, oy);
      px(ctx, h, [[2, 4], [3, 4], [8, 4], [9, 4]], ox, oy);
      px(ctx, '#f6efe0', [[1, 7], [10, 7]], ox, oy);
    } else {
      const back = [];
      for (let y = 8; y <= 11; y++) for (let x = 2; x <= 9; x++) back.push([x, y]);
      px(ctx, h, back, ox, oy);
      px(ctx, OUT, [[1, 8], [1, 9], [1, 10], [1, 11], [10, 8], [10, 9], [10, 10], [10, 11], [2, 12], [3, 12], [4, 12], [5, 12], [6, 12], [7, 12], [8, 12], [9, 12]], ox, oy);
    }
  }
  if (kind === 'exec' && view === 'down') {
    px(ctx, '#d8b04a', [[3, 4], [4, 4], [5, 4], [7, 4], [8, 4], [9, 4], [6, 4], [3, 5], [5, 5], [7, 5], [9, 5]], ox, oy);
    px(ctx, '#bfb8cc', [[4, 7], [5, 7], [6, 7], [7, 7]], ox, oy);
  }
  if (kind === 'lead' && view === 'down') {
    px(ctx, '#e9e3f5', [[2, 1], [3, 1]], ox, oy);
    px(ctx, '#5a4a40', [[5, 7], [6, 7]], ox, oy);
  }
}

function frame(rows, pal, acc, view) {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 24;
  const ctx = c.getContext('2d');
  paint(ctx, rows, pal, 2, 6);
  accessories(ctx, acc, view, 2, 6, pal);
  return c;
}

// frame canvases are 16x24; body rows start at y=6, feet bottom at y=24
export function buildSprites(a) {
  const pal = a.pal;
  return {
    d_stand: frame([...HEAD_D, ...TORSO_D, ...LEGS.stand], pal, a.acc, 'down'),
    d_A: frame([...HEAD_D, ...TORSO_D, ...LEGS.A], pal, a.acc, 'down'),
    d_B: frame([...HEAD_D, ...TORSO_D, ...LEGS.B], pal, a.acc, 'down'),
    u_stand: frame([...HEAD_U, ...TORSO_U, ...LEGS.stand], pal, a.acc, 'up'),
    u_A: frame([...HEAD_U, ...TORSO_U, ...LEGS.A], pal, a.acc, 'up'),
    u_B: frame([...HEAD_U, ...TORSO_U, ...LEGS.B], pal, a.acc, 'up'),
    sit: frame([...HEAD_D, ...TORSO_SIT], pal, a.acc, 'down'),
  };
}

export function makeAvatar(a, scale = 4) {
  const s = buildSprites(a).d_stand;
  const c = document.createElement('canvas');
  c.width = 16 * scale;
  c.height = 16 * scale;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s, 0, 0, 16, 16, 0, 0, 16 * scale, 16 * scale);
  return c.toDataURL();
}

export const DEPTS = [
  { id: 'collect', name: '수집부', model: '제미나이', motto: '눈과 귀', color: '#57e3c9' },
  { id: 'analysis', name: '분석부', model: '클로드', motto: '두뇌', color: '#ffc94a' },
  { id: 'risk', name: '리스크부', model: '클로드', motto: '방패', color: '#c79bff' },
  { id: 'exec', name: '실행부', model: '제미나이', motto: '손발', color: '#ff8a5a' },
];

// duty: which schedule modes each agent works in
const D_ALL = { pre: true, open: true, post: true };
export const AGENTS = [
  {
    id: 'crawlA', name: '다윗', en: 'David', role: '속도 중심 스캐너', dept: 'collect', color: '#57e3c9', desk: 0, acc: 'antenna', screen: 'book',
    persona: '돌팔매처럼 빠르다. 거래량이 튀는 순간을 누구보다 먼저 맞힌다.',
    tasks: ['관심종목 5분봉 S티어(A·B·C) 신호 포착', 'KIS 거래량급증·체결강도 순위로 시장 탐색 (탐색 모드 ON)', '탐색 후보 AI 분류: 집중·관망·제외'],
    duty: { pre: true, open: true, post: false },
    pal: { h: '#8e9bbd', H: '#cfd8ee', s: '#c3cde6', e: '#4ff0d8', b: '#9fb0d6', t: '#2f6b7a', T: '#245562', a: '#57e3c9', p: '#2a2f4a', g: '#57e3c9' },
  },
  {
    id: 'crawlB', name: '사무엘', en: 'Samuel', role: '재료 정보통 (KIS 해외뉴스)', dept: 'collect', color: '#a6e36b', desk: 1, acc: 'antenna', screen: 'log',
    persona: '귀가 밝은 선지자형 정보통. 공시 한 줄, 뉴스 한 줄도 놓치지 않는다.',
    tasks: ['공시·뉴스 데이터 소스가 아직 연결되지 않음', '연결 전까지 매매 판단에 관여하지 않음'],
    duty: { pre: true, open: true, post: false },
    pal: { h: '#a48fbf', H: '#d9cdea', s: '#d5cbe6', e: '#a6e36b', b: '#b3a3cf', t: '#5b4a8a', T: '#47396f', a: '#a6e36b', p: '#2a2f4a', g: '#a6e36b' },
  },
  {
    id: 'cha', name: '솔로몬', en: 'Solomon', role: '퀀트 분석', dept: 'analysis', color: '#ffc94a', desk: 2, acc: 'glasses', screen: 'candle',
    persona: '지혜로운 판관. 감이 아니라 숫자로 차트를 판결한다.',
    tasks: ['S티어 지표: 볼린저·ATR·RSI·거래량 배수 (실제 5분봉)', '모세 판단용 이평·MACD·RSI 계산'],
    duty: { pre: true, open: true, post: false },
    pal: { h: '#3b2a24', H: '#5e4438', s: '#f3c9a0', e: OUT, b: '#ec9a8a', t: '#e9e4d6', T: '#c8c0ad', a: '#d0443c', p: '#3a4a73' },
  },
  {
    id: 'ju', name: '요셉', en: 'Joseph', role: '펀더멘털 분석 (데이터 미연결)', dept: 'analysis', color: '#ff9f6b', desk: 3, acc: 'longhair', screen: 'bars',
    persona: '7년 풍년과 7년 흉년을 내다본 해석가. 실적의 사이클을 읽는다.',
    tasks: ['재무·실적 데이터 소스가 아직 연결되지 않음', '연결 전까지 매매 판단에 관여하지 않음'],
    duty: { pre: true, open: true, post: false },
    pal: { h: '#2a2036', H: '#4a3a5e', s: '#f5d0ae', e: OUT, b: '#f09a9a', t: '#3f8f7b', T: '#2f6f5f', a: '#f6efe0', p: '#34405e' },
  },
  {
    id: 'na', name: '노아', en: 'Noah', role: '진입 차단관', dept: 'risk', color: '#c79bff', desk: 4, acc: 'lead', screen: 'bars',
    persona: '홍수를 먼저 본 사람. 변동성이 차오르면 망설임 없이 방주를 닫는다.',
    tasks: ['QQQ 전일 대비·장중 고점 대비 하락으로 방주 열고 닫기', '규칙 점검: 매수 중단·비상 대기·잔고·마감 임박', 'AI 위험 점검 (Claude / Gemini): 차단만 가능'],
    duty: D_ALL,
    pal: { h: '#77768a', H: '#a8a7bb', s: '#e8b98f', e: OUT, b: '#e0907c', t: '#2f3a6b', T: '#232c55', a: '#f2c14e', p: '#23284a' },
  },
  {
    id: 'kang', name: '아브라함', en: 'Abraham', role: '비중 조절관 · 최종 결재권자', dept: 'risk', color: '#ff7ab8', desk: 5, acc: 'exec', screen: 'doc',
    persona: '믿음의 조상이자 최종 결재권자. 의견이 갈리면 그의 도장이 결론이다.',
    tasks: ['켈리 공식 수량 (봉 백테스트 + 실거래 기록 반영)', 'AI 최종 결재: 승인·축소·반려 (늘리기 불가)', '장 마감 후 일일 정산'],
    duty: D_ALL,
    pal: { h: '#e6e2f0', H: '#ffffff', s: '#e2b089', e: OUT, b: '#d88a78', t: '#26233a', T: '#18162a', a: '#d0443c', p: '#1a1826' },
  },
  {
    id: 'trA', name: '여호수아', en: 'Joshua', role: '최적 체결관', dept: 'exec', color: '#ff5a5a', desk: 6, acc: 'headset', screen: 'book',
    persona: '여리고 성을 돈 행진처럼, 정해진 순서대로 진입한다.',
    tasks: ['최우선 매도호가 지정가 매수 (상한 +0.3%)', '60초 미체결 시 잔량 취소, 추격 매수 안 함'],
    duty: { pre: false, open: true, post: true },
    pal: { h: '#e07a3c', H: '#f4a66a', s: '#f6cfa6', e: OUT, b: '#f09a86', t: '#b83b4a', T: '#922c3a', a: '#f6efe0', p: '#2e2a3e' },
  },
  {
    id: 'trB', name: '모세', en: 'Moses', role: '익절·손절 감시관', dept: 'exec', color: '#4d9bff', desk: 7, acc: 'headset', screen: 'candle',
    persona: '고정된 수치에 얽매이지 않고 추세와 호가 흐름을 읽어 손익절 타이밍을 조율한다. 단, 강제 손절선은 절대 넘기지 않는다.',
    tasks: ['강제 손절선 상시 감시 (브라우저 꺼져도 서버가 집행)', '실제 5분봉·1호가 잔량·QQQ로 손절/익절/트레일링 판단', '미체결 시 단계적 가격 하향 재주문 (시장가 정산)'],
    duty: { pre: false, open: true, post: true },
    pal: { h: '#2b3a66', H: '#41558a', s: '#eac3a0', e: OUT, b: '#e39a86', t: '#2f6fc0', T: '#25579a', a: '#f6efe0', p: '#2e2a3e' },
  },
];
