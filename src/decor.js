// 오피스 꾸미기 아이템 (픽셀). 자리(slot)마다 하나씩 놓을 수 있다.
//   그리기 좌표: (x = 왼쪽, y = 바닥) 기준, 1 = 오피스 1픽셀
import { OUT } from './sprites';
import * as F from './fixtures';

const r = (ctx, c, x, y, w, h) => {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
};
const box = (ctx, fill, x, y, w, h) => {
  r(ctx, OUT, x - 1, y - 1, w + 2, h + 2);
  r(ctx, fill, x, y, w, h);
};
const shadow = (ctx, x, y, w) => r(ctx, 'rgba(10,6,20,0.35)', x, y, w, 2);

// 자리: 오피스 빈 곳 (사람 다니는 길은 피함)
export const SLOTS = {
  // 기본 가구 자리 (예전 오피스에 있던 것들, 자리마다 물건 하나)
  tile: { name: '탕비실 바닥', group: 'pantry' },
  cabinet: { name: '찬장', group: 'pantry' },
  clock: { name: '벽시계', group: 'pantry' },
  pposter: { name: '탕비실 메모', group: 'pantry' },
  counter: { name: '조리대', group: 'pantry' },
  coffee: { name: '커피머신', group: 'pantry' },
  microwave: { name: '전자레인지', group: 'pantry' },
  fridge: { name: '냉장고', group: 'pantry' },
  cooler: { name: '정수기', group: 'pantry' },
  sofa: { name: '소파', group: 'lounge' },
  lamp: { name: '스탠드', group: 'lounge' },
  plantWin: { name: '창가 화분', group: 'plants' },
  plantRight: { name: '탕비실 옆 화분', group: 'plants' },
  plantCorner: { name: '왼쪽 구석 화분', group: 'plants' },
  plantMid: { name: '가운데 화분', group: 'plants' },
  // 꾸미기 자리 (자리마다 여러 물건 중 하나)
  sill: { name: '창틀 소품', group: 'deco', x: 24, y: 33, w: 12 },
  poster: { name: '벽 포스터', group: 'deco', x: 369, y: 30, w: 13 },
  shelf: { name: '벽 쪽 가구', group: 'deco', x: 3, y: 66, w: 26 },
  board: { name: '보드', group: 'deco', x: 78, y: 64, w: 28 },
  pet: { name: '반려동물', group: 'pet', x: 52, y: 219, w: 24 },
  floorB: { name: '바닥 (가운데)', group: 'floor', x: 112, y: 222, w: 26 },
  floorC: { name: '바닥 (오른쪽)', group: 'floor', x: 197, y: 222, w: 24 },
};
export const GROUPS = [
  ['pantry', '탕비실'],
  ['lounge', '라운지'],
  ['plants', '화분'],
  ['deco', '벽 · 소품'],
  ['floor', '바닥 큰 물건'],
  ['pet', '반려동물'],
];
// 직원이 쉬러 가는 자리 → 그 자리에 있어야 하는 물건 (없으면 안 감)
export const SPOT_NEEDS = { coffee: 'coffee', micro: 'microwave', fridge: 'fridge', cooler: 'cooler', sofaL: 'sofa', sofaM: 'sofa', sofaR: 'sofa', plant: 'plantRight' };

