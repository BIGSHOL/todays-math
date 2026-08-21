-- 진도 동기화 멱등 키 (2026-08-21).
-- 전량 재동기화가 기본이라(증분 기준이 없다 — 보고서의 85.6% 가 수업일 이틀 뒤
-- 이후 작성) 이 unique 가 없으면 돌릴 때마다 같은 진도가 또 쌓인다.
ALTER TABLE "progress" ADD COLUMN "eywa_report_id" UUID;
CREATE UNIQUE INDEX "progress_eywa_report_id_unit_id_key" ON "progress"("eywa_report_id", "unit_id");
