# 적대적 리뷰 ③ — '오늘의 시험' 화면 · 조회 API · 실점수 입력

- 대상: `src/components/exam/**` · `src/app/api/exam/rounds/**` · `src/lib/exam/{loadRounds,composeRounds}.ts` · `src/components/chrome/AppChrome.tsx`
- 기준 커밋: `2e3cf615` (worktree `adv3-화면입력`, 작업 트리 깨끗)
- **제품 코드는 한 줄도 고치지 않았다.** 재현물은 전부 `_adv-` 접두 파일이다.
  - `src/__tests__/api/_adv-examRounds.test.ts`
  - `src/__tests__/components/_adv-actualScoreCell.test.tsx`
  - `src/__tests__/components/_adv-numberInputProbe.test.tsx`
  - `src/__tests__/unit/_adv-evidenceCount.test.ts`
  - `src/__tests__/unit/_adv-viewRender.test.tsx`
- 돌연변이 검사를 위해 제품 파일을 임시로 바꾼 구간이 있으나 `git checkout --` 로 즉시
  되돌렸고, 매 회 `git status --porcelain` 로 추적 파일 변경 0을 확인했다. 커밋은 없다.
- 공유 DB 는 붙지 않았다(쓰기 금지 지시에 따라 읽기조차 시도하지 않음). 전부 인메모리
  테스트 더블 + 실 Route Handler 직접 호출이다.

한 줄 요약: **숫자가 새는 경로가 있고(🔴 B), 그 위에 화면 전체가 실데이터에서는 아예
켜지지 않는다(🔴 A).**

---

# 조치 현황 (2026-08-16, 원장님 지시 "A와 C부터 고쳐라")

| 소견 | 상태 | 비고 |
|---|---|---|
| 🔴 A 계기판이 영구히 빈다 | **고침** | 소유권을 `PredictionRun.userId` 로. 아래 §A-fix |
| 🔴 A 실점수 저장 422 | **미해결(선행 조건 부족)** | 엔진이 학생별 예측을 못 낸다. 아래 §A-남은것 |
| 🔴 C 시행일 유실 · 정렬 무효 | **고침** | `exam_date` 를 그대로 싣는다. 아래 §C-fix |
| 🔴 B 근거 수 오염 | 미해결 | 지시 대기 |
| 🟡 D 소유권 우회 | **A 고치며 함께 닫힘** | 아래 §A-fix |
| 🟡 E·F·G·H · 🟢 I~L | 미해결 | 지시 대기 |

## §A-fix — 소유권을 회차의 주인으로 되돌렸다

**바꾼 것**
- `src/lib/exam/loadRounds.ts` — `db.predictionRun.findMany({ where: { userId } })`.
  전량 읽어 앱에서 거르던 것이 사라졌다(`@@index([userId, createdAt desc])` 가 쓰인다).
- `src/lib/exam/composeRounds.ts` — `isRunVisibleTo(run, actuals, ownedStudentIds)` 를
  **`isRunOwnedBy(run, userId)`** 로 교체. 이름을 바꿔서 모든 호출부와 테스트가 컴파일
  단계에서 드러나게 했다(같은 이름으로 뜻만 바꾸면 조용히 어긋난다).
  `PredictionRunRow` 에 `userId`·`examDate` 를 추가했다.
- 학생 목록은 그대로 읽는다 — **이름을 붙이고, 남의 학생 이름을 막는** 데 쓴다.
  다만 학생이 0명이어도 회차는 보인다. 시험지 단위 청사진은 학생 없이도 유효하다.

**함께 닫힌 것(소견 D)** — 남의 회차에 내 학생이 섞여 있어도 이제 안 보인다.
소유자 한 값만 보므로 전보다 **더 좁다**.

**함께 드러난 것 — 빈 학생 표가 거짓말을 하고 있었다.**
회차가 보이게 되자 `students: []` 상태가 처음으로 화면에 닿았는데, 표는
"이 회차에 배정된 학생이 없습니다" 라고 적고 있었다. 학생이 멀쩡히 등록된 반에서도
그렇게 나온다 — 원인은 반이 아니라 엔진인데 원장님을 반 편성 쪽으로 보낸다.
그래서 사유를 가를 값 하나를 계약에 추가했다:
- `examScreen.contract.ts` — `predictedStudentCount: z.int().min(0)`
- `StudentScoreTable.tsx` — 0 이면 "학생별 예상 점수는 아직 내지 않습니다. 회차 단위
  청사진만 있습니다.", 0 이 아닌데 표가 비면 "이 회차의 예측 대상 중 내 학생이 없습니다".

## §C-fix — 시행일을 그대로 싣는다

- `composeRounds.ts` — `examDate: toIsoDate(run.examDate)`. `@db.Date` → `YYYY-MM-DD`.
  NULL 이면 여전히 null 이다(대상 시점에서 날짜를 지어내지 않는다).
- 결과: 계기판·상세의 D-day 가 살아나고 `sortRounds` 가 실제로 정렬한다
  (임박한 회차가 위로).

## §A/C 공통 — 두 버그를 숨긴 **픽스처**를 먼저 고쳤다

버그보다 이쪽이 근본이다. 두 열을 무시하는 코드가 있는데도 테스트가 전부 초록이었던
이유는 픽스처에 그 열이 **없었기** 때문이다.

- `src/mocks/prismaTestDouble.ts` — `PredictionRunRow` 에 `userId`·`examDate`·`riskFlags`
  추가. 이제 픽스처가 그 열을 반드시 채워야 한다.
- `src/__tests__/api/examRounds.test.ts` — `SeedRun` 타입도 같은 열로. 두 파일 모두
  "열을 빼지 말 것, 뺀 열의 버그는 검출할 방법이 없다"는 주석을 달았다.

## §A/C 돌연변이 검사 — 새 테스트가 실제로 무는지 확인했다

내가 지적한 것과 같은 실수를 반복하지 않기 위해, 고친 자리를 하나씩 되돌려 놓고
테스트가 빨개지는지 봤다(전부 `git checkout --` 로 원복).

