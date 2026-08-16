# 적대적 리뷰 ② — 배점 보정기 · 예측 문제지 · 채점 접합

- 대상: `scoreNormalizer` · `composePredictedPaper` · `generatePredictedPaper` ·
  `persistPredictedPaper` · `/api/tests/predicted` · `/api/tests/{id}/scores` ·
  `gradeAnswers` · `submitTestResult`
- 코퍼스: `PREDICTOR_CORPUS_DIR=…\handoff-a-index\scripts\qa\reports` (읽기만). 공유 DB 는 손대지 않았다.

> **1차(리뷰)**: 읽기·재현 전용으로 진행했고 기존 파일을 한 줄도 고치지 않았다.
> **2차(수리, 2026-08-16 원장님 지시)**: 아래 🔴 두 건을 고쳤다. 나머지 항목은 손대지 않았다.

---

# 수리 기록 (2026-08-16)

원장님 지시로 🔴 두 건만 고쳤다. 🟡·🟢 는 **그대로 남아 있다.**

| 결함 | 수리 | 고친 곳 |
|---|---|---|
| 🔴 중복 `orderIndex` → 만점 100 가드 우회 | 문항 번호가 중복되면 **합계를 세기 전에** `문항_중복` 으로 거부 | `scoreNormalizer.ts` `validateManualScores` · `scoreNormalizer.contract.ts` (`manualScoreIssueSchema` 에 `문항_중복` 추가) · `persistPredictedPaper.ts` (`문항_중복` → `문항_불일치`(400) 매핑) |
| 🔴 중복 응답 → 이중 채점 | `answerProblemIds.size !== input.answers.length` 면 400 으로 거부 (중복된 problemId 를 `details` 에 싣는다) | `submitTestResult.ts` |

**RED → GREEN 으로 했다.** 먼저 정규 테스트 파일에 실패하는 테스트를 넣어 빨간 것을 확인하고
(`persistPredictedPaper.test.ts` 2건 · `testresult.test.ts` 1건) 그 다음에 고쳤다.
적대적 재현 파일(`_adv-*`)의 단언은 **고쳐진 동작으로 뒤집어** 두었다 —
공격 모양 그대로 회귀 테스트로 남는다.

## 수리 후 검증

```
$ npx vitest run          → Test Files 68 passed (68) · Tests 914 passed (914)
$ npm run type-check      → 0 error
$ npm run lint            → 0 error (경고 1건은 lint-staged.config.mjs, 기존 것)
$ npm run lint:affordance → 통과
```

## 돌연변이 검사 — 새 가드가 무는가

| 죽인 가드 | 결과 |
|---|---|
| `validateManualScores` 중복 검사 | 🔴 5건 빨강 (단위 2 · 저장 2 · 라우트 1) |
| `submitTestResult` 중복 응답 검사 | 🔴 2건 빨강 |

**중간에 한 번 잘못 만들었다가 되돌렸다.** 처음에는 중복 검사를 `saveManualScores` 와
`validateManualScores` **두 곳**에 겹쳐 뒀는데, 돌연변이 검사에서 `saveManualScores` 쪽만
지웠더니 **아무 테스트도 빨개지지 않았다**(다른 층이 대신 잡고 메시지까지 같아서 구분이 안 됐다).
이 리뷰가 스스로 세운 규칙 — "가드를 지웠는데 안 빨개지면 그 가드는 있는지 확인할 수 없다" —
에 걸리므로, 검사를 `validateManualScores` **한 곳**으로 모으고 `saveManualScores` 에는
왜 여기서 다시 세지 않는지 주석으로 남겼다. 지금은 어느 쪽을 지워도 빨개진다.

## 이번에 안 고친 것 (그대로 남아 있다)

- 🟡 반쪽 시험지가 확정·인쇄까지 감 (`unfilled` 이 저장되지 않음)
- 🟡 `saveManualScores` 에 `testType`·`status`·기채점 가드가 없음 — 인쇄된 일일테스트도 덮어씀
- 🟢 `offGrid` 안내가 영원히 빈 배열
- 🟢 `validateManualScores` 가 문자열 `"50"` 을 통과시킴 (라우트 zod 가 막고 있음)
- `ProblemAnswer` 에 `@@unique([testResultId, problemId])` 가 없음 — 응용 계층에서만 막았다.
  DB 층 방어를 넣으려면 마이그레이션이 필요해 이번엔 하지 않았다.

