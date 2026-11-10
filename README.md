# 퀀트 오피스

한국투자증권(KIS) Open API로 미국 주식을 자동 매매하는 서버 상주 봇 + 픽셀 오피스 대시보드.
화면의 숫자는 전부 KIS 실데이터. 같은 앱 안에 플래너, 공부방(암기 카드 · 오피스 꾸미기) 포함.

## 구성

| | |
|---|---|
| 화면 | React 18, esbuild → `dist/index.html` 단일 파일, 갈무리 폰트, 캔버스 픽셀 오피스 |
| 서버 · 봇 | Node.js 22 (`server/`), 의존성 `dotenv`, `ws`만 |
| 외부 API | 한국투자증권 Open API, Claude / Gemini (서로 폴백), Alpha Vantage · 야후 뉴스 |
| 실행 | Docker Compose: 봇 + Caddy(자동 HTTPS) |
| 호스팅 | Google Cloud Compute Engine e2-micro (무료 등급, us-west1) |
| 접속 | `https://<서버IP>.sslip.io` + 비밀번호 로그인 |

```
브라우저 ──https──▶ Caddy :80/:443 ──▶ 봇 127.0.0.1:8787 ──┬─ KIS API
                                                         ├─ Claude / Gemini
                                                         └─ ./data
```

## 서버 (Google Cloud)

- e2-micro, 메모리 1GB + 스왑 2GB, 표준 영구 디스크 30GB, Ubuntu 22.04, 스냅샷 없음
- 무료 조건: 미국 리전 + e2-micro + 표준 디스크 30GB 이하. 예산 알림 $1 걸어 둘 것
- `restart: always` + 헬스체크 + 내부 감시견(루프 5분 멈추면 재시작). 서버 재부팅 시 자동 복구
- VM을 **중지**하면 외부 IP가 바뀔 수 있음 → `.env`의 `PUBLIC_HOST` 수정 후 `docker compose up -d`

### 새로 만들기

1. VM: us-west1 / E2 e2-micro / 표준 영구 디스크 30GB / 스냅샷 없음 / 방화벽 HTTP·HTTPS 허용
2. 스왑 + Docker
   ```bash
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER && sudo systemctl enable docker && sudo apt-get install -y unzip
   ```
   설치 중 Ctrl+C 금지 (5~10분). 끝나면 SSH 재접속
3. 코드: SSH 창 "파일 업로드"로 zip 올리고
   ```bash
   mkdir -p ~/quant-office && cd ~/quant-office && unzip -o ~/파일.zip >/dev/null && sudo chown -R $USER:$USER . && chmod -R u+rwX .
   ```
4. `.env`: `cp .env.example .env && nano .env`. Windows에서 가져온 파일이면 `sed -i 's/\r$//' .env`. 마지막에 `chmod 600 .env`
5. 실행
   ```bash
   sudo mkdir -p data .kis-cache && sudo chown -R 1000:1000 data .kis-cache
   docker compose up -d --build
   docker compose ps                                  # quant-office, quant-caddy 둘 다 Up
   docker logs quant-caddy 2>&1 | grep -i obtained    # 인증서 발급 확인
   ```

### 업데이트

```bash
cd ~/quant-office && unzip -o ~/새파일.zip >/dev/null && rm ~/새파일.zip && docker compose up -d --build
```
`.env`, `data/`, `.kis-cache/`는 zip에 없으므로 유지됨.

### 자주 쓰는 명령

| 명령 | |
|---|---|
| `docker compose ps` | 상태 |
| `docker compose logs -f --tail 100 quant-office` | 봇 로그 |
| `docker compose restart quant-office` | 봇 재시작 |
| `docker compose stop` / `start` | 잠시 끄기 / 켜기 |
| `free -h`, `df -h /` | 메모리, 디스크 |

## 로컬 개발