```
───── 돌연변이: examDate 를 다시 null 로 ─────
     × 🔴 exam_date 가 있으면 YYYY-MM-DD 로 낸다
     × 🔴 시행일이 있으면 그대로 낸다 — 없는 척하면 D-day 와 정렬이 죽는다
      Tests  2 failed | 36 passed (38)

───── 돌연변이: isRunOwnedBy 를 fail-open 으로 ─────
     × 남의 회차면 안 보인다
     × 🔴 남의 회차에 내 학생이 들어 있어도 내 회차가 아니다
     × 세션 id 가 빈 문자열이면 아무것도 안 보인다
      Tests  3 failed | 35 passed (38)

───── 돌연변이: SQL where + 안전망 둘 다 제거 ─────
     × 남의 회차면 안 보인다
     × 🔴 남의 회차에 내 학생이 들어 있어도 내 회차가 아니다
     × 세션 id 가 빈 문자열이면 아무것도 안 보인다
     × 내 회차만 낸다 — 남의 회차는 목록에서 빠진다
     × 🔴 남의 회차에 내 학생이 섞여 있어도 그 회차는 내 것이 아니다
     × 🔴 남의 회차는 403 이 아니라 404 — 존재 여부를 알리지 않는다
      Tests  6 failed | 32 passed (38)

───── 돌연변이: predictedStudentCount 를 항상 0 으로 ─────
     × 🔴 학생 표가 빈 이유 둘을 구분할 수 있게 예측 인원 수를 낸다
     × 🔴 예측 대상이 전부 남의 학생이어도 내 회차면 보인다 — 학생 행만 빈다
      Tests  2 failed | 36 passed (38)

───── 돌연변이: 빈 표 사유 문구 변경 ─────
     × 🔴 학생별 예측이 0명이면 반 탓으로 돌리지 않고 엔진 쪽 사유를 적는다
      Tests  1 failed | 20 passed (21)
```

SQL 필터와 조합 계층 안전망은 **둘 중 하나만** 지워도 나머지가 막는다(의도한 이중 방어).
그래서 세 번째 검사는 둘을 함께 지웠다.

## §A-남은것 — 실점수 저장 422 는 고치지 않았다. 이유를 적는다

회차는 보이게 됐지만 `POST /api/predictions/{id}/actual` 은 여전히 422 다.
**원인이 조회가 아니라 엔진과 스키마에 있어서, 내 판단으로 손대지 않았다.**

1. `runPrediction()` 이 `predictedScores: []` 를 저장한다. 학생 개인 예상 점수는
   능력 추정(11 §3 L3)과 난이도→점수 환산 계수(§2.7-3, T7.11)가 있어야 낼 수 있다.
   **없는 예측을 지어내는 것이 이 저장소에서 가장 하면 안 되는 일**이라 채우지 않았다.
2. `ActualExamScore` 는 `predicted_score`·`residual`·`interval_hit` 이 전부 NOT NULL 이다.
   예측이 없으면 저장할 값이 없다. 넣으려면 **공유 DB 마이그레이션**으로 이 셋을
   nullable 로 풀고 `summarizeResiduals` 의 분모 규칙을 함께 고쳐야 한다
   (구간 스냅샷이 이미 그 방식이다 — `hasInterval` 이 false 면 분모에서 뺀다).
   그건 T7.10/T7.11 보정 트랙의 계약 변경이고 공유 DB 를 건드리므로 원장님 확정이 필요하다.

**지금 화면은 그 422 요청을 만들지 않는다.** 학생 행이 아예 없으므로 「실점수 입력」
버튼도 없고, 표는 이유를 적는다. 즉 원장님이 마주하는 것은 "눌렀는데 거절당함"이 아니라
"아직 학생별 예측이 없다"는 사실이다 — 정직한 상태이되, **보정 루프는 여전히 못 돈다.**

선택지는 둘이다. 어느 쪽으로 갈지 정해 주시면 그대로 하겠다.
- (가) T7.11(환산 계수)을 먼저 세워 `predictedScores` 를 실제로 채운다. 정공법이고,
  채워지는 순간 실점수 입력구가 그대로 열린다.
- (나) 예측 없이도 실점수를 받도록 스키마를 푼다(위 3열 nullable + 분모 규칙).
  실측을 먼저 모아 둘 수 있다는 이점이 있지만, 계약과 공유 DB 를 건드린다.

재현물 `src/__tests__/api/_adv-examRounds.test.ts` 의 `[ADV-2 · 미해결]` 이 이 422 를
계속 찍고 있다 — 열리면 그 테스트가 빨개져서 알려 준다.

## 검증

```
$ npm run type-check     # 0 (stale Prisma Client 를 npx prisma generate 로 갱신한 뒤)
$ npm run lint           # 0 errors (기존 경고 1건은 lint-staged.config.mjs)
$ npm run lint:affordance# 통과
$ npx vitest run         # 69 files / 926 tests 전부 통과
```

⚠️ 이 워크트리의 `node_modules/.prisma` 가 낡아 있어(생성물에 `PredictionRun` 이 없었다)
`npx prisma generate` 를 한 번 돌렸다. `node_modules` 만 바뀌고 저장소 파일은 그대로다.
그전에는 `db.*` 가 전부 `any` 로 잡혀 타입 검사가 이 종류의 버그를 못 봤다.

---

# 이하 원본 리뷰 (2026-08-16 최초 보고)

---

## 🔴 A [조회 API · 실점수 입력] 실 엔진이 만든 회차는 계기판에 한 건도 뜨지 않고, 실점수는 언제나 422 로 거절된다

**무슨 일이 벌어지나** — 원장님이 `POST /api/predictions` 로 예측을 돌린다. 회차는 DB 에
정상 저장된다. 그런데 `/exam` 을 열면 "아직 회차가 없습니다. 예측을 실행하면 여기에
쌓입니다." 만 나온다. 예측을 몇 번을 돌려도 같다. 회차 URL 을 직접 쳐도 404 다.
설령 회차가 보인다 해도 「실점수 입력」은 **모든 학생에서** "이 회차의 예측 대상이 아닌
학생이 있습니다." 로 거절된다. T7.15 가 만든 "보정 루프의 유일한 입력구"는 오늘 기준
한 건도 통과시키지 못한다.

닫힌 고리다:

