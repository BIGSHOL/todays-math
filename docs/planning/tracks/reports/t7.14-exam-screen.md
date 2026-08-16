# T7.14 — '오늘의 시험' 화면 (계기판 · 회차 상세) 완료 보고

브랜치 `BIGSHOL/T7.14-화면` · 트랙 E · 2026-08-16

---

## 1. 무엇을 했나

확정 시안(`docs/design/mockups/hifi-t70-todays-exam.html`, `05-design-system.md §8.7`,
D-39~D-44)을 그대로 구현했다. **새 디자인을 만들지 않았다.**

### 만든 파일 (전부 소유 트리 안)

| 파일 | 내용 |
|---|---|
| `src/app/(main)/exam/page.tsx` | `/exam` 계기판 라우트 |
| `src/app/(main)/exam/[id]/page.tsx` | `/exam/{id}` 회차 상세 라우트 |
| `src/components/exam/examScreen.contract.ts` | 화면 조회 계약 (predictor.contract 를 **조합만** 함) |
| `src/components/exam/viewModel.ts` | 파생 규칙 순수 함수 — 판정 가능 여부·D-day·단계·잔차·구간 좌표 |
| `src/components/exam/examApi.ts` | 조회 + 계약 parse |
| `src/components/exam/ExamChrome.tsx` | 워드마크 분기 크롬 (D-39) |
| `src/components/exam/ExamDashboard.tsx` | 계기판 화면 |
| `src/components/exam/RoundRow.tsx` | 회차 행 — 인셋 바(신뢰도) + 큰 순번 + D-day |
| `src/components/exam/PipelineDots.tsx` | 4단계 색점 + 라벨 (점이 앞, D-42) |
| `src/components/exam/RoundDetail.tsx` | 회차 상세 — 예측 \| 실측 좌우 대조 (D-40) |
| `src/components/exam/BlueprintPanel.tsx` | 대조 기둥 한쪽 (예측/실측 같은 항목·같은 순서) |
| `src/components/exam/StudentScoreTable.tsx` | 학생 표 — 예상 → 구간 → 실제 → 잔차 |
| `src/components/exam/ScoreIntervalBar.tsx` | 연속 막대 + 눈금 (D-42, 폭 132px) |
| `src/mocks/data/predictions.ts` | 회차 픽스처 4건 |
| `src/mocks/handlers/prediction.ts` | MSW — `GET /api/exam/rounds`, `GET /api/exam/rounds/{id}` |
| `src/__tests__/unit/examView.test.ts` | 파생 규칙 33개 |
| `src/__tests__/components/TodaysExam.test.tsx` | RTL 16개 |

### 고친 파일 — 1개, 3줄

`src/mocks/handlers/index.ts` — import 1줄 + 배열 등록 1줄 + 주석 1줄. 지시받은 범위 그대로다.

### 손대지 않은 것 (지시대로)

- `prisma/schema.prisma`, `prisma/migrations/**` — **한 글자도 안 고쳤다.** 새 테이블/컬럼도 필요 없었다.
- `src/contracts/predictor.contract.ts` — 읽기만 했다.
- `Problem.score` / `externalId` / `answer` / `figureUrls` / `figureSource` — 읽지도 쓰지도 않았다.
- 남의 트랙 파일, 원본 저장소(`F:\시험지변환기`, eywa, sumaek, N드라이브), 공유 DB — 접근 없음.
  이 태스크는 네트워크·DB 를 아예 타지 않아 `--apply` / `ALLOW_SHARED_IMPORT` 게이트가 필요 없었다.

---

## 2. RED 기준을 어떻게 지켰나

### 🔴 근거가 없으면 숫자를 내지 않는다 — 이 화면의 핵심 계약

"언제 숫자를 내지 **않는가**"를 JSX 가 아니라 `viewModel.ts` 의 순수 함수에 못박고
단위 테스트로 잠갔다. 조건이 렌더 코드에 흩어지면 다음 사람이 하나 지우면서 조용히 깨진다.

- **회차 단위** `roundJudgement()` — 아래 셋 중 하나면 `available: false`
  - 근거 회차 < **2** (`MIN_EVIDENCE_ROUNDS`)
  - 신뢰도 < 0.4 (낮음)
  - 신뢰도가 `null` (미산출) — **0 으로 갈음하지 않는다**
- **학생 단위** `studentJudgement()` — `riskFlags` 에 `학생응답_부족` 이 있으면 개인 점수를 안 낸다.
- 판정 불가일 때 화면이 하는 일:
  - 계기판: `신뢰도 낮음 0.18` 옆에 **`예측 불가 — 근거 부족`** 을 적는다.
  - 계기판: **'지금 할 일'(블루 점)을 지정하지 않는다.** 권장하지 않는 회차로 원장님을
    보내지 않기 위해서다. Hi-fi 03행이 전 단계 무색인 이유가 이것이라고 읽었다.
  - 상세: 예측 기둥이 **청사진 숫자를 한 줄도 내지 않고** `예측 불가 — 근거 부족` +
    `근거 1회차 · 신뢰도 낮음 0.18` 만 적는다.
  - 학생 표: 빈칸 대신 이유를 적는다 — `미응시` / `예측 불가 — 응답 부족`.
    (빈칸은 "0점"이나 "로딩 중"으로 오해된다.)

