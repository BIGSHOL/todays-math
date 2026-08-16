# 적대적 리뷰 ① — 보정 루프 (예측 저장 → 실점수 → 잔차 → 계수)

- 대상: `predictionRunService.ts` · `api/predictions/**` · `actualScoreService.ts` ·
  `calibration.ts` · `scripts/predictor/calibration-report.ts` ·
  `contracts/{predictionRun,calibration}.contract.ts`
- 방식: 읽기 전용. 기존 파일은 한 줄도 고치지 않았다(`git status` 로 확인).
  재현물은 `src/__tests__/**/_adv-*.test.ts` 7개, `scripts/qa/_adv-*.ts` 3개.
- 재현 결과: **빨간 테스트 13개**. 기존 테스트 113개는 그대로 초록(회귀 없음).
- 공유 DB 는 읽지도 쓰지도 않았다. 전부 인메모리 대역과 순수 함수로 재현했다.
- **진행 상황: 🔴1 고침(2026-08-16). 나머지 9건은 미해결.**

## 재현물 실행법

```bash
npm run test:adv       # 아직 안 고친 결함의 재현물 (qa/adversarial/**) — 일부러 빨갛다
npm run test           # 제품 테스트 — 초록이어야 한다
npx tsx scripts/qa/_adv-calibration-probe.ts
npx tsx scripts/qa/_adv-calibration-sweep.ts
npx tsx scripts/qa/_adv-holdout-check.ts
```

재현물은 `qa/adversarial/` 에 있고 기본 `npm run test` 의 include 밖이다 — 안 그러면
품질 게이트가 늘 빨개서 아무도 안 보게 된다. 결함을 고치면 그 재현물은 지우고 회귀 가드를
`src/__tests__/**` 로 옮긴다(🔴1 에서 그렇게 했다).

---

## ✅ [고침 2026-08-16] 🔴1 — 실측 점수를 넣을 수 있는 경로가 하나도 없었다

> **아래 재현은 이제 통과한다.** 회귀 가드는
> `src/__tests__/api/calibrationLoop.test.ts`(진짜 엔진으로 run 생성 → 실점수 저장 →
> 화면 조회, 7건) · `src/__tests__/unit/examRoster.test.ts`(8건) ·
> `examCompose.test.ts`·`examRounds.test.ts`·`actualScore.test.ts` 에 있다.
> 무엇을 어떻게 고쳤는지는 이 절 끝의 「고친 내용」 참조.

## 🔴 [보정 루프] 실측 점수를 넣을 수 있는 경로가 하나도 없다 — 루프가 처음부터 닫혀 있다

**무슨 일이 벌어지나** — 원장이 시험이 끝나고 실제 내신 점수를 넣으려 하면, 넣을 화면 자체가
없다. '오늘의 시험' 계기판에 그 회차가 **아예 안 뜬다**. 어찌어찌 회차 id 를 알아내 API 를
직접 두드려도 422 로 거절당한다. 즉 T7.15 가 "보정 루프의 유일한 입력구"라고 부른 그 입력구가
막혀 있고, 그래서 `ActualExamScore` 에는 영원히 0건이 쌓인다. 보정 계수는 영원히 나오지 않는다.

**재현**

`src/__tests__/api/_adv-loop-closure.test.ts` — 진짜 `POST /api/predictions` 로 run 을 만들고
그 run 에 실측을 붙인다.

```
  저장된 predictedScores = []
  riskFlags = ["시험범위_미확정","학생응답_부족"]
  POST /actual -> 422 {"error":{"code":"VALIDATION_ERROR",
     "message":"이 회차의 예측 대상이 아닌 학생이 있습니다.",
     "details":[{"field":"scores.studentId",
                 "message":"dddddddd-... — 이 회차의 예측 대상이 아닙니다."}]}}

 × 실제 엔진이 만든 run 에 실측 점수를 붙일 수 있다
   AssertionError: expected 422 to be 200
```

`src/__tests__/unit/_adv-screen-run-visibility.test.ts` — 화면 쪽도 같이 막혀 있다.

```
 × 자기 run 이 계기판에 보인다            AssertionError: expected false to be true
 × 회차 상세에 학생 행이 뜬다              AssertionError: expected 0 to be greater than 0
```

**원인**

1. `src/lib/predictor/predictionRunService.ts:466` — `const predictedScores: ScorePrediction[] = [];`
   이 파일의 `db.predictionRun.create`(`:502`)가 **저장소 전체에서 유일한 PredictionRun 생성처**다
   (`grep -rn "predictionRun.create"` 결과 1건). 따라서 실전의 모든 run 은 `predictedScores = []` 다.
2. `src/lib/predictor/actualScoreService.ts:172-177` — `index.byStudent` 에 없는 학생은 전부
   `학생_회차없음`. `byStudent` 는 그 빈 배열에서 만들어지므로 **항상 비어 있다** →
   어떤 학생도 통과 못 한다.
3. `src/lib/exam/composeRounds.ts:103-106` `isRunVisibleTo` — 가시성 판정이
   ① `predictedScores` 안의 내 학생 ② 그 run 에 붙은 내 학생 실측, 두 가지뿐이다.
   ①은 항상 빈 배열, ②는 ①·②가 막혀서 못 생긴다.
   `PredictionRun.userId` 컬럼이 있는데도 쓰지 않는다(`src/lib/exam/loadRounds.ts:54` 는 필터
   없이 전량을 읽는다). 주석은 아직 "`PredictionRun` 에 `userId` 컬럼이 아직 없다(2026-08-16
   확인)"라고 적혀 있다 — `prisma/schema.prisma` 의 `PredictionRun.userId` 와 어긋난 낡은 전제다.

