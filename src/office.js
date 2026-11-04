import { AGENTS, DEPTS, buildSprites, OUT } from './sprites';

export const W = 384;
export const H = 224;
const WALL = 48;

export const PODS = [
  { x: 14, y: 84, dept: 'collect' },
  { x: 128, y: 84, dept: 'analysis' },
  { x: 14, y: 152, dept: 'risk' },
  { x: 128, y: 152, dept: 'exec' },
];
// two desks per pod, separated by a partition; left desk is mirrored so monitors face the partition
const DESKS = PODS.flatMap((p) => [
  { x: p.x, y: p.y, mirror: true, pod: p },
  { x: p.x + 52, y: p.y, mirror: false, pod: p },
]);
const LANE_X = 240;

export const SPOTS = [
  { id: 'coffee', label: '커피머신', x: 280, y: 88, lane: 122, face: 'up' },
  { id: 'micro', label: '전자레인지', x: 306, y: 88, lane: 122, face: 'up' },
  { id: 'fridge', label: '냉장고', x: 334, y: 88, lane: 122, face: 'up' },
  { id: 'cooler', label: '정수기', x: 359, y: 90, lane: 122, face: 'up' },
  { id: 'window', label: '창가', x: 228, y: 64, lane: 122, face: 'up' },
  { id: 'sofaL', label: '소파', x: 304, y: 188, lane: 206, face: 'down', sit: true },
  { id: 'sofaM', label: '소파', x: 328, y: 188, lane: 206, face: 'down', sit: true },
  { id: 'sofaR', label: '소파', x: 352, y: 188, lane: 206, face: 'down', sit: true },
  { id: 'pace', label: '라운지', x: 262, y: 158, lane: 158, face: 'down', pace: true },
  { id: 'plant', label: '화분 옆', x: 366, y: 140, lane: 140, face: 'up' },
  { id: 'rug', label: '라운지', x: 262, y: 212, lane: 212, face: 'down' },
];

const OFF_LINES = ['오늘은 제 근무 시간이 아니에요', '대기 중! 필요하면 불러주세요', '커피 한 잔의 여유', '잠깐 충전 중...', '퇴근각 재는 중', '다음 근무 때 봬요'];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function seatOf(d) {
  return { x: d.mirror ? d.x + 18 : d.x + 30, y: d.y + 4 };
}

function routeTo(d, spot) {
  const seat = seatOf(d);
  const cy = d.y + 38;
  const ex = d.mirror ? d.x - 6 : d.x + 54;
  return [
    { x: ex, y: seat.y },
    { x: ex, y: cy },
    { x: LANE_X, y: cy },
    { x: LANE_X, y: spot.lane },
    { x: spot.x, y: spot.lane },
    { x: spot.x, y: spot.y },
  ];
}
function hop(from, to) {
  return [
    { x: from.x, y: from.lane },
    { x: LANE_X, y: from.lane },
    { x: LANE_X, y: to.lane },
    { x: to.x, y: to.lane },
    { x: to.x, y: to.y },
  ];
}

