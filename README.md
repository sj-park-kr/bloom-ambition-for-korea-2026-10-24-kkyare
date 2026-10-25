# kkyare_hackathon

BLOOM AMBITION FOR KOREA · 2026.10.24 해커톤 **꺄레** 팀 레포입니다.

- 트랙: 미국 RL Eval·데이터 회사가 돈 내고 쓸 서비스 (AttentionX)
- **한 줄 소개: 실제 날씨로 자동 채점되는 농업 의사결정 데이터. 농장은 수확 기록을 내고 필지별 생산량 예측을 무료로 받고, 돈은 RL 평가·데이터 회사와 작물보험사가 낸다.**
- 파는 것: RL 회사에는 "예보만 보고 결정 → 다음 날 실측으로 채점"되는 과제와 비공개 평가셋, 보험사에는 같은 계산으로 만든 청구 검증·요율 범위
- 왜 지금: 공개 예보는 무료가 됐지만 결정 단위로는 자주 틀린다. 2026년 여름 디모인 살포 판단 1,012건에서 공개 예보 4개가 실측과 25~31% 어긋났다 (아래 "실데이터 백테스트")

## 문서

- [리서치 및 제품 초안 (FieldBench)](docs/research_yujin.md)
- [SprayWindow 리서치](docs/research_sungho/): 경쟁사, 고객, 데이터·기술, Why now, 서비스 정의, 문제 근거, 사업 계획, dispatcher 검증
  - 시작점: [00 종합](docs/research_sungho/00_summary.md) · [05 서비스 정의서](docs/research_sungho/05_service_spec.md) · [07 사업 계획](docs/research_sungho/07_business_plan.md)

## 실행

```bash
corepack enable          # pnpm 10.33.0
pnpm install
cp .env.example .env.local   # ANTHROPIC_API_KEY (없어도 데모는 저장 응답·템플릿으로 동작)
pnpm dev                 # http://localhost:3000
pnpm test                # vitest
```

## Credits

사용한 오픈소스와 데이터의 출처를 여기에 적습니다. 일반 라이브러리 외에, 오늘 만든 코드가 아닌 것만 적습니다.

### 화면·디자인 (유진)
- 디자인 원칙: [anthropics/skills `frontend-design`](https://github.com/anthropics/skills/tree/main/skills/frontend-design) (Apache 2.0). 가이드만 따랐고 코드는 가져오지 않았다.
- 글꼴: [Public Sans](https://fonts.google.com/specimen/Public+Sans), [Barlow Condensed](https://fonts.google.com/specimen/Barlow+Condensed) (SIL Open Font License, Google Fonts)
- 프레임워크·라이브러리: Next.js, React, Tailwind CSS, Recharts, Motion, Zod, Anthropic TypeScript SDK

### 데이터
- 실데이터
  - 농장 지도의 "오늘부터 7일 실제 예보": [Open-Meteo](https://open-meteo.com) Forecast API를 브라우저에서 바로 부른다 (키 불필요, CC BY 4.0).
  - 채점 과정(/live)의 "실데이터 · 2026년 7월 29일 디모인": Open-Meteo Single Runs API로 그날 실제 발행된 HRRR·NBM·GFS·ECMWF run을 받고, [IEM ASOS](https://mesonet.agron.iastate.edu) DSM 실측으로 채점한다. `npx -y tsx scripts/build-real-scenario.ts`로 다시 만들 수 있다 (`fixtures/nowcasting/real-0729/`, `demo: false`).
  - 지도 배경은 Sentinel-2 cloudless(EOX).
- 목업: 필지·과거 날씨·청구·생산량·수확 기록과 설계한 시나리오 3개(2026-06-10). 형식은 위 공개 자료 구조와 NOAA CPC, USDA RMA를 따랐다. 각 화면 하단에 출처를 적었다.
- Open-Meteo 무료 API는 비상업 용도만 허용한다. 상업 납품 전에 유료 구독으로 바꾸거나 NOAA 원본(HRRR·GFS)을 직접 받는다.

### 실데이터 백테스트
`npx -y tsx scripts/backtest-spray-windows.ts` (2026-06-01 ~ 08-31, DSM, 당일 00Z run, 살포 시작 12~22Z 창 1,012개, 규칙은 `src/families/nowcasting/rules.ts`)

| 공개 예보 | 실측과 판정 불일치 | 위반을 놓침 | 괜히 막음 |
|---|---|---|---|
| HRRR | 31% | 196 | 110 |
| NBM | 27% | 176 | 93 |
| GFS | 31% | 200 | 110 |
| ECMWF IFS | 25% | 112 | 140 |

한계: 관측소 한 곳(공항)이고, 모델 돌풍과 ASOS 돌풍은 정의가 달라 차이가 일부 과장될 수 있다. 판정 규칙(풍속 3~10 mph, 돌풍 15 mph 이하, 4시간 무강우)은 데모 가정값이다.

### 데이터 확보 경로 (실서비스)
| 데이터 | 경로 | 누가 가질 수 있나 |
|---|---|---|
| 날씨 예보·관측 | NOAA(HRRR·GFS·NBM), ECMWF open data, IEM ASOS, Open-Meteo(상업은 유료) | 누구나. 해자가 아니다 |
| 카운티 수확량·보험 손해 | USDA NASS Quick Stats(무료 키), USDA RMA Cause of Loss | 누구나 |
| **필지별 과거 수확량** | ① 보험사 파일럿: 농가가 보험 가입 때 내는 과거 생산 기록(APH, 보통 4~10년)과 청구 기록 ② 농가 동의를 받은 John Deere Operations Center·FieldView API 연결로 수확량 지도 | **동의를 받은 우리만.** 공유 조건과 API 이용 약관은 확인 필요 |
| **"예보 → 결정 → 실측" 채점 기록** | 우리 과제를 풀고 채점할 때마다 쌓인다 | 우리만. 시즌이 지날수록 쌓이고 모델이 다시 학습되므로 늦게 시작한 경쟁사가 따라오기 어렵다 |