**왜 기존 테스트가 못 잡았나 — 저장소가 이미 낸 사고와 같은 종류다**

`src/__tests__/api/actualScore.test.ts:181-229` 의 `buildPredictedScores()` 는 학생 3명이 든
`predictedScores` Json 을 **손으로 지어 넣는다.** 그 모양을 만드는 코드는 저장소에 없다.
"합성 픽스처가 이관 결함을 통과시켰다"와 정확히 같은 자리다 — 픽스처가 코드 쪽 형태를 쓰는 바람에
원본(실제 엔진 출력)과 어긋난 것을 20개 테스트가 전부 초록으로 통과시킨다.

**내가 확인 못 한 것** — `predictedScores` 를 채우는 것이 다른 트랙(능력 추정 엔진, 11 §3 L3)의
미착수 작업이라 "의도된 미완"일 수 있다. 다만 그렇다면 T7.15 커밋 메시지("보정 루프의 유일한
입력구")와 `actualScore.test.ts` 20건이 초록인 상태가 **완성된 것처럼 보인다**는 것이 문제다.

### 고친 내용 (2026-08-16)

**방향을 정한 근거.** 예측을 지어내서 루프를 여는 길은 막았다 — L3 는 산식조차 없고
(11 §L3 "개념만"), 근거 없는 값을 내는 것은 이 저장소가 이미 낸 사고다. 대신 SSOT 가 정한
순서를 따랐다: 11 §3 L5-b "실제 시험이 끝나면 시험지와 학생 점수를 **입력** → 잔차를 저장",
§4 "환산 계수를 학생 데이터로 구하기 **전에는** 답할 수 없다". **실점수가 예측보다 먼저다.**

| 무엇 | 어떻게 |
|---|---|
| `ActualExamScore.predictedScore`·`residual` | `NOT NULL` → **nullable**. 예측이 없으면 실점수만 남기고 잔차는 비운다(마이그레이션 `20260816180000_actual_score_without_prediction`) |
| 응시 판정 | 새 파일 `src/lib/predictor/examRoster.ts` 의 `takesExam` **하나**. 서버 가드와 화면이 같은 함수를 쓴다. 규칙은 "**아는 것만 막고 모르는 것으로는 막지 않는다**" — `Student.school*` 을 채우는 화면이 아직 없어 전부 NULL 이고, 일치를 요구하면 전원이 조용히 사라진다 |
| `attachActualScores` | "예측한 학생만" → "이 시험을 보는 내 학생". 라우터가 소유권 확인하며 읽은 학생 행을 그대로 넘긴다(두 번 읽지 않는다) |
| `isRunVisibleTo` | `predictedScores` 되짚기 → `PredictionRun.userId` **컬럼**. `loadVisibleRuns` 도 `where: { userId }` 로 DB 가 거른다 |
| `toRoundDetail` 명단 | ① 이 시험을 보는 내 학생 ∪ ② 예측된 학생 ∪ ③ 이미 실점수가 있는 학생. ③ 덕분에 명단 규칙이 나중에 좁아져도 넣은 점수가 사라지지 않는다 |
| MAE 분모 | `ResidualSummary.residualCount` 신설. 잔차 없는 행을 **0 으로 세지 않는다** — "라벨 없는 문항을 한 칸으로 셌다"와 같은 사고 방지 |
| 보정 표본 | `buildCalibrationSamples` 가 예측 없는 행을 제외하되 **몇 건인지 리포트 머리에 찍는다**(조용히 버리지 않는다) |

**화면은 한 줄도 안 고쳤다.** `StudentScoreTable`/`ActualScoreCell` 이 이미 `prediction: null`
을 처리하고 실측 입력칸을 그린다 — 막혀 있던 것은 서버뿐이었다. D-07(디자인 확정) 대상 아님.

**돌연변이 검사** — 새 가드가 실제로 무는지 확인했다.

| 지운/뒤집은 것 | 결과 |
|---|---|
| M8 잔차 없는 행을 0 으로 세기 | 🔴 2건 실패 — 문다 |
| M9 응시 명단 가드 제거 | 🔴 2건 실패 — 문다 |
| M10 예측 없을 때 잔차를 0 으로 지어내기 | 🔴 4건 실패 — 문다 |
| M11 "모르면 막는다"로 규칙 뒤집기 | 🔴 9건 실패 — 문다 |

**아직 남은 것** — 실점수는 쌓이지만 **잔차는 여전히 0건**이다. L3(학생 능력 엔진)이 붙어야
`predictedScores` 가 채워지고 보정 계수가 나온다. 지금 열린 것은 그때까지 실점수를 모아 두는
길이다(11 §4 가 정한 순서). 리포트가 "예측이 없어 표본에서 뺀 행: N건"으로 이 상태를 알린다.

---

## 🔴 [calibration] `improved`·`maeAfter` 는 홀드아웃이 아니다 — 같은 표본으로 고르고 같은 표본으로 잰다

**무슨 일이 벌어지나** — 리포트가 "MAE: 보정 전 5.296 → 홀드아웃 3.468 (개선)" 이라고 찍는다.
34.5% 개선이다. 그런데 그 계수를 실제 새 학생들에게 적용하면 **오히려 0.78점 더 틀린다.**
원장은 좋아졌다는 보고를 받고 나빠진 계수를 쓰게 된다. 보정할 것이 아무것도 없는 자료
(학교 효과 0, 전역 편향 0)에서 나온 결과다.

**재현**

```
$ npx tsx scripts/qa/_adv-holdout-check.ts
리포트가 원장님께 보여 줄 숫자:
  MAE: 보정 전 5.296 → 홀드아웃 3.468 (개선)
  = 34.5% 개선 주장
  계수 {"학교02":2.22233,"학교03":-7.693255,"학교04":2.574741,"학교05":8.709909,"학교09":-3.226703}

같은 분포에서 새로 뽑은 3000건으로 실제 검증:
  보정 전 MAE = 6.2930
  보정 후 MAE = 7.0773
  → 실제로는 0.7843점 나빠졌다 🔴
```

우연이 아니다. 씨앗 200개 × 4가지 표본 크기로 쓸어 봤다(`_adv-calibration-sweep.ts`).
전부 **진짜 보정할 것이 없는** 자료다.

```
$ npx tsx scripts/qa/_adv-calibration-sweep.ts
표본 20건 / 학교 10곳 (진짜 보정할 것 없음, 200회):
   학교 계수를 지어낸 실행     : 101/200
   improved=true 로 보고한 실행: 112/200
   그 중 신규 표본에서 나빠짐  : 108/112  (평균 0.4005점 악화)
표본 30건 / 학교 10곳:  improved 110/200,  그 중 나빠짐 104/110 (평균 0.2407점)
표본 40건 / 학교 8곳 :  improved 102/200,  그 중 나빠짐  92/102 (평균 0.1821점)
표본 60건 / 학교 12곳:  improved 102/200,  그 중 나빠짐  85/102 (평균 0.1248점)
```

**"improved 라고 보고한 실행의 91%(389/426)가 실제로는 나빠진다."**
표본 20건 구간에서는 96%(108/112)다. 표본이 늘수록 완화되지만 60건에서도 83%다.

**원인** — LOO 자체는 맞게 짜여 있다. 문제는 **그 LOO 오차로 무엇을 채택할지 고른 다음,
같은 오차를 성적표로 쓴다**는 것이다.

- `src/lib/predictor/calibration.ts:486` — `apply: weight > 0 && after < before`
  학교마다 "LOO 가 좋아졌나"로 채택 여부를 고른다. 학교당 표본이 2~3명이면 순전히 운으로
  절반쯤이 좋아 보이고, 그 절반만 채택된다.
- `calibration.ts:502-507` — `finalErrors` 를 **채택된 학교는 `schoolErrors`, 나머지는
  `adoptedErrors`** 로 골라 담는다. 즉 이긴 쪽만 모은 오차다.
- `calibration.ts:576` — `improved: round6(finalMae) < round6(maeBefore)`.
  고르는 데 쓴 숫자를 그대로 성적으로 낸다.
- 1·2단계(`:409`, `:438`)도 같은 성질이지만(3개 후보 중 최소를 골라 그 값을 보고) 규모가 작다.
  큰 것은 학교 단계다.

계약 주석(`src/contracts/calibration.contract.ts:259`)은 이 값을 "채택된 보정만 적용한 뒤의
**홀드아웃(LOO)** MAE" 라고 부르고, 코드 주석(`calibration.ts:331-333`)은 "같은 표본으로 계수를
고르고 같은 표본으로 좋아졌다고 말하지 않기 위한 장치"라고 적는다. 학교 단계에서 정확히 그 일이
일어난다.

**내가 확인 못 한 것** — 실제 데이터의 학교 효과가 얼마나 되는지는 모른다(실측 표본이 0건이라
`ActualExamScore` 가 비어 있다). 11 §2.3 의 "학교 고유성 1.8%" 가 맞다면 실전 자료는 내가 쓴
"효과 0" 합성 자료와 거의 같은 상황이므로, 위 수치가 그대로 나타날 것으로 본다.

---

## 🔴 [calibration] τ̂²=0 안전장치가 실제 잔차에서는 작동하지 않는다 — 없는 학교 계수를 만든다

**무슨 일이 벌어지나** — "학교 하나에 2~3명 응시한 걸로 그 학교 계수를 확정하는 일이
**구조적으로 불가능하다**"고 코드가 선언한다(`calibration.ts:185-193`). 실제로는 학교 효과가
정확히 0인 자료에서 학교 5곳에 최대 **+8.71점**짜리 계수를 만들어 낸다. 그 학교 학생들의
예상 점수가 근거 없이 8점 올라간다.

**재현** — `src/__tests__/unit/_adv-fixture-degenerate.test.ts`

```
 ✓ (a) 잔차가 ±5 두 값뿐인 기존 픽스처에서는 성립한다
 × (b) 같은 '효과 0' 인데 잔차가 연속값이면 없는 학교 계수를 만든다
   maeBefore=5.296 -> maeAfter=3.468389 improved=true
   만들어 낸 학교 계수: {"학교02":2.22233,"학교03":-7.693255,"학교04":2.574741,
                        "학교05":8.709909,"학교09":-3.226703}
    학교00 n=3 raw=1.653333  shrunk=0.711231  w=0.800936 apply=false
    학교02 n=3 raw=3.54      shrunk=2.22233   w=0.800936 apply=true
    학교03 n=3 raw=-8.84     shrunk=-7.693255 w=0.800936 apply=true
    학교05 n=3 raw=11.64     shrunk=8.709909  w=0.800936 apply=true
   AssertionError: expected false to be true   (모든 shrinkageWeight === 0 이어야 함)

 × (c) 학교 안 잔차가 서로 같으면 축소가 아예 걸리지 않는다(가중 1.0)
   학교0 n=2 raw=-4.5 shrunk=-4.5 w=1
   AssertionError: expected false to be true   (모든 shrinkageWeight < 1 이어야 함)
```

(a)와 (b)의 차이는 **자료의 성질 하나뿐**이다. (a)는 기존 `src/__tests__/unit/calibration.test.ts`
픽스처(`repeat([5,-5],5)`)로, 학교 평균도 전체 평균도 **정확히 0으로 떨어지는 완전 대칭 설계**다.
(b)는 같은 크기의 연속 잡음이다. 실제 내신 점수 잔차는 (b) 쪽이다.

**원인**

- `calibration.ts:237-243` — τ̂² = `max(0, (betweenMs − withinVariance) / effectiveN)`.
  이 추정량은 **표본 오차를 감안하지 않는다.** 진짜 τ²=0 이어도 `betweenMs` 는 절반의 확률로
  `withinVariance` 를 넘고, 그때 τ̂² > 0 이 되어 가중이 붙는다. 학교당 2~3명이면 이 흔들림이 크다.
  "학교 고유 신호가 잡음에 묻히면 τ̂² 이 0 이 된다"는 주석의 주장은 **기댓값 수준에서만** 맞고
  개별 표본에서는 성립하지 않는다.
- 민감도가 심하다. 같은 30건을 소수점 둘째 자리까지만 반올림해 넣었더니 축소 가중이
  0.215 → 0.801 로 바뀌었다(`_adv-calibration-probe.ts` A절 vs `_adv-fixture-degenerate.ts` (b)).
- `calibration.ts:245-249` — `withinVariance === 0` 이면 `weight = 1`. 학교 안 잔차가 전부
  같기만 하면(정수 점수·소표본에서 충분히 일어난다) **축소를 통째로 건너뛰고 2명짜리 학교를
  100% 신뢰한다.** 주석이 "구조적으로 불가능"이라고 못 박은 바로 그 동작이다.

**돌연변이 검사** — `weight = 0` 을 `weight = 1` 로 뒤집으면 `calibration.test.ts` 가 1건 빨개진다
(가드가 물기는 문다). 다만 그 테스트가 쓰는 픽스처가 위 (a) 라서, **연속 잔차에서 가드가
새는 것은 못 잡는다.**

---

## 🔴 [calibration] 한 학교 20건이 전국 계수를 정하고, 표본이 0건인 다른 학교 예측을 8점 움직인다

**무슨 일이 벌어지나** — 한 학교에서만 실측 20건이 들어오면 그 학교의 편향이 그대로
`coefficients.offset`(전역 오프셋)이 된다. `applyCalibration` 은 이 오프셋을 **학교를 가리지 않고**
더하므로, 실측이 한 건도 없는 학교의 학생 예상 점수가 8점 올라간다.

**재현**

```
$ npx tsx scripts/qa/_adv-calibration-probe.ts   (B절)
B. 한 학교(가중)에서만 20건, 그 학교만 +8점 편향
학교 수 = 1  계수 = {"engineVersion":"...","offset":8.0085,"slope":1,"schoolOffsets":{}}
improved = true  maeBefore = 8.0085 -> maeAfter = 1.327

  이 계수를 '전혀다른고'(표본 0건) 학생 예측 70점에 적용하면 → 78.0085점
  🔴 근거가 한 학교뿐인데 다른 학교 예측이 8.01점 움직인다.
  schoolOffsets 로 격리됐는가: {}
```

**원인** — `MIN_CALIBRATION_SAMPLES = 20` 은 표본 **개수**만 본다(`calibration.ts:70-73`).
학교가 몇 곳인지는 보지 않는다. 학교가 1곳이면 `fitSchoolOffsets` 의 `identifiable` 이 false 가 되어
학교 오프셋은 안 만들지만(`:221`), 그 편향은 대신 **전역 오프셋으로 통째로 흡수된다**(`:302-304`).
`applyCalibration`(`:135-144`)은 `coefficients.offset` 을 모든 학교에 더한다.
격리 장치가 학교 오프셋 쪽에만 있고 전역 오프셋 쪽에는 없다.

**내가 확인 못 한 것** — "전역 오프셋은 엔진 자체의 편향이니 전 학교에 적용하는 게 맞다"는
설계 의도일 수 있다. 그렇다 해도 근거가 학교 1곳뿐일 때 그 구분이 성립하지 않는다는 점,
그리고 리포트가 이 상황을 구분해 알리지 않는다는 점(`schoolCount: 1` 만 찍힌다)은 남는다.

---

## 🔴 [engineVersion] 파라미터를 바꿔도 버전 문자열이 안 올라간다 — "버전 혼재" 가드가 무력하다

**무슨 일이 벌어지나** — 원장/개발자가 엔진 파라미터를 바꿔 예측을 돌려도 `engineVersion` 은
`"0.5.0"` 그대로 찍힌다. 보정은 `engineVersion` **하나만** 보고 표본을 가르므로, 서로 다른 엔진이
낸 잔차를 한 통에 넣고 계수를 뽑는다. 두 무리가 각각 +9점·−9점 틀렸는데 리포트는 "편향 없음"
이라고 적는다.

**재현** — `src/__tests__/api/_adv-version-and-wipe.test.ts`

```
  run A 파라미터: {"decay":0.85,"sameRoundBoost":4,...,"stylePriorWeight":0.5,"unitOwnWeight":0.25}
  run B 파라미터: {"decay":0.2,"sameRoundBoost":20,...,"stylePriorWeight":100,"unitOwnWeight":1}
  run A 청사진 문항수: 22.14791594101939
  run B 청사진 문항수: 24.411764705882355
  engineVersion A/B: 0.5.0 / 0.5.0
 × 파라미터를 바꿔 실행하면 engineVersion 이 달라진다
   AssertionError: expected '0.5.0' not to be '0.5.0'

  bias.detected = false   meanResidual = 0
  전역 offset = 0         improved = true
 × engineVersion 이 같으면 보정은 두 엔진의 잔차를 그냥 합친다
   AssertionError: expected false to be true
```

두 run 은 **서로 다른 청사진**(22.1문항 vs 24.4문항)을 냈다. 같은 엔진이 아니다.

**원인**

- `src/lib/predictor/predictBlueprint.ts:93-96` — 버전은 손으로 관리하는 문자열 리터럴이다.
  바로 위 주석이 "⚠️ `DEFAULT_PARAMS` 를 바꾸면 이 값을 함께 올린다"라고 부탁하지만,
  **강제하는 장치가 코드에 하나도 없다.** `grep -rn PREDICTOR_ENGINE_VERSION` 결과 전부를 봤다 —
  파라미터 내용과 버전 문자열을 묶는 해시·스냅샷·테스트가 없다.
  유일한 테스트(`src/__tests__/api/predictions.test.ts:202`)는
  `expect(body.data.engineVersion).toBe(PREDICTOR_ENGINE_VERSION)` — 같은 상수끼리 비교하는
  항등식이라 어떤 표류도 못 잡는다.
- `src/contracts/predictionRun.contract.ts:141` — API 가 요청마다 `params` 부분 오버라이드를 받는다.
  `predictionRunService.ts:430-433` 이 그걸 그대로 엔진에 넣고, `:508` 이 같은 버전을 찍는다.
  파라미터 스냅샷은 `PredictionRun.params` 에 남지만
  **`scripts/predictor/calibration-report.ts:279-291` 의 select 가 그 필드를 안 읽고,
  `calibrationSampleSchema` 에 담을 자리도 없다.** 보정은 그 차이를 볼 수 없다.

---

## 🟡 [파라미터 표류] 엔진이 파라미터를 하나 늘리거나 줄이면 **과거 run 상세가 전부 500** 이 된다

**무슨 일이 벌어지나** — 계기판 목록에는 과거 회차가 정상으로 뜬다. 그런데 원장이 그 회차를
누르면 500 이 뜬다. 목록은 되는데 상세만 안 되니 원인을 짐작하기 어렵다.
이 저장소가 이미 낸 사고("계약을 한 벌 더 복제해 뒀다가 엔진이 필드를 늘리자 런타임 500")와
같은 증상이 — 복제를 없앤 뒤에도 — 남아 있다. 이번엔 복제가 아니라 **저장된 행 vs 현재 스키마** 다.

**재현** — `src/__tests__/unit/_adv-params-drift.test.ts`

```
 ✓ 현재 엔진이 저장한 run 은 당연히 읽힌다 (대조군)
 × 엔진이 파라미터를 하나 늘리기 **전에** 저장된 run 도 계속 읽혀야 한다
   결과: throw → PredictionRun ...: params 가 계약 형태가 아니다 — 엔진 버전 간 형태 표류.
 × 엔진이 파라미터를 **줄인 뒤** 옛 run 을 읽어도 계속 읽혀야 한다
   결과: throw → PredictionRun ...: params 가 계약 형태가 아니다 — 엔진 버전 간 형태 표류.
```

(늘리기 전 = 옛 run 에 `stylePriorWeight` 가 없는 경우. 실제로 그 필드가 추가된 이력이
`predictionRun.contract.ts:71-77` 에 적혀 있다.)

**원인**

- `src/contracts/predictor.contract.ts:123` — `predictorParamsSchema` 가 `z.strictObject`.
  키가 모자라도, 남아돌아도 실패한다. 즉 **양방향으로 깨진다.**
- `predictionRunService.ts:625-628` `readParams` → `:648-654` `serializePredictionRunDetail` 이
  실패 시 `throw`. `src/app/api/predictions/[id]/route.ts` 에는 try/catch 가 없다 → 500.
- 목록 쪽(`serializePredictionRunSummary`, `:672`)은 `readParams` 를 안 부른다.
  그래서 **목록은 멀쩡하고 상세만 죽는** 비대칭이 생긴다.
- `src/contracts/calibration.contract.ts:41` 의 `predictedScoreSnapshotSchema` 는 정확히 이 이유로
  `strictObject` 예외를 두고 그 근거를 주석에 적어 뒀다. 같은 논리가 `params` 에는 적용되지 않았다.

**내가 확인 못 한 것** — 실제 DB(공유 Supabase)에 옛 파라미터 형태로 저장된 run 이 몇 건 있는지는
읽지 않았다(쓰기 금지 지시에 맞춰 접속 자체를 안 했다).

---

## 🟡 [데이터 유실] 학교 평균만 다시 보내면 저장돼 있던 학교 표준편차가 조용히 지워진다

**무슨 일이 벌어지나** — 원장이 학교가 공개한 평균 62.5·표준편차 12 를 넣어 뒀다가, 나중에
평균만 63.1 로 고쳐 보낸다(표준편차는 그대로 두려고 안 보낸다). 표준편차가 **null 로 지워진다.**
경고도 없고 되돌릴 수도 없다.

**재현** — `src/__tests__/unit/_adv-school-stat-wipe.test.ts`

```
  정정 후 mean = 63.1  stdev = null
 × 평균만 고쳐 보내도 표준편차는 남는다
   AssertionError: expected null to be 12
 ✓ 점수만 고쳐 보내면 학교 통계는 건드리지 않는다
```

**원인** — `src/lib/predictor/actualScoreService.ts:242-251`.
진입 조건은 `schoolMean !== undefined || schoolStdev !== undefined` 로 **OR** 인데,
쓰는 값은 `actualSchoolMean: input.schoolMean ?? null` 과
`actualSchoolStdev: input.schoolStdev ?? null` 로 **둘 다** 쓴다.
한쪽만 보내면 안 보낸 쪽이 `undefined → null` 로 덮인다.
계약(`calibration.contract.ts:76-77`)이 두 필드를 각각 `.nullable().optional()` 로 두어
"안 보냄(유지)"과 "null 로 지움"을 구분할 수 있게 해 놨는데, 서비스가 그 구분을 버린다.

**내가 확인 못 한 것** — 현재 화면(`src/components/exam/examApi.ts:41-50` `saveActualScore`)은
학교 통계를 아예 안 보내므로 지금 이 경로를 타는 UI 는 없다. API 를 직접 쓰거나 화면이 붙는
순간 터진다. 그리고 이 세 컬럼을 읽는 코드는 아직 저장소에 없다(`grep` 확인) — 그래서 🔴 이
아니라 🟡 로 둔다.

---

## 🟡 [화면] 원장이 입력한 시행일이 어떤 화면에도 나오지 않는다 (D-day 가 영원히 안 뜬다)

**무슨 일이 벌어지나** — `POST /api/predictions` 로 `examDate` 를 보내면 DB 에 정상 저장되고
`GET /api/predictions/{id}` 도 정확히 돌려준다. 그런데 '오늘의 시험' 계기판은 항상 "일정 미정"
이다. `src/components/exam/RoundRow.tsx:52` 의 D-day 표시가 영원히 안 뜬다.

**재현** — `src/__tests__/unit/_adv-screen-run-visibility.test.ts`

```
 × 원장이 넣은 시행일이 화면에 나온다
   AssertionError: expected null to be '2026-04-28'
```

**원인** — `src/lib/exam/composeRounds.ts:168-169`

```ts
// 🔴 `PredictionRun.examDate` 컬럼이 아직 없다 — D-day 를 지어내지 않는다.
examDate: null,
```

컬럼은 있다. `prisma/schema.prisma` `PredictionRun.examDate DateTime? @db.Date`,
마이그레이션 `20260816160000_prediction_run_owner_and_interval`.
`src/lib/exam/loadRounds.ts:40-44` 의 "`PredictionRun` 에 `userId` 가 없어 SQL 로 좁히지 못한다"도
같은 낡은 전제다. 두 파일이 T7.7 병합 이전 시점에 멈춰 있다.

---

## 🟡 [화면] 같은 시험의 run 이 여러 개인데 계기판에서 구분할 방법이 없다

**무슨 일이 벌어지나** — run 은 갱신하지 않고 항상 새 행이다(의도된 설계). 원장이 재예측을
한 번 돌리면 같은 (학교, 대상 시점) 회차가 계기판에 **똑같은 모습으로 두 줄** 뜬다.
어느 쪽이 최신인지, 어느 쪽에 점수를 넣어야 잔차가 맞는지 화면으로는 알 수 없다.

**재현** — `src/__tests__/unit/_adv-screen-run-visibility.test.ts`
(엔진 버전과 생성 시각이 서로 다른 두 run)

```
  옛 run 이 화면에 그리는 값: {"series":{...가람중...},"period":{2026,1,"중간"},
     "examDate":null,"evidenceCount":1,"confidence":null,"stages":[...]}
  새 run 이 화면에 그리는 값: {"series":{...가람중...},"period":{2026,1,"중간"},
     "examDate":null,"evidenceCount":1,"confidence":null,"stages":[...]}
 × 같은 시험을 두 번 예측하면 계기판에서 두 회차를 구분할 수 있다
   AssertionError: expected '{...}' not to be '{...}'
```

두 문자열이 완전히 같다.

**원인** — `ExamRoundSummary`(`toRoundSummary`, `composeRounds.ts:143-174`)에 `createdAt` 도
`engineVersion` 도 담기지 않는다. `RoundRow.tsx:47-90` 이 그리는 것은 제목(시리즈+시점)·
파이프라인 점·신뢰도·근거 회차 수·D-day 뿐이고, D-day 는 위 항목 때문에 항상 비어 있다.
`engineVersion` 은 상세(`ExamRoundDetail`)에만 있어 한 번 들어가 봐야 안다.

`/api/predictions` 목록(`PredictionRunSummary`)에는 `createdAt`·`engineVersion` 이 둘 다 있다 —
화면이 쓰는 쪽 계약에만 없다.

---

## 🟡 [핀 경로] 학년·과목이 전혀 다른 시험지를 근거로 못 박아도 아무 검사 없이 통과한다

**무슨 일이 벌어지나** — 중3 예측에 같은 학교의 **중1 시험지**를 `inputExamIds` 로 지정하면
201 로 저장되고, 그 중1 시험지의 30문항 구성이 그대로 중3 청사진이 된다. 경고도 위험 표시도 없다.

**재현** — `src/__tests__/api/_adv-leakage-probe.test.ts` ⑤

```
  ⑤ status = 201
     저장된 evidence = {"history":1,"cohort":0,"rangeHistory":0,"rangeCohort":0,
                        "excludedByTrust":0,"pinned":true}
     청사진 문항수 = 30
 × ⑤ 핀 경로 — 학년·과목이 전혀 다른 시험지를 근거로 지정하면 거부되어야 한다
   AssertionError: expected 201 not to be 201
```

`history: 1` 로 잡혔다. 즉 "이 학교 중3의 과거 회차"로 취급됐다.

**원인** — `predictionRunService.ts:215-228` `splitEvidence` 는 **학교만** 비교한다
(`p.series.school === series.school`). 자동 경로는 SQL 이 `level`·`grade` 를 걸러 주지만
(`:243-247`), 핀 경로(`gatherPinnedEvidence`, `:290-320`)는 시리즈 일치를 전혀 확인하지 않는다.
누출 검사(시간)는 예외 없이 걸리지만, **어떤 시리즈의 자료인가**는 아무도 안 본다.

**내가 확인 못 한 것** — 이 경로는 화면에 노출되지 않고 "과거 run 재실행 비교" 용도라
(`predictionRun.contract.ts:124-133`) 조작자가 일부러 틀리게 쓸 때만 문제가 된다.
그래서 🟡 로 둔다.

---

# 결함이 아니었던 것 — 무엇을 어떻게 찔러 봤는지

## 시간 누출 (주장 1) — 4개 경로 전부 막혀 있다

`src/__tests__/api/_adv-leakage-probe.test.ts` ①~④ 통과.

| 경로 | 결과 |
|---|---|
| ① 학기 경계 (2025-2-기말 → 2026-1-중간) | 정상 근거로 잡힌다. 과잉 차단도 없다 |
| ② 컷오프==대상, 대상 회차 시험지가 DB 에 있음 | 근거에서 빠진다 |
| ③ 대상 회차 자체를 `inputExamIds` 로 핀 | 422, 행 0개 |
| ④ 다른 학교의 대상 시점 시험지(코호트) | 근거에서 빠진다 |

`periodSortKey`(`predictor.contract.ts:431`)가 `YYYY-S-R` 고정 폭 문자열이라 사전순 = 시간순이
성립한다(연도가 `min(2000).max(2100)` 으로 항상 4자리). 학기 경계에서 뒤집히지 않는다.
`rangeHistory`/`rangeCohort` 는 `history`/`cohort` 의 부분집합이라 전수 검사에 포함된다.

**돌연변이 검사** — 가드를 하나씩 지우고 테스트가 실제로 빨개지는지 확인했다.

| 지운 것 | 결과 |
|---|---|
| M1 `assertNoLeakage(used, cutoff, target)` 호출 제거 | 🔴 1건 실패 — 문다 |
| M2 `beforeCutoff` 를 `< 0` → `<= 0` (같은 시점 허용) | 🔴 1건 실패 — 문다 |
| M3 `assertCutoffNotAfterTarget` 제거 | 🔴 1건 실패 — 문다 |

## 스냅샷 불변성 (주장 2) — 성립한다

`predictedScore`·구간 스냅샷은 재저장해도 안 움직이고, `residual` 과 `intervalHit` 은
**둘 다 저장된 행**(`existing.predictedScore`, `existing.predictedLower/Upper`) 기준으로
다시 계산된다(`actualScoreService.ts:199-219`). 서로 어긋나는 자리를 못 찾았다.

**돌연변이 검사**

| 지운 것 | 결과 |
|---|---|
| M5 재저장 시 잔차를 run 의 현재 Json(`snapshot.expectedScore`)으로 계산 | 🔴 1건 실패 — 문다 |
| M6 재저장 시 적중을 run 의 현재 구간으로 판정 | 🔴 1건 실패 — 문다 |
| M7 구간 없는 표본을 적중률 분모에 다시 포함 | 🔴 2건 실패 — 문다 |

## 소유권 (주장 5) — 새는 경로를 못 찾았다

| 경로 | 근거 |
|---|---|
| `POST /api/predictions` | 세션의 `userId` 로만 쓴다 (`route.ts:39`) |
| `GET /api/predictions` (목록) | `where: { userId }` — DB 가 거른다. `total` 도 정확 |
| `GET /api/predictions/{id}` | `requireOwnedPredictionRun` → 없으면 404, 남의 것이면 403 |
| `POST /api/predictions/{id}/actual` | 회차 소유(`ownerUserId`) + 학생 소유(`requireOwnedStudent`) 이중 확인. 학생은 **전부** 먼저 확인한 뒤 저장 |
| `GET /api/predictions/{id}/actual` | 회차 소유 + `student: { class: { userId } }` 로 한 번 더 |
| `GET /api/exam/rounds`, `/{id}` | 남의 회차는 403 이 아니라 404 |

`loadRounds.ts:54` 가 `PredictionRun` 을 필터 없이 전량 읽는 것은 눈에 걸렸지만, 실제로 남의
회차가 보이려면 남의 run 에 내 학생 실측이 붙어 있어야 하고 그 경로가 위 이중 검사로 막혀 있다.
**재현 가능한 누출을 만들지 못했다.** (다만 `userId` 컬럼을 안 쓰는 것 자체가 위 🔴 1번의 원인이다.)

## 그 밖에 찔러 보고 문제가 아니었던 것

- `MIN_CALIBRATION_SAMPLES` 를 **딱 20** 으로 맞춘 경우 — 판단을 시작한다(경계 동작 정상,
  기존 테스트도 있음). 다만 20건이 한 학교에서 나오면 위 🔴 4번이 된다.
- `summarizeResiduals` 의 표본 0 처리, `intervalCount` 분모 제외 — 정상.
- `resolveNominalCoverage`(`calibration-report.ts:84-98`) — coverage 가 섞이면 null 을 돌려
  정직성 판정을 건너뛴다. 정상.
- `calibration-report.ts` 에 쓰기 없음 — `findMany` 하나뿐인 것을 확인했다.
- `applyCalibration` 의 0~100 클램프는 `predictWith`(홀드아웃 계산)에는 없다. 실제 점수가
  0~100 이라 클램프는 오차를 **줄이는** 쪽으로만 작동해, 보고 숫자가 낙관 쪽으로 틀어지지는 않는다.
- `computeResidual` 부호(`actual − predicted`)와 `direction` 매핑 — 일치한다.

---

# 미확인 의심 (재현 못 함 — 이유와 함께)

1. **`attachActualScores` 의 읽기-쓰기 경합.**
   `existingRows` 를 트랜잭션 **밖**에서 읽고(`actualScoreService.ts:179-184`) 갱신은 안에서 한다.
   같은 (run, 학생)에 두 요청이 겹치면 둘 다 `create` 로 가서 `@@unique([runId, studentId])`
   위반 → 500 이 날 수 있다. **재현하려면 실제 Postgres 에 동시 요청을 넣어야 하는데
   공유 DB 쓰기가 금지라 하지 않았다.** 인메모리 대역으로는 경합이 재현되지 않는다.

2. **실제 코퍼스로 계수를 뽑아 보기.**
   `PREDICTOR_CORPUS_DIR` 의 리포트는 문항 이관 산출물이고 `ActualExamScore` 자료가 아니다.
   실측 표본은 DB 에만 있고 현재 0건이다(위 🔴 1번 때문에 앞으로도 0건이다). 그래서
   보정기 검증은 전부 합성 자료로 했다. 실제 학교 효과 크기가 11 §2.3 의 1.8% 라면
   내 합성 자료(효과 0)와 거의 같은 상황이지만, **그건 확인이 아니라 추정이다.**

3. **`intervalHonest` 판정의 실전 동작.**
   구간을 만드는 엔진 코드가 아직 없어(`predictedScores` 가 빈 배열) coverage 가 실제로 어떤
   값으로 들어오는지 못 봤다. `predictedCoverage` 가 run 마다 다를 때
   `resolveNominalCoverage` 가 null 로 빠지는 것까지만 확인했다.

4. **실물 화면 검수.**
   화면 관련 지적(시행일, 중복 회차, 회차 비가시)은 순수 함수 단위로만 재현했다.
   브라우저에서 실제로 어떻게 보이는지는 확인하지 않았다.

---

# 남긴 파일

`npm run test:adv` (설정: `vitest.adversarial.mts`) — **미해결 결함의 재현물. 일부러 빨갛다.**

```
qa/adversarial/_adv-version-and-wipe.test.ts       🔴5 engineVersion
qa/adversarial/_adv-fixture-degenerate.test.ts     🔴3 τ̂²=0 보호막
qa/adversarial/_adv-leakage-probe.test.ts          주장1 검증(통과) + 🟡 핀 경로
qa/adversarial/_adv-screen-run-visibility.test.ts  🟡 시행일 + 🟡 중복 회차
qa/adversarial/_adv-school-stat-wipe.test.ts       🟡 표준편차 유실
qa/adversarial/_adv-params-drift.test.ts           🟡 과거 run 상세 500
scripts/qa/_adv-calibration-probe.ts               🔴3 🔴4 숫자
scripts/qa/_adv-calibration-sweep.ts               🔴2 씨앗 200개 쓸기
scripts/qa/_adv-holdout-check.ts                   🔴2 신규 표본 검증
```

현재 `npm run test:adv` = **10 failed | 7 passed**. 통과하는 7건은 시간 누출 4경로 검증과
🔴1 을 고쳐서 초록이 된 항목들이다.

🔴1 을 고치며 `_adv-loop-closure.test.ts` 는 지우고 회귀 가드
`src/__tests__/api/calibrationLoop.test.ts` 로 대체했다.
`scripts/qa/_*` 는 `.gitignore:60` 에 걸려 추적되지 않는다.