function cactus(ctx, x, y) {
  box(ctx, '#c0663c', x + 3, y - 4, 6, 4);
  r(ctx, '#d98450', x + 3, y - 4, 6, 1);
  box(ctx, '#3fb26e', x + 5, y - 12, 2, 7);
  box(ctx, '#3fb26e', x + 2, y - 10, 2, 3);
  box(ctx, '#3fb26e', x + 8, y - 11, 2, 3);
  r(ctx, '#2f8f5a', x + 5, y - 9, 1, 3);
  r(ctx, '#ff7ab8', x + 6, y - 13, 1, 1);
}
function miniTrophy(ctx, x, y) {
  box(ctx, '#6b4530', x + 2, y - 2, 8, 2);
  r(ctx, '#d8b04a', x + 5, y - 5, 2, 3);
  box(ctx, '#ffc94a', x + 2, y - 11, 8, 5);
  r(ctx, '#fff1b8', x + 3, y - 11, 2, 1);
  r(ctx, OUT, x, y - 10, 1, 3);
  r(ctx, OUT, x + 11, y - 10, 1, 3);
  r(ctx, '#ffc94a', x + 1, y - 10, 1, 2);
  r(ctx, '#ffc94a', x + 10, y - 10, 1, 2);
}
function hourglass(ctx, x, y, t) {
  r(ctx, '#6b4530', x + 2, y - 2, 8, 2);
  r(ctx, '#6b4530', x + 2, y - 14, 8, 2);
  r(ctx, OUT, x + 3, y - 12, 1, 10);
  r(ctx, OUT, x + 8, y - 12, 1, 10);
  r(ctx, '#bfe8ff', x + 4, y - 12, 4, 10);
  const k = Math.floor(t / 2) % 4;
  r(ctx, '#ffc94a', x + 4, y - 12 + k, 4, 3 - Math.min(k, 3));
  r(ctx, '#ffc94a', x + 5, y - 7, 2, 1);
  r(ctx, '#ffc94a', x + 4, y - 3 - Math.min(k, 3), 4, 1 + Math.min(k, 3));
}

function posterChart(ctx, x, y) {
  box(ctx, '#1b2a2a', x, y - 20, 12, 18);
  r(ctx, '#57e3c9', x + 1, y - 4, 10, 1);
  [[1, 7], [3, 9], [5, 8], [7, 12], [9, 15]].forEach(([dx, h], i) => r(ctx, i % 2 ? '#4d9bff' : '#ff5a5a', x + dx, y - 4 - h + 2, 2, h - 2));
  r(ctx, '#ffc94a', x + 9, y - 19, 2, 2);
}
function posterMoon(ctx, x, y) {
  box(ctx, '#1d1a3a', x, y - 20, 12, 18);
  r(ctx, '#ffe9a8', x + 6, y - 18, 4, 4);
  r(ctx, '#1d1a3a', x + 8, y - 18, 2, 2);
  r(ctx, '#efe6d2', x + 2, y - 15, 1, 1);
  r(ctx, '#efe6d2', x + 4, y - 11, 1, 1);
  r(ctx, '#efe6d2', x + 9, y - 10, 1, 1);
  r(ctx, '#ff5a5a', x + 3, y - 7, 2, 3);
  r(ctx, '#efe6d2', x + 3, y - 9, 2, 2);
  r(ctx, '#ffc94a', x + 3, y - 4, 2, 1);
}

function bookshelf(ctx, x, y) {
  shadow(ctx, x, y, 26);
  box(ctx, '#6b4530', x, y - 28, 26, 28);
  r(ctx, '#4a2f20', x + 2, y - 26, 22, 24);
  const cols = ['#ff5a5a', '#4d9bff', '#ffc94a', '#57e3c9', '#c79bff', '#efe6d2', '#ff9f6b'];
  [y - 26, y - 18, y - 10].forEach((sy, row) => {
    let bx = x + 3;
    for (let i = 0; bx < x + 22; i++) {
      const w = 2 + ((i + row) % 2);
      const h = 6 - ((i * 3 + row) % 3);
      r(ctx, cols[(i + row * 3) % cols.length], bx, sy + 7 - h, w, h);
      bx += w + 1;
    }
    r(ctx, '#8a5a3c', x + 2, sy + 7, 22, 1);
  });
}
function trophyCase(ctx, x, y, t) {
  shadow(ctx, x, y, 26);
  box(ctx, '#3a2a20', x, y - 28, 26, 28);
  r(ctx, '#2a3a44', x + 2, y - 26, 22, 24);
  r(ctx, '#8a5a3c', x + 2, y - 14, 22, 1);
  [[4, y - 15], [11, y - 15], [18, y - 15], [7, y - 3], [15, y - 3]].forEach(([dx, by], i) => {
    r(ctx, i === 2 ? '#c0c8d8' : i === 4 ? '#d08a4a' : '#ffc94a', x + dx, by - 6, 4, 3);
    r(ctx, '#d8b04a', x + dx + 1, by - 3, 2, 2);
    r(ctx, '#6b4530', x + dx, by - 1, 4, 1);
  });
  if (Math.floor(t * 1.5) % 4 === 0) r(ctx, '#ffffff', x + 5, y - 21, 1, 1);
  r(ctx, 'rgba(255,255,255,0.12)', x + 3, y - 25, 2, 22);
}

