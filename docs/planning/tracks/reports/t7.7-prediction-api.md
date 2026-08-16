# T7.7 — `PredictionRun` 저장 + 예측 API (트랙 E) 완료 보고

브랜치 `BIGSHOL/T7.7-예측API` · 2026-08-16

---

## 1. 무엇을 했나

`predictBlueprint`(기존 엔진)로 예측을 만들어 `PredictionRun` 한 행으로 남기고,
그 기록을 읽는 API 3개를 붙였다.

| 파일 | 내용 |
|---|---|
| `src/contracts/predictionRun.contract.ts` | 신규 — 요청/응답 계약. `predictor.contract.ts` 는 **읽기만** 했다 |
| `src/lib/predictor/predictionRunService.ts` | 신규 — 근거 수집 · 누출 검사 · 저장 · 직렬화 · 소유권 |
| `src/app/api/predictions/route.ts` | 신규 — `POST`(실행·저장) · `GET`(회차 목록) |
| `src/app/api/predictions/[id]/route.ts` | 신규 — `GET`(회차 상세) |
| `src/__tests__/api/predictions.test.ts` | 신규 — 28개 |
| `src/__tests__/helpers/predictionRunTestDb.ts` | 신규 — T7.7 전용 인메모리 Prisma 대역 |

**`prisma/schema.prisma` · `prisma/migrations/**` · `predictor.contract.ts` · 남의 트랙 파일은
한 줄도 건드리지 않았다.** `git status` 에 위 6개 신규 경로만 뜬다.

### 엔드포인트

- `POST /api/predictions` — `{ series, targetPeriod, cutoffPeriod?, inputExamIds?, params? }`
  → 201 + run 상세. 컷오프를 생략하면 대상 시점과 같다.
- `GET /api/predictions/{id}` — run 상세. 남의 run 은 403, 없으면 404.
- `GET /api/predictions?school=..&grade=..[&level=..&subject=..]` — 계기판용 요약 목록(최신순).

### RED 기준 대응

| 기준 | 어떻게 |
|---|---|
| 🔴 컷오프 이후 자료가 근거에 섞이면 **422** | `comparePeriod` 로 저장 **직전에 전수 검사**. 자동 수집 경로는 이미 컷오프 이전만 모으지만, 근거를 직접 지정(`inputExamIds`)하는 경로가 있어 이중으로 막는다. **컷오프가 대상 시점보다 뒤인 설정도 같은 사고**라 DB 를 읽기 전에 먼저 막는다 |
| 🔴 근거 없으면 청사진을 지어내지 않음 | `PredictorUnavailableError` → `predictedBlueprint` NULL 저장 + riskFlag `적은_과거회차`. 0문항 0점 청사진이 저장되지 않는 것을 **원시 DB 행으로** 확인하는 테스트를 넣었다 |
| `inputExamIds` 에 실제로 쓴 시험지가 전부 | 자기 학교 이력 + 코호트 전부를 담는다(코호트도 근거다). 저장 행과 응답이 같은 목록임을 테스트가 확인 |
| `params` 스냅샷 + `engineVersion` | `params.predictor` 에 `PredictorParams` 전체(오버라이드 반영). `engineVersion = "0.2.0"` |
| 같은 시험 2회 예측 → 행 2개 | 항상 `create`. upsert 를 쓰지 않는다 |
| 소유권 404/403 | `src/lib/ownership.ts` 와 같은 패턴(`requireOwnedPredictionRun`). **단, 소유자 근거가 `params` 안에 있다 — 아래 §3-A** |

### 추가로 넣은 것 (근거 있는 것만)

- **신뢰 가드**: 자동 수집 시 `paperTrust` 로 만점 미달/초과 편을 뺀다. 잘린 시험지를 학습에
  넣으면 그 학교가 "12문항만 낸다"고 배운다. **뺀 편 수를 `params.evidence.excludedByTrust` 에
  센다** — 조용히 버리지 않는다.
- **riskFlag 4종**을 실제 데이터로 판정한다. 지어낸 임계값을 쓰지 않았다.
  - `적은_과거회차` — 자기 학교 과거가 0편이거나 예측 자체가 불가능할 때
  - `시험범위_미확정` — `ExamScope` 행이 없거나 `confirmedAt` 이 NULL 이거나 `unitIds` 가 빔
  - `난이도라벨_결손` — 근거는 있는데 상/중/하 라벨이 한 문항도 없을 때
  - `학생응답_부족` — 항상. `predictedScores` 가 비어 있는 이유다(§3-C)
