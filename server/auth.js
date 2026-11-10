// 인터넷 공개용 로그인 (APP_PASSWORD를 넣었을 때만 켜짐. 비우면 지금처럼 잠금 없음 → 내 PC 전용)
//   로그인 성공 → 서명된 쿠키(30일). 실패는 IP마다 15분에 5번까지, 넘으면 잠깐 막음.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PASSWORD = process.env.APP_PASSWORD || '';
export const enabled = PASSWORD.length > 0;
const COOKIE = 'qo_s';
const DAYS = 30;
const SECRET_FILE = path.resolve(process.env.SESSION_SECRET_FILE || 'data/.session-secret');

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
    fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
    return s;
  }
}
const SECRET = enabled ? secret() : '';
// 비밀번호를 바꾸면 기존 로그인은 모두 풀린다 (서명에 비밀번호 지문 포함)
const PW_TAG = enabled ? crypto.createHash('sha256').update(PASSWORD).digest('hex').slice(0, 16) : '';
const sign = (v) => crypto.createHmac('sha256', SECRET).update(`${v}.${PW_TAG}`).digest('base64url');

function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
export function valid(req) {
  const c = cookies(req)[COOKIE];
  if (!c) return false;
  const [exp, sig] = c.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = sign(exp);
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}
// 프록시(Caddy) 뒤에서 들어온 요청인지 = 인터넷에서 온 요청
export const viaProxy = (req) => !!req.headers['x-forwarded-for'];
export const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https';

const fails = new Map(); // ip → [시각...]
const WINDOW = 15 * 60 * 1000;
const MAX_FAILS = 5;
export function tooMany(ip) {
  const now = Date.now();
  const list = (fails.get(ip) || []).filter((t) => now - t < WINDOW);
  fails.set(ip, list);
  return list.length >= MAX_FAILS;
}

export function login(req, res, password) {
  const ip = clientIp(req);
  if (tooMany(ip)) return { code: 429, error: '비밀번호를 여러 번 틀렸어요. 15분 뒤에 다시 시도하세요.' };
  const a = crypto.createHash('sha256').update(String(password || '')).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    fails.get(ip).push(Date.now());
    console.warn(`[로그인] 실패 ${ip} (${fails.get(ip).length}/${MAX_FAILS})`);
    return { code: 401, error: '비밀번호가 틀렸어요.' };
  }
  fails.delete(ip);
  const exp = String(Date.now() + DAYS * 86400000);
  res.setHeader('Set-Cookie', `${COOKIE}=${exp}.${sign(exp)}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`);
  console.log(`[로그인] 성공 ${ip}`);
  return { code: 200 };
}
export function logout(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

export const LOGIN_HTML = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>퀀트 오피스 · 로그인</title>
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{display:grid;place-items:center;background:#161719;color:#efe6d2;font:14px/1.5 ui-monospace,"Cascadia Mono","D2Coding",monospace;
background-image:radial-gradient(rgba(255,255,255,.04) 1px,transparent 1px);background-size:8px 8px}
form{width:min(340px,90vw);padding:28px 24px 24px;background:#1f2023;box-shadow:0 0 0 3px #0e0f11,6px 6px 0 3px #000;position:relative}
.logo{display:flex;align-items:center;gap:10px;margin-bottom:18px}
.q{width:34px;height:34px;display:grid;place-items:center;background:#ffc94a;color:#141517;font-weight:700;font-size:20px;box-shadow:0 0 0 2px #0e0f11}
h1{margin:0;font-size:18px;color:#ffc94a}p{margin:0;color:#8e9198;font-size:12px}
label{display:block;margin:18px 0 6px;font-size:12px;color:#8e9198}
input{width:100%;padding:10px 12px;font:inherit;color:#efe6d2;background:#0e0f11;border:0;box-shadow:inset 0 0 0 1px #3d3f45;outline:none}
input:focus{box-shadow:inset 0 0 0 2px #ffc94a}
button{width:100%;margin-top:14px;padding:10px;font:inherit;font-weight:700;border:0;cursor:pointer;background:#ffc94a;color:#141517;box-shadow:0 0 0 2px #0e0f11,3px 3px 0 2px #000}
button:active{transform:translate(2px,2px);box-shadow:0 0 0 2px #0e0f11,1px 1px 0 2px #000}
button:focus-visible{outline:2px solid #efe6d2;outline-offset:3px}
.err{min-height:18px;margin-top:10px;color:#ff5a5a;font-size:12px}
</style></head><body>
<form id="f"><div class="logo"><div class="q">Q</div><div><h1>퀀트 오피스</h1><p>비밀번호를 넣어야 들어갈 수 있어요</p></div></div>
<label for="pw">비밀번호</label><input id="pw" type="password" autocomplete="current-password" autofocus required>
<button type="submit">들어가기</button><div class="err" id="e" role="alert"></div></form>
<script>
document.getElementById('f').onsubmit=async(ev)=>{ev.preventDefault();const e=document.getElementById('e');e.textContent='';
try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})});
const d=await r.json().catch(()=>({}));if(r.ok){location.replace('/');}else{e.textContent=d.error||'로그인 실패';}}catch{e.textContent='서버에 연결할 수 없어요';}};
</script></body></html>`;