## 곁다리로 고친 환경 문제

이 워크트리는 `prisma generate` 가 안 돼 있어 **`npm run type-check` 가 154개 에러**를 뱉고
`auth.test.ts`·`problem.test.ts` 2건이 빨간 상태였다(1차 보고서의 "환경 메모").
`npx prisma generate` 한 번으로 둘 다 사라졌다. 저장소 파일은 바뀌지 않는다(`node_modules` 만 갱신).

---

## 🔴 [수동 배점 조정] 같은 `orderIndex` 를 두 번 보내면 "합계 100" 가드가 통째로 뚫린다 — **수리됨(2026-08-16)**

**무슨 일이 벌어지나** — 같은 문항 번호를 여러 번 담아 보내면 `PATCH /api/tests/{id}/scores` 가
**200 과 `totalScore: 100`** 을 돌려주는데, DB 에 실제로 저장된 시험지 만점은 100 이 아니다.
재현에서는 **148점짜리 시험지**가 남았다. 그 시험지로 채점하면 학생 총점이 100 을 넘고
(만점 100 전제), `predictStudentScore` 는 100 으로 clamp 하지만 `TestResult.score` 에는
148 이 그대로 저장된다. D-42(합계 100)와 D-45(만점 100 아닌 시험지는 출제·채점에서 제외)를
동시에 우회한다.

**재현** — `src/__tests__/api/_adv-predictedPaper.test.ts`

```
$ npx vitest run src/__tests__/api/_adv-predictedPaper.test.ts

[적대] PATCH /scores — 같은 orderIndex 를 두 번 보낸다
PATCH status 200 · 응답 totalScore 100
DB 실제 만점: 148 · 배점: [
  2, 52, 3, 3, 3, 4, 4, 4,
  4,  4, 4, 4, 4, 4, 4, 4,
  4,  4, 4, 4, 5, 5, 5, 5,
  5
]
 ✓ 200 과 totalScore 100 을 돌려주지만 DB 만점은 100 이 아니다
```

보낸 것은 25문항 시험지에 `orderIndex:1` 24개(각 2점) + `orderIndex:2` 1개(52점) = **정확히 100점**.

단위 수준 재현 — `src/__tests__/unit/_adv-manualScores.test.ts`

```
저장된 배점: [ 25, 12.5, 12.5, 20, 20 ] 실제 만점: 90
 ✓ 합계 100 을 통과하지만 실제 저장된 만점은 100 이 아니다
 ✓ (validateManualScores 단독) 같은 번호를 여러 번 세어 100 을 만든다
```

> 위 출력은 **수리 전** 기록이다. 지금 같은 파일을 돌리면 `문항_불일치` 로 거부하고
> 배점이 `[20,20,20,20,20]` 그대로인 것을 확인한다(단언을 고쳐진 동작으로 뒤집어 뒀다).

**원인** — 세 곳이 각자 "남이 보겠지" 하고 통과시킨다.

- `src/lib/predictor/persistPredictedPaper.ts:172-179` — 짝맞춤 검사가
  **개수(`rows.length !== input.scores.length`)와 존재 여부(`byOrder.has`)만** 본다.
  `[1,1,1,2,3]` 은 개수 5, 전부 존재하므로 통과한다. **중복도 누락도 잡지 못한다.**
- `src/lib/predictor/scoreNormalizer.ts:373-381` — `validateManualScores` 는 넘어온 배열을
  그냥 더한다. `number` 의 중복을 보지 않으므로 같은 문항을 여러 번 세어 100 을 만들 수 있다.
- `src/lib/predictor/persistPredictedPaper.ts:194-199` — 저장은 `orderIndex → row` 로 되짚어
  `update` 하므로 **같은 행에 마지막 값만 남고**, 보내지 않은 문항은 예전 배점 그대로 남는다.
  합계를 여기서 다시 세지 않는다.

