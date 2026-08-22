-- 대사 표시 (2026-08-21): roster 에서 사라진 연계 학생. 삭제 대신 표시 — 시험 이력 보존.
ALTER TABLE "student" ADD COLUMN "eywa_withdrawn_at" TIMESTAMP(3);