function whiteboard(ctx, x, y) {
  shadow(ctx, x + 2, y, 24);
  r(ctx, '#2b2d33', x + 4, y - 6, 1, 6);
  r(ctx, '#2b2d33', x + 23, y - 6, 1, 6);
  box(ctx, '#e9eef2', x + 1, y - 24, 26, 18);
  r(ctx, '#ff5a5a', x + 4, y - 20, 8, 1);
  r(ctx, '#4d9bff', x + 4, y - 17, 12, 1);
  r(ctx, '#4d9bff', x + 4, y - 14, 6, 1);
  [[16, 14], [18, 16], [20, 13], [22, 19]].forEach(([dx, dy]) => r(ctx, '#3fb26e', x + dx, y - dy, 2, 2));
  r(ctx, '#9aa3ad', x + 3, y - 7, 22, 1);
}
function corkboard(ctx, x, y) {
  box(ctx, '#b07a48', x + 2, y - 26, 24, 16);
  r(ctx, '#c98f58', x + 2, y - 26, 24, 1);
  [['#ffe27a', 4, 23], ['#ff9fc0', 11, 22], ['#9fe0ff', 18, 23], ['#b8f0a0', 7, 16], ['#ffe27a', 15, 15]].forEach(([c, dx, dy]) => {
    r(ctx, c, x + dx, y - dy, 5, 5);
    r(ctx, '#ff5a5a', x + dx + 2, y - dy, 1, 1);
  });
}

