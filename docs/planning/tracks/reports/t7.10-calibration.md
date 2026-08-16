# T7.10 + T7.11 완료 보고 — 실측 점수 저장 · 환산 계수 추정 (트랙 E)

브랜치 `BIGSHOL/T7.10-보정루프` · 2026-08-16

---

## 1. 무엇을 했나

새로 만든 파일 6개다. **다른 파일은 한 줄도 고치지 않았다**(`git status` 상 수정 0건, 신규 6건).

| 파일 | 내용 |
|---|---|
| `src/contracts/calibration.contract.ts` | 보정 루프 계약 (신규) |
| `src/lib/predictor/calibration.ts` | 순수 함수 — 잔차·구간 판정·계수 추정. **IO 없음** |
| `src/lib/predictor/actualScoreService.ts` | 실측 저장/조회 (이 트랙에서 IO 를 하는 유일한 파일) |
| `src/app/api/predictions/[id]/actual/route.ts` | `POST`·`GET` |
| `src/__tests__/unit/calibration.test.ts` | 21건 |
| `src/__tests__/api/actualScore.test.ts` | 15건 |

`prisma/schema.prisma` · `prisma/migrations/**` · `src/contracts/predictor.contract.ts` ·
`src/mocks/prismaTestDouble.ts` · 남의 트랙 파일 — **전부 손대지 않았다.**
공유 DB 에도 쓰지 않았다(이 태스크는 네트워크·DB 접근 자체가 없다. 테스트는 파일 단위 모킹).

### T7.10 — 실측 저장

`POST /api/predictions/{id}/actual` · `GET /api/predictions/{id}/actual`

- **같은 run·같은 학생을 두 번 붙이면 갱신**이다. 기존 행을 먼저 읽어 create/update 를 갈라
  `$transaction` 안에서 처리한다.
- **`predictedScore` 는 스냅샷**이다. 처음 저장할 때 run 의 Json 에서 복사하고,
  **재저장 때는 덮어쓰지 않는다.** 잔차는 그 스냅샷 기준으로 다시 센다.
  → 테스트 "재저장해도 예측값 스냅샷은 run 의 Json 을 따라가지 않는다"가 이걸 못 박는다
  (저장 후 run 의 Json 을 72 → 50 으로 바꿔도 스냅샷은 72 로 남는다).
- `residual = actual − predicted`, `intervalHit` 은 예측 구간이 실제를 담았는지(경계 포함).
- **run 에 없는 학생 → 422**, 그리고 **한 명이라도 어긋나면 아무것도 저장하지 않는다.**
- `studentId: null` 항목(시험지 예상 평균 예측)은 대조 대상에서 제외한다.
- 401 / 400 / 404(회차·학생) / 403(남의 학생) / 422 를 전부 테스트로 고정했다.

### T7.11 — 환산 계수 추정

`estimateCalibration(samples, { nominalCoverage? })` → `CalibrationOutcome`

- **표본 부족이면 `judgementUnavailable: true`.** 계수를 지어내지 않는다.
  `MIN_CALIBRATION_SAMPLES = 20`. 근거는 코드 주석에 적었다 — 이 추정의 안전장치가
  `|평균잔차| > 2·SE` t 판정인데, 그 판정은 표본 표준편차가 믿을 만해야 성립한다.
  표본 표준편차의 상대 표준오차는 대략 `1/√(2(n−1))` 로 n=20 에서 16%, n=10 이면 24% 다.
  **20 은 "이 아래로는 판단 안 함"의 하한이지 "20이면 믿어도 된다"가 아니다** — 실제 채택은
  아래 홀드아웃 비교가 정한다.
- **엔진 버전이 섞이면 표본이 충분해도 판단하지 않는다**(`reason: "엔진버전_혼재"`).
  predictor.contract.ts 가 "버전이 다르면 지표를 섞어 비교하지 않는다"고 못 박은 것을 코드로 세웠다.