1. `runPrediction()` 은 **예외 없이** `predictedScores: []` 를 저장한다
   — `src/lib/predictor/predictionRunService.ts:466`
   (주석: "학생 개인 예상 점수는 아직 낼 수 없다 … 빈 배열을 저장하고 `학생응답_부족` 을 남긴다").
   `predictedScores` 에 쓰는 코드는 저장소 전체에서 이 한 줄뿐이다.
2. 회차 가시성은 `isRunVisibleTo()` 가 **그 Json 안의 학생**으로만 판정한다
   — `src/lib/exam/composeRounds.ts:103`. 빈 배열이면 첫 조건은 항상 false.
3. 두 번째 조건은 "그 회차에 내 학생의 실측이 있는가" 인데, 실측은
   `attachActualScores()` 가 `index.byStudent`(= 같은 빈 Json) 에 없는 학생을 전부
   거절하므로 **애초에 한 행도 생길 수 없다** — `src/lib/predictor/actualScoreService.ts:172`.

즉 회차를 보려면 실측이 있어야 하고, 실측을 넣으려면 회차의 예측 목록에 학생이 있어야
하는데, 엔진은 그 목록을 절대 채우지 않는다.

**재현**

```
$ npx vitest run src/__tests__/api/_adv-examRounds.test.ts --reporter=verbose --silent=false

[ADV-1] 목록 응답 = []
[ADV-1] 상세 status = 404
[ADV-2] 422 {"error":{"code":"VALIDATION_ERROR","message":"이 회차의 예측 대상이 아닌 학생이 있습니다.",
  "details":[{"field":"scores.studentId","message":"30000000-0000-4000-8000-000000000001 — 이 회차의 예측 대상이 아닙니다."}]}}

 ✓ predictedScores: [] 인 내 회차 — 목록이 빈 배열이다
 ✓ 같은 회차의 상세도 404 — 내가 만든 회차인데 없다고 한다
 ✓ predictedScores: [] 이면 어떤 학생도 '예측 대상'이 아니다
 Tests  6 passed (6)
```

시드한 행은 `db.predictionRun.create({data})`(predictionRunService.ts:502) 가 실제로 쓰는
모양 그대로다 — `userId` · `examDate` · `riskFlags` 포함, `predictedScores: []`.
세션은 그 `userId` 의 원장이다.

**원인**
- `src/lib/predictor/predictionRunService.ts:466` — `predictedScores` 가 항상 `[]`.
- `src/lib/exam/composeRounds.ts:103` — 가시성이 그 빈 Json 에 걸려 있다.
- `src/lib/predictor/actualScoreService.ts:172` — 실측 자격도 같은 빈 Json 에 걸려 있다.

**왜 기존 테스트가 못 잡았나** — `src/__tests__/api/examRounds.test.ts` 의 픽스처
`runRow(id, predictedScores)` 는 **모든 호출에서** `scorePrediction(...)` 을 최소 한 개
넣는다. 엔진이 실제로 만드는 `[]` 회차는 한 번도 테스트되지 않았다. 저장소가 이미 낸
사고("합성 픽스처가 이관 결함을 통과시켰다")와 같은 종류다.

**내가 확인 못 한 것** — 공유 DB 의 실제 `prediction_run` / `actual_exam_score` 행 수는
읽지 않았다(쓰기 금지 지시에 따라 접속 자체를 안 함). 만약 다른 경로(시드 스크립트 등)로
`predicted_scores` 가 채워진 행이 이미 있다면 그 회차만은 보일 것이다. 그러나 제품 코드에
`predictedScores` 를 쓰는 자리는 위 한 줄뿐이다.

---

## 🔴 B ['근거 부족' 가드] 「근거 5회차」의 4회차가 남의 학교 시험지다 — 우리 학교 과거 1편으로도 예측 숫자가 나간다

**무슨 일이 벌어지나** — 회차 상세 예측 기둥에 `근거 5회차 · 신뢰도 보통 0.51` 이 적히고
`24문항 / 100점`, `객18 단2 서4`, `하9 중11 상4` 가 그대로 나간다. 원장님은 이것을
"우리 학교 기출 5개를 본 결과"로 읽는다. 실제로 본 우리 학교 기출은 **1편**이고 나머지
4편은 A중·B중·C중·D중 것이다.

`viewModel.roundJudgement` 가 `MIN_EVIDENCE_ROUNDS = 2` 를 세운 근거는 그 자리에 적혀 있다:

> `evidenceCount === 0` 은 계약 주석대로 "전국 평균만으로 만든 것"이다.
> **1편은 학교 패턴이라고 부를 수 없다.**

둘 다 **그 학교 과거 편수**에 대한 말이고, 엔진도 그렇게 센다
(`predictBlueprint.ts:435` — `evidenceCount: history.length`).
그런데 화면이 보는 값은 다른 수다:

- `composeRounds.ts:171` — `evidenceCount: run.inputExamIds.length`
- `predictionRunService.ts:425` — `const used = [...evidence.history, ...evidence.cohort]`
- `predictionRunService.ts:499` — `const inputExamIds = used.map((p) => p.externalExamId)`
- `predictionRunService.ts:221` — `const cohort = papers.filter((p) => p.series.school !== series.school)` ← **다른 학교**

그리고 `examScreen.contract.ts:66` 은 이렇게 적혀 있다:
`/** 근거로 쓴 과거 회차 수(blueprint.evidenceCount 와 같은 값). */` — 같은 값이 아니다.

**재현** — 실 엔진(`predictBlueprint`)을 그대로 호출하고, `runPrediction` 이 저장할
`inputExamIds` 를 그대로 만들어 `toRoundSummary` → `roundJudgement` 에 먹인다.

```
$ npx vitest run src/__tests__/unit/_adv-evidenceCount.test.ts --reporter=verbose --silent=false

[ADV-11] 엔진이 낸 값 — evidenceCount = 1 · confidence = 0.511
[ADV-11] 화면이 보는 값 — evidenceCount = 5 · 판정 = {"available":true,"reason":null}
[ADV-11] 청사진 패널 근거 줄 = 근거 5회차 · 신뢰도 보통 0.51
[ADV-11b] blueprint.evidenceCount = 1 · summary.evidenceCount = 2

 ✓ 우리 학교 과거 1편 + 남의 학교 4편 → 화면은 '근거 5회차' 라고 적고 숫자를 낸다
 ✓ 계약 주석은 '(blueprint.evidenceCount 와 같은 값)' 이라고 적혀 있다 — 실제로는 다르다
 Tests  2 passed (2)
```