function cat(ctx, x, y, t) {
  shadow(ctx, x + 4, y, 16);
  const c = '#f2a65a';
  const d = '#d0843a';
  box(ctx, c, x + 6, y - 7, 11, 6);
  r(ctx, d, x + 9, y - 7, 1, 6);
  r(ctx, d, x + 12, y - 7, 1, 6);
  box(ctx, c, x + 3, y - 12, 7, 6);
  r(ctx, OUT, x + 3, y - 14, 2, 2);
  r(ctx, OUT, x + 8, y - 14, 2, 2);
  r(ctx, c, x + 4, y - 13, 1, 1);
  r(ctx, c, x + 8, y - 13, 1, 1);
  const blink = Math.floor(t * 0.7) % 6 === 0;
  r(ctx, OUT, x + 5, y - 10, 1, blink ? 1 : 2);
  r(ctx, OUT, x + 8, y - 10, 1, blink ? 1 : 2);
  r(ctx, '#ff9fc0', x + 6, y - 8, 2, 1);
  const up = Math.floor(t * 2) % 2;
  r(ctx, c, x + 17, y - 6 - up * 2, 2, 2);
  r(ctx, c, x + 18, y - 9 - up * 2, 2, 3);
  r(ctx, d, x + 18, y - 9 - up * 2, 2, 1);
}
function dog(ctx, x, y, t) {
  shadow(ctx, x + 3, y, 18);
  const c = '#e9e3d6';
  const d = '#b98a5a';
  box(ctx, c, x + 7, y - 8, 11, 6);
  r(ctx, c, x + 8, y - 2, 2, 2);
  r(ctx, c, x + 15, y - 2, 2, 2);
  box(ctx, c, x + 2, y - 14, 8, 7);
  r(ctx, d, x + 1, y - 13, 2, 5);
  r(ctx, d, x + 9, y - 13, 2, 5);
  r(ctx, OUT, x + 4, y - 11, 1, 1);
  r(ctx, OUT, x + 7, y - 11, 1, 1);
  r(ctx, OUT, x + 5, y - 9, 2, 1);
  r(ctx, '#ff5a5a', x + 7, y - 8, 4, 1);
  const wag = Math.floor(t * 4) % 2;
  r(ctx, d, x + 18, y - 10 + wag, 2, 3);
  r(ctx, '#57e3c9', x + 3, y - 7, 6, 1);
}
function fishbowl(ctx, x, y, t) {
  shadow(ctx, x + 4, y, 16);
  r(ctx, '#6b4530', x + 6, y - 6, 12, 6);
  r(ctx, '#8a5a3c', x + 6, y - 6, 12, 1);
  box(ctx, '#2a5f86', x + 4, y - 19, 16, 13);
  r(ctx, '#3f8fc0', x + 4, y - 17, 16, 2);
  r(ctx, 'rgba(255,255,255,0.35)', x + 5, y - 15, 1, 6);
  r(ctx, '#3fb26e', x + 7, y - 10, 1, 4);
  r(ctx, '#3fb26e', x + 16, y - 11, 1, 5);
  const fx = x + 8 + Math.round(4 + 3 * Math.sin(t * 1.3));
  const fy = y - 13 + Math.round(Math.sin(t * 2.1));
  const dir = Math.cos(t * 1.3) >= 0 ? 1 : -1;
  r(ctx, '#ff8a3a', fx, fy, 3, 2);
  r(ctx, '#ffb070', fx - dir, fy, 1, 2);
  if (Math.floor(t * 2) % 3 === 0) r(ctx, '#bfe8ff', x + 11, y - 18 + (Math.floor(t * 4) % 3), 1, 1);
}

function monstera(ctx, x, y) {
  shadow(ctx, x + 5, y, 16);
  box(ctx, '#e9e3d6', x + 8, y - 8, 10, 8);
  r(ctx, '#57e3c9', x + 8, y - 5, 10, 1);
  r(ctx, '#2f6b4a', x + 12, y - 22, 1, 14);
  [[2, -26, 9, 6], [13, -28, 10, 6], [4, -18, 8, 5], [14, -17, 9, 5], [8, -32, 8, 5]].forEach(([dx, dy, w, h], i) => {
    r(ctx, i % 2 ? '#2f8f5a' : '#3fb26e', x + dx, y + dy, w, h);
    r(ctx, '#1d5a3a', x + dx + Math.floor(w / 2), y + dy + 1, 1, h - 2);
  });
}
function beanbag(ctx, x, y) {
  shadow(ctx, x + 1, y, 24);
  box(ctx, '#c79bff', x + 2, y - 12, 22, 11);
  box(ctx, '#c79bff', x + 5, y - 17, 15, 6);
  r(ctx, '#a77ae0', x + 2, y - 4, 22, 3);
  r(ctx, '#e0c8ff', x + 7, y - 16, 6, 2);
  r(ctx, '#ffc94a', x + 15, y - 9, 6, 4);
  r(ctx, '#ffe9a8', x + 16, y - 9, 4, 1);
}

