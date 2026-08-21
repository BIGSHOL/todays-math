-- D-64 (2026-08-21): 학생별 일일 확인테스트 화면의 상태 데이터.
-- ① 마지막 수업보고서 날짜·원문 — 시험기간만 적힌 날은 진도 행이 없어서,
--    «오늘 수업했는데 자동 출제에서 빠진 학생»은 이 둘로만 보인다.
ALTER TABLE "student" ADD COLUMN "eywa_last_report_date" DATE;
ALTER TABLE "student" ADD COLUMN "eywa_last_report_text" TEXT;

-- ② 동기화 실행 기록 — 화면의 「마지막 동기화」 스트립용 (원장 파일은 웹서버가 못 읽는다).
CREATE TABLE "eywa_sync_run" (
    "id" UUID NOT NULL,
    "ran_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transport" VARCHAR(8) NOT NULL,
    "students" INTEGER NOT NULL,
    "classes" INTEGER NOT NULL,
    "progress_rows" INTEGER NOT NULL,
    "unresolved_lines" INTEGER NOT NULL,
    "ambiguous" INTEGER NOT NULL,
    "exam_only" INTEGER NOT NULL,
    CONSTRAINT "eywa_sync_run_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "eywa_sync_run_ran_at_idx" ON "eywa_sync_run"("ran_at");