**내가 확인 못 한 것** — 배점 조정 화면이 아직 없어(저장소 전체에 `/scores` 를 호출하는 `.tsx` 가
없다) 실제 UI 가 중복을 보낼지는 모른다. 다만 요청 계약(`testScoresUpdateRequestSchema`)에
유일성 제약이 없으므로 클라이언트가 무엇을 보내든 서버가 막아야 하는 자리다.

---

## 🔴 [채점] 같은 문항 응답을 두 번 보내면 이중으로 채점된다 — **수리됨(2026-08-16)**

**무슨 일이 벌어지나** — `POST /api/tests/{id}/submit` 의 "모든 문항에 응답이 필요하다" 검사가
**고유 problemId 개수**만 세기 때문에, 중복 응답을 섞으면 검사를 통과하고 그 문항의 배점이
두 번 더해진다. 학생 점수가 실제보다 높게 나가고, `ProblemAnswer` 에도 중복 행이 남는다
(스키마에 `@@unique([testResultId, problemId])` 가 없다 — `prisma/schema.prisma:472-491`).

**재현** — `src/__tests__/api/_adv-grading.test.ts`

```
[적대] 같은 문항 응답을 두 번 보낸다
중복 제출 총점: 80 (정상은 70)
저장된 ProblemAnswer 행 수: 4 (문항은 3개)
 ✓ 문항 수 검사를 통과하고 배점이 이중으로 계산된다
```

> 위 출력은 **수리 전** 기록이다. 지금은 400 (`같은 문항에 대한 응답이 여러 번 들어왔습니다.`)
> 으로 거부하고 `TestResult`·`ProblemAnswer` 를 한 행도 남기지 않는다.

3문항 픽스처(배점 10·10·80)에 정답 문항 1개를 한 번 더 넣었을 뿐이다.

**원인** — `src/lib/testResults/submitTestResult.ts:40,53`

```ts
const answerProblemIds = new Set(input.answers.map((a) => a.problemId));
...
if (answerProblemIds.size !== testProblems.length) { ... }   // 중복은 Set 에서 사라진다
```

`input.answers.length` 를 보지 않으므로 `[p1, p1, p2, p3]` 은 size 3 === 3 으로 통과한다.
게다가 균등배분은 `answers.length` 로 나눈다(`src/lib/testResults/gradeAnswers.ts:82`) —
중복이 섞이면 배점 없는 시험지의 문항당 배점까지 같이 흔들린다.

**이번 변경(D-42)이 만든 결함은 아니다.** `git log -S adjustedScore` 로 확인했다 — 이 가드는
T7.1 부터 있었고 f9ec664d 는 건드리지 않았다. 다만 D-42 가 **결과를 나쁘게 만든다**:
예전에는 `Problem.score` 합이 애초에 100 이 아니라 총점이 무의미했지만, 이제 예측 문제지는
만점 100 을 보장하므로 중복 한 건이 곧 "만점 초과 점수"가 된다.

**내가 확인 못 한 것** — 결과 입력 화면이 중복을 보낼 수 있는지는 보지 않았다.

---

## 🟡 [예측 문제지] 청사진을 다 못 채운 반쪽 시험지가 확정·인쇄까지 간다

**무슨 일이 벌어지나** — 청사진이 25문항을 요구하는데 문제은행에 21개뿐이면
`composePredictedPaper` 는 21문항짜리 시험지를 만들고 **그 21문항으로 합계 100 을 맞춘다.**
API 는 201 로 저장하고, 이어서 확정(200) → 인쇄(200) 까지 아무 저항 없이 통과한다.
`unfilled` 는 생성 응답에만 실리고 **어디에도 저장되지 않으므로**, 그 응답을 흘려보낸 뒤에는
"이 시험지는 청사진의 4칸이 비어 있다"는 사실을 알 방법이 없다. 원장은 정상 시험지로 인쇄한다.

**재현** — `src/__tests__/api/_adv-predictedPaper.test.ts`

```
[적대] 청사진 칸을 다 못 채운 반쪽 시험지
status 201 · 문항수 21 · 만점 100 · 못채운칸 4
GET /api/tests/{id} 응답 키: {"data":{"test":{… "testType":"review","status":"draft", …},"problems"…
confirm status 200
print status 200
 ✓ 201 로 저장되고 확정·인쇄까지 간다 — 저장 뒤에는 결손 흔적이 남지 않는다
```