function arcade(ctx, x, y, t) {
  shadow(ctx, x, y, 24);
  box(ctx, '#3a2a6b', x + 2, y - 32, 20, 32);
  r(ctx, '#ff5a5a', x + 2, y - 32, 20, 4);
  r(ctx, '#ffe9a8', x + 5, y - 31, 14, 1);
  r(ctx, OUT, x + 4, y - 26, 16, 11);
  const k = Math.floor(t * 3) % 3;
  r(ctx, ['#57e3c9', '#ffc94a', '#ff7ab8'][k], x + 6, y - 24, 12, 7);
  r(ctx, OUT, x + 8 + k * 3, y - 22, 2, 2);
  r(ctx, '#2a1f50', x + 3, y - 14, 18, 4);
  r(ctx, '#ff5a5a', x + 6, y - 13, 2, 2);
  r(ctx, '#4d9bff', x + 14, y - 13, 2, 2);
  r(ctx, '#ffc94a', x + 17, y - 13, 2, 2);
  r(ctx, '#57e3c9', x + 4, y - 31, 1, 1);
}
function vending(ctx, x, y, t) {
  shadow(ctx, x, y, 24);
  box(ctx, '#d0443c', x + 1, y - 32, 22, 32);
  r(ctx, '#bfe8ff', x + 3, y - 29, 13, 22);
  const cans = ['#ffc94a', '#57e3c9', '#4d9bff', '#ff9fc0', '#efe6d2'];
  for (let row = 0; row < 4; row++) for (let i = 0; i < 4; i++) r(ctx, cans[(row + i) % 5], x + 4 + i * 3, y - 28 + row * 5, 2, 3);
  r(ctx, OUT, x + 17, y - 29, 4, 10);
  r(ctx, Math.floor(t) % 2 ? '#57e3c9' : '#1b5a50', x + 18, y - 28, 2, 2);
  r(ctx, '#2b2d33', x + 3, y - 5, 13, 3);
}
function safe(ctx, x, y, t) {
  shadow(ctx, x, y, 24);
  box(ctx, '#5c6270', x + 1, y - 22, 22, 22);
  r(ctx, '#7c8494', x + 1, y - 22, 22, 2);
  r(ctx, '#4a4f5c', x + 3, y - 19, 18, 17);
  r(ctx, '#c0c8d8', x + 9, y - 14, 6, 6);
  r(ctx, OUT, x + 11, y - 12, 2, 2);
  r(ctx, '#ffc94a', x + 4, y - 26, 6, 3);
  r(ctx, '#ffc94a', x + 11, y - 26, 6, 3);
  r(ctx, '#ffc94a', x + 7, y - 29, 7, 3);
  r(ctx, '#fff1b8', x + 8, y - 29, 3, 1);
  if (Math.floor(t * 1.5) % 3 === 0) r(ctx, '#ffffff', x + 15, y - 28, 1, 1);
}

