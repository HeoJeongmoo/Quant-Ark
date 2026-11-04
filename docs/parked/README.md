# 보류 중인 기능

- `notify/`: 휴대폰 알림(텔레그램·ntfy). 사용자 요청으로 아직 연결하지 않음. 쓰게 되면 `server/notify/`로 옮기고 `server/index.js`에서 `createNotifier({ bus: bot.bus, journal })`를 연결하면 된다.