`GET /api/tests/{id}` 응답에는 `unfilled` 도 `evidenceCount` 도 `confidence` 도 없다.

**원인**

- `src/lib/predictor/composePredictedPaper.ts:339` — 거절 조건이 `filled.length === 0` 뿐이다.
  1개만 채워도 `ok: true` 다.
- `src/lib/predictor/generatePredictedPaper.ts` 8단계(적재) — 적재 전에 `paper.unfilled` 를 보지 않는다.
- `prisma/schema.prisma` 의 `Test`/`TestProblem` 에 결손·근거를 담을 자리가 없다.
- `src/app/api/tests/[id]/confirm/route.ts` · `print/route.ts` — 상태 전이만 보고 내용은 안 본다.

같은 자리에서 하나 더: **그 학교 근거가 0편이어도 코호트(남의 학교)만으로 201 을 낸다.**

```
[적대] 근거 편수 경계
status 201 · evidenceCount 0 · confidence 0 · 문항수 25
 ✓ 그 학교 근거가 0편이어도 코호트(남의 학교)만으로 시험지를 만든다
```

`predictBlueprint` 의 거절 조건은 `history.length === 0 && cohort.length === 0`
(`src/lib/predictor/predictBlueprint.ts:281`) 이라, 대구여고를 요청했는데 대구여고 자료가
한 편도 없어도 남의 학교 통계로 만든 시험지가 나간다. 계약 주석에 "0이면 코호트만으로 만든
것이라 신뢰도가 낮다"고 적혀 있으니 **의도된 동작**이지만, `confidence: 0` 역시 저장되지 않아
인쇄 시점에는 구분할 수 없다.

**내가 확인 못 한 것** — 인쇄 지면에 결손이 어떻게 보이는지(실물 출력)는 확인하지 않았다.
예측 문제지 화면 자체가 아직 없다.

---

## 🟡 [수동 배점 조정] 배점을 쓰지 않는 일일테스트·이미 인쇄된 시험지도 덮어쓴다

**무슨 일이 벌어지나** — `saveManualScores` 에 `testType`·`status`·기채점 여부 검사가 없다.
**이미 인쇄된 일일테스트**(D-28·D-40 상 배점 표기가 없어 `TestProblem.score` 가 NULL 이어야
하는 시험지)에 배점을 심을 수 있고, 그 순간부터 그 시험지의 채점 기준이 바뀐다.
같은 시험지를 이미 채점했다면 예전 결과와 새 결과가 어긋난다. 되돌릴 값(NULL)은 남지 않는다.

**재현** — `src/__tests__/api/_adv-scores-edge.test.ts`

```
[적대] 배점을 표기하지 않는 일일/확인테스트(D-28·D-40)에 배점을 심는다
대상 시험지 testType/status: daily printed
변경 전 TestProblem.score: [ null, null, null ]
PATCH status: 200
변경 후 TestProblem.score: [ 98, 1, 1 ]
 ✓ testType·status 검사 없이 옛 시험지의 TestProblem.score 를 덮어쓴다
```

원래 `Problem.score` 10·10·80 으로 채점되던 시험지가 98·1·1 로 바뀐다.

**원인** — `src/lib/predictor/persistPredictedPaper.ts:160-166` 은 소유권만 본다.
`test.testType` · `test.status` · `TestResult` 존재 여부를 보지 않는다.

**내가 확인 못 한 것** — 화면이 없어 원장이 실수로 이 경로에 닿을 확률은 재지 못했다.

---

## 🟡 [수동 배점 조정] 중복 `orderIndex` + 배점 NULL 시험지 = 잡히지 않은 예외(500) — **수리됨(2026-08-16, 위 🔴 수리의 부수 효과)**

**무슨 일이 벌어지나** — 위 🔴 와 같은 중복 입력을 **배점이 아직 NULL 인 시험지**에 보내면,
저장은 (일부만) 되고 응답을 만드는 단계에서 계약 검증이 터진다. `jsonOk` 는 실패 시 그대로
throw 하므로 예외가 Route Handler 밖으로 나간다 — 원장 화면에는 500 이 뜬다.
**저장은 이미 일어난 뒤라 되돌아가지 않는다.**

**재현** — `src/__tests__/api/_adv-scores-edge.test.ts`