`MIN_EVIDENCE_ROUNDS = 2` 의 근거는 11 §8 backtest 다. 근거 1편은 문항수 MAE 1.362 로
4편+(1.079)와 차이가 크고, 계약 주석대로 `evidenceCount === 0` 은 전국 평균일 뿐이다.
**1편은 학교 패턴이라고 부를 수 없다**고 판단했다. — 이 임계값은 원장님 확정 사항이 아니다(§4 확인 요청).

### 🔴 D-30 어포던스

`npm run lint:affordance` 통과. 행 본체에 `cursor-pointer`/`hover:bg-*` 없음, `<div onClick>` 없음.
회차로 들어가는 **링크만** 컨트롤이다. 검사 우회(eslint-disable) 없음.
RTL 로도 행 className 에 `cursor-pointer`/`hover:bg-` 가 없음을 직접 검증한다.

### 🔴 색만으로 전달하지 않는다 (D-42)

컴포넌트 테스트는 **색이 아니라 말**을 검증한다. 색은 빠지면 눈에 띄지만, 말이 빠지면
색맹 사용자에게 화면이 통째로 침묵하기 때문이다.
`신뢰도 높음 0.81` / `채점 2/4` / `실점수 대기` / `+3 적중` / `−13 빗나감` / `80~93`.

### 🔴 D-44 인셋 바에 블루 금지

`ConfidenceBarColor` 타입 자체에 `blue` 가 없다(`green|yellow|red|none`).
DOM 에 `data-confidence-bar` 를 심어 4행 전부 `["yellow","green","red","green"]` 인지 테스트한다.
단계 점의 블루는 시안이 확정한 표기라 그대로 뒀다(Hi-fi 범례에 명시).

### 🔴 예상 점수는 점이 아니라 구간 (D-40)

`ScoreIntervalBar` — 회색 구간 막대 + 2px 세로 눈금 + 옆에 `80~93` 병기.
Hi-fi 시안의 좌표(60~100 눈금 · left 50% / width 32.5% / point 70%)를 **회귀 기준값으로
테스트에 박아 뒀다.** 눈금 범위를 바꾸면 테스트가 깨진다.

---

## 3. 테스트 결과 (숫자)

| 게이트 | 결과 |
|---|---|
| `npm test` | **51 파일 / 661 테스트 전부 통과** (내 신규 49개 포함) |
| └ `examView.test.ts` | 33 통과 |
| └ `TodaysExam.test.tsx` | 16 통과 |
| `npm run type-check` | **0 에러** |
| `npm run lint` | **0 에러** (경고 1건은 `lint-staged.config.mjs` 기존 것 — 내 파일 아님) |
| `npm run lint:affordance` | **통과** |
| `npm run build` | **성공** — `/exam`(static) · `/exam/[id]`(dynamic) 등록 확인 |

TDD 순서를 실제로 지켰다: 테스트 2개 파일 작성 → 실행해 RED 확인(모듈 없음) → 구현 → GREEN.

### ⚠️ type-check 관련 — 코디네이터가 헷갈릴 수 있는 것

이 워크트리에서 처음 `npm run type-check` 를 돌리면 **에러 83개**가 난다.
전부 `@prisma/client` 가 생성돼 있지 않아서다(`Module '@prisma/client' has no exported
member 'Class'` 류). 내 변경과 무관함을 `git stash` 로 확인했다 — **stash 전후 모두 83개**.
`npx prisma generate` 한 번이면 **0개**가 된다. schema/migrations 는 건드리지 않았고,
`prisma generate` 는 `node_modules` 에만 쓴다(`git status` 로 확인).

---

## 4. 막힌 것 · 확인해 주셔야 할 것

### (1) 🔴 전용 계약 파일이 지정되지 않았다 — 위치를 정해 주십시오

지시문은 "새 계약이 필요하면 **아래에 지정된 네 전용 계약 파일**에만 쓴다"고 했는데,
소유 파일 목록에 계약 파일이 없었다. `src/contracts/` 에 새 파일을 만들면 T7.7/T7.10 과
충돌할 수 있어 **소유 트리 안**(`src/components/exam/examScreen.contract.ts`)에 두었다.
`src/contracts/` 로 옮길지는 코디네이터 판단이다. 파일 안에도 같은 주석을 남겼다.

이 계약이 왜 필요했는지: `predictionRunSchema` 는 **엔진 실행 스냅샷**이라 화면이 필요한
셋이 없다 — ① 시험 시행일(D-day 기준) ② 4단계 파이프라인 진행 상태 ③ 학생 이름·실점수.
셋 다 엔진 입출력이 아니라 화면 조합물이다. `predictor.contract.ts` 는 **한 글자도 안 고쳤고**
`blueprintSchema` · `scorePredictionSchema` 는 그대로 재사용한다.

