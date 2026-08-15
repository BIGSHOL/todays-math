-- v2 "오늘의 시험"(기출 예상 점수 판독기) T7.1 — 학생 응시 결과 데이터 모델.
-- 참조: docs/planning/11-score-predictor.md §1
--
-- ⚠️ 이 migration.sql은 이 워크트리에서 로컬 Postgres(Docker)에 접속할 수 없어
--    `prisma migrate dev`로 자동 생성하지 못했다 — schema.prisma를 SSOT로 두고
--    기존 migration.sql(20260813014714_init 등)의 CREATE TABLE 스타일을 그대로 따라
--    수기로 작성했다. DB 연결 가능한 환경에서 `npx prisma migrate dev`를 한 번
--    실행해 Prisma가 실제로 이 SQL과 동일한 결과를 만드는지 확인이 필요하다(완료 보고 참조).

-- CreateTable
CREATE TABLE "test_result" (
    "id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "taken_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" DOUBLE PRECISION NOT NULL,
    "predicted_score" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problem_answer" (
    "id" UUID NOT NULL,
    "test_result_id" UUID NOT NULL,
    "problem_id" UUID NOT NULL,
    "selected_choice" INTEGER,
    "essay_score" DOUBLE PRECISION,
    "is_correct" BOOLEAN NOT NULL,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "problem_answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_report" (
    "id" UUID NOT NULL,
    "test_result_id" UUID NOT NULL,
    "total_score" DOUBLE PRECISION NOT NULL,
    "predicted_score" DOUBLE PRECISION NOT NULL,
    "unit_scores" JSONB NOT NULL,
    "difficulty_distribution" JSONB NOT NULL,
    "recommended_units" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "test_result_test_id_student_id_taken_at_idx" ON "test_result"("test_id", "student_id", "taken_at");

-- CreateIndex
CREATE INDEX "problem_answer_test_result_id_sequence_idx" ON "problem_answer"("test_result_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_report_test_result_id_key" ON "analysis_report"("test_result_id");

-- AddForeignKey
ALTER TABLE "test_result" ADD CONSTRAINT "test_result_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_result" ADD CONSTRAINT "test_result_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_answer" ADD CONSTRAINT "problem_answer_test_result_id_fkey" FOREIGN KEY ("test_result_id") REFERENCES "test_result"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_answer" ADD CONSTRAINT "problem_answer_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_report" ADD CONSTRAINT "analysis_report_test_result_id_fkey" FOREIGN KEY ("test_result_id") REFERENCES "test_result"("id") ON DELETE CASCADE ON UPDATE CASCADE;
