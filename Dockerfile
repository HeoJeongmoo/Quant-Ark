# 퀀트 오피스: 매매 봇 + 대시보드 (http://localhost:8787)
# 1단계: 대시보드 빌드 (React → dist/index.html 한 파일)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY build.mjs ./
COPY src ./src
RUN node build.mjs

# 2단계: 실행 이미지 (서버 코드 + 빌드된 화면만)
FROM node:22-alpine
ENV NODE_ENV=production \
    SERVER_HOST=0.0.0.0 \
    SERVER_PORT=8787 \
    TZ=Asia/Seoul
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY src/strategy ./src/strategy
COPY --from=build /app/dist ./dist
# 체결 기록·설정·관심종목(data)과 KIS 토큰 캐시는 볼륨에 둔다 (컨테이너를 지워도 남음)
RUN mkdir -p data .kis-cache && chown -R node:node /app
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/api/bot/health >/dev/null || exit 1
CMD ["node", "server/index.js"]