### (2) 🔴 API 경로가 T7.7/T7.10 과 합의되지 않았다

`/api/exam/rounds`, `/api/exam/rounds/{id}` 로 잡았다. 근거 문서(11-score-predictor.md)에
엔드포인트 정의가 없어 **내가 정한 이름이다.** T7.7 이 다른 경로를 쓰면
`src/components/exam/examApi.ts` 의 `ROUNDS_PATH` 한 곳만 고치면 된다.
합의된 경로를 알려 주시면 맞추겠다.

### (3) 🔴 `AppChrome` 에 반대 방향 워드마크 분기가 없다 — 다른 트랙 소유라 못 고쳤다

D-39 는 워드마크 자리에서 두 탭이 갈리는 구조다. `/exam` → `/`(오늘의 수학) 방향은
`ExamChrome` 에 넣었지만, **`/`(오늘의 수학) → `/exam` 방향이 없다.**
`src/components/chrome/AppChrome.tsx` 는 내 소유가 아니라 손대지 않았다.
**지금 상태로는 원장님이 URL 을 직접 치지 않으면 '오늘의 시험' 탭에 들어갈 수 없다.**
병합 시 `AppChrome` 의 `오늘의수학` 워드마크를 `오늘의수학 │ 오늘의시험` 분기로 바꿔 주셔야 한다.
장기적으로는 두 화면이 크롬 컴포넌트 하나를 공유하는 편이 맞다(현재는 의도적으로 분리 복제).

### (4) 시안의 「+ 새 회차」 버튼을 넣지 않았다

회차 생성 API 도 폼도 없다. 누르면 아무 일도 안 하는 컨트롤을 두는 것이 **D-30 이 막는
바로 그 버그**라 뺐다. 코드에 주석으로 남겼다. 회차 생성은 별도 태스크가 필요하다.

### (5) 시안의 「배점 보정기」는 이 태스크 범위가 아니다

Hi-fi 페이지 아래쪽 배점 보정기(11 §10, D-43)는 **T7.9(예측 문제지 생성기)의 필수 구성**이라
구현하지 않았다. 실점수 `[입력]` 컨트롤(D-40 와이어의 우측 칸)도 T7.10 의 저장 API 가 있어야
의미가 있어 표시만 하고 입력 폼은 넣지 않았다. 필요하면 후속 태스크로 잡아 주십시오.

### (6) 확정해 주셔야 할 디자인 세부 2건

- **회차 행의 주 버튼**: D-39 는 "행 클릭 → 상세, 단 행 본체 손가락 커서 금지 — 주 버튼만"
  인데 Hi-fi 시안에는 별도 버튼 칸이 없다(3열 그리드: 44px / 1fr / 96px).
  **회차 제목을 링크로** 만들어 시안 레이아웃을 그대로 유지했다.
  '오늘의 수학'처럼 별도 액션 컬럼을 원하시면 알려 주십시오.
- **`MIN_EVIDENCE_ROUNDS = 2`**: 위 §2 의 근거로 내가 정한 값이다. 원장님이 "1회차라도
  일단 보여 달라"고 하시면 상수 하나만 바꾸면 된다(테스트도 상수를 참조한다).

### (7) 확인 못 한 것 — 정직하게 적는다

- **실물 브라우저 렌더를 눈으로 보지 못했다.** 실 API(`/api/exam/rounds`)가 아직 없어
  `npm run dev` 로 띄우면 "회차를 불러오지 못했습니다"만 나온다. 검증은 RTL(DOM) +
  `npm run build` 성공까지다. **Hi-fi 시안과의 픽셀 대조는 코디네이터가 실 API 연결 후
  한 번 봐 주셔야 한다.** 특히 인셋 바 5px·단계 점 7px·구간 막대 132px 의 실제 무게감.
- 인쇄 대상 화면이 아니라 실물 프린터 검수(절대 규칙 6)는 해당 없음.
- Mock 픽스처의 회차 라벨(`25-2 중간`)과 시행일(2026-08-29)은 **Hi-fi 시안의 값을 그대로
  옮긴 것**이라 실제 학사일정과는 맞지 않는다. 화면 표기 확인용 픽스처일 뿐 엔진 입력이 아니다.

---

## 5. 코디네이터 체크리스트

- [ ] `npx prisma generate` 후 `npm run type-check` 0 에러 재확인 (§3)
- [ ] `examScreen.contract.ts` 를 `src/contracts/` 로 옮길지 결정 (§4-1)
- [ ] T7.7 과 API 경로 합의 → `examApi.ts` 의 `ROUNDS_PATH` 정렬 (§4-2)
- [ ] **`AppChrome` 에 `오늘의수학 │ 오늘의시험` 분기 추가 — 없으면 탭 진입 경로가 없다** (§4-3)
- [ ] `MIN_EVIDENCE_ROUNDS = 2` 와 회차 행 주 버튼 형태를 원장님께 확인 (§4-6)
- [ ] 실 API 연결 후 Hi-fi 시안과 눈으로 대조 (§4-7)