// ---------- static background ----------
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function drawBackground(ctx, phase) {
  const day = phase === 'day';
  const dusk = phase === 'dusk';
  const r = seeded(7);
  // floor: wood planks
  ctx.fillStyle = '#4a3127';
  ctx.fillRect(0, WALL, W, H - WALL);
  for (let y = WALL; y < H; y += 8) {
    ctx.fillStyle = '#3a251e';
    ctx.fillRect(0, y, W, 1);
    const off = ((y / 8) % 2) * 20;
    for (let x = off; x < W; x += 40) {
      ctx.fillRect(x, y, 1, 8);
    }
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = r() > 0.5 ? '#553a2e' : '#432c23';
      ctx.fillRect(Math.floor(r() * W), y + 2 + Math.floor(r() * 5), 2 + Math.floor(r() * 4), 1);
    }
  }
  // pantry checker
  for (let y = WALL; y < 128; y += 8) {
    for (let x = 256; x < W; x += 8) {
      ctx.fillStyle = ((x + y) / 8) % 2 ? '#3a3c41' : '#47494f';
      ctx.fillRect(x, y, 8, 8);
    }
  }
  ctx.fillStyle = '#2b2d33';
  ctx.fillRect(256, 128, W - 256, 1);
  ctx.fillRect(255, WALL, 1, 80);
  // lounge rug
  ctx.fillStyle = '#4b2440';
  ctx.fillRect(280, 150, 100, 66);
  ctx.fillStyle = '#6e3560';
  ctx.fillRect(282, 152, 96, 62);
  ctx.fillStyle = '#4b2440';
  ctx.fillRect(286, 156, 88, 54);
  ctx.fillStyle = '#7d4470';
  for (let y = 160; y < 208; y += 6) for (let x = 290; x < 372; x += 6) if (((x + y) / 6) % 2 < 1) ctx.fillRect(x, y, 1, 1);
  // work-area rug (subtle)
  ctx.fillStyle = 'rgba(18,19,22,0.3)';
  ctx.fillRect(8, 68, 112, 46);
  ctx.fillRect(122, 68, 112, 46);
  ctx.fillRect(8, 136, 112, 46);
  ctx.fillRect(122, 136, 112, 46);

  // wall
  ctx.fillStyle = '#2a2b2f';
  ctx.fillRect(0, 0, W, WALL);
  ctx.fillStyle = '#1e1f22';
  ctx.fillRect(0, 0, W, 4);
  ctx.fillStyle = '#36383d';
  ctx.fillRect(0, 36, W, 10);
  ctx.fillStyle = '#2f3135';
  for (let x = 6; x < W; x += 24) ctx.fillRect(x, 37, 1, 9);
  ctx.fillStyle = '#45474d';
  ctx.fillRect(0, 36, W, 1);
  ctx.fillStyle = OUT;
  ctx.fillRect(0, 46, W, 2);

  // windows with skyline
  const windowAt = (wx, wy, ww, wh, orb) => {
    const r = seeded(wx * 31 + 11);
    ctx.fillStyle = '#55585f';
    ctx.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
    const bands = day ? ['#5fb2ff', '#7cc2ff', '#9ad1ff', '#bfe3ff'] : dusk ? ['#3c3a7a', '#a4507c', '#ee7f58', '#ffbe72'] : ['#0d1433', '#121c44', '#182553', '#1f2e60'];
    bands.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(wx, wy + Math.floor((i * wh) / 4), ww, Math.ceil(wh / 4));
    });
    if (orb && dusk) {
      // setting sun, half behind the skyline
      ctx.fillStyle = '#ffd27a';
      ctx.fillRect(wx + ww - 16, wy + wh - 11, 8, 6);
      ctx.fillRect(wx + ww - 17, wy + wh - 9, 10, 4);
      ctx.fillStyle = '#fff0b8';
      ctx.fillRect(wx + ww - 14, wy + wh - 10, 4, 3);
    } else if (orb && day) {
      ctx.fillStyle = '#fff3b0';
      ctx.fillRect(wx + ww - 12, wy + 2, 6, 6);
      ctx.fillRect(wx + ww - 13, wy + 3, 8, 4);
      ctx.fillStyle = '#ffd84a';
      ctx.fillRect(wx + ww - 11, wy + 3, 4, 4);
    } else if (orb) {
      ctx.fillStyle = '#f6efc8';
      ctx.fillRect(wx + ww - 10, wy + 3, 4, 4);
      ctx.fillRect(wx + ww - 11, wy + 4, 6, 2);
      ctx.fillStyle = '#0d1433';
      ctx.fillRect(wx + ww - 8, wy + 3, 2, 2);
    }
    if (day) {
      // clouds
      const cloud = (cx, cy, w) => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx, cy, w, 2);
        ctx.fillRect(cx + 2, cy - 1, w - 4, 1);
        ctx.fillStyle = '#dceeff';
        ctx.fillRect(cx + 1, cy + 2, w - 2, 1);
      };
      cloud(wx + 3 + Math.floor(r() * 6), wy + 4, 10);
      cloud(wx + 18 + Math.floor(r() * 6), wy + 8, 8);
    } else if (dusk) {
      ctx.fillStyle = '#f7a3a0';
      ctx.fillRect(wx + 4 + Math.floor(r() * 6), wy + 6, 11, 1);
      ctx.fillRect(wx + 20 + Math.floor(r() * 6), wy + 9, 9, 1);
      ctx.fillStyle = '#ffd6b0';
      ctx.fillRect(wx + 6, wy + 5, 6, 1);
    } else {
      for (let i = 0; i < 6; i++) {
        const sx = wx + Math.floor(r() * ww);
        ctx.fillStyle = '#9aa6e0';
        ctx.fillRect(sx, wy + 1 + Math.floor(r() * 6), 1, 1);
      }
    }
    let bx = wx;
    while (bx < wx + ww) {
      const bw = 4 + Math.floor(r() * 7);
      const bh = 6 + Math.floor(r() * (wh - 8));
      const tone = r() > 0.5;
      ctx.fillStyle = day ? (tone ? '#6f80ad' : '#8494bf') : dusk ? (tone ? '#2d2846' : '#3a3152') : tone ? '#0a0e24' : '#0e1330';
      ctx.fillRect(bx, wy + wh - bh, Math.min(bw, wx + ww - bx), bh);
      if (day) {
        ctx.fillStyle = '#a9b8dc';
        ctx.fillRect(bx, wy + wh - bh, 1, bh);
      }
      for (let yy = wy + wh - bh + 2; yy < wy + wh - 1; yy += 3)
        for (let xx = bx + 1; xx < Math.min(bx + bw, wx + ww) - 1; xx += 2) {
          const lit = r() > 0.62;
          const warm = r() > 0.3;
          if (day) {
            ctx.fillStyle = lit ? '#d6ecff' : '#53638f';
            ctx.fillRect(xx, yy, 1, 1);
          } else if (lit && (!dusk || warm)) {
            ctx.fillStyle = warm ? '#ffd36a' : '#ff8f6a';
            ctx.fillRect(xx, yy, 1, 1);
          }
        }
      bx += bw + (r() > 0.7 ? 1 : 0);
    }
    ctx.fillStyle = '#55585f';
    ctx.fillRect(wx + Math.floor(ww / 2), wy, 1, wh);
    ctx.fillStyle = '#686c74';
    ctx.fillRect(wx - 3, wy + wh + 2, ww + 6, 2);
  };
  windowAt(8, 8, 44, 24, false);
  windowAt(204, 8, 48, 24, true);

  // LED board frame
  ctx.fillStyle = '#4a4c52';
  ctx.fillRect(62, 5, 132, 26);
  ctx.fillStyle = '#111214';
  ctx.fillRect(64, 7, 128, 22);
  ctx.fillStyle = '#070708';
  ctx.fillRect(66, 9, 124, 18);
  ctx.fillStyle = '#17181a';
  for (let y = 10; y < 27; y += 2) for (let x = 67; x < 190; x += 2) ctx.fillRect(x, y, 1, 1);
  ctx.fillStyle = '#2a2b2f';
  ctx.fillRect(74, 31, 2, 5);
  ctx.fillRect(180, 31, 2, 5);

  // pantry wall: upper cabinets + clock
  ctx.fillStyle = '#4c4f57';
  ctx.fillRect(262, 8, 58, 16);
  ctx.fillStyle = '#3c3f45';
  ctx.fillRect(262, 22, 58, 2);
  ctx.fillRect(290, 8, 1, 14);
  ctx.fillStyle = '#d8c98a';
  ctx.fillRect(286, 14, 2, 3);
  ctx.fillRect(293, 14, 2, 3);
  // clock
  ctx.fillStyle = OUT;
  ctx.fillRect(352, 9, 14, 14);
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(353, 10, 12, 12);
  ctx.fillStyle = OUT;
  ctx.fillRect(358, 12, 1, 5);
  ctx.fillRect(359, 16, 3, 1);
  // little poster
  ctx.fillStyle = '#ff5a5a';
  ctx.fillRect(330, 11, 12, 16);
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(332, 13, 8, 1);
  ctx.fillRect(332, 22, 3, 3);
  ctx.fillStyle = '#ffc94a';
  ctx.fillRect(333, 16, 1, 4);
  ctx.fillRect(335, 17, 1, 3);
  ctx.fillRect(337, 15, 1, 5);

  if (day || dusk) {
    // daylight shafts from windows onto the floor (warm and long at dusk)
    ctx.fillStyle = dusk ? 'rgba(255,150,90,0.08)' : 'rgba(255,244,214,0.07)';
    for (let i = 0; i < 26; i++) {
      ctx.fillRect(4 + i, 48 + i * 2, 50, 2);
      ctx.fillRect(200 + i, 48 + i * 2, 54, 2);
    }
  }
}
function drawPool(ctx, cx, cy, rx, ry, a = 1) {
  [1, 0.7, 0.45].forEach((k, i) => {
    ctx.fillStyle = `rgba(255,214,140,${(0.025 + i * 0.015) * a})`;
    for (let y = -ry * k; y <= ry * k; y += 1) {
      const w = Math.floor(rx * k * Math.sqrt(1 - (y * y) / (ry * k * ry * k)));
      ctx.fillRect(cx - w, Math.floor(cy + y), w * 2, 1);
    }
  });
}
// ---------- furniture ----------
function drawChair(ctx, x, deskY) {
  ctx.fillStyle = OUT;
  ctx.fillRect(x - 9, deskY - 14, 18, 16);
  ctx.fillStyle = '#3a3c42';
  ctx.fillRect(x - 8, deskY - 13, 16, 15);
  ctx.fillStyle = '#4a4d55';
  ctx.fillRect(x - 7, deskY - 12, 14, 2);
}

