-- 원본 역추적 메타데이터 (docs/planning/08-import-ledger.md)
-- 추출기는 이 값들을 갖고 있었으나 적재 단계가 버려, 훼손·그림 문항을
-- 원본 시험지로 되짚을 수 없었다. external_id 는 재이관 멱등 키다.
ALTER TABLE "problem"
  ADD COLUMN "external_id" VARCHAR(120),
  ADD COLUMN "source_file" VARCHAR(500),
  ADD COLUMN "school" VARCHAR(50),
  ADD COLUMN "subject" VARCHAR(50),
  ADD COLUMN "exam_id" VARCHAR(120),
  ADD COLUMN "question_number" INTEGER,
  ADD COLUMN "score" DOUBLE PRECISION;

-- NULL 은 중복 허용(Postgres) — 메타데이터 없는 기존 행에 영향 없음
CREATE UNIQUE INDEX "problem_external_id_key" ON "problem"("external_id");