```bash
cp .env.example .env     # KIS_ENV=demo. APP_PASSWORD, PUBLIC_HOST, COMPOSE_PROFILES는 비움
docker compose up -d --build
```
- http://localhost:8787 (로그인 없음)
- Docker 없이: `npm install` → `npm run build` → `npm run server`. 화면 작업은 `npm run dev` (:5173)
- 서버와 로컬을 동시에 실전 주문으로 켜지 말 것 (같은 계좌에 주문 중복)

## 환경 변수

`.env`는 서버와 로컬에만. 깃·zip·메신저로 보내지 않음.

| 변수 | |
|---|---|
| `KIS_ENV` | `real` / `demo` |
| `APP_KEY`, `APP_SECRET` | KIS Developers 발급 |
| `CANO`, `ACNT_PRDT_CD` | 계좌번호 앞 8자리 / 뒤 2자리 |
| `KIS_ENABLE_REAL_ORDERS` | `true`일 때만 실전 주문 전송 |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | 하나만 있어도 동작 |
| `ALPHAVANTAGE_API_KEY` | 뉴스 감성 (없으면 야후·KIS만) |
| `APP_PASSWORD` | 서버 전용. 로그인 비밀번호, 12자 이상. 비어 있으면 외부 접속 전부 차단 |
| `PUBLIC_HOST` | 서버 전용. `136.109.243.219.sslip.io` 형식 |
| `COMPOSE_PROFILES` | 서버 전용. `public` → Caddy 실행 |
| `LOCAL_API_TOKEN` | 선택. 로그인한 세션은 따로 묻지 않음 |
| `BOT_MIN_TARGET_PCT`, `BOT_LOSS_CUT_PCT` | 선택. 비우면 화면 설정값 |
| 그 외 | `.env.example` 기본값 |

## 점검

| 명령 | |
|---|---|
| `npm run kis:check` | 토큰, 시세, 호가, 5분봉, 계좌, 주문(dry-run) |
| `npm run kis:scan` | 순위 API 필드 확인, 필터 통과 후보, 갭 후보 |
| `npm run llm:check` | Claude · Gemini 연결 |
| `npm run news:check -- TSLA` | 뉴스 3곳 + 사무엘 판단 |
| `npm run test:bot` | 장 시간표, 손절, 체결 기록, 켈리, 재주문 |
| `npm run test:stier` | S티어 지표, 켈리 계산 |

서버에서는 `docker compose exec quant-office npm run kis:check` 식으로.

## 봇 (server/bot)

장 상태는 뉴욕 시각(서머타임 자동) + NYSE 휴장·조기폐장 기준 (`session.js`). 정규장만 주문.

정규장 루프
1. 시세: 보유 10초, 관심 약 30초, 보유 1호가 30초
2. 5분봉: 봉 마감마다 관심 + 보유 + QQQ
3. 노아의 방주: QQQ가 전일 또는 장중 고점 대비 1.5%(`arkDropPct`) 하락 시 신규 매수 중지
4. 신호 → 규칙 점검 → 수량 → 노아 위험 점검(막기만) → 여호수아 매수
5. 모세: 보유 종목 매 틱 매도 판단
6. 다윗 탐색: 5분마다 순위 API로 후보 → AI 관심종목

매도 (모세, `moses.js`)
- 강제 손절 −3% (`HARD_STOP_PCT`), 모드·AI 무관
- AI 모드: 5분봉 이평·MACD·RSI, 호가 잔량, QQQ로 하락 압력 판단 → 손절 / +1% 이상이면 트레일링
- 수동 모드: 고정 손절·익절선

체결 (`executor.js`). KIS 미국주식은 정규장 시장가가 없어 지정가로 근사
- 손절: 매수호가 −0.2% → 20초 → −1% → 20초 → −3% → 이후 60초마다 재시도 (8회 실패 시 경보)
- 익절: 매수호가 → 45초 → −0.3% → 30초 → −1.5% → −3%
- 매수: 매도호가(상한 +0.3%), 60초 미체결 시 잔량 취소, 추격 없음
- 체결 즉시 내부 잔고 반영, 다음 틱에 KIS 잔고로 재동기화

