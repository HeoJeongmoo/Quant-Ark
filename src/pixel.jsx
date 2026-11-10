// 작은 픽셀 그림: 오피스 에이전트 포즈 · 꾸미기 아이템 · 코인
import React, { useEffect, useRef } from 'react';
import { AGENTS, buildSprites, OUT } from './sprites';
import { drawItemPreview } from './decor';

const cache = {};
const spritesOf = (id) => (cache[id] ||= buildSprites(AGENTS.find((a) => a.id === id) || AGENTS[0]));
export const AGENT_IDS = AGENTS.map((a) => a.id);
export const agentName = (id) => (AGENTS.find((a) => a.id === id) || AGENTS[0]).name;

const r = (ctx, c, x, y, w, h) => {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
};

// 20 x 24 캔버스, 몸(16x24 프레임)은 x=2에 둔다
function drawPose(ctx, id, pose) {
  const meta = AGENTS.find((a) => a.id === id) || AGENTS[0];
  const pal = meta.pal;
  const sp = spritesOf(id);
  ctx.clearRect(0, 0, 20, 24);
  ctx.drawImage(sp.d_stand, 2, 0);
  if (pose === 'coffee') {
    r(ctx, OUT, 14, 14, 5, 5);
    r(ctx, '#f6efe0', 15, 15, 3, 3);
    r(ctx, '#6b4530', 15, 15, 3, 1);
    r(ctx, OUT, 18, 16, 1, 1);
    r(ctx, 'rgba(239,230,210,0.7)', 16, 11, 1, 2);
    r(ctx, 'rgba(239,230,210,0.5)', 17, 9, 1, 2);
  } else if (pose === 'book') {
    r(ctx, OUT, 4, 15, 12, 6);
    r(ctx, meta.color, 5, 16, 10, 4);
    r(ctx, '#f6efe0', 6, 16, 3, 3);
    r(ctx, '#f6efe0', 11, 16, 3, 3);
    r(ctx, OUT, 10, 16, 1, 4);
  } else if (pose === 'sleep') {
    r(ctx, OUT, 7, 11, 2, 1);
    r(ctx, OUT, 12, 11, 2, 1);
  } else if (pose === 'wave' || pose === 'cheer') {
    const arm = (x) => {
      r(ctx, OUT, x - 1, 6, 4, 9);
      r(ctx, pal.t, x, 9, 2, 5);
      r(ctx, pal.s, x, 7, 2, 2);
    };
    r(ctx, pal.t, 15, 15, 1, 2);
    arm(16);
    if (pose === 'cheer') arm(2);
  } else if (pose === 'laptop') {
    r(ctx, OUT, 3, 17, 14, 6);
    r(ctx, '#2b2d33', 4, 18, 12, 4);
    r(ctx, meta.color, 5, 19, 6, 1);
    r(ctx, '#57e3c9', 5, 20, 3, 1);
  }
}

export function AgentPix({ id = AGENTS[0].id, pose = 'stand', scale = 3, className = '', title }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    drawPose(ctx, id, pose);
  }, [id, pose]);
  return (
    <span className={`pix-agent pose-${pose} ${className}`} title={title} aria-hidden={title ? undefined : true}>
      <canvas ref={ref} width={20} height={24} style={{ width: 20 * scale, height: 24 * scale }} />
      {pose === 'sleep' && <span className="pix-z" aria-hidden="true">z</span>}
    </span>
  );
}

// 아이템 미리보기 (animate면 0.2초마다 다시 그림 — 고양이 꼬리, 금붕어 등)
const reduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export function ItemPix({ id, scale = 3, animate = false, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return undefined;
    const draw = () => drawItemPreview(c, id, performance.now() / 1000, 1);
    draw();
    if (!animate || reduced) return undefined;
    const t = setInterval(draw, 200);
    return () => clearInterval(t);
  }, [id, animate]);
  return <canvas ref={ref} className={`pix-item ${className}`} style={{ width: 34 * scale, height: 36 * scale }} aria-hidden="true" />;
}

export function Coin({ size = 14 }) {
  return (
    <svg className="pix-coin" width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M2 0h4v1h1v1h1v4h-1v1h-1v1h-4v-1h-1v-1h-1v-4h1v-1h1z" fill="#1a1326" />
      <path d="M2 1h4v1h1v4h-1v1h-4v-1h-1v-4h1z" fill="#ffc94a" />
      <path d="M3 2h2v1h-2zM3 3h1v2h-1zM3 5h2v1h-2z" fill="#d8962a" />
      <path d="M2 1h2v1h-2zM1 2h1v2h-1z" fill="#fff1b8" />
    </svg>
  );
}