입력은 "작년 같은 회차 우리 학교 1편 + 같은 시점 다른 학교 4편" 이다. 학원이 새 학교를
맡은 첫 해에 그대로 나오는 배치이고, `DEFAULT_PARAMS`(`sameRoundBoost: 4`, `priorWeight: 2`)
에서 신뢰도 0.511 은 `CONFIDENCE_MID(0.4)` 를 넘어 **보통(옐로)** 으로 통과한다.
즉 근거 문턱과 신뢰도 문턱 둘 다 이 경우를 막지 못한다.

**원인** — `src/lib/exam/composeRounds.ts:171`. 계약이 요구하는 값
(`blueprint.evidenceCount`)이 바로 옆 `parseBlueprint(run.predictedBlueprint)` 에 있는데도
`run.inputExamIds.length` 를 쓴다. 같은 혼동이 `predictionRunService.ts:687`
(`/api/predictions` 목록 응답) 에도 있다.

**내가 확인 못 한 것** — 코호트가 0편인 시리즈에서도 같은 일이 나는지는 확인하지 않았다
(코호트 0편이면 두 값이 같아진다). 그리고 `confidence` 문턱 0.4 자체가 적절한지는 판단
대상이 아니라 보았다 — 여기서 깨진 것은 **문턱이 아니라 문턱에 들어가는 수**다.

---

## 🔴 C [계기판] 시행일 컬럼이 이미 있는데 화면은 언제나 "일정 미정" 이고, 그걸 지키는 테스트는 아무것도 검사하지 않는다

**무슨 일이 벌어지나** — 원장님이 회차를 만들 때 시행일을 넣는다
(`POST /api/predictions` 의 `examDate`, `predictionRun.contract.ts:140` — 주석에 대놓고
"화면이 D-day 를 세는 기준"이라고 적혀 있다). DB 에도 들어간다. 그런데 계기판과 상세는
전부 **"일정 미정"** 이라고 적는다. 원장님이 직접 입력한 날짜를 화면이 "모른다"고 말한다.

부수 효과가 더 크다. `sortRounds` 는 "다가오는 회차를 가까운 순으로 먼저" 세우는 함수인데
모든 `examDate` 가 null 이라 **정렬이 통째로 무효**다. 회차는 `createdAt desc` 순으로만
쌓이므로, 3일 남은 시험이 60일 남은 시험 아래에 앉는다. "다음에 무엇을 준비하는가"를
보는 자리라는 이 화면의 존재 이유가 사라진다.

**재현**

```
$ npx vitest run src/__tests__/api/_adv-examRounds.test.ts -t "ADV-3" --reporter=verbose --silent=false
[ADV-3] examDate = null            ← exam_date = 2026-08-29 인 행을 시드했는데도 null

$ npx vitest run src/__tests__/unit/_adv-viewRender.test.tsx --reporter=verbose --silent=false
[ADV-14] 정렬 결과 = a,b,c          ← sortRounds 가 입력 순서를 그대로 돌려준다
```

**원인** — `src/lib/exam/composeRounds.ts:168-169`

```ts
// 🔴 `PredictionRun.examDate` 컬럼이 아직 없다 — D-day 를 지어내지 않는다.
examDate: null,
```

주석이 사실이 아니다. `prisma/migrations/20260816160000_prediction_run_owner_and_interval/migration.sql:22`
가 `exam_date DATE` 를 추가했고(커밋 `43cabe5d`, 08-16 10:10), `composeRounds.ts` 는
**90분 뒤**(커밋 `5782a95a`, 11:40) 에 병합되면서도 "컬럼이 아직 없다(2026-08-16 확인)"
라고 적고 있다. 같은 파일 93행의 `PredictionRun.userId` 주석도 같은 이유로 낡았다(→ 소견 D).

**🔴 돌연변이 검사 — 이 자리를 지키는 테스트는 없는 것과 같다.**
`composeRounds.ts` 를 "exam_date 를 읽도록" 고쳐 놓고 기존 테스트를 돌렸다:

```
[돌연변이] examDate: (run as {examDate?: Date|null}).examDate?.toISOString().slice(0,10) ?? null

$ npx vitest run src/__tests__/api/examRounds.test.ts src/__tests__/unit/examCompose.test.ts \
    src/__tests__/unit/examLoad.test.ts src/__tests__/components/TodaysExam.test.tsx
 Test Files  4 passed (4)
      Tests  55 passed (55)          ← 하나도 빨개지지 않는다
```

`src/__tests__/api/examRounds.test.ts:185` 의
`it("🔴 examDate 컬럼이 없으므로 시행일을 지어내지 않는다")` 는 **양쪽 다 통과한다.**
픽스처 `SeedRun` 에 `examDate` 필드 자체가 없어 `run.examDate` 가 `undefined` 이기 때문이다.
"컬럼을 안 읽는다"와 "컬럼을 제대로 읽는다"를 구분하지 못하므로 이 테스트는 아무것도
잠그지 않는다. 실제 컬럼 모양으로 시드한 내 테스트는 같은 돌연변이에서 정확히 빨개졌다:

```
$ npx vitest run src/__tests__/api/_adv-examRounds.test.ts -t "ADV-3"   # 돌연변이 상태
+ Received: "2026-08-29"
 ❯ src/__tests__/api/_adv-examRounds.test.ts:203:36
 Tests  1 failed | 5 skipped (6)
```

(검사 후 `git checkout -- src/lib/exam/composeRounds.ts` 로 원복, `git status` 로 확인.)

**내가 확인 못 한 것** — 실제로 `examDate` 를 채워 예측을 돌리는 화면·스크립트가 오늘
존재하는지는 확인하지 않았다. API 계약과 서비스 경로는 열려 있다.

---

## 🟡 D [소유권] 회차 소유자 컬럼(`user_id`)을 무시하고 학생 도달성으로 되짚는다 — 남의 회차가 내 계기판에 뜬다