- **계층 축소는 경험적 베이즈**다. `w_s = n_s·τ̂² / (n_s·τ̂² + σ̂²_within)`,
  τ̂²(학교 간 진짜 분산)은 학교 평균의 흩어짐에서 학교 안 잡음을 뺀 나머지로 **자료에서 추정**한다.
  임의의 상수를 박지 않았다.
  → 학교 고유 신호가 잡음에 묻히면 τ̂² = 0 이 되어 **모든 학교 가중이 0**이 된다.
    즉 "2명 응시한 학교의 잔차 평균을 그 학교 계수로 확정"하는 일이 **구조적으로 불가능**하다.
    11 §2.3 이 1,752편으로 실측한 상황(학교 고유성 1.8%)에서 나와야 하는 동작이 이것이다.
- **보정 전/후 MAE 를 홀드아웃(leave-one-out)으로 잰다.** 같은 표본으로 계수를 고르고
  같은 표본으로 좋아졌다고 말하지 않기 위해서다. `improved: false` 면 보정을 적용하지 않는 쪽이 옳다.
- **트랙 교훈("합산 목적함수 하나로 고르면 어떤 항목이 조용히 나빠진다")을 구조로 반영했다.**
  보정을 3단계(`전체_오프셋` → `전체_기울기` → `학교_오프셋`)로 쪼개 **단계마다 따로 채택 판정**하고,
  학교 오프셋은 **학교 하나하나마다 홀드아웃 MAE 를 봐서 나빠진 학교는 뺀다.**
  각 단계의 `maeBefore`/`maeAfter`/`note` 가 그대로 결과에 실린다.
- **기울기(= 11 §2.7-3 이 말한 "환산 계수")** 는 표본 30건 미만이거나 예측값에 폭이 없으면
  아예 제안하지 않고, 제안하더라도 `|β−1| > 2·SE(β)` 를 통과하고 홀드아웃이 좋아져야 채택한다.
- **편향을 명시적으로 표시한다** — `bias.detected` / `meanResidual` / `tStatistic` /
  `direction`("과소예측" | "과대예측").
- **구간 적중률은 점 예측 MAE 와 분리해 보고**한다. 엔진이 선언한 신뢰수준을 호출자가 알려주면
  이항 표준오차로 정직성을 판정하고, 안 알려주면 `intervalHonest: null` — 판정하지 않는다.

---

## 2. 테스트 결과 숫자

| | 값 |
|---|---|
| 착수 전 전체 | 49 파일 / **612건 통과** |
| 완료 후 전체 | 51 파일 / **648건 통과, 실패 0** |
| 이번에 추가 | **36건** (calibration 21 + actualScore 15) |
| `npm run type-check` | 통과 (출력 없음) |
| `npm run lint` | 오류 0. 경고 1건은 **기존 것**(`lint-staged.config.mjs` import/no-anonymous-default-export, 내 변경과 무관) |
| `npm run lint:affordance` | 통과 |

RED → GREEN 을 실제로 밟았다. calibration 테스트는 먼저 모듈 미존재로 실패했고
(`Failed to resolve import "@/lib/predictor/calibration"`), 구현 후 21/21 통과했다.

---

## 3. 막힌 것과 그 이유 — 추측이 아니라 사실만

### 3-1. 실측 잔차 코퍼스가 **존재하지 않는다**. 계수 추정을 실데이터로 검증하지 못했다

`PREDICTOR_CORPUS_DIR` 을 확인했다(`handoff-a-index/scripts/qa/reports`). 그 안에 있는 것은
정답 대조·문항 분류·폐기 후보 등 **문항 단위 산출물**이고, **학생별 실제 내신 점수는 한 건도 없다.**
DB 의 `ActualExamScore` 도 비어 있다(이 태스크가 그 테이블에 처음 쓰는 코드다).

그래서:

- T7.11 의 검증은 **성질(property) 기반**이다 — 결정적으로 만든 합성 표본으로
  "신호가 없으면 가중이 0", "표본이 적을수록 가중이 낮다", "나빠지면 채택 안 함",
  "편향이 있으면 표시" 같은 **불변식**을 못 박았다.
- **`MIN_CALIBRATION_SAMPLES = 20` 은 통계적 근거이지 이 프로젝트 실측 근거가 아니다.**
  실제 잔차가 20건이라도 쌓이면 그 분포로 다시 정해야 한다. 코드 주석에도 그렇게 적어 두었다.
