-- 트랙 E 병합 후 보강 — 병렬 세션 4개가 보고한 스키마 결함 3건을 한 번에 닫는다.
-- 근거: docs/planning/tracks/reports/{t7.7-prediction-api,t7.10-calibration}.md
--
-- 1) prediction_run.user_id — 소유자 컬럼이 없어 params JSON 에 임시로 싣고 있었다.
--    메모리 필터라 목록에 페이지네이션을 붙일 수 없었고 인덱스도 못 걸었다.
-- 2) prediction_run.risk_flags — "근거가 없어 청사진을 못 만들었다"는 run 단위 사실인데
--    담을 자리가 없어 역시 params JSON 에 있었다.
-- 3) actual_exam_score 예측 구간 스냅샷 — 없으면 점수 정정 시 interval_hit 만
--    run 의 현재 Json 으로 다시 판정돼 점수 스냅샷과 어긋난다.
--
-- prediction_run.user_id 를 NOT NULL 로 두는 근거: 공유 DB 에서 세 테이블 모두
-- 행 수 0 을 확인했다(2026-08-16). 기존 행이 없으니 기본값이 필요 없다.
--
-- ⚠️ 수기 헤더 + `prisma migrate diff` 산출. 로컬 빈 DB 에 전수 적용해 검증한다.

-- AlterTable
ALTER TABLE "actual_exam_score" ADD COLUMN     "predicted_coverage" DOUBLE PRECISION,
ADD COLUMN     "predicted_lower" DOUBLE PRECISION,
ADD COLUMN     "predicted_upper" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "prediction_run" ADD COLUMN     "exam_date" DATE,
ADD COLUMN     "risk_flags" TEXT[],
ADD COLUMN     "user_id" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "prediction_run_user_id_created_at_idx" ON "prediction_run"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "prediction_run" ADD CONSTRAINT "prediction_run_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