```
[적대] 같은 orderIndex 중복 + 배점 없는 시험지 = 응답 계약 위반으로 터진다
status: 0 · 던진 예외: [ { "origin": "number", "code": "too_small", "minimum": 0,
  "inclusive": false, "path": [ "data", "problems", 2, "score" ] … } ]
 ✓
```

**원인** — `src/app/api/tests/[id]/scores/route.ts:78` 이 `score: row.score ?? 0` 으로 내보내는데
응답 계약은 `score: z.number().positive().max(100)` 이라 **0 을 허용하지 않는다**
(`src/contracts/scoreNormalizer.contract.ts` `testScoresUpdateResponseSchema`).
중복 때문에 갱신되지 않고 NULL 로 남은 행이 있으면 반드시 걸린다.

---

## 🟢 [배점 보정기] "만점이 정확히 100.0" — 반환 배열을 그냥 더하면 100 이 아니다

**무슨 일이 벌어지나** — 지금은 사용자에게 새지 않는다. 다만 주장 자체는 사실이 아니다.
`normalizeScores` 가 돌려준 `questions[].score` 를 **소박한 실수 덧셈**으로 더하면
`100.00000000000001` · `99.99999999999996` 이 나오는 조합이 실측 코퍼스에서 **14,839건**
(전체 245,936 조합 중 6.0%) 있다.

**재현** — `scripts/qa/_adv-normalizer-sweep.ts`
(코퍼스 1,575편 눈금 × 문항수 3~40 전수 × 난이도 프로필 4종 — T7.9 는 Δn∈{-2,0,+3} × 라벨없음 1종만 쟀다)

```
$ PREDICTOR_CORPUS_DIR=…\handoff-a-index\scripts\qa\reports npx tsx scripts/qa/_adv-normalizer-sweep.ts

코퍼스 시험지 1575편
0.01 단위가 아닌 원본 배점: 0건

조합 245936건 · ok 128596건 (52.29%)
거절 사유: [ [ '합계_100_불가', 117340 ] ]

불변식 위반 14839건
  ✗ 실수합≠100 final-batch/1524.json n=19 하중상반복 → 99.99999999999997 (배점 4.3+4.6+5+4.3+4.7+5.2+…)
  ✗ 실수합≠100 final-batch/1565.json n=25 라벨없음 → 100.00000000000001 (배점 3+3+…+3.2+3.3+5+5+6+7+7+7+7+3.3)
  … (정수합(sumScores) 위반 0건 · 눈금 밖 0건 · 0 이하 배점 0건)

"만들 수 있는데 못 만든다" 0건
```

**왜 지금은 안 터지나** — 저장 직전 가드가 `sumScores`(0.01 단위 정수합)를 쓰고
(`persistPredictedPaper.ts:90`), 채점은 문항마다 `round2` 한 뒤 총점도 `round2` 한다
(`gradeAnswers.ts:78,113-115`). **실수합을 그대로 쓰는 가드가 지금은 한 군데도 없다.**
새 코드가 `questions.reduce((a,q)=>a+q.score,0) === 100` 을 쓰는 순간 터진다.
(참고: `persistPredictedPaper.test.ts:334` 는 `maxPoints` 를 실수로 reduce 해 `toBe(100)` 을
단언하는데, 눈금이 20 인 픽스처라 지금은 통과한다. 4.3 같은 눈금을 쓰는 픽스처로 바꾸면 깨진다.)

**같은 실행에서 확인된 것 — 거절은 정직하다.** `합계_100_불가` 117,340건 전부를 독립적으로 짠
도달 가능성 DP 로 교차 검증했고 "만들 수 있는데 못 만든다"는 **0건**이었다.
`눈금_해상도_초과` 도 0건, 눈금 밖 배점도 0건이다.

---

## 🟢 [수동 배점 조정] `offGrid` 안내는 영원히 빈 배열이다

`validateManualScores` 는 `grid` 를 받아 눈금 밖 배점 번호를 `offGrid` 로 알리게 돼 있지만
(`scoreNormalizer.ts:352-357` 주석), `saveManualScores` 는 `grid` 를 넘기지 않는다
(`persistPredictedPaper.ts:182-187`). 넘길 grid 를 저장한 곳도 없다 —
`Test`·`TestProblem` 어디에도 눈금 컬럼이 없고 `PredictedPaper.grid` 는 생성 응답에만 실린다.
게다가 `testScoresUpdateResponseSchema` 에 `offGrid` 필드 자체가 없어 원장에게 도달할 길이 없다.
문서화된 기능이 조용히 no-op 이다.

