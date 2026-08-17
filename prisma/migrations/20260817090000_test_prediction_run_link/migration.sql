-- 예측 문제지 ↔ 회차 연결 — Test.prediction_run_id (15 §B).
--
-- 이 한 컬럼이 세 결함을 닫는다:
--  1. 예측 문제지 구분 — testType 이 "review" 라 일반 확인테스트와 구분되지 않았고,
--     배점 유무라는 간접 신호로 가드를 걸고 있었다
--  2. 계기판 파이프라인의 문제지·채점 단계 — 데이터 원천이 없어 항상 미완이었다
--  3. 반쪽 시험지 차단 — 확정 시 회차 청사진의 문항 수와 대조할 근거가 없었다
--
-- 회차 삭제 시 SET NULL — 인쇄물이 이미 나갔을 수 있어 시험지는 남긴다.
-- 추가 전용이라 기존 행 영향 없음(프로덕션 예측 문제지 0건 확인, 2026-08-17).
-- ⚠️ 수기 헤더 + `prisma migrate diff` 산출. 로컬 빈 DB 전수 적용으로 검증한다.

-- AlterTable
ALTER TABLE "test" ADD COLUMN     "prediction_run_id" UUID;

-- CreateIndex
CREATE INDEX "test_prediction_run_id_idx" ON "test"("prediction_run_id");

-- AddForeignKey
ALTER TABLE "test" ADD CONSTRAINT "test_prediction_run_id_fkey" FOREIGN KEY ("prediction_run_id") REFERENCES "prediction_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