function drawDesk(ctx, d, occ, t) {
  const { x, y, mirror } = d;
  ctx.fillStyle = 'rgba(10,6,20,0.35)';
  ctx.fillRect(x + 2, y + 20, 48, 3);
  ctx.fillStyle = OUT;
  ctx.fillRect(x - 1, y - 1, 50, 22);
  ctx.fillStyle = '#b07c4f';
  ctx.fillRect(x, y, 48, 12);
  ctx.fillStyle = '#c99462';
  ctx.fillRect(x, y, 48, 1);
  ctx.fillStyle = '#7a4f30';
  ctx.fillRect(x, y + 12, 48, 8);
  ctx.fillStyle = '#5e3c25';
  ctx.fillRect(x, y + 12, 48, 1);
  const drawerX = mirror ? x + 16 : x + 31;
  ctx.fillRect(drawerX, y + 13, 1, 7);
  ctx.fillStyle = '#d8b07a';
  ctx.fillRect(mirror ? x + 7 : x + 37, y + 15, 4, 1);

  const seated = occ && occ.state === 'seat';
  const active = seated && !occ.faded;
  const busy = active && occ.busy;
  const mx = mirror ? x + 25 : x + 3;
  const my = y - 10;
  if (active) {
    const glow = busy ? 0.22 + 0.06 * Math.sin(t * 6) : 0.09;
    ctx.fillStyle = `rgba(255,201,74,${glow})`;
    ctx.fillRect(mx - 4, my - 3, 28, 22);
    ctx.fillStyle = `rgba(255,201,74,${glow * 0.6})`;
    ctx.fillRect(mx - 7, my - 5, 34, 26);
  }
  ctx.fillStyle = OUT;
  ctx.fillRect(mx - 1, my - 1, 22, 15);
  ctx.fillStyle = '#2b2d33';
  ctx.fillRect(mx, my, 20, 13);
  ctx.fillStyle = active ? '#0c1f2e' : '#141226';
  ctx.fillRect(mx + 1, my + 1, 18, 10);
  ctx.fillStyle = '#2b2d33';
  ctx.fillRect(mx + 8, my + 14, 4, 2);
  ctx.fillRect(mx + 6, my + 15, 8, 1);
  if (active) drawScreen(ctx, occ.meta.screen, mx + 1, my + 1, t, busy, occ.meta.color);
  else if (seated) {
    ctx.fillStyle = '#2b2d33';
    ctx.fillRect(mx + 8, my + 5, 4, 1);
  }

  // mug + papers
  const mugX = mirror ? x + 2 : x + 41;
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(mugX, y + 3, 5, 6);
  ctx.fillStyle = occ ? occ.meta.color : '#888';
  ctx.fillRect(mugX, y + 5, 5, 2);
  const papX = mirror ? x + 37 : x + 4;
  ctx.fillStyle = '#d9d2c2';
  ctx.fillRect(papX, y + 5, 7, 5);
  ctx.fillStyle = '#b9b0a0';
  ctx.fillRect(papX + 1, y + 6, 5, 1);
  ctx.fillRect(papX + 1, y + 8, 4, 1);

  const sx = seatOf(d).x;
  const kx = sx - 6;
  ctx.fillStyle = OUT;
  ctx.fillRect(kx - 1, y + 2, 14, 5);
  ctx.fillStyle = '#cfd1d6';
  ctx.fillRect(kx, y + 3, 12, 3);
  ctx.fillStyle = '#9a9da4';
  for (let i = 0; i < 6; i++) ctx.fillRect(kx + 1 + i * 2, y + 4, 1, 1);
  if (active) {
    const speed = busy ? 14 : 3;
    const f = Math.floor(t * speed) % 2;
    ctx.fillStyle = occ.meta.pal.s;
    ctx.fillRect(kx + 1, y + 2 + f, 3, 2);
    ctx.fillRect(kx + 8, y + 3 - f, 3, 2);
    ctx.fillStyle = OUT;
    ctx.fillRect(kx + 1, y + 4 + f, 3, 1);
    ctx.fillRect(kx + 8, y + 5 - f, 3, 1);
  }
}