비용 필터
- 왕복 비용 0.6% = 수수료 0.25% × 2 + 여유 0.1% (`KIS_FEE_PCT`)
- 예상 변동폭(5분봉 ATR% × √보유 봉 수)이 목표 수익 이상인 종목만 진입
- 트레일링 스톱은 평단 + 왕복 비용 아래로 안 내려감. 보유 예정 시간 2배 지나도 비용 못 넘기면 시간 손절
- 체결 기록 손익은 수수료 차감 후

위험 상품 제외 (`risk.js`)
- 상품기본정보(CTPF1702R): 레버리지·인버스, PTP, 상장폐지, 워런트·유닛·권리·우선주·채권형, 펀드 제외. `data/product-info.json`에 7일 캐시
- 조회 실패 시 종목명·티커로 판별
- 거래대금 $5M 미만, 예상 변동폭 12% 초과도 매수 안 함

계좌 보호
- 뉴욕 거래일 첫 평가금액 기준 −5%(`dailyLossPct`) → 그날 셧다운: 신규 매수 금지(직접 주문 포함), 봇 포지션 청산, 다음 거래일 자동 해제 (`data/bot-guard.json`)
- 동시 보유 최대 3종목 (`maxPositions`, 진행 중 매수 포함)
- 마감 60분 전부터 신규 매수 금지, 마감 5분 전 봇 포지션 청산
- 장중 입출금·환전 시 오늘 손익 계산이 틀어짐

안전장치
- `KIS_ENABLE_REAL_ORDERS=true`가 아니면 실전에서도 주문안만 기록
- `KIS_MAX_ORDER_USD`는 매수에만 적용
- 잔고 조회 3회 연속 실패 → 비상 대기 (매수 중지, 매도는 계속)
- 수동 제어 중에는 신호만 기록
- AI는 규칙 결정을 막거나 줄이기만 함. AI 실패 시 규칙대로

### 누적 손실 방어

최근 20거래일 평가금액 고점 대비 (`data/drawdown.json`)

| 단계 | 고점 대비 | 대처 |
|---|---|---|
| 정상 | −8% 미만 | |
| 1 | −8% (`dd1Pct`) | 비중 ½, 동시 2종목 |
| 2 | −12% (`dd2Pct`) | 비중 ¼, 1종목, D만 |
| 3 | −15% (`dd3Pct`) | 신규 매수 중지 (가상은 계속), 수동 해제 |

- 악화는 즉시, 회복은 기준의 절반 위로 올라오면 하루 한 단계씩
- 방어 단계에서는 "0주면 1주" 미적용. 매도·손절은 항상 정상
- 설정 탭 → 계좌 보호: 정지 풀기(2단계부터), 고점 다시 잡기(입출금한 날)

## 트랙 1: 갭 + 시가 범위 돌파 (D)

1. 장전 스캔: 뉴욕 08:30~09:25, 10분마다 상승률 순위
   - 갭 +4~25%, $5~30, 프리마켓 50만 주 또는 $5M 이상, 시총 $300M 이상, 위험 상품 제외
   - 상위 5개 `data/gap-candidates.json`, 09:25 확정. 놓치면 09:30~09:45 정규장 등락률로 대체
2. 진입: 첫 15분 고가·저가 = 시가 범위. 09:45~11:00 마감 5분봉이
   - 범위 고가 위 양봉 마감
   - 거래량 범위 평균 1.2배 이상
   - 고가에서 3% 이상 달아나지 않음
   - 갭 절반 이상 반납 안 함
   종목당 하루 1회
3. 손절: 범위 저가와 진입가 −2% 중 가까운 쪽. +3%부터 추적 익절
4. 갭 종목 변동폭 상한 30%

## 상대 거래량 · 뉴스

