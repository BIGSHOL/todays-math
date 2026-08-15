-- 트랙 D '오늘의 시험' — 예측기 L0(시험지 단위) + 예측 대상 결정에 필요한 컬럼.
-- 설계: docs/planning/11-score-predictor.md §3 L0, §5
--
-- ⚠️ 수기 작성. 로컬 빈 DB에 9건 전부 적용해 검증했다(2026-08-16).
-- id 에 DB 기본값을 두지 않는다 — Prisma `@default(uuid())` 는 앱에서 만든다.
-- 인덱스명은 Prisma 규칙을 따른다. 어기면 migrate diff 가 매번 drift 로 잡는다.

-- 1) 재학 학교 — '오늘의 시험'의 예측 대상을 정한다.
--    표기는 eywa school-name.ts 규칙으로 정규화해 넣는다.
ALTER TABLE "student"
  ADD COLUMN "school_name"  VARCHAR(50),
  ADD COLUMN "school_level" VARCHAR(2),
  ADD COLUMN "school_grade" INTEGER;

-- 2) 출제 형식(객관식/단답형/서술형).
--    problem_type(계산/개념/활용/서술형)과 다른 축이다.
--    mapProblemType 이 객관식을 "개념" 으로 뭉개 원본 구분이 소실돼 있었다.
ALTER TABLE "problem"
  ADD COLUMN "question_type" VARCHAR(10);

-- 3) 기출 시험지 1편.
CREATE TABLE "exam" (
  "id"               UUID         NOT NULL,
  "external_exam_id" VARCHAR(120) NOT NULL,
  "school"           VARCHAR(50)  NOT NULL,
  "level"            VARCHAR(2)   NOT NULL,
  "grade"            INTEGER      NOT NULL,
  "subject"          VARCHAR(50)  NOT NULL,
  "subject_raw"      VARCHAR(50),
  "year"             INTEGER      NOT NULL,
  "semester"         INTEGER      NOT NULL,
  "round"            VARCHAR(4)   NOT NULL,
  "total_score"      DOUBLE PRECISION NOT NULL,
  "question_count"   INTEGER      NOT NULL,
  "source_file"      VARCHAR(500),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "exam_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exam_external_exam_id_key" ON "exam"("external_exam_id");
CREATE INDEX "exam_school_level_grade_subject_year_semester_round_idx" ON "exam"("school","level","grade","subject","year","semester","round");
CREATE INDEX "exam_level_grade_subject_year_semester_round_idx" ON "exam"("level","grade","subject","year","semester","round");

-- 4) 시험지 안의 문항.
CREATE TABLE "exam_question" (
  "id"               UUID         NOT NULL,
  "exam_id"          UUID         NOT NULL,
  "number"           INTEGER      NOT NULL,
  "score"            DOUBLE PRECISION NOT NULL,
  "qtype"            VARCHAR(10)  NOT NULL,
  "difficulty_label" VARCHAR(4),
  "topic_raw"        VARCHAR(100),
  "unit_id"          UUID,
  "answer"           TEXT,
  "has_figure"       BOOLEAN      NOT NULL DEFAULT false,
  "problem_id"       UUID,
  CONSTRAINT "exam_question_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exam_question_exam_id_number_key" ON "exam_question"("exam_id","number");
CREATE INDEX "exam_question_unit_id_idx" ON "exam_question"("unit_id");

ALTER TABLE "exam_question"
  ADD CONSTRAINT "exam_question_exam_id_fkey"
  FOREIGN KEY ("exam_id") REFERENCES "exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 단원이 지워져도 문항은 남긴다 — topic_raw 원문이 있어 재매핑할 수 있다.
ALTER TABLE "exam_question"
  ADD CONSTRAINT "exam_question_unit_id_fkey"
  FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