const plantBox = (x, y, big) => ({ x: x - 8, y: y - (big ? 29 : 23), w: 17, h: big ? 32 : 26 });
export const ITEMS = [
  // 기본 가구
  { id: 'f-tile', slot: 'tile', name: '탕비실 타일 바닥', price: 30, box: { x: 254, y: 46, w: 130, h: 84 }, layers: (ctx) => [{ z: -3, draw: () => F.drawPantryFloor(ctx) }] },
  { id: 'f-cabinet', slot: 'cabinet', name: '찬장', price: 30, box: { x: 261, y: 7, w: 60, h: 18 }, layers: (ctx) => [{ z: 0, draw: () => F.drawCabinets(ctx) }] },
  { id: 'f-clock', slot: 'clock', name: '벽시계', price: 20, box: { x: 351, y: 8, w: 16, h: 16 }, layers: (ctx) => [{ z: 0, draw: () => F.drawClock(ctx) }] },
  { id: 'f-pposter', slot: 'pposter', name: '빨간 메모 포스터', price: 15, box: { x: 329, y: 10, w: 14, h: 18 }, layers: (ctx) => [{ z: 0, draw: () => F.drawPantryPoster(ctx) }] },
  { id: 'f-counter', slot: 'counter', name: '조리대', price: 80, box: { x: 260, y: 48, w: 64, h: 27 }, layers: (ctx) => [{ z: 74, draw: () => F.drawCounterBase(ctx) }] },
  { id: 'f-coffee', slot: 'coffee', name: '커피머신', price: 60, needs: 'counter', box: { x: 274, y: 22, w: 18, h: 35 }, layers: (ctx, t, info) => [{ z: 74.1, draw: () => F.drawCoffee(ctx, t, info.coffeeBusy) }] },
  { id: 'f-microwave', slot: 'microwave', name: '전자레인지', price: 40, needs: 'counter', box: { x: 298, y: 41, w: 20, h: 12 }, layers: (ctx) => [{ z: 74.2, draw: () => F.drawMicrowave(ctx) }] },
  { id: 'f-fridge', slot: 'fridge', name: '냉장고', price: 90, box: { x: 323, y: 26, w: 24, h: 49 }, layers: (ctx) => [{ z: 74, draw: () => F.drawFridge(ctx) }] },
  { id: 'f-cooler', slot: 'cooler', name: '정수기', price: 50, box: { x: 350, y: 40, w: 18, h: 38 }, layers: (ctx) => [{ z: 77, draw: () => F.drawCooler(ctx) }] },
  {
    id: 'f-sofa', slot: 'sofa', name: '소파 + 러그', price: 180, box: { x: 279, y: 149, w: 102, h: 68 },
    layers: (ctx) => [{ z: -1, draw: () => F.drawRug(ctx) }, { z: 176, draw: () => F.drawSofaBack(ctx) }, { z: 191, draw: () => F.drawSofaFront(ctx) }],
  },
  {
    id: 'f-lamp', slot: 'lamp', name: '스탠드 조명', price: 40, box: { x: 358, y: 186, w: 28, h: 30 },
    layers: (ctx, t, info) => [...(info.night || info.preview ? [] : [{ z: -2, draw: () => F.drawLampPool(ctx, info.lampA) }]), { z: 214, draw: () => F.drawLamp(ctx) }],
  },
  { id: 'f-plantWin', slot: 'plantWin', name: '창가 화분', price: 15, box: plantBox(190, 64), layers: (ctx) => [{ z: 68, draw: () => F.drawPlant(ctx, 190, 64, false) }] },
  { id: 'f-plantRight', slot: 'plantRight', name: '탕비실 옆 화분', price: 15, box: plantBox(376, 124), layers: (ctx) => [{ z: 118, draw: () => F.drawPlant(ctx, 376, 124, false) }] },
  { id: 'f-plantCorner', slot: 'plantCorner', name: '큰 화분', price: 25, box: plantBox(8, 222, true), layers: (ctx) => [{ z: 216, draw: () => F.drawPlant(ctx, 8, 222, true) }] },
  { id: 'f-plantMid', slot: 'plantMid', name: '작은 화분', price: 15, box: plantBox(232, 222), layers: (ctx) => [{ z: 216, draw: () => F.drawPlant(ctx, 232, 222, false) }] },
  // 꾸미기
  { id: 'cactus', slot: 'sill', name: '선인장', price: 20, draw: cactus },
  { id: 'hourglass', slot: 'sill', name: '모래시계', price: 40, draw: hourglass },
  { id: 'minitrophy', slot: 'sill', name: '미니 트로피', price: 60, draw: miniTrophy },
  { id: 'p-chart', slot: 'poster', name: '상승 차트 포스터', price: 50, draw: posterChart },
  { id: 'p-moon', slot: 'poster', name: '투더문 포스터', price: 50, draw: posterMoon },
  { id: 'bookshelf', slot: 'shelf', name: '책장', price: 80, draw: bookshelf },
  { id: 'trophycase', slot: 'shelf', name: '트로피 장식장', price: 220, draw: trophyCase },
  { id: 'corkboard', slot: 'board', name: '메모 게시판', price: 50, draw: corkboard },
  { id: 'whiteboard', slot: 'board', name: '화이트보드', price: 70, draw: whiteboard },
  { id: 'fishbowl', slot: 'pet', name: '금붕어 어항', price: 90, draw: fishbowl },
  { id: 'cat', slot: 'pet', name: '고양이', price: 150, draw: cat },
  { id: 'dog', slot: 'pet', name: '강아지', price: 150, draw: dog },
  { id: 'monstera', slot: 'floorB', name: '몬스테라', price: 40, draw: monstera },
  { id: 'beanbag', slot: 'floorB', name: '빈백 소파', price: 90, draw: beanbag },
  { id: 'vending', slot: 'floorC', name: '음료 자판기', price: 160, draw: vending },
  { id: 'arcade', slot: 'floorC', name: '오락기', price: 300, draw: arcade },
  { id: 'safe', slot: 'floorC', name: '황금 금고', price: 500, draw: safe },
];
export const ITEM = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