## 🟢 [수동 배점 조정] `validateManualScores` 는 문자열 `"50"` 을 통과시킨다

`toCenti("50" as number)` 가 `"50" * 100 = 5000` 으로 계산돼 합계에 들어간다.
NaN·±Infinity·음수·0 은 전부 `배점_형식오류` 로 잡힌다. 현재는 라우트의 zod
(`score: z.number().positive().max(100)`)가 400 으로 먼저 막아 도달 불가다.

```
  NaN          → ok=false issue=배점_형식오류 …
  Infinity     → ok=false issue=배점_형식오류 …
  -Infinity    → ok=false issue=배점_형식오류 …
  음수          → ok=false issue=배점_형식오류 …
  0            → ok=false issue=배점_형식오류 …
  문자열 '50'    → ok=true          ← 이것만 샌다
  (라우트 경유: 1e999 → 400 · -50 → 400 · "50" → 400)
```

---

# 깨지지 않은 주장 — 무엇을 어떻게 확인했나

### ✅ "`Problem.score` 원본은 절대 안 바뀐다" — 세 경로 전부 확인, 결함 없음

- **적재**: `Problem.score` 를 쓰는 곳은 이관 경로 `src/lib/import/toLoadRows.ts:101` 하나뿐이다.
  `src` 와 `scripts` 전체에서 `problem.create/update/upsert` 를 부르는 21곳을 훑어 `score` 를
  `data` 에 싣는 곳이 그 외에 없음을 확인했다.
- **수동조정**: `problemUpdateRequestSchema`(`src/contracts/problem.contract.ts:69-78`) 에
  `score` 필드가 없다 — `PATCH /api/problems/{id}` 로는 배점을 못 바꾼다.
  `saveManualScores` 는 `tx.testProblem.update` 만 부른다.
- **채점**: `submitTestResult` 의 트랜잭션은 `TestResult`·`ProblemAnswer`·`AnalysisReport`
  세 테이블만 만든다. `problem` 을 스치지 않는다.
- **문항 교체**(`src/lib/tests/replaceTestProblem.ts:112-115`)도 `problemId`·`replaced` 만
  갱신하고 `TestProblem.score` 를 보존한다 — 교체해도 그 자리의 배점이 유지돼 만점 100 이 깨지지 않는다.

### ✅ "옛 시험지(배점 NULL) 채점이 이번 변경으로 달라지지 않았다" — 실제로 재현

```
[적대/회귀] 배점 없는 옛 일일테스트 채점이 D-42 변경 후에도 같은가
옛 시험지 TestProblem.score: [ null, null, null ]
옛 시험지 채점 총점: 70
 ✓ TestProblem.score 가 NULL 이면 예전 규칙(Problem.score ?? 균등배분) 그대로다
```

`git diff 945003cb f9ec664d -- gradeAnswers.ts` 로 변경 전 산식이 `problem.score ?? equalShare`
였음을 확인했고, 새 산식 `adjustedScore ?? score ?? equalShare` 는 `adjustedScore` 가 NULL 인
모든 옛 시험지에서 같은 값을 낸다. 다만 위 🟡 처럼 **누군가 옛 시험지에 배점을 심으면 그때부터 달라진다.**

### ✅ "근거가 0 이면 422" — 학교·코호트 모두 0 일 때는 참

기존 테스트(`predictedPaper.test.ts`)가 이미 이 경로를 잡고 있고, 누출 차단(미래 회차만 있는
경우)도 422 로 떨어진다. 코호트만 있는 경우는 위 🟡 참조.

### 실측 — 문항수가 어긋날 때 얼마나 거절하나 (`scripts/qa/_adv-corpus-fill.ts`)

`load-exams.ts` 가 실제로 쓰는 `loadCorpus()` 로 2,020편을 읽어(신뢰 가드 통과 1,810편)
그 학교 자기 눈금으로 문항수를 ±5 흔들었다.