function drawPartition(ctx, pod, color) {
  const x = pod.x + 48;
  const y = pod.y - 18;
  ctx.fillStyle = OUT;
  ctx.fillRect(x - 1, y - 1, 6, 40);
  ctx.fillStyle = '#4a4d55';
  ctx.fillRect(x, y, 4, 38);
  ctx.fillStyle = '#5b5f68';
  ctx.fillRect(x, y, 1, 38);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 4, 3);
  ctx.fillStyle = '#33363c';
  for (let yy = y + 6; yy < y + 36; yy += 5) ctx.fillRect(x + 2, yy, 1, 2);
}

function drawScreen(ctx, mode, sx, sy, t, busy, color) {
  const step = Math.floor(t * (busy ? 4 : 1));
  if (mode === 'log') {
    for (let i = 0; i < 5; i++) {
      const w = 4 + ((step + i * 7) % 11);
      ctx.fillStyle = i === 4 ? color : '#2f6f70';
      ctx.fillRect(sx + 1, sy + 1 + i * 2, w, 1);
    }
  } else if (mode === 'candle') {
    for (let i = 0; i < 6; i++) {
      const v = Math.sin((step + i) * 1.7) * 3;
      const up = v > 0;
      const h = 2 + Math.abs(Math.round(v));
      ctx.fillStyle = up ? '#ff5a5a' : '#4d9bff';
      ctx.fillRect(sx + 1 + i * 3, sy + 5 - (up ? h : 0) + (i % 2), 2, h);
    }
  } else if (mode === 'bars') {
    for (let i = 0; i < 4; i++) {
      const h = 2 + ((step * (i + 1)) % 7);
      ctx.fillStyle = ['#c79bff', '#ffc94a', '#57e3c9', '#ff8a5a'][i];
      ctx.fillRect(sx + 2 + i * 4, sy + 9 - h, 3, h);
    }
  } else if (mode === 'doc') {
    ctx.fillStyle = '#efe6d2';
    ctx.fillRect(sx + 3, sy + 1, 12, 9);
    ctx.fillStyle = '#9a9da4';
    for (let i = 0; i < 3; i++) ctx.fillRect(sx + 5, sy + 2 + i * 2, 4 + ((step + i) % 4), 1);
    if (step % 3 === 0) {
      ctx.fillStyle = '#d0443c';
      ctx.fillRect(sx + 11, sy + 6, 3, 3);
    }
  } else {
    for (let i = 0; i < 5; i++) {
      const w = 2 + ((step + i * 3) % 7);
      ctx.fillStyle = i < 2 ? '#4d9bff' : i === 2 ? '#efe6d2' : '#ff5a5a';
      if (i === 2) ctx.fillRect(sx + 1, sy + 1 + i * 2, 16, 1);
      else ctx.fillRect(i < 2 ? sx + 17 - w : sx + 1, sy + 1 + i * 2, w, 1);
    }
  }
  if (busy && step % 2 === 0) {
    ctx.fillStyle = '#efe6d2';
    ctx.fillRect(sx + 16, sy + 8, 1, 1);
  }
}

