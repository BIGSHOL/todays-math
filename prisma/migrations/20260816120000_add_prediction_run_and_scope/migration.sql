-- 트랙 E '오늘의 시험' 보정 루프 — 예측 스냅샷 · 실측 점수 · 시험범위 · 조정 배점.
-- 설계: docs/planning/11-score-predictor.md §3 L5, §5, §10
--
-- ⚠️ 수기 헤더 + `prisma migrate diff` 산출. 로컬 빈 DB에 전수 적용해 검증한다.
-- id 에 DB 기본값을 두지 않는다 — Prisma `@default(uuid())` 는 앱에서 만든다.
-- 인덱스명은 Prisma 규칙 그대로 둔다. 어기면 migrate diff 가 매번 drift 로 잡는다.
--
-- 이 마이그레이션은 **트랙 E가 한 번에** 낸다. T7.7/T7.9/T7.10/T7.11 을 병렬로
-- 나눠 각자 마이그레이션을 내면 3중 충돌한다(tracks/track-e-todays-exam.md).

-- AlterTable
ALTER TABLE "test_problem" ADD COLUMN     "score" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "prediction_run" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "engine_version" VARCHAR(40) NOT NULL,
    "school" VARCHAR(50) NOT NULL,
    "level" VARCHAR(2) NOT NULL,
    "grade" INTEGER NOT NULL,
    "subject" VARCHAR(50) NOT NULL,
    "target_year" INTEGER NOT NULL,
    "target_semester" INTEGER NOT NULL,
    "target_round" VARCHAR(4) NOT NULL,
    "cutoff_year" INTEGER NOT NULL,
    "cutoff_semester" INTEGER NOT NULL,
    "cutoff_round" VARCHAR(4) NOT NULL,
    "input_exam_ids" TEXT[],
    "params" JSONB NOT NULL,
    "predicted_blueprint" JSONB,
    "predicted_scores" JSONB NOT NULL,
    "actual_school_mean" DOUBLE PRECISION,
    "actual_school_stdev" DOUBLE PRECISION,
    "actual_recorded_at" TIMESTAMP(3),

    CONSTRAINT "prediction_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actual_exam_score" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "actual_score" DOUBLE PRECISION NOT NULL,
    "predicted_score" DOUBLE PRECISION NOT NULL,
    "residual" DOUBLE PRECISION NOT NULL,
    "interval_hit" BOOLEAN NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "actual_exam_score_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_scope" (
    "id" UUID NOT NULL,
    "school" VARCHAR(50) NOT NULL,
    "level" VARCHAR(2) NOT NULL,
    "grade" INTEGER NOT NULL,
    "subject" VARCHAR(50) NOT NULL,
    "year" INTEGER NOT NULL,
    "semester" INTEGER NOT NULL,
    "round" VARCHAR(4) NOT NULL,
    "unit_ids" UUID[],
    "confirmed_at" TIMESTAMP(3),
    "note" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_scope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prediction_run_school_level_grade_subject_target_year_targe_idx" ON "prediction_run"("school", "level", "grade", "subject", "target_year", "target_semester", "target_round");

-- CreateIndex
CREATE INDEX "prediction_run_engine_version_created_at_idx" ON "prediction_run"("engine_version", "created_at");

-- CreateIndex
CREATE INDEX "actual_exam_score_student_id_recorded_at_idx" ON "actual_exam_score"("student_id", "recorded_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "actual_exam_score_run_id_student_id_key" ON "actual_exam_score"("run_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_scope_school_level_grade_subject_year_semester_round_key" ON "exam_scope"("school", "level", "grade", "subject", "year", "semester", "round");

-- AddForeignKey
ALTER TABLE "actual_exam_score" ADD CONSTRAINT "actual_exam_score_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "prediction_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actual_exam_score" ADD CONSTRAINT "actual_exam_score_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