```
로더 통계: { files: 2036, papers: 2020, questions: 42741, …, scoreFilled: 761 }
신뢰 가드 통과 1810편 / 전체 2020편

0.01 단위가 아닌 눈금을 가진 시험지: 0편

문항수 오차별 거절률 (학교 자기 눈금):
  Δn=-5 →  95/1810 (5.2%)    Δn=-2 → 31/1810 (1.7%)    Δn=+2 →  39/1810 (2.2%)
  Δn=-4 →  75/1810 (4.1%)    Δn=-1 → 26/1810 (1.4%)    Δn=+3 →  54/1810 (3.0%)
  Δn=-3 →  41/1810 (2.3%)    Δn= 0 →  0/1810 (0.0%)    Δn=+4 →  74/1810 (4.1%)
                              Δn=+1 → 24/1810 (1.3%)    Δn=+5 → 111/1810 (6.1%)
```

**청사진 문항수가 그 학교 실제 문항수와 같으면 거절이 0 이다.** 어긋날수록 늘어 ±5 에서 5~6% 다.
T7.9 가 보고한 97.9~98.3% 와 모순되지 않는다. 내 첫 훑기의 52%는 문항수를 3~40 으로 억지로
흔든 값이라 실전 수치가 아니다(위 🟢 참조) — 그 훑기의 쓸모는 "거절이 거짓말이 아니다"를
전수로 확인한 데 있다.

**부수 확인 — 중앙값 채움은 아직 눈금을 오염시키지 않았다.**
`scripts/predictor/loadCorpus.ts:145-149` 는 배점 없는 문항(761개)을 **편 중앙값**으로 채운다.
중앙값은 짝수 개일 때 두 값의 평균이라 구조적으로 0.005 단위(→ `눈금_해상도_초과` → 그 학교
전체 422)가 나올 수 있는데, **현재 코퍼스에서는 0편**이었다. 지금은 안전하다.
다만 이 채움값은 그 학교가 실제로 쓴 눈금이 아닐 수 있으니, 추출을 다시 돌리면 재확인할 자리다.
`ExamQuestion` 을 쓰는 유일한 경로가 이 로더라 코퍼스 JSON 만 보는 `scoreNormalizerCorpus.test.ts`
는 이 채움값을 영영 보지 못한다.

---

# 돌연변이 검사 — 이 테스트들이 실제로 무는가

가드를 하나씩 죽이고 관련 테스트가 **빨개지는지** 확인했다. 확인 후 전부 `git checkout --` 으로 되돌렸다.

| 죽인 가드 | 결과 |
|---|---|
| `gradeAnswers.ts:91` 우선순위 뒤집기 (`score ?? adjustedScore`) | 🔴 3개 파일 빨강 |
| `persistPredictedPaper.ts:91` 저장 직전 만점 가드 제거 | 🔴 빨강 (`만점_불일치` 단언) |
| `scoreNormalizer.ts:298` DP 마무리("정확히 100 으로 닫는다") 제거 | 🔴 2개 파일 3건 빨강 |
| `scoreNormalizer.ts:345` 눈금 밖 값 주입 (합계 100 은 유지) | 🔴 7건 빨강 — **코퍼스 테스트가 잡는다** |
| `persistPredictedPaper.ts:172` 문항 짝맞춤 가드 제거 | 🔴 빨강 (`문항_불일치` 단언) |
| `submitTestResult.ts:53` 응답 개수 가드 제거 | 🔴 빨강 |

**있는 가드는 전부 문다.** 특히 "합성 픽스처가 결함을 통과시킨다"는 이 저장소의 전례에 대해,
합계 100 을 유지한 채 눈금 밖 값만 주입해도 코퍼스 테스트가 스스로 빨개지는 것을 확인했다.

문제는 **없는 가드**다 — 위 🔴 두 건(중복 `orderIndex`, 중복 `problemId`)은 어떤 테스트도 다루지
않는다. 물 것이 없어서 안 무는 것이지, 테스트가 무른 것이 아니다.

---

# 미확인 의심 (재현 못 함 — 왜 못 했는지 포함)