- RVol = 오늘 누적 거래량 ÷ (20일 평균 × 이 시각까지 보통 쌓이는 비율, U자 곡선). 일봉은 종목당 하루 1회 (`data/avg-volume.json`)
  - 탐색: RVol 2배(`rvolMin`) 미만 제외 / 장중 매수: 1.5배(`rvolMinEntry`) 미만 차단 (D 제외)
- 갭 점수 가산: 프리마켓 RVol, 뉴스 재료, 상장주식수 적음
- 사무엘 뉴스 (종목별 10분 캐시)
  - Alpha Vantage: 무료 하루 25회 → 매수 직전과 09:25 갭 확정에만. 감성 −0.35 이하(2건↑) 차단, +0.25 이상 재료 (`data/av-usage.json`)
  - 야후 RSS: 키 없음, 보조. 403/429 시 30분 휴식
  - KIS 해외뉴스: 한글 제목
  - 공모·유상증자·희석·역분할·상장폐지·파산 제목 → 차단
  - AI 의견 BLOCK만 효력
- 화면 뉴스 속보: KIS 전체 3분마다, 내 종목은 야후·KIS. 30분 이내 "속보"

## 가상 거래 · 전략 승격

D를 뺀 모든 전략은 가상 거래로 성적을 쌓고 승격돼야 실매수.

체결 가정 (보수적)
- 진입: 다음 봉 시가 +0.1%. 시가가 신호가보다 0.3% 넘게 높으면 미체결
- 손절: 손절가 −0.2%, 갭 하락이면 시가 −0.2%. 같은 봉에 손절·목표 둘 다면 손절
- 목표: 고가가 목표가를 0.05% 넘어야 체결
- 마감: 15:55(조기폐장 12:55) 봉 시가 −0.1%
- 같은 종목·전략·청산은 뉴욕 기준 하루 1건

청산 규칙 3종: P1 +2%/−1% 2시간, P2 +3%/−1.5% 3시간, P3 +5%/−2% 4시간

승격 조건 (최근 80건, 모두 충족)
- 40건 이상 (`promoteMin`), 기대값 +0.3% 이상 (`promoteExp`), PF 1.3 이상 (`promotePF`), 거래일 15일 이상 (`promoteDays`)
- 앞 절반 · 뒤 절반 모두 기대값 플러스
- 후보 8개 초과 시 2개마다 기대값 +0.1%p, 건수 +10 (현재 10개 → +0.4%, 50건)
- 장세 한정: 전체는 미달이어도 QQQ 방향(강세/보합/약세) 하나에서 통과하면 그 장세일 때만 매수
- 통과한 청산 중 기대값 최고 규칙으로 매매. 기준 아래로 떨어지면 관찰로 강등

매수 비중
- `sizeMode: tier` (소액 계좌): 예상 승률(가상 + 실거래 2배 가중)을 본전 승률과 비교

  | 단계 | 조건 | 비중 |
  |---|---|---|
  | 검증 전 | 표본 20건 미만 | 25% |
  | 본전 근처 | 본전 +3%p 미만 | 15% |
  | 보통 | 본전 +3%p 이상 | 33% |
  | 높음 | 본전 +10%p 이상 | 45% |

- `sizeMode: fixed`: 종목당 10%, 최대 15%
- 실거래 20건 이상 + 평가금액 $2,000 이상이면 하프 켈리. 켈리 0 이하면 매수 안 함
- 0주면 1주 가격이 한도 안일 때 1주
- `sizeTierUntilEquity` 이상이면 자동으로 fixed

### 전략 목록

