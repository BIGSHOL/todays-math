-- 예측이 없어도 실점수를 받을 수 있게 한다 — 보정 루프의 입구를 여는 마이그레이션.
--
-- 왜: `PredictionRun.predictedScores` 는 지금 항상 빈 배열이다(학생 개인 예상 점수는
-- 능력 추정 §3 L3 이 없어 못 낸다). 그런데 실측 저장이 "이 회차의 예측 대상인가"를 그
-- 빈 배열로 판정해 **어떤 학생도 통과하지 못했다.** ActualExamScore 에 0건이 쌓이고
-- 보정 계수는 영원히 "표본 부족"이 된다. 적대적 리뷰 2개 세션이 독립적으로 재현했다.
--
-- 실제 결과는 언제나 근거다. 예측을 못 냈다는 것과 실제 점수를 못 받는다는 것은 다른
-- 문제다. 예측이 없으면 잔차를 **지어내지 않고 NULL** 로 둔다 — 나중에 개인 예측이
-- 가능해지면 그때부터 잔차가 쌓이고, 그전에도 실제 점수는 남아 있다.
--
-- ⚠️ 수기 헤더 + `prisma migrate diff` 산출. 로컬 빈 DB 에 전수 적용해 검증한다.
--    널 허용을 **넓히는** 방향이라 기존 행에 영향이 없다(현재 0행인 것도 확인했다).

-- AlterTable
ALTER TABLE "actual_exam_score" ALTER COLUMN "predicted_score" DROP NOT NULL,
ALTER COLUMN "residual" DROP NOT NULL;