**무슨 일이 벌어지나** — `loadVisibleRuns` 는 `PredictionRun` 을 **전량** 읽어
(`loadRounds.ts:54`, `where` 없음) 앱 메모리에서 `isRunVisibleTo` 로 거른다. 그 판정은
`run.userId` 를 **한 번도 보지 않고**, "이 회차의 예측 Json 이나 실측에 내 학생이 하나라도
있는가" 만 본다. 그래서 다른 원장이 만든 회차라도 내 학생 id 가 그 Json 에 있으면 내
목록에 뜨고, 상세로 들어가면 그 원장의 **청사진·신뢰도·엔진 버전·근거 회차 수**가 그대로
보인다.

**재현**

```
$ npx vitest run src/__tests__/api/_adv-examRounds.test.ts -t "ADV-4" --reporter=verbose --silent=false
[ADV-4] 남의 회차가 내 목록에: [{"id":"70000000-...-b1","confidence":0.62}]
 ✓ 남의 회차라도 내 학생이 그 안에 있으면 내 계기판에 뜬다
```

(`userId: OTHER_USER_ID` 인 회차를 시드하고 TEACHER 세션으로 조회. 상세도 200 이고
`engineVersion`·`predictedBlueprint` 가 그대로 나온다.)

**원인** — `src/lib/exam/composeRounds.ts:92-103` 의 주석 "🔴 `PredictionRun` 에 `userId`
컬럼이 아직 없다(2026-08-16 확인)" 가 사실이 아니다. `migration.sql:24` 이 `user_id UUID
NOT NULL` + FK 를 넣었고 `runPrediction` 이 채운다. 이 우회 경로는 성능 메모까지 남기며
"컬럼이 생기면 `where: { userId }` 로 바꿔야 한다"고 적어 뒀는데, 컬럼은 이미 생긴 뒤였다.

**내가 확인 못 한 것 (중요)** — 프로덕션에서 **남의 회차 Json 에 내 학생 id 가 들어가는
경로**는 재현하지 못했다. `Student → Class → user` 이므로 학생 id 는 원장 한 명에게만
속하고, `runPrediction` 은 현재 학생을 아예 담지 않는다(소견 A). 그래서 오늘 이것은
"열려 있는 문"이지 "새고 있는 구멍"이라고는 말하지 못한다. 다만 소견 A 를 고쳐
`predictedScores` 를 채우기 시작하는 순간 이 판정 기준이 유일한 경계가 된다는 점,
그리고 **반대 방향(내 회차가 안 보임)** 은 이미 소견 A 로 확정 재현됐다는 점을 적어 둔다.

---

## 🟡 E [진행률] 실점수 분모가 내 학생이 아닌 사람까지 센다 — 다 넣어도 끝나지 않고, 남의 학생 수가 새어 나온다

**무슨 일이 벌어지나** — 학생이 반을 옮겼거나 삭제되면 그 학생은 `ownedStudents` 에서
빠져 표에서 사라지지만, 회차 Json 의 `predictedScores` 에는 그대로 남는다. 진행률 분자는
**내 학생의 실측만**(`loadRounds.ts:57` 이 소유 학생으로 좁혀 조회) 세는데, 분모는
**Json 의 전원**을 센다. 그래서 화면에 보이는 학생을 전부 입력해도 `실점수 2/3` 에서
멈추고 `done` 이 되지 않는다. 원장님은 찾을 수 없는 1명을 찾아 헤맨다. 그 "3" 자체가
지금 내 학생이 아닌 사람의 머릿수다.

**재현**

```
$ npx vitest run src/__tests__/api/_adv-examRounds.test.ts -t "ADV-5" --reporter=verbose --silent=false
[ADV-5] actual stage = {"key":"actual","done":false,"progress":{"current":2,"total":3}}
[ADV-5] 표에 실린 학생 = [ '김하윤', '이서준' ]
 ✓ 내 학생 2명을 다 넣어도 '실점수 2/3' 에서 멈춘다
```

**원인**
- `src/lib/exam/composeRounds.ts:170` — `buildStages(blueprint, studentIds.length, actualCount)`
  에서 `studentIds` 는 `runStudentIds(run)`(Json 전원), `actualCount` 는 소유 학생 실측만.
- `src/lib/exam/composeRounds.ts:127` — `done: predictedStudentCount > 0 && actualCount >= predictedStudentCount`.

**내가 확인 못 한 것** — 오늘은 소견 F 때문에 이 진행률 숫자가 **화면에 그려지지 않는다**
(항상 "실점수 대기"). 그래서 지금 당장 원장님 눈에 닿는 손해는 `done` 판정뿐이다.
소견 F 를 고치는 순간 이 분모가 그대로 노출된다.

---

## 🟡 F [4단계 띠] '지금 할 일' 파란 점이 영원히 「문제지 만들기」를 가리킨다 — 없는 기능이다

**무슨 일이 벌어지나** — `buildStages` 는 `paper` 와 `grading` 을 **항상** `done: false` 로
둔다(데이터 원천이 없어서다 — 정직한 선택이다). 그런데 `stageViews` 는 "첫 번째 미완
단계"를 '지금 할 일'(파랑 + 굵게)로 칠한다. 미완 중 첫 번째는 늘 `paper` 다. 결과적으로
모든 회차가, 청사진을 냈든 실점수를 다 넣었든, **"문제지 만들기"** 를 파랗게 가리킨다.
그런 화면도 버튼도 없다. 그리고 `실점수` 는 절대 '지금 할 일'이 되지 못하므로
`composeRounds` 가 계산한 `2/3` 진행률은 **어디에도 그려지지 않는다**.

**재현**

```
$ npx vitest run src/__tests__/unit/_adv-viewRender.test.tsx --reporter=verbose --silent=false
[ADV-12] 원자료 = [{"key":"blueprint","done":true,...},{"key":"paper","done":false,...},
                   {"key":"grading","done":false,...},{"key":"actual","done":false,"progress":{"current":2,"total":3}}]
[ADV-12] 화면 표기 = done:청사진 | current:문제지 만들기 | waiting:채점 대기 | waiting:실점수 대기
 ✓ 문제지·채점이 영원히 미완이라 파란 점은 언제나 '문제지 만들기' 다