// 오피스 캔버스에 놓기: equip = { slot: itemId }
export const isPlaced = (equip, slot) => {
  const it = ITEM[(equip || {})[slot]];
  return !!it && it.slot === slot && (!it.needs || isPlaced(equip, it.needs));
};
export function decorDrawables(ctx, equip, t, info = {}) {
  return Object.entries(equip || {})
    .filter(([slot]) => isPlaced(equip, slot))
    .flatMap(([slot, id]) => {
      const it = ITEM[id];
      if (it.layers) return it.layers(ctx, t, info);
      return [{ z: SLOTS[slot].y, draw: () => it.draw(ctx, SLOTS[slot].x, SLOTS[slot].y, t) }];
    });
}
export const spotNeeds = (equip, spotId) => !SPOT_NEEDS[spotId] || isPlaced(equip, SPOT_NEEDS[spotId]);

// 미리보기 (상점 카드 · 플래너 빈칸): 아이템을 작은 캔버스 가운데에 그린다
export function drawItemPreview(canvas, id, t = 0, scale = 3) {
  const it = ITEM[id];
  const ctx = canvas.getContext('2d');
  if (it && it.box) {
    // 기본 가구: 오피스 좌표 그대로 그리고 그 부분만 잘라 보여 준다
    const b = it.box;
    canvas.width = (b.w + 4) * scale;
    canvas.height = (b.h + 4) * scale;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(scale, 0, 0, scale, (-b.x + 2) * scale, (-b.y + 2) * scale);
    it.layers(ctx, t, { preview: true, coffeeBusy: true, lampA: 1, night: true }).sort((p, q) => p.z - q.z).forEach((l) => l.draw());
    return;
  }
  const w = 34;
  const h = 36;
  canvas.width = w * scale;
  canvas.height = h * scale;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!it) return;
  const sw = SLOTS[it.slot].w;
  it.draw(ctx, Math.floor((w - sw) / 2), h - 2, t);
}

// ---------- 코인 ----------
// 번 코인은 지금 기록에서 매번 다시 계산한다 (따로 장부 없음 → 체크를 풀면 코인도 빠짐)
export const EARN = { todo: 5, list: 3, habit: 2, review: 1, goalBonus: 10, goalCards: 20 };
export function coinsOf(data) {
  const d = data || {};
  let todo = 0;
  let habit = 0;
  Object.values(d.weeks || {}).forEach((w) => {
    todo += (w.todo || []).filter((x) => x && x.t && x.done).length;
    (w.habits || []).forEach((h) => h && h.name && (habit += (h.d || []).filter(Boolean).length));
  });
  const list = (d.lists?.check || []).filter((x) => x && x.t && x.done).length + (d.lists?.wish || []).filter((x) => x && x.t && x.done).length;
  const log = d.study?.log || {};
  const reviews = Object.values(log).reduce((a, n) => a + (n || 0), 0);
  const goalDays = Object.values(log).filter((n) => n >= EARN.goalCards).length;
  const earned = todo * EARN.todo + list * EARN.list + habit * EARN.habit + reviews * EARN.review + goalDays * EARN.goalBonus;
  const spent = (d.room?.owned || []).reduce((a, id) => a + (ITEM[id]?.price || 0), 0);
  return { earned, spent, balance: earned - spent, parts: { todo, list, habit, reviews, goalDays } };
}
