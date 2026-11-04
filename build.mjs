// Bundles src/ into one self-contained dist/index.html (React, CSS and pixel fonts inlined).
import * as esbuild from 'esbuild';
import fs from 'fs';
import { fileURLToPath } from 'url';

const fontB64 = (n) => fs.readFileSync(new URL(`./node_modules/galmuri/dist/${n}`, import.meta.url)).toString('base64');

export async function build({ dev = false } = {}) {
  const r = await esbuild.build({
    entryPoints: ['src/main.jsx'],
    bundle: true,
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
  });
  const js = r.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
  const fonts = [['Galmuri11', 'Galmuri11.woff2'], ['Galmuri11B', 'Galmuri11-Bold.woff2'], ['Galmuri9', 'Galmuri9.woff2']]
    .map(([n, file]) => `@font-face{font-family:'${n}';src:url(data:font/woff2;base64,${fontB64(file)}) format('woff2');font-display:block}`)
    .join('\n');
  const css = fs.readFileSync('src/style.css', 'utf8');
  // 파비콘·홈 화면 아이콘 (src/brand, 원본은 brand/make_logo.py)
  const png = (f) => { try { return fs.readFileSync(`src/brand/${f}`).toString('base64'); } catch { return null; } };
  const i64 = png('logo-64.png'), i180 = png('logo-180.png');
  const icons = [i64 && `<link rel="icon" type="image/png" href="data:image/png;base64,${i64}">`, i180 && `<link rel="apple-touch-icon" href="data:image/png;base64,${i180}">`, '<meta name="theme-color" content="#141517">'].filter(Boolean).join('\n');
  // dev only: reload the page when the dev server reports a new build
  const live = dev
    ? `<script>(()=>{let v=null;setInterval(async()=>{try{const n=await (await fetch('/__version')).text();if(v&&n!==v)location.reload();v=n}catch(e){}},700)})()</script>`
    : '';
  const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>퀀트 오피스 · Pixel Agents</title>
${icons}
<style>${fonts}\n${css}</style></head>
<body><div id="root"></div><script>${js}</script>${live}</body></html>`;
  // 개발 서버(npm run dev)는 메모리에서만 쓰고 dist는 건드리지 않는다 (dist는 봇 서버가 화면으로 내보냄)
  if (!dev) {
    fs.mkdirSync('dist', { recursive: true });
    fs.writeFileSync('dist/index.html', html);
  }
  return html;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await build();
  console.log(`빌드 완료: dist/index.html (${(fs.statSync('dist/index.html').size / 1024) | 0}KB)`);
}