```

**원인** — `src/components/exam/viewModel.ts:237`
`const currentIndex = available ? stages.findIndex((s) => !s.done) : -1;`
`composeRounds.ts:120-121` 이 `paper`/`grading` 을 상수 false 로 두는 한 이 findIndex 는
1 을 벗어나지 못한다. D-30 이 막는 "눌러도 아무 일 없는 컨트롤"은 아니지만(점은 컨트롤이
아니다) **없는 일을 지금 할 일이라고 지시하는** 같은 종류의 거짓말이다.

**내가 확인 못 한 것** — 확정 시안(05 §8.7 / Hi-fi)이 이 상태에서 어느 점을 파랗게
칠하기로 했는지는 문서에서 찾지 못했다. "파란 점을 아예 찍지 않는다"가 맞는 답인지는
원장님 확정 사항이다.

---

## 🟡 G [실점수 입력] 브라우저가 못 읽는 입력은 Enter 를 쳐도 저장도 오류도 없이 조용히 아무 일이 안 일어난다

**무슨 일이 벌어지나** — 전각숫자(`９１`), `--5`, `abc`, 공백 섞인 값 등을 치면
`<input type="number">` 의 값 정규화(HTML 표준 value sanitization algorithm) 때문에
`event.target.value` 가 **빈 문자열**이 된다. 화면의 입력칸에는 원장님이 친 글자가 그대로
남아 있는데, Enter 를 치면 `commit()` 의 첫 줄이 그냥 `return` 한다. 요청도 없고,
`role="alert"` 도 안 뜨고, 편집칸이 닫히지도 않는다. 원장님 입장에서 Enter 키가 고장난
것처럼 보이고, 몇 번 더 쳐 보다 Esc 로 나가면 점수는 안 들어간 것이다.

**재현**

```
$ npx vitest run src/__tests__/components/_adv-actualScoreCell.test.tsx --reporter=verbose --silent=false
[ADV-6] onChange 후 input.value = ""
[ADV-6] 요청 수 = 0
[ADV-6] alert = (없음)
[ADV-6] 행 문구 = "이서준8880~93Enter 저장 · Esc 취소—"
[ADV-6b] 요청 수 = 0 · value = ""
 ✓ 전각숫자 '９１' 를 넣고 Enter — 요청도 없고 오류 문구도 없다
 ✓ '--5' 도 마찬가지 — 조용히 무반응

$ npx vitest run src/__tests__/components/_adv-numberInputProbe.test.tsx --reporter=verbose --silent=false
[ADV-PROBE] 입력 "--5" → onChange value=""
[ADV-PROBE] 입력 "９１" → onChange value=""
[ADV-PROBE] 입력 "8,5" → onChange value=""
[ADV-PROBE] 입력 "1-2" → onChange value=""
[ADV-PROBE] 입력 "9 1" → onChange value=""
[ADV-PROBE] 입력 "abc" → onChange value=""
```

**원인** — `src/components/exam/ActualScoreCell.tsx:66`

```ts
// 빈 값은 "0점"이 아니다 — 아직 안 들어온 것이다. 보내지 않는다.
if (trimmed === "") return;
```

이 판단 자체는 옳다. 문제는 `type="number"` 에서 `""` 가 **두 가지 전혀 다른 상태**를
뜻한다는 것이다 — "아직 아무것도 안 침"과 "쳤는데 브라우저가 못 읽음". 코드는 둘을
구분하지 않고 둘 다 무반응으로 처리한다. 구분 수단은 `input.validity.badInput` 인데
쓰이지 않는다.

**곁가지 — 더 나쁠 수 있는 쪽**: 사람이 한 글자씩 치는 경로에서는
`8,5` → **`85`**, `9 1` → **`91`** 로 **저장된다**(8.5 를 치려던 것이 85 가 된다):

```
[ADV-6c] 보낸 본문 = {"scores":[{"studentId":"...0001","actualScore":85}]}
```

**내가 확인 못 한 것** — 위 곁가지는 jsdom + `@testing-library/user-event` 의 타이핑
시뮬레이션 결과다. 실제 Chrome/Firefox 가 숫자 입력에서 `,` 를 무시하는지 badInput 으로
두는지는 브라우저·로케일마다 달라서 확인하지 못했다. 다만 **어느 쪽이든 조용하다** —
85 로 저장되거나(틀린 값), 아무 일도 안 일어나거나(값 없음). `""` 무반응 경로는 HTML
표준이 강제하는 동작이라 브라우저 무관하게 성립한다.

---

## 🟡 H [미응시] 응시 여부를 담을 자리가 없어, 시험을 안 본 학생에게도 입력칸이 열린다

**무슨 일이 벌어지나** — `toRoundDetail` 은 모든 학생에게 `absent: false` 를 준다
(`composeRounds.ts:209`, `:222` — "응시 여부를 담는 컬럼이 없다. 모르는 것을 '미응시'로
단정하지 않는다"). 그래서 T7.15 가 세운 규칙 "미응시 학생에게는 입력 자리를 주지 않는다"
는 **실서비스에서 한 번도 발동하지 않는다.** 시험을 안 본 학생 행에도 「실점수 입력」이
열려 있고, 원장님이 거기에 `0` 을 넣으면 보정 루프는 그것을 "0점을 받은 학생"으로
학습한다. 잔차 −88 이 한 건 섞이면 환산 계수가 통째로 기운다. 화면은 빈 값은 거절하지만
0 은 정상 입력으로 받는다.

**재현** — MSW 목 데이터에는 `absent: true` 인 학생(박지호)이 있어 화면 분기가 살아 있는
것처럼 보이지만, 실 API 에서는 그 값이 나올 수 없다. 위 소견 A 의 `_adv-examRounds`
상세 응답에서도 모든 행이 `absent: false` 다. 코드 근거는 `composeRounds.ts:209,222`
두 줄(리터럴 `false`)이고 `absent` 를 `true` 로 만드는 코드는 저장소에 없다:

```
$ grep -rn "absent" src/lib/ src/app/ --include=*.ts
src/lib/exam/composeRounds.ts:209:      absent: false,
src/lib/exam/composeRounds.ts:222:      absent: false,
```

서버 쪽에서 `absent` 를 쓰는 자리는 이 두 리터럴이 전부다. 208행 주석이 그 이유를 적어
뒀다 — "🔴 응시 여부를 담는 컬럼이 없다. 모르는 것을 '미응시'로 단정하지 않는다."
판단 자체는 옳지만, 그 결과로 화면의 미응시 분기가 도달 불가가 된다.

**내가 확인 못 한 것** — "0점과 미응시를 어떻게 가를 것인가"는 설계 결정이라 답을 내지
않았다. 다만 지금은 **가를 방법 자체가 없다**는 사실만 적는다.

---

## 🟢 I [키보드] 저장이 끝나면 포커스가 `document.body` 로 떨어진다 — 24명을 연속으로 못 친다

**무슨 일이 벌어지나** — Enter 로 저장하면 `setBusy(true)` 가 입력칸을 `disabled` 로
바꾸고(실브라우저는 이 시점에 blur), 성공하면 `setEditing(false)` 가 그 input 을 언마운트
한다. 포커스를 넘겨받을 대상을 아무도 지정하지 않아 `document.body` 로 떨어진다.
다음 학생을 치려면 Tab 을 문서 맨 위(워드마크 링크)부터 다시 눌러야 한다. 한 반 24명이면
매번 그렇다.

**재현**

```
$ npx vitest run src/__tests__/components/_adv-actualScoreCell.test.tsx -t "ADV-7" --reporter=verbose --silent=false
[ADV-7] 저장 후 activeElement = BODY "오늘의수학│오늘의시험2026-08-15 토메인반문제은행"
 ✓ Enter 저장 후 활성 요소가 document.body 로 떨어진다
