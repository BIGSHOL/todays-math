-- D-31: 문제 공용 풀. 기본 shared. 기존 행도 공용으로 본다.
CREATE TYPE "problem_pool" AS ENUM ('shared', 'private');

ALTER TABLE "problem" ADD COLUMN "pool" "problem_pool" NOT NULL DEFAULT 'shared';

CREATE INDEX "problem_pool_unit_id_review_status_direct_use_allowed_idx"
  ON "problem"("pool", "unit_id", "review_status", "direct_use_allowed");
