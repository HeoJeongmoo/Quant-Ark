// 오피스 기본 가구 (처음엔 없음 → 공부방 상점에서 사서 놓는다). 절대 좌표로 그린다.
import { OUT } from './sprites';

export function drawPool(ctx, cx, cy, rx, ry, a = 1) {
  [1, 0.7, 0.45].forEach((k, i) => {
    ctx.fillStyle = `rgba(255,214,140,${(0.025 + i * 0.015) * a})`;
    for (let y = -ry * k; y <= ry * k; y += 1) {
      const w = Math.floor(rx * k * Math.sqrt(1 - (y * y) / (ry * k * ry * k)));
      ctx.fillRect(cx - w, Math.floor(cy + y), w * 2, 1);
    }
  });
}
// ---------- furniture ----------

export function drawPantryFloor(ctx) {
  const WALL = 48;
  const W = 384;
  for (let y = WALL; y < 128; y += 8) {
    for (let x = 256; x < W; x += 8) {
      ctx.fillStyle = ((x + y) / 8) % 2 ? '#3a3c41' : '#47494f';
      ctx.fillRect(x, y, 8, 8);
    }
  }
  ctx.fillStyle = '#2b2d33';
  ctx.fillRect(256, 128, W - 256, 1);
  ctx.fillRect(255, WALL, 1, 80);
}
export function drawRug(ctx) {
  ctx.fillStyle = '#4b2440';
  ctx.fillRect(280, 150, 100, 66);
  ctx.fillStyle = '#6e3560';
  ctx.fillRect(282, 152, 96, 62);
  ctx.fillStyle = '#4b2440';
  ctx.fillRect(286, 156, 88, 54);
  ctx.fillStyle = '#7d4470';
  for (let y = 160; y < 208; y += 6) for (let x = 290; x < 372; x += 6) if (((x + y) / 6) % 2 < 1) ctx.fillRect(x, y, 1, 1);
}
export function drawCabinets(ctx) {
  ctx.fillStyle = '#4c4f57';
  ctx.fillRect(262, 8, 58, 16);
  ctx.fillStyle = '#3c3f45';
  ctx.fillRect(262, 22, 58, 2);
  ctx.fillRect(290, 8, 1, 14);
  ctx.fillStyle = '#d8c98a';
  ctx.fillRect(286, 14, 2, 3);
  ctx.fillRect(293, 14, 2, 3);
}
export function drawClock(ctx) {
  ctx.fillStyle = OUT;
  ctx.fillRect(352, 9, 14, 14);
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(353, 10, 12, 12);
  ctx.fillStyle = OUT;
  ctx.fillRect(358, 12, 1, 5);
  ctx.fillRect(359, 16, 3, 1);
}
export function drawPantryPoster(ctx) {
  ctx.fillStyle = '#ff5a5a';
  ctx.fillRect(330, 11, 12, 16);
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(332, 13, 8, 1);
  ctx.fillRect(332, 22, 3, 3);
  ctx.fillStyle = '#ffc94a';
  ctx.fillRect(333, 16, 1, 4);
  ctx.fillRect(335, 17, 1, 3);
  ctx.fillRect(337, 15, 1, 5);
}
export function drawCounterBase(ctx) {
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
}
export function drawCoffee(ctx, t, coffeeBusy) {
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
}
export function drawMicrowave(ctx) {
  ctx.fillStyle = OUT;
  ctx.fillRect(299, 42, 18, 10);
  ctx.fillStyle = '#d9dbe0';
  ctx.fillRect(300, 43, 16, 8);
  ctx.fillStyle = '#2b2d33';
  ctx.fillRect(301, 44, 10, 6);
  ctx.fillStyle = '#57e3c9';
  ctx.fillRect(313, 45, 2, 1);
}
export function drawLampPool(ctx, lampA) {
  drawPool(ctx, 326, 180, 54, 26, lampA);
}
export function drawFridge(ctx) {
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

export function drawCooler(ctx) {
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

export function drawPlant(ctx, x, y, big) {
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

export function drawSofaBack(ctx) {
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
export function drawSofaFront(ctx) {
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

export function drawLamp(ctx) {
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