- **`inputExamIds` 로 근거 핀 고정**: "엔진을 고칠 때마다 과거 run 을 새 버전으로 재실행해
  비교"(11 §3 L5-c)가 성립하려면 같은 입력을 그대로 다시 먹여야 한다. 이 경로는
  `paperTrust` 를 적용하지 않는다(가드 기준이 바뀌면 같은 입력이 아니게 된다).
  **누출 검사만은 예외 없이 적용된다.**

---

## 2. 테스트 결과 (숫자)

```
npx vitest run src/__tests__/api/predictions.test.ts
  Test Files  1 passed (1)
       Tests  28 passed (28)

npm test (전체)
  Test Files  50 passed (50)
       Tests  640 passed (640)      ← 이전 회차 612 + 신규 28, 기존 회귀 0

npm run type-check        통과 (tsc --noEmit, 출력 없음)
npm run lint              error 0 · warning 1 (lint-staged.config.mjs — 기존 것, 내 파일 아님)
npm run lint:affordance   통과 (이 태스크는 UI 없음)
```

### 테스트가 실제로 무는지 확인했다 (돌연변이 검사)

트랙 README 의 "합성 픽스처가 이관 결함을 통과시켰다" 사고를 되풀이하지 않으려고,
누출 가드 두 줄을 일부러 지우고 다시 돌렸다.

```
assertNoLeakage / assertCutoffNotAfterTarget 제거
  → Tests  2 failed | 26 passed (28)
     × 컷오프 이후 시험지를 근거로 지정하면 422 이고 run 이 저장되지 않는다
     × 컷오프가 대상 시점보다 뒤면 422 이고 run 이 저장되지 않는다
```

가드를 빼면 정확히 그 두 테스트만 빨개진다. 원복 후 다시 28/28 초록.

### 대역(fake)이 실제 Prisma 보다 관대해지지 않게 한 것

- `Prisma.DbNull` → 조회 시 `null` 로 정규화(실제 Prisma 동작).
- Json 컬럼은 **JSON 왕복**시켜 저장한다. 객체 참조를 그대로 들고 있으면 `undefined` 필드나
  Date 가 살아남아 Postgres 에서는 사라질 값으로 테스트가 초록이 된다.
- 지원하지 않는 where 연산자·`include` 형태가 들어오면 **던진다**(조용히 통과시키지 않는다).

---

## 3. 🔴 막힌 것 — 코디네이터가 판단해야 할 것

### A. `PredictionRun` 에 **소유자 컬럼(`userId`)이 없다** — 가장 중요

지시는 "소유자 아닌 사용자의 run 조회는 404/403" 이었는데, 커밋된 스키마
(`431560f`)의 `PredictionRun` 에는 소유자를 적을 자리가 아예 없다.
스키마·마이그레이션 수정이 금지돼 있어(4개 세션 병렬) **`params` JSON 안에
`ownerUserId` 예약 키로 실었다.**

- 계약상 `params` 는 `z.record(z.string(), z.unknown())` + "형태는 엔진 버전마다 다르다"라
  담을 수는 있다. 그러나 **본래 자리가 아니다.**
- 실제로 생긴 제약 두 가지:
  1. 목록 조회의 소유자 필터가 **DB where 가 아니라 메모리에서** 일어난다.
     그래서 목록 응답에 페이지네이션 `meta` 를 붙이지 않았다(page/total 이 정확할 수 없다).
     한 학교·학년 시리즈의 회차는 학기당 2편 수준이라 지금 규모에서는 문제가 없다.
  2. 소유자에 인덱스를 걸 수 없다.
- **권고**: `PredictionRun.userId String @db.Uuid` + `@@index([userId, createdAt])` 추가.
  마이그레이션 후 `params.ownerUserId` → 컬럼 복사는 기계적으로 된다
  (계약 파일의 `PREDICTION_RUN_PARAMS_STOPGAP_KEYS` 가 옮길 키 목록이다).

**정책 판단이 필요한 곳**: 지금은 POST 에 학교 제한을 두지 않았다(누구든 어느 학교로든
run 을 만들 수 있고, 만든 사람만 읽는다). "내 학생이 다니는 학교만" 같은 제한을 걸려면
`Student.schoolName/schoolLevel/schoolGrade` 로 판정할 수 있지만, 그건 제품 정책이라
임의로 넣지 않았다. 원장님 확인이 필요하다.

### B. 실행 단위 `riskFlags` 컬럼도 없다

`riskFlags` 는 계약상 `ScorePrediction` 안에만 있는데, "근거가 없어 청사진을 못 만들었다"는
**run 단위 사실**이라 담을 자리가 없다(`predictedScores` 가 비어 있으니 문항별로도 못 담는다).
같은 이유로 `params.riskFlags` 에 실었다. **권고**: `riskFlags String[]` 컬럼 추가.

### C. `predictedScores` 는 항상 빈 배열이다 — 지어내지 않았다

