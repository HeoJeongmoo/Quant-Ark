// npm run notify:setup  → 텔레그램 봇에 보낸 메시지로 TELEGRAM_CHAT_ID를 찾아 준다
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.log('1) 텔레그램에서 @BotFather → /newbot → 봇 이름을 정하면 토큰이 나옵니다.\n2) .env에 TELEGRAM_BOT_TOKEN=그토큰 을 넣고\n3) 새로 만든 봇과 대화방을 열어 아무 메시지나 보낸 뒤 이 명령을 다시 실행하세요.');
  process.exit(0);
}
const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const d = await r.json();
if (!d.ok) {
  console.log(`토큰 확인 실패: ${d.description || r.status}`);
  process.exit(1);
}
const chats = new Map();
for (const u of d.result || []) {
  const c = u.message?.chat || u.channel_post?.chat;
  if (c) chats.set(c.id, c.username || c.title || c.first_name || '');
}
if (!chats.size) console.log('아직 받은 메시지가 없어요. 텔레그램에서 봇에게 아무 메시지나 보낸 뒤 다시 실행하세요.');
for (const [id, name] of chats) console.log(`TELEGRAM_CHAT_ID=${id}   (${name})`);
process.exit(0);