| | 진입 (마감된 5분봉) |
|---|---|
| A 변동성 돌파 | S티어 |
| B 과매도 반등 | S티어 |
| C 장 초반 갭 | S티어 |
| E VWAP 회복 | VWAP 아래 → 위로 양봉, 거래량 10봉 평균 1.3배↑ |
| F 장중 고점 돌파 | 6봉 횡보폭 1.5% 이하 → 당일 고점 위 양봉, 거래량 1.5배↑ |
| G 레드 투 그린 | 전일 종가 아래 시작 → 처음 전일 종가 위 양봉 |
| H NR7 돌파 | 직전 봉이 7봉 중 최소 폭 → 그 고가 위 양봉 |
| I 불 플래그 | 4봉 내 +3% → 거래량 줄며 절반 이내 눌림 → 직전 고가 위 양봉 |
| J 터틀 수프 | 20봉 저가를 0.1~1.5% 깬 뒤 1~3봉 안에 그 위 양봉 |
| K 실버 불릿 | 10~11시, 당일 저가 갱신 후 상승 FVG 첫 되돌림 양봉 |
| L VWAP 2σ 되돌림 | VWAP −2σ 아래 마감 → 밴드 안 양봉 |
| M 홀리 그레일 | ADX 30↑, +DI > −DI, 20 EMA 첫 눌림 → 직전 고가 돌파 |
| N DTFX | 스윙 고점 종가 돌파 → 50~70% 되돌림 → 직전 고가 돌파 |
| O 상대강도 신고가 | 10시 이후 QQQ 마이너스, 종목 +1%↑, 당일 고가 거래량 1.5배 돌파 |
| P VWAP 첫 눌림 | 09:45부터 VWAP 위 유지 → 10:30 이후 첫 VWAP 터치 → 직전 고가 돌파 |
| Q ORB 리테스트 | 첫 15분 고가 돌파 → +0.3% 이내 되돌림 지지 → 직전 고가 돌파 (11:30까지) |

- 후보 자리 10개 (D 제외). 대기열 순서: O → P → L → Q → M → N (`QUEUE_ORDER`)
- 명부 `data/strategy-registry.json`
- 은퇴 (30분마다, 승격·장세 한정·수동 고정 제외)
  - 부진: 100건·30거래일↑, 기대값 −0.1% 이하, 최근 50건도 마이너스
  - 신호 부족: 60거래일에 40건 미만
  - 정체: 90거래일 동안 미승격
- 은퇴 = 영구 결번, 기록 유지, 대기열 맨 앞이 빈자리로

### 가상 전용 종목

- 고정 8개: AAPL, MSFT, NVDA, AMZN, META, TSLA, SPY, QQQ
- 자동 5개: 뉴욕 09:20 이후 거래량 급증·체결강도·거래대금 상위, 그날 고정 (`data/shadow-universe.json`)
- 갭 후보도 포함. 관심 종목·AI 추천은 가상 기록 안 함
- 가상 전용 종목은 실매수 안 함
- `SHADOW_EPOCH`를 올리면 기존 기록을 `.bak.jsonl`로 옮기고 새로 시작 (현재 2)

### 장세 기록 (KIS 데이터)

- QQQ 5분봉: 방향(±0.5%), 갭, 변동폭 ÷ 20일 평균, 추세 효율, 장중 변동성
- 시장 폭: 섹터 ETF 11개 상승 수, RSP − SPY
- VIXY, IWM, QQQ − IWM, SPY
- 가상 매수 순간 값을 거래마다 저장 (`regime`), 하루 값은 `data/regime-days.json`

## 데이터 (`data/`)

| 파일 | |
|---|---|
| `journal/fills.jsonl` | 체결 (부분 체결 포함) |
| `journal/trades.jsonl` | 왕복 거래 |
| `journal/signals.jsonl` | 신호와 처리 결과 |
| `journal/shadow.jsonl` | 가상 거래 |
| `shadow-open.json` | 진행 중 가상 거래 |
| `bot-positions.json` | 봇 포지션 메타 |
| `equity-daily.json` | 날짜별 평가금액 (손익 캘린더) |
| `regime-days.json` | 날짜별 장세 |
| `strategy-registry.json` | 전략 명부 |
| `planner.json` | 플래너 · 공부방 · 꾸미기 |
| `caddy/` | HTTPS 인증서 |
| `.session-secret` | 로그인 쿠키 서명 키 |