```

**원인** — `src/components/exam/ActualScoreCell.tsx:80-82`. 저장 성공 경로에 포커스 이관이
없다(예: 「실점수 고치기」 버튼으로 되돌리기).

---

## 🟢 J [접근성] 표의 「실점수 입력」 버튼이 학생마다 같은 이름이다

**무슨 일이 벌어지나** — 입력칸에는 `aria-label={`${studentName} 실점수`}` 가 붙어 있는데
버튼에는 없다. 스크린리더의 버튼 목록/로터로 훑으면 "실점수 입력"이 학생 수만큼 똑같이
나열되어 어느 학생 것인지 구분되지 않는다(표 안을 셀 단위로 이동하면 행 머리글이
읽히므로 완전히 막히지는 않는다).

**재현**

```
$ npx vitest run src/__tests__/unit/_adv-viewRender.test.tsx -t "ADV-16" --reporter=verbose --silent=false
[ADV-16] 표의 버튼 접근이름 = ["실점수 입력","실점수 입력","실점수 입력"]
```

같은 실행에서 각 행의 칸도 찍었다:

```
[ADV-16] 이서준 행 = ["88","80~93","—실점수 입력","—"]
[ADV-16] 최수아 행 = ["—","예측 불가 — 응답 부족","—실점수 입력","—"]
[ADV-16] 박지호 행 = ["—","미응시","","—"]
```

예측 쪽 `—` 는 옆 칸이 이유를 말해 주지만, **실제 칸의 `—`** 와 **잔차 칸의 `—`** 는
이유가 없다. "아직 안 들어옴"인지 "0점"인지 소리만으로는 구분되지 않는다
(단, 바로 옆 「실점수 입력」 버튼이 문맥을 준다).

---

## 🟢 K [구간 막대] 60점 미만 예측은 전부 같은 그림이 된다

**무슨 일이 벌어지나** — 막대 눈금이 60–100 으로 고정이고 `toPct` 가 clamp 하므로,
예상 40(구간 30~50)과 예상 60(구간 60~60)이 **완전히 같은 좌표**로 그려진다. 중학교 내신
실점수 분포에서 60점 미만은 드물지 않다. 표를 훑는 눈에는 하위권 학생 여럿이 같은 상태로
보인다. (옆에 `30~50` 이 글자로 병기되므로 거짓 정보는 아니고, 머리글도
`구간 60 — 100` 이라고 밝힌다.)

**재현**

```
$ npx vitest run src/__tests__/unit/_adv-viewRender.test.tsx -t "ADV-13" --reporter=verbose --silent=false
[ADV-13] 예상 40 · 구간 30~50 → {"leftPct":0,"widthPct":0,"pointPct":0}
[ADV-13] 예상 55 · 구간 48~58 → {"leftPct":0,"widthPct":0,"pointPct":0}
[ADV-13] 예상 60 · 구간 60~60 → {"leftPct":0,"widthPct":0,"pointPct":0}
[ADV-13] 예상 88 · 구간 80~93 → {"leftPct":50,"widthPct":32.5,"pointPct":70}
```

**원인** — `src/components/exam/viewModel.ts:266` `toPct` 의 clamp. 60–100 은 Hi-fi 시안
표기 그대로라 **확정 사항일 수 있다** — 그렇다면 결함이 아니라 알려진 제약이다.
판단은 원장님 몫이라 사실만 적는다.

---

## 🟢 L [확정 시안 이탈] '오늘의시험' 탭에는 「남은 작업 N」이 없다

`docs/planning/05-design-system.md:364` 의 확정 와이어는 오늘의시험 상단에
`오늘의수학 │ 오늘의시험    8월 15일 금   남은 작업 3` 을 그렸고, 370행은
"날짜·남은 작업 크롬은 **두 탭이 공유**한다" 고 못박았다. 그런데 `ExamDashboard` 와
`RoundDetail` 은 `<AppChrome tab="exam">` 만 넘기고 `remaining` 을 넘기지 않아 그 요소가
아예 렌더되지 않는다.

**재현** — 위 ADV-7 실행이 찍은 body 텍스트가 그대로 근거다:
`"오늘의수학│오늘의시험2026-08-15 토메인반문제은행"` — 「남은 작업」이 없다.

`AppChrome.tsx:70` 의 `remaining !== undefined` 분기가 그 자리다.

---

## 공격했으나 깨지지 않은 것 (같은 무게로 적는다)

1. **저장 중 Enter 연타로 두 번 저장되지 않는다.** `disabled={busy}` 가 실제로 막는다.
   포커스를 따라가는 경로(`user.keyboard`)로 3연타해도 요청은 1건이었다.
   ```
   [ADV-8b] userEvent 연타 → 요청 수 = 1 · disabled = true
   ```
   (`fireEvent.keyDown` 으로 disabled 를 무시하고 강제 주입하면 3건이 나가지만, 그건
   jsdom 이 disabled 요소에도 이벤트를 흘려 주기 때문이지 브라우저 동작이 아니다.
   `commit()` 에 재진입 가드가 없고 `disabled` 에만 의존한다는 사실은 남는다.)
2. **남의 학생 이름은 새지 않는다.** `toRoundDetail` 의 `!nameById.has(id)` 필터를 지우는
   돌연변이를 넣었더니 `examRounds.test.ts` 의
   `"🔴 같은 회차에 남의 학생이 섞여 있어도 그 이름은 새지 않는다"` 가 정확히 빨개졌다.
3. **회차 소유권 판정은 fail-closed 이고 테스트가 문다.** `isRunVisibleTo` 를
   `return true` 로 바꿨더니 5건이 빨개졌다(목록·상세 404·학생 0명 경로 포함).
4. **`roundJudgement`/`studentJudgement` 자체는 우회로가 없다.** 근거 부족 가드를 지우는
   돌연변이에 3건이 빨개졌다. 계기판 행·청사진 패널·상세·학생 표 네 곳이 모두 같은
   `roundJudgement`/`studentJudgement` 를 통과하며, 숫자를 내는 자리(예상 점수·구간·잔차·
   청사진 5필드)는 전부 그 뒤에 있다. **신뢰도가 null 인데 0 으로 갈음하는 자리도 없다**
   — `confidenceTier(null) === "unknown"` → `"신뢰도 미산출"` 로 갈리고 인셋 바 색은
   `none` 이다. (깨진 것은 가드가 아니라 가드에 들어가는 수다 → 소견 B.)
5. **소수 점수가 정상 동작한다.** 87.5 를 치면 `actualScore: 87.5` 로 그대로 나가고
   화면에도 `87.5` 로 표시된다. `formatScore` 도 소수를 살린다.
6. **범위 밖 값은 말로 막는다.** `1e3`(=1000), `101`, `-5` 는 전부
   "점수는 0에서 100 사이여야 합니다" 를 `role="alert"` 로 띄우고 값을 남긴다.
7. **화면의 적중 판정이 서버와 같은 규칙이다.** `viewModel.residualView` 의
   `actual >= lower && actual <= upper` 는 `calibration.isIntervalHit` 과 글자 그대로
   같다(경계 포함). DB 의 `interval_hit` 과 화면의 `적중/빗나감` 이 엇갈릴 경로를
   찾지 못했다.
8. **D-30 우회 없음.** `article`·`tr`·장식 표면에 `cursor-pointer` 나 행 hover, `div
   onClick` 이 없다. 실제로 누르는 것(링크 2종, 「실점수 입력/고치기」 버튼)만 컨트롤이고,
   `ExamDashboard` 는 시안의 「+ 새 회차」를 **일부러 넣지 않았다**(API 가 없어서).
   반대로 "눌러야 하는데 커서가 안 바뀌는 것"도 찾지 못했다.
9. **빈 상태가 전부 이유를 적는다.** 회차 0건 / 학생 0명 / 청사진 없음 / 실점수만 있음
   네 가지가 모두 문장으로 사유를 낸다. 특히 "실점수만 들어왔습니다" 분기는 실제로
   나는 상태를 정확히 구분한다.

---

## 미확인 의심 (재현 못 했다 — 결함으로 세지 말 것)

1. **저장 성공 후 서버 응답을 통째로 버린다.** `examApi.ts:51` 은 `if (res.ok) return;`
   으로 본문을 읽지 않고, `RoundDetail.applyActualScore` 는 **클라이언트가 보낸 값**으로
   화면을 갱신한다. 서버가 다른 값을 저장하면 화면과 DB 가 어긋나는데,
   `attachActualScores` 를 읽어 보니 오늘은 `actualScore` 를 변형 없이 저장한다
   (`Float` 컬럼, 반올림·clamp 없음). **어긋남을 실제로 만들지 못했다.**
   응답에는 저장된 행과 잔차 요약이 들어 있는데 쓰이지 않는다는 사실만 적어 둔다.
2. **`8,5` → `85`.** 위 소견 G 곁가지. jsdom + user-event 결과이고 실브라우저 확인 못 함.
3. **`predictionRunService.ts:687` 의 `evidenceCount: row.inputExamIds.length`.**
   소견 B 와 같은 혼동이 `/api/predictions` 목록 응답에도 있다. 내 담당 영역 밖이라
   그쪽 화면에서 어떤 손해가 나는지는 확인하지 않았다.
4. **하이드레이션.** `formatMastheadDate()` 와 `ddayLabel(..., new Date())` 가 렌더 중
   현재 시각을 읽으므로 서버·클라이언트 렌더가 날짜 경계에서 갈릴 수 있다. 다만
   `examDate` 가 늘 null 이고(소견 C) 목록·상세는 `useEffect` 뒤에 그려지므로 오늘은
   재현되지 않았다. 소견 C 를 고친 뒤 다시 볼 자리다.
5. **공유 DB 의 실제 행.** 접속하지 않았다. 위 모든 재현은 인메모리 테스트 더블 +
   실 Route Handler 직접 호출이다.

---

## 재현물 정리

```
src/__tests__/api/_adv-examRounds.test.ts          6 passed   (A · C · D · E)
src/__tests__/components/_adv-actualScoreCell.test.tsx 8 passed (G · I · 반증 1)
src/__tests__/components/_adv-numberInputProbe.test.tsx 2 passed (G 근거)
src/__tests__/unit/_adv-evidenceCount.test.ts      2 passed   (B)
src/__tests__/unit/_adv-viewRender.test.tsx        5 passed   (C · F · K · J)
```

이 파일들은 **현재 코드의 잘못된 동작을 그대로 고정하는 방향으로** 단언되어 있다
(예: "examDate 는 null 이어야 한다"). 고칠 때는 지우거나 방향을 뒤집어야 한다.
지울지 남길지는 원장님이 정하시면 된다.

기존 스위트는 손대지 않은 상태에서 그대로 초록이다:

```
$ npx vitest run src/__tests__/api/examRounds.test.ts src/__tests__/api/actualScore.test.ts \
    src/__tests__/unit/examCompose.test.ts src/__tests__/unit/examView.test.ts \
    src/__tests__/components/{TodaysExam,ActualScoreEntry,AppChrome}.test.tsx
 Test Files  7 passed (7)
      Tests  120 passed (120)
```
