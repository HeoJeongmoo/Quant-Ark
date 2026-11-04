// npm run dev: rebuilds on every change in src/ and serves it at http://localhost:5173 with auto-reload.
import http from 'http';
import fs from 'fs';
import { build } from './build.mjs';

const PORT = Number(process.env.PORT) || 5173;
let html = '';
let version = 0;
let timer = null;

async function rebuild() {
  const t = Date.now();
  try {
    html = await build({ dev: true });
    version++;
    console.log(`[dev] 빌드 완료 (${Date.now() - t}ms)`);
  } catch (e) {
    console.error('[dev] 빌드 실패:', e.message);
  }
}

await rebuild();
fs.watch('src', { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 120);
});

const server = http.createServer((req, res) => {
  if (req.url === '/__version') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    return res.end(String(version));
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
});

// 포트가 이미 쓰이고 있으면 다음 번호로 자동 이동 (5173 → 5174 → ...)
let port = PORT;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && port < PORT + 10) {
    console.warn(`[dev] ${port} 포트를 다른 프로그램이 쓰고 있어 ${port + 1}로 시도합니다. (이전에 켠 npm run dev가 아직 실행 중일 수 있어요)`);
    port++;
    server.listen(port);
  } else {
    console.error('[dev] 서버 시작 실패:', e.message);
    process.exit(1);
  }
});
server.on('listening', () => console.log(`[dev] http://localhost:${port} 에서 실행 중 (src/ 수정 시 자동 새로고침, 종료: Ctrl+C)`));
server.listen(port);