봇 밖(HTS)에서 거래한 종목은 `external`로 기록, 전략 통계 제외.

## 화면

- 상단 전환: 트레이딩 / 플래너 / 공부방
- 트레이딩 오른쪽 탭: 매매 / 성과 / 가상 / 설정. AI 자동 · 수동 전환은 설정 탭 "매매 제어"
- 가상 탭: 진행 중, 오늘 청산, 오늘 1등, 승격 근접, 가상 캘린더(일 · 주 · 월), 승격 표
- 손익 캘린더: 평가금액 기준 / 실현 손익 기준. 입출금한 날은 평가금액 손익에 섞임

### 플래너

- 월간 · 주간 · 연간 · 리스트
- 월간: 날짜 클릭해서 일정 입력. 빈칸에는 오피스 직원(산 반려동물 포함)
- 주간: 요일별 메모, 할 일 체크, 습관 3개 × 7일
- 연간: 12달 미니 달력, 올해 목표 5개
- 하루 계획표: 24시간 원형, 30분 단위, 자정 넘김 지원, 현재 시각 바늘
- 2026 공휴일 표시. 0.8초 뒤 서버에 자동 저장, 동시 수정 시 늦은 쪽이 다시 불러옴

### 공부방

암기 카드
- 덱 → 카드 직접 입력, 또는 공부 내용 붙여 넣고 AI 생성 (요셉: Claude → Gemini)
- 복습: Space로 뒤집기, 1/2/3 = 몰랐어 / 헷갈려 / 알았어
- 간격: 1 → 2 → 4 → 7 → 15 → 30일. 몰랐어는 당일 재출제
- 하루 목표 20장, 연속 일수, 7일 그래프

코인

| | 코인 |
|---|---|
| 플래너 할 일 완료 | 5 |
| 리스트 체크 | 3 |
| 습관 체크 | 2 |
| 카드 복습 | 1 |
| 하루 20장 | +10 |

- 기록에서 매번 다시 계산. 체크 해제 시 차감

오피스 꾸미기
- 책상만 있는 빈 사무실에서 시작
- 기본 가구(탕비실, 소파+러그, 스탠드, 화분 4개)와 꾸미기 17종을 코인으로 구매
- 커피머신 · 전자레인지는 조리대 필요
- 쉬는 직원은 놓인 가구로만 이동
- 산 물건은 트레이딩 화면 오피스에도 반영. 마우스 올리면 미리 보기

## API

```
POST /api/login {"password"}  /api/logout
GET  /api/bot/state | events (SSE) | health | stats | journal?kind=trades | shadowcal?month=
POST /api/bot/settings | order | liquidate | gapscan
POST /api/watchlist/manual   DELETE /api/watchlist/(manual|ai)/:code
GET  /api/planner   PUT /api/planner
POST /api/study/cards {text, n}
GET  /api/llm/health   GET /api/usage/stream
```
`APP_PASSWORD`가 있으면 로그인 쿠키 필요. 없고 `LOCAL_API_TOKEN`만 있으면 변경 API에 `x-api-token` 헤더.

## AI

하루 예산 `LLM_DAILY_BUDGET_USD` (기본 $3)
- 다윗 · 사무엘 · 여호수아: Gemini Flash → Claude Haiku
- 솔로몬 · 요셉 · 노아 · 아브라함: Claude Sonnet → Gemini
- 실제 호출: 노아 위험 점검, 다윗 탐색 요약, 사무엘 뉴스, 요셉 암기 카드

## 남은 것

- `data/` 자동 백업 (현재 서버 디스크에만 있음)
- 봇 가동률 기록
- 모바일 알림 (`docs/parked/notify/`에 보관)
- 스윙 트랙, 과거 데이터 백테스트
- 휴장일 표는 2027년까지. 이후 `US_MARKET_HOLIDAYS`에 추가