학생 개인 예상 점수를 내려면 능력 추정(11 §3 L3)과 난이도→점수 환산 계수(§2.7-3)가
필요한데 **둘 다 아직 없다.** `src/lib/predictor/predictStudentScore.ts` 는 채점 결과가
있어야 도는 v0 placeholder라 예측 시점에는 쓸 수 없다.

그래서 빈 배열을 저장하고 `학생응답_부족` 을 남긴다. 0점짜리 `ScorePrediction` 을 만들면
계약상 `expectedScore`·`interval` 을 지어내야 하고, 그게 이 프로젝트가 이미 낸 실수다.

**T7.10(`ActualExamScore`) 에 영향이 있다**: `ActualExamScore.predictedScore` 는 "예측
당시 값의 스냅샷"인데 지금은 붙일 예측값이 없다. T7.11(환산 계수)이 나오기 전까지
T7.10 은 청사진 잔차만 다룰 수 있다. **이건 T7.10 세션에 알려야 한다.**

### D. `engineVersion` 문자열이 두 곳에 따로 있다

- `scripts/predictor/backtest.ts:42` — `const ENGINE_VERSION = "0.2.0"`
- `src/lib/predictor/predictionRunService.ts` — `PREDICTION_ENGINE_VERSION = "0.2.0"`

지금은 같은 값이지만 한쪽만 올리면 backtest 지표와 실행 기록이 조용히 다른 축이 된다.
`backtest.ts` 는 내 소유 파일이 아니라 손대지 않았다. **권고**: 상수를 한 곳
(`src/lib/predictor/` 아래)에 두고 backtest 가 import 하게 통일.

### E. `Prisma Client` 가 이 워크트리에서 낡아 있었다

`node_modules` 의 생성물에 `Exam`·`PredictionRun` 이 없어 `npx prisma generate` 를 돌렸다
(스키마·마이그레이션은 안 건드렸고, `git status` 도 깨끗하다). **다른 트랙 세션도 같은
상태일 수 있다** — `431560f` 이후 워크트리를 만든 세션은 generate 가 필요하다.

### F. 확인만 하고 넘기는 것 — 조회 부하

자동 근거 수집은 코호트를 `(급, 학년, 과목)` 전체에서 문항까지 통째로 읽는다.
코퍼스 2,020편 규모에서는 문제없지만(한 코호트가 수백 편), 편수가 크게 늘면
연도 상한(`year: { lte: cutoff.year }`) 같은 DB 단 필터가 필요하다. 지금 넣지 않은 이유는
**같은 결과를 내는 최적화라 검증 대상만 늘리기 때문**이다. 편수가 늘면 그때 붙이면 된다.

### G. 구현하지 않은 riskFlag 하나

`학교표기_불일치` 는 열거값에는 있지만 **판정 근거가 없어 붙이지 않는다.**
"자기 학교 과거가 0편"인 상황이 학교명 표기 불일치 때문인지, 정말 자료가 없는 것인지
지금 데이터로는 가를 수 없다. T7.5(학교명 정규화)가 끝나면 그 정규화 결과와 대조해
판정할 수 있을 것으로 본다 — **추측으로 붙이지 않았다.**

---

## 4. 코디네이터가 확인할 것 (체크리스트)

1. **`PredictionRun.userId` 컬럼 추가 여부** (§3-A) — 스키마 담당 세션이 한 번에 내야 한다.
2. **`PredictionRun.riskFlags String[]` 컬럼 추가 여부** (§3-B).
3. **POST 의 학교 제한 정책** — 원장님 확인 필요 (§3-A 끝).
4. **T7.10 세션에 §3-C 전달** — 붙일 개인 예측값이 아직 없다.
5. `engineVersion` 상수 통일 (§3-D) — `backtest.ts` 를 고칠 권한이 있는 쪽에서.
6. main 병합 전 `npx prisma generate` (§3-E).

---

## 5. 추측과 사실의 구분

이 보고서에서 **사실**은 다음뿐이다: 테스트 숫자, 돌연변이 검사 결과, 스키마에 컬럼이
없다는 것, 생성 클라이언트가 낡아 있었다는 것, `backtest.ts` 의 상수 위치.

**추측/판단**으로 표시해야 하는 것:
- §3-F 의 부하 전망 — 실제로 재보지 않았다. 코퍼스 편수(2,020)만 근거다.
- §3-G 의 "T7.5 가 끝나면 판정 가능할 것" — 아직 확인 못 했다.
- `params` 에 두 값을 싣는 것이 "허용 범위"라는 판단 — 계약 문구상 담을 수는 있으나
  설계 의도는 아니다. 코디네이터가 다르게 판단하면 되돌리기 쉽게 예약 키를 상수로 묶어뒀다.