function drawCounter(ctx, t, coffeeBusy) {
  // counter
  ctx.fillStyle = OUT;
  ctx.fillRect(261, 49, 62, 25);
  ctx.fillStyle = '#bfc2c8';
  ctx.fillRect(262, 50, 60, 9);
  ctx.fillStyle = '#d9dbe0';
  ctx.fillRect(262, 50, 60, 1);
  ctx.fillStyle = '#5a5d66';
  ctx.fillRect(262, 59, 60, 14);
  ctx.fillStyle = '#4a4d55';
  ctx.fillRect(291, 60, 1, 13);
  ctx.fillRect(262, 59, 60, 1);
  ctx.fillStyle = '#c9bfa0';
  ctx.fillRect(287, 64, 2, 3);
  ctx.fillRect(294, 64, 2, 3);
  // coffee machine
  ctx.fillStyle = OUT;
  ctx.fillRect(275, 37, 16, 19);
  ctx.fillStyle = '#34353a';
  ctx.fillRect(276, 38, 14, 17);
  ctx.fillStyle = '#4a4c52';
  ctx.fillRect(276, 38, 14, 4);
  ctx.fillStyle = coffeeBusy && Math.floor(t * 3) % 2 ? '#57e3c9' : '#ff5a5a';
  ctx.fillRect(286, 40, 2, 1);
  ctx.fillStyle = '#151618';
  ctx.fillRect(279, 45, 8, 7);
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(281, 49, 4, 3);
  if (coffeeBusy) {
    ctx.fillStyle = 'rgba(239,230,210,0.7)';
    for (let i = 0; i < 3; i++) {
      const yy = 34 - ((t * 10 + i * 4) % 12);
      ctx.fillRect(282 + (i % 2), Math.floor(yy), 1, 2);
    }
  }
  // microwave
  ctx.fillStyle = OUT;
  ctx.fillRect(299, 42, 18, 10);
  ctx.fillStyle = '#d9dbe0';
  ctx.fillRect(300, 43, 16, 8);
  ctx.fillStyle = '#2b2d33';
  ctx.fillRect(301, 44, 10, 6);
  ctx.fillStyle = '#57e3c9';
  ctx.fillRect(313, 45, 2, 1);
}

function drawFridge(ctx) {
  ctx.fillStyle = OUT;
  ctx.fillRect(324, 27, 22, 47);
  ctx.fillStyle = '#dadce0';
  ctx.fillRect(325, 28, 20, 45);
  ctx.fillStyle = '#b6b9bf';
  ctx.fillRect(325, 44, 20, 1);
  ctx.fillRect(343, 30, 1, 12);
  ctx.fillRect(343, 47, 1, 18);
  ctx.fillStyle = '#ffc94a';
  ctx.fillRect(328, 32, 4, 4);
  ctx.fillStyle = '#ff5a5a';
  ctx.fillRect(333, 34, 3, 3);
}

function drawCooler(ctx) {
  ctx.fillStyle = OUT;
  ctx.fillRect(351, 41, 16, 36);
  ctx.fillStyle = '#7fb6ff';
  ctx.fillRect(353, 42, 12, 10);
  ctx.fillStyle = '#b3d4ff';
  ctx.fillRect(354, 43, 3, 7);
  ctx.fillStyle = '#e2e4e8';
  ctx.fillRect(352, 52, 14, 24);
  ctx.fillStyle = '#ff5a5a';
  ctx.fillRect(355, 57, 2, 2);
  ctx.fillStyle = '#4d9bff';
  ctx.fillRect(361, 57, 2, 2);
  ctx.fillStyle = '#b6b9bf';
  ctx.fillRect(354, 62, 10, 1);
}

function drawPlant(ctx, x, y, big) {
  const s = big ? 1 : 0;
  ctx.fillStyle = 'rgba(10,6,20,0.35)';
  ctx.fillRect(x - 6, y, 13, 2);
  ctx.fillStyle = OUT;
  ctx.fillRect(x - 5, y - 9, 11, 10);
  ctx.fillStyle = '#c0663c';
  ctx.fillRect(x - 4, y - 8, 9, 8);
  ctx.fillStyle = '#d98450';
  ctx.fillRect(x - 4, y - 8, 9, 2);
  const leaves = [[0, -14 - s * 6, 2, 6 + s * 6], [-5, -16 - s * 4, 4, 6], [3, -17 - s * 4, 4, 7], [-7, -12, 4, 4], [5, -12, 4, 4], [-2, -20 - s * 6, 3, 5]];
  leaves.forEach(([lx, ly, lw, lh], i) => {
    ctx.fillStyle = i % 2 ? '#2f8f5a' : '#3fb26e';
    ctx.fillRect(x + lx, y + ly, lw, lh);
  });
  ctx.fillStyle = '#7fe0a0';
  ctx.fillRect(x + 4, y - 16 - s * 4, 1, 2);
}

function drawSofaBack(ctx) {
  const x = 292, y = 164;
  ctx.fillStyle = 'rgba(10,6,20,0.4)';
  ctx.fillRect(x - 2, y + 26, 76, 3);
  ctx.fillStyle = OUT;
  ctx.fillRect(x - 5, y - 1, 82, 28);
  ctx.fillStyle = '#2f7f86';
  ctx.fillRect(x - 4, y, 80, 12);
  ctx.fillStyle = '#46a3a8';
  ctx.fillRect(x - 4, y, 80, 2);
  ctx.fillStyle = '#26696f';
  ctx.fillRect(x + 35, y + 2, 1, 10);
}
function drawSofaFront(ctx) {
  const x = 292, y = 164;
  ctx.fillStyle = '#26696f';
  ctx.fillRect(x, y + 12, 72, 10);
  ctx.fillStyle = '#2f7f86';
  ctx.fillRect(x, y + 12, 72, 2);
  ctx.fillStyle = '#1d5458';
  ctx.fillRect(x, y + 22, 72, 4);
  ctx.fillRect(x + 35, y + 12, 1, 10);
  ctx.fillStyle = '#3a9198';
  ctx.fillRect(x - 4, y + 6, 6, 20);
  ctx.fillRect(x + 70, y + 6, 6, 20);
  ctx.fillStyle = '#58b6bb';
  ctx.fillRect(x - 4, y + 6, 6, 2);
  ctx.fillRect(x + 70, y + 6, 6, 2);
  ctx.fillStyle = OUT;
  ctx.fillRect(x - 5, y + 26, 82, 1);
}