- 트랙 규칙이 경고한 "합성 픽스처가 이관 결함을 통과시켰다"와 같은 종류의 위험이 남아 있다.
  다만 여기서 합성한 것은 *이관 대상 원본*이 아니라 *통계적 성질*이라 성격이 다르다.
  그래도 **실측이 처음 들어오는 회차에서는 계수를 자동 적용하지 말고 원장 눈으로 한 번 보게 할 것**을
  권한다.

### 3-2. 스키마에 없어서 못 한 것 (고치지 않고 보고만 한다 — 지시대로)

`prisma/schema.prisma` 는 건드리지 않았다. 다음 두 가지는 **현재 스키마로는 원리적으로 불가능**하다.

1. **`ActualExamScore` 에 예측 구간(lower/upper/coverage) 스냅샷이 없다.**
   `intervalHit` 만 저장한다. 결과:
   - 재저장(원장이 점수 정정) 시 `intervalHit` 은 **run 의 현재 Json 구간으로 다시 판정**된다.
     `predictedScore`/`residual` 은 스냅샷이 지켜지지만 `intervalHit` 만 그렇지 못하다.
   - T7.11 의 구간 정직성 판정에 쓸 `coverage` 를 저장된 행에서 읽을 수 없어,
     호출자가 `nominalCoverage` 를 넘겨야 한다(안 넘기면 `intervalHonest: null`).
   → **제안**: `ActualExamScore` 에 `predictedLower` `predictedUpper` `predictedCoverage`
     세 컬럼 추가. 트랙 E 마이그레이션을 낼 때 같이 넣으면 된다.

2. **`PredictionRun` 에 소유자 컬럼이 없다.** 그래서 회차 자체에는 소유권 경계를 걸 수 없어
   **학생에 걸었다** — `requireOwnedStudent` 로 저장을 막고, 조회는
   `where: { student: { class: { userId } } }` 로 남의 학생 점수가 새지 않게 걸렀다.
   → **코디네이터 확인 필요**: 이 경계가 의도한 것인지. "회차는 학교 시리즈 단위라 공용,
     학생 점수는 소유 원장만" 이 지금 구현의 전제다. 다르면 알려 주면 맞춘다.

### 3-3. 하지 않은 것 (범위 밖이라 판단)

- **T7.11 을 부르는 API·화면·스크립트는 만들지 않았다.** 지시가 지정한 소유 파일에
  `[id]/actual/**` 만 있었고, 계수 추정은 순수 함수로 내는 것이 태스크였다.
  누가 이걸 호출할지(리포트 스크립트인지 T7.14 화면인지)는 정해지지 않았다. → 결정 필요.
- **MSW 목 핸들러(`src/mocks/handlers/**`)를 추가하지 않았다.** 공유 파일이라 T7.7·T7.14 와
  충돌할 수 있어서다. T7.14 화면이 MSW 를 쓸 거라면 그때 한 곳에서 넣는 편이 안전하다.
- `src/mocks/prismaTestDouble.ts` 에 `predictionRun`/`actualExamScore` 모델을 넣지 않았다.
  같은 이유(공유 파일 충돌). 대신 API 테스트가 `vi.mock("@/lib/db")` 로 파일 단위 대역을 쓴다
  — `src/__tests__/api/auth.test.ts` 가 쓰는 것과 같은 방식이다.

---

## 4. 코디네이터가 확인해야 할 것

1. **[결정]** `PredictionRun` 소유권 경계 — 3-2 (2) 의 전제가 맞는지.
2. **[스키마]** `ActualExamScore` 에 예측 구간 3컬럼 추가 여부 — 3-2 (1).
   트랙 E 마이그레이션을 낼 때 함께 넣을지 판단 필요.
3. **[병합]** T7.7 이 만드는 `src/app/api/predictions/route.ts` · `[id]/route.ts` 와
   경로가 겹치지 않는다(나는 `[id]/actual/route.ts` 하나만 추가). 디렉터리만 공유한다.
4. **[정책]** 첫 실측 회차에서 계수를 자동 적용할지, 원장 확인 후 적용할지 — 3-1.
   `estimateCalibration` 은 `improved`·단계별 `apply` 를 다 돌려주므로 어느 쪽이든 붙일 수 있다.
5. **[후속]** T7.11 결과를 실제로 소비할 자리(리포트 스크립트 / T7.14 화면)를 어느 트랙이 맡을지.
