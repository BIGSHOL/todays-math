-- T3.0 / D-26: RPM 원본 직접 출제 잠금
ALTER TABLE "problem" ADD COLUMN "direct_use_allowed" BOOLEAN NOT NULL DEFAULT true;

DROP INDEX IF EXISTS "problem_unit_id_difficulty_review_status_idx";

CREATE INDEX "problem_unit_id_difficulty_review_status_direct_use_allowed_idx"
  ON "problem"("unit_id", "difficulty", "review_status", "direct_use_allowed");