function drawLamp(ctx) {
  const x = 372, y = 214;
  ctx.fillStyle = 'rgba(255,214,140,0.10)';
  ctx.fillRect(x - 12, y - 30, 24, 26);
  ctx.fillStyle = OUT;
  ctx.fillRect(x - 6, y - 10, 13, 11);
  ctx.fillStyle = '#6b4530';
  ctx.fillRect(x - 5, y - 9, 11, 9);
  ctx.fillStyle = '#2b2d33';
  ctx.fillRect(x, y - 20, 1, 11);
  ctx.fillStyle = '#ffd36a';
  ctx.fillRect(x - 4, y - 26, 9, 6);
  ctx.fillStyle = '#ffe9a8';
  ctx.fillRect(x - 3, y - 25, 7, 1);
}

// ---------- engine ----------
export function createOffice(canvas, { onFrame, onBubble } = {}) {
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const octx = off.getContext('2d');
  const mkBg = (phase) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    drawBackground(c.getContext('2d'), phase);
    return c;
  };
  const bgs = { day: mkBg('day'), dusk: mkBg('dusk'), night: mkBg('night') };
  let env = { phase: 'night', dark: new Set(), night: true };

  const deptColor = Object.fromEntries(DEPTS.map((d) => [d.id, d.color]));

  const agents = AGENTS.map((meta) => {
    const d = DESKS[meta.desk];
    const s = seatOf(d);
    return {
      id: meta.id, meta, desk: d, x: s.x, y: s.y,
      state: 'seat', busy: false, onDuty: true, faded: false,
      path: [], trail: [], spot: null, target: null, dir: 'down', walkT: 0, restUntil: 0,
      waiters: [], bubble: null, sprites: buildSprites(meta), stat: { tasks: 0, moves: 0 },
    };
  });
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  let offMode = 'lounge';
  let hover = null;
  let selected = null;
  let raf = 0;
  let last = performance.now();
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function say(id, text, ms = 5200) {
    const a = byId[id];
    a.bubble = { text, until: performance.now() + ms };
    onBubble && onBubble(id, text);
  }

  function freeSpot(except) {
    const taken = new Set(agents.map((a) => a.target && a.target.id));
    const free = SPOTS.filter((s) => !taken.has(s.id) && s !== except);
    return free.length ? pick(free) : null;
  }

  function goOut(a) {
    const spot = freeSpot();
    if (!spot) return false;
    const seat = seatOf(a.desk);
    a.target = spot;
    a.path = routeTo(a.desk, spot);
    a.trail = [seat];
    a.state = 'out';
    a.stat.moves++;
    return true;
  }

  function relocate(a) {
    const to = freeSpot(a.spot);
    if (!to) return;
    a.path = hop(a.spot, to);
    a.target = to;
    a.spot = null;
    a.state = 'out';
    a.stat.moves++;
  }

  function goBack(a) {
    if (a.state === 'seat' || a.state === 'back') return;
    const back = a.trail.slice().reverse();
    a.path = back.length ? back : [seatOf(a.desk)];
    a.trail = [];
    a.state = 'back';
    a.spot = null;
    a.target = null;
  }

  function summon(id) {
    const a = byId[id];
    if (a.state === 'seat') return Promise.resolve();
    goBack(a);
    return new Promise((res) => a.waiters.push(res));
  }

  function setBusy(id, v) {
    const a = byId[id];
    a.busy = v;
    if (v) a.stat.tasks++;
  }

  function setSchedule(duty, mode) {
    offMode = mode;
    let delay = 0;
    for (const a of agents) {
      const was = a.onDuty;
      a.onDuty = !!duty[a.id];
      a.busy = false;
      if (!a.onDuty && offMode === 'lounge' && a.state === 'seat') {
        // stagger departures so people don't leave in lockstep
        a.leaveAt = performance.now() + delay;
        delay += 500 + Math.random() * 500;
      }
      if (was !== a.onDuty && a.onDuty && a.state !== 'seat') goBack(a);
    }
  }

  function update(dt, now) {
    for (const a of agents) {
      if (a.bubble && now > a.bubble.until) {
        a.bubble = null;
        onBubble && onBubble(a.id, null);
      }
      a.faded = !a.onDuty && offMode === 'fade' && a.state === 'seat';
      if (a.onDuty || offMode === 'fade') {
        if (a.state === 'out' || a.state === 'rest') goBack(a);
      } else if (a.state === 'seat' && !a.waiters.length && now > (a.leaveAt || 0)) {
        goOut(a);
      }

      if (a.state === 'seat') continue;
      if (a.state === 'rest') {
        if (a.spot.pace) {
          if (!a.path.length && Math.random() < dt * 0.6) a.path = [{ x: 248 + rand(0, 30), y: 146 + rand(0, 20) }];
          moveAlong(a, dt, 18);
        }
        if (now > a.restUntil && !a.path.length) relocate(a);
        continue;
      }
      const arrived = moveAlong(a, dt, 38);
      if (arrived) {
        if (a.state === 'out') {
          a.state = 'rest';
          a.spot = a.target;
          a.trail = [seatOf(a.desk), ...routeTo(a.desk, a.spot)];
          a.dir = a.spot.face;
          a.restUntil = now + rand(10000, 20000);
          // 휴식 중 연출 대사는 없음 (말풍선은 실제 봇 이벤트에서만)
        } else if (a.state === 'back') {
          a.state = 'seat';
          a.dir = 'down';
          a.trail = [];
          const w = a.waiters.splice(0);
          w.forEach((r) => r());
        }
      }
    }
  }

  function moveAlong(a, dt, speed) {
    if (!a.path.length) return true;
    const target = a.path[0];
    const dx = target.x - a.x;
    const dy = target.y - a.y;
    const dist = Math.hypot(dx, dy);
    const stepLen = speed * dt;
    if (dist <= stepLen) {
      a.x = target.x;
      a.y = target.y;
      a.path.shift();
      if (a.state === 'out') a.trail.push(target);
    } else {
      a.x += (dx / dist) * stepLen;
      a.y += (dy / dist) * stepLen;
    }
    if (dist > 0.01) a.dir = Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? 'up' : 'down') : 'down';
    a.walkT += dt;
    return a.path.length === 0;
  }

  function drawAgent(ctx, a, t) {
    const x = Math.round(a.x);
    const y = Math.round(a.y);
    if (a.state === 'seat') {
      if (a.faded) ctx.globalAlpha = 0.5;
      const bob = a.busy && Math.floor(t * 3) % 4 === 0 ? 1 : 0;
      ctx.drawImage(a.sprites.sit, x - 8, y - 20 + bob);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = 'rgba(10,6,20,0.4)';
    ctx.fillRect(x - 5, y - 1, 10, 2);
    if (a.state === 'rest' && a.spot.sit) {
      ctx.drawImage(a.sprites.sit, x - 8, y - 22);
      ctx.fillStyle = a.meta.pal.p;
      ctx.fillRect(x - 4, y - 4, 3, 3);
      ctx.fillRect(x + 1, y - 4, 3, 3);
      ctx.fillStyle = '#24181a';
      ctx.fillRect(x - 4, y - 1, 3, 1);
      ctx.fillRect(x + 1, y - 1, 3, 1);
      return;
    }
    const moving = a.path.length > 0;
    const view = a.dir === 'up' ? 'u' : 'd';
    let f = 'stand';
    if (moving) {
      const k = Math.floor(a.walkT * 7) % 4;
      f = k === 0 ? 'A' : k === 2 ? 'B' : 'stand';
    }
    ctx.drawImage(a.sprites[`${view}_${f}`], x - 8, y - 24);
  }

  function headTop(a) {
    return Math.round(a.y) - (a.state === 'seat' ? 22 : a.state === 'rest' && a.spot.sit ? 24 : 26);
  }

  function drawMarker(ctx, a, t, color) {
    const x = Math.round(a.x);
    const top = headTop(a);
    const b = reduced ? 0 : Math.floor(t * 4) % 2;
    ctx.fillStyle = OUT;
    ctx.fillRect(x - 3, top - 5 - b, 7, 4);
    ctx.fillStyle = color;
    ctx.fillRect(x - 2, top - 5 - b, 5, 1);
    ctx.fillRect(x - 1, top - 4 - b, 3, 1);
    ctx.fillRect(x, top - 3 - b, 1, 1);
  }

  function drawTyping(ctx, a, t) {
    if (a.state !== 'seat' || !a.busy || a.bubble) return;
    const x = Math.round(a.x);
    const y = Math.round(a.y) - 30;
    ctx.fillStyle = OUT;
    ctx.fillRect(x - 6, y - 1, 13, 6);
    ctx.fillStyle = '#efe6d2';
    ctx.fillRect(x - 5, y, 11, 4);
    const k = Math.floor(t * 4) % 4;
    ctx.fillStyle = OUT;
    for (let i = 0; i < 3; i++) if (i < k) ctx.fillRect(x - 3 + i * 3, y + 1 + (i === k - 1 ? 0 : 1), 1, 1);
  }

  function drawPause(ctx, a, t) {
    if (!a.manual || !a.onDuty || a.state !== 'seat' || a.busy || a.bubble || a.faded) return;
    // beside the head, on the side away from the monitor (dept tags sit above the head)
    const x = Math.round(a.x) + (a.desk.mirror ? -13 : 13);
    const y = Math.round(a.y) - 20;
    const on = reduced || Math.floor(t * 2) % 2 === 0;
    ctx.fillStyle = OUT;
    ctx.fillRect(x - 5, y - 1, 11, 9);
    ctx.fillStyle = on ? '#ffc94a' : '#b8862a';
    ctx.fillRect(x - 4, y, 9, 7);
    ctx.fillStyle = OUT;
    ctx.fillRect(x - 2, y + 1, 2, 5);
    ctx.fillRect(x + 1, y + 1, 2, 5);
  }

  function drawZzz(ctx, a, t) {
    if (!a.faded) return;
    const x = Math.round(a.x) + 6;
    const y = Math.round(a.y) - 28 - (reduced ? 0 : Math.floor(t * 2) % 3);
    ctx.fillStyle = 'rgba(239,230,210,0.6)';
    ctx.fillRect(x, y, 3, 1);
    ctx.fillRect(x + 1, y + 1, 1, 1);
    ctx.fillRect(x, y + 2, 3, 1);
  }

  function render(t) {
    const ctx = octx;
    ctx.drawImage(bgs[env.phase] || bgs.night, 0, 0);
    const lampA = env.phase === 'day' ? 0.6 : env.phase === 'dusk' ? 0.85 : 1;
    PODS.forEach((p) => {
      if (!env.dark.has(p.dept)) drawPool(ctx, p.x + 50, p.y + 16, 56, 28, lampA);
    });
    if (!env.night) drawPool(ctx, 326, 180, 54, 26, lampA);
    if (env.phase !== 'day' && !reduced && Math.floor(t * 2) % 3 === 0) {
      ctx.fillStyle = '#ffd36a';
      ctx.fillRect(18 + (Math.floor(t) % 5) * 5, 26, 1, 1);
    }
    const coffeeBusy = agents.some((a) => a.state === 'rest' && a.spot.id === 'coffee');
    const items = [];
    DESKS.forEach((d) => {
      const occ = agents.find((a) => a.desk === d && a.state === 'seat');
      items.push({ z: d.y - 14, draw: () => drawChair(ctx, seatOf(d).x, d.y) });
      items.push({ z: d.y + 20, draw: () => drawDesk(ctx, d, occ, t) });
    });
    PODS.forEach((p) => items.push({ z: p.y + 20.5, draw: () => drawPartition(ctx, p, deptColor[p.dept]) }));
    items.push({ z: 74, draw: () => drawCounter(ctx, t, coffeeBusy) });
    items.push({ z: 74, draw: () => drawFridge(ctx) });
    items.push({ z: 77, draw: () => drawCooler(ctx) });
    items.push({ z: 176, draw: () => drawSofaBack(ctx) });
    items.push({ z: 191, draw: () => drawSofaFront(ctx) });
    items.push({ z: 214, draw: () => drawLamp(ctx) });
    items.push({ z: 216, draw: () => drawPlant(ctx, 8, 222, true) });
    items.push({ z: 118, draw: () => drawPlant(ctx, 376, 124, false) });
    items.push({ z: 68, draw: () => drawPlant(ctx, 190, 64, false) });
    items.push({ z: 216, draw: () => drawPlant(ctx, 232, 222, false) });
    agents.forEach((a) => {
      let z = a.y;
      if (a.state === 'rest' && a.spot.sit) z = 192;
      items.push({ z, draw: () => drawAgent(ctx, a, t) });
    });
    items.sort((p, q) => p.z - q.z);
    items.forEach((it) => it.draw());
    // lights-off overlays
    if (env.night) {
      ctx.fillStyle = 'rgba(6,6,10,0.28)';
      ctx.fillRect(0, WALL, W, H - WALL);
    }
    PODS.forEach((p) => {
      if (!env.dark.has(p.dept)) return;
      ctx.fillStyle = 'rgba(6,4,18,0.42)';
      ctx.fillRect(p.x - 8, p.y - 30, 116, 62);
    });
    agents.forEach((a) => {
      drawTyping(ctx, a, t);
      drawZzz(ctx, a, t);
      drawPause(ctx, a, t);
    });
    if (selected) drawMarker(ctx, byId[selected], t, '#ffc94a');
    if (hover && hover !== selected) drawMarker(ctx, byId[hover], t, '#efe6d2');

    const dctx = canvas.getContext('2d');
    dctx.imageSmoothingEnabled = false;
    dctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt, now);
    render(now / 1000);
    onFrame && onFrame(agents);
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  function hit(lx, ly) {
    let best = null;
    for (const a of agents) {
      const top = a.state === 'seat' ? a.y - 16 : a.y - 20;
      const bottom = a.state === 'seat' ? a.y - 2 : a.y;
      if (lx >= a.x - 7 && lx <= a.x + 7 && ly >= top && ly <= bottom) {
        if (!best || a.y > best.y) best = a;
      }
    }
    return best ? best.id : null;
  }

  return {
    agents, byId, say, summon, setBusy, setSchedule, hit, headTop,
    setEnv: (e) => (env = { ...env, ...e }),
    setManual: (on) => agents.forEach((a) => (a.manual = on && (a.meta.dept === 'risk' || a.meta.dept === 'exec'))),
    setHover: (id) => (hover = id),
    setSelected: (id) => (selected = id),
    destroy: () => cancelAnimationFrame(raf),
  };
}

export function statusText(a) {
  if (a.state === 'seat') {
    if (a.faded) return '비근무 (자리 대기)';
    if (!a.onDuty) return '자리 정리 중';
    if (a.busy) return a.userTask ? '사용자 지시 집행 중' : '자리에서 작업 중';
    if (a.manual) return '사용자 수동 제어 대기 중';
    return '자리에서 대기 중';
  }
  if (a.state === 'out') return `${a.target ? a.target.label : '휴게실'} 쪽으로 이동 중`;
  if (a.state === 'rest') return `${a.spot.label}에서 휴식 중`;
  return '자리로 복귀 중';
}