1. **실전 `합계_100_불가` 발생률.** 공유 DB 는 읽기만 하라는 지시가 있고 이 워크트리에 로컬 DB 가
   없어, 실제 `predictBlueprint` 가 내는 `questionCount` 가 그 학교 실제 문항수에서 얼마나
   벗어나는지 못 쟀다. 위 Δn 표는 "어긋나면 이만큼 거절한다"이지 "실제로 이만큼 어긋난다"가 아니다.
   실전 눈금은 코호트 혼합이라 자기 눈금보다 **넓어져** 거절이 줄 가능성이 크다(내 혼합 눈금
   샘플에서도 그랬다) — 방향은 안전한 쪽이지만 수치는 못 냈다.
2. **실제 Prisma 트랜잭션 롤백.** 테스트는 인메모리 더블(`src/mocks/prismaTestDouble.ts`)을 쓰므로
   `persistPredictedPaper` 의 `testProblem.create` 가 중간에 실패했을 때 `Test` 행이 남는지
   확인하지 못했다. 코드상 `db.$transaction` 안이라 실 Prisma 는 롤백하겠지만 **재현하지 않았다.**
   참고로 `persistPredictedPaper.ts` 헤더 주석은 만점 판정을 "트랜잭션 안에서" 한다고 적었으나
   실제 판정(`:90-96`)은 트랜잭션 **앞**이다. 순수 계산이라 결과는 같아서 결함으로 세지 않았다.
3. **인쇄 실물.** 예측 문제지 화면·배점 조정 화면이 아직 없어 지면에 배점이 어떻게 찍히는지,
   반쪽 시험지가 눈으로 구분되는지는 확인하지 못했다.
4. **동시성.** 같은 시험지에 `PATCH /scores` 가 동시에 들어올 때(읽기-검증-쓰기가 트랜잭션 밖에서
   시작된다) 마지막 쓰기가 이기는 것 외에 합계가 깨질 수 있는지는 재현하지 못했다.
5. **정수 배점을 문자열로 보내는 경로.** `validateManualScores` 가 `"50"` 을 통과시키는 것은
   확인했지만, 라우트 zod 를 우회해 이 함수에 문자열이 닿는 실제 호출자는 찾지 못했다.

---

# 환경 메모 (내 영역 밖)

(1차 리뷰 시점 기록 — `npx prisma generate` 로 해소했다. 위 「수리 기록」 참조.)
`npx vitest run` 전체는 1차 리뷰 시점에 **2건이 빨갰다** — `src/__tests__/api/auth.test.ts` 와
`src/__tests__/api/problem.test.ts` 의 경쟁 상황 테스트가
`TypeError: Prisma.PrismaClientKnownRequestError is not a constructor` 로 실패한다.
**내가 추가한 `_adv-*` 파일을 전부 치우고 돌려도 똑같이 실패**하므로 내 파일과 무관하고,
이번 리뷰 대상(배점·채점)과도 무관하다. `prisma generate` 상태 문제로 보인다.
그 2건을 빼면 909건 통과다.

---

# 내가 만든 파일 (지울지는 원장님이 정한다)

- `src/__tests__/unit/_adv-manualScores.test.ts` — 중복 `orderIndex` 단위 재현
- `src/__tests__/api/_adv-predictedPaper.test.ts` — 반쪽 시험지 인쇄 · PATCH 중복 · 근거 0편
- `src/__tests__/api/_adv-grading.test.ts` — 중복 응답 이중 채점 · 옛 시험지 회귀 확인
- `src/__tests__/api/_adv-scores-edge.test.ts` — 이상값 · 일일테스트 덮어쓰기 · 500
- `scripts/qa/_adv-normalizer-sweep.ts` — 코퍼스 눈금 × 문항수 3~40 × 난이도 4종 전수
- `scripts/qa/_adv-corpus-fill.ts` — 실제 로더(`loadCorpus`)로 Δn 별 거절률 · 중앙값 채움 점검

`scripts/qa/_adv-*` 는 `.gitignore:60`(`scripts/qa/_*`)에 걸려 추적되지 않는다.
1차 리뷰에서는 기존 파일을 고치지 않았다. 2차 수리에서 `_adv-*` 의 단언만 고쳐진 동작으로 뒤집었다 —
공격 모양 그대로 회귀 테스트로 남는다. 커밋은 하지 않았다.
