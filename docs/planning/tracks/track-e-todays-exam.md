# 트랙 E — '오늘의 시험' (기출 예상 점수 판독기 적용)

착수 2026-08-16 · 설계 SSOT `docs/planning/11-score-predictor.md` ·
화면 확정 `05-design-system.md §8.7` (D-39~D-44)

A/B/C 트랙과 **파일·DB 컬럼이 겹치지 않는다.** 새 테이블과 새 컬럼만 쓴다.

| | 값 |
|---|---|
| **소유 파일** | `src/lib/predictor/**`, `scripts/predictor/**`, `src/contracts/predictor.contract.ts`, `src/lib/schools/**`, `scripts/qa/backfill-question-type.ts` |
| **새로 만드는 테이블** | `Exam` · `ExamQuestion` · `PredictionRun` · `ActualExamScore` · `ExamScope` |
| **새로 붙이는 컬럼** | `Student.schoolName` `schoolLevel` `schoolGrade` · `Problem.questionType` |
| **읽기만 하는 컬럼** | `Problem.externalId`(트랙 C 소유) · `Problem.score` `answer` `unitId` |

## 다른 트랙과의 접점 — 지킬 것

- 🔴 **`Problem.externalId` 는 트랙 C 소유다.** T7.6 백필은 이 값을 **조인 키로 읽기만** 한다.
  값을 고치지 않는다. 트랙 C가 externalId 를 바꾸면 백필을 다시 돌리면 된다(멱등).
- 🔴 **`Problem.score` 를 덮어쓰지 않는다.** 배점 보정(11 §10)은 시험지 쪽에만 싣는다.
  덮어쓰면 학습 코퍼스가 오염된다.
- 🔴 `answer` · `figureUrls` · `figureSource` 는 **읽지도 쓰지도 않는다**(A·B 트랙 소유).
- `prisma/schema.prisma` 와 마이그레이션은 **트랙 E가 한 번에** 바꾼다. 셋으로 나누면
  마이그레이션이 3중 충돌한다.

## 태스크

| ID | 내용 | RED 기준 |
|---|---|---|
| T7.3 | `Exam`/`ExamQuestion` + 추출 JSON 적재기 | 같은 파일을 2회 적재해도 행 수 불변(externalExamId 멱등) |
| T7.5 | 학교명 정규화(eywa SSOT 이식) + `Student.school*` | "경명여자중학교" 순서 의존 + eywa 매칭률 99% 회귀 |
| T7.6 | `Problem.questionType` 백필(externalId 재조인) | 백필 후 객관식/단답형/서술형 3값 존재, 서술형 건수 불변 |
| T7.7 | `PredictionRun` + 예측 API | 컷오프 이후 시험지를 넣으면 422 (누출 차단) |
| T7.9 | 예측 문제지 + **배점 보정기** | 기출+자작 혼합 시험지의 만점이 정확히 100.0 |
| T7.10 | `ActualExamScore` + 잔차 저장 | 같은 run 에 두 번 붙이면 갱신(중복 아님) |
| T7.11 | 환산 계수 추정 | **표본 부족이면 `judgementUnavailable` 반환** — 점수를 지어내지 않는다 |
| T7.14 | 화면 (계기판·회차 상세) | RTL + D-30 어포던스 스캐너 통과 |

## 공통 규칙

README.md 의 공통 규칙 9개를 그대로 따른다. 특히:
- 공유 DB 쓰기는 `--apply` + `ALLOW_SHARED_IMPORT=1` 둘 다 있을 때만.
- 원본 저장소(`F:\시험지변환기`, eywa, N드라이브)는 읽기 전용.
- 마치기 전 `npm run type-check` · `npm test` · `npm run lint`.

## 지난 회차 교훈 (이 트랙에서 실제로 겪은 것)

- **지표가 나쁠 때 모델부터 손대지 마라.** 단원 거리 0.84 의 가장 큰 몫은 모델이 아니라
  **지표 계산의 오염**이었다(라벨 없는 문항을 한 칸으로 세고 있었다). 0.84 → 0.59.
- **파생 산출물을 워크트리 간에 복사하지 마라.** 낡은 `final-pairs.json` 을 복사해 와
  279편 중 271편의 학년이 날아갔다. 재생성이 원칙이다.
- **합산 목적함수 하나로 파라미터를 고르면 어떤 항목은 조용히 나빠진다.**
  항목별로 홀드아웃을 보고, 나빠지는 항목이 있으면 변경을 쪼개서 채택한다.
