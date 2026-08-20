-- 문항 신고 · 검수 계정 · 해설 출처 — 검수 콘솔(17).
--
-- ✅ **적용 완료** (2026-08-20, `prisma migrate deploy`).
--    적용 전에 **롤백 검증**을 돌렸다 — `scripts/qa/verify-review-migration.ts`.
--    트랜잭션 안에서 이 SQL 을 실제로 실행하고, 제약이 나쁜 행을 **정말 막는지**까지
--    확인한 뒤 되돌린다. 텍스트로만 검사하면 장식이 된다(2026-08-18 교훈).
--    그 검증이 실제로 결함을 하나 잡았다 — 아래 `NULLS NOT DISTINCT` 를 보라.
--
-- ⚠️ 적용 순서(어기면 인쇄가 죽는다): 이 SQL → `schema.prisma` → `prisma generate`
--    (워크트리마다) → 질의·화면. 인쇄 질의가 `include: { problem: true }` 라
--    스키마에만 먼저 넣으면 컬럼 없는 DB 로 `SELECT solution_source` 를 쏜다.
--
-- 왜 필요한가: 문항이 47,049건이라 **전량 검수가 불가능하다**(한 문항 10초로도
-- 131시간). 마지막 안전망은 「쓰다가 이상하면 누른다」이고, 그 기록이 다음 검수의
-- 대기열이 된다. 그리고 해설 없음이 32,931건(70%)이라 AI 로 채울 물량이 큰데,
-- **원본 해설과 AI 해설을 안 갈라 두면 틀린 AI 해설이 「원래 그랬던 것」이 된다.**

-- ── 열거형 ────────────────────────────────────────────────────────────────
CREATE TYPE "report_reason" AS ENUM
  ('figure', 'content', 'answer', 'solution', 'unit', 'other');

CREATE TYPE "report_status" AS ENUM ('open', 'resolved', 'dismissed');

CREATE TYPE "solution_source" AS ENUM ('none', 'original', 'ai');

CREATE TYPE "user_role" AS ENUM ('director', 'reviewer');

-- ── 해설 출처 ─────────────────────────────────────────────────────────────
ALTER TABLE "problem"
  ADD COLUMN "solution_source" "solution_source" NOT NULL DEFAULT 'none';

COMMENT ON COLUMN "problem"."solution_source" IS
  '해설이 어디서 왔나. none=없다 / original=원본에 있던 것(교재·기출·자작) / ai=우리가 AI 로 만들었다. '
  'original 과 ai 를 반드시 갈라 둔다 — 안 갈라 두면 틀린 AI 해설이 「원래 그랬던 것」이 된다. '
  'AI 가 만든 해설은 사람이 「이 해설 쓴다」를 누르기 전까지 solution 에 넣지 않는다(D-22 와 같은 결).';

-- 지금 있는 값 채우기. 근거(2026-08-20 실측):
--   해설 있음 14,116 · 그중 source=ai_generated 269
--   source=transformed 이면서 origin_problem_id 가 있는(=AI 변형) 해설은 **0건**이라
--   「transformed 는 전부 RPM 교재」로 봐도 안전하다. 0 이 아니었다면 갈랐어야 한다.
UPDATE "problem"
   SET "solution_source" = 'ai'
 WHERE "solution" IS NOT NULL AND "solution" <> ''
   AND "source" = 'ai_generated';

UPDATE "problem"
   SET "solution_source" = 'original'
 WHERE "solution" IS NOT NULL AND "solution" <> ''
   AND "source" <> 'ai_generated';

-- ── 계정 역할 ─────────────────────────────────────────────────────────────
-- 기본값은 director 다. 지금까지의 사용자는 전부 원장이고, 기본값이 reviewer 면
-- **기존 계정이 조용히 권한을 잃는다.**
ALTER TABLE "user"
  ADD COLUMN "role" "user_role" NOT NULL DEFAULT 'director';

COMMENT ON COLUMN "user"."role" IS
  'director=원장(지금까지의 모든 계정) / reviewer=검수 전용. '
  'reviewer 는 문제은행을 보고 신고만 한다 — 출제·반 관리는 못 한다.';

-- ── 문항 신고 ─────────────────────────────────────────────────────────────
CREATE TABLE "problem_report" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "problem_id"      UUID NOT NULL,
  -- 신고자가 탈퇴해도 **기록은 남는다.** 지우면 「몇 건이 있었나」가 거짓이 된다.
  "reporter_id"     UUID,
  "reason"          "report_reason" NOT NULL,
  "note"            TEXT,
  "status"          "report_status" NOT NULL DEFAULT 'open',
  "resolution_note" TEXT,
  "resolved_at"     TIMESTAMPTZ,
  "resolved_by"     UUID,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "problem_report_problem_id_fkey"
    FOREIGN KEY ("problem_id") REFERENCES "problem"("id") ON DELETE CASCADE,
  CONSTRAINT "problem_report_reporter_id_fkey"
    FOREIGN KEY ("reporter_id") REFERENCES "user"("id") ON DELETE SET NULL,
  CONSTRAINT "problem_report_resolved_by_fkey"
    FOREIGN KEY ("resolved_by") REFERENCES "user"("id") ON DELETE SET NULL,

  -- 「기타」는 설명이 있어야 받는다. 사유 없는 기록은 대기열만 늘린다.
  -- 계약(problemReport.contract.ts)과 **같은 규칙을 DB 도 건다** — 한쪽만 있으면
  -- API 를 우회한 적재가 그 규칙을 그냥 지나간다.
  CONSTRAINT "problem_report_other_needs_note"
    CHECK ("reason" <> 'other' OR ("note" IS NOT NULL AND btrim("note") <> '')),

  -- 처리했으면 처리 시각이 있어야 하고, 안 했으면 없어야 한다.
  CONSTRAINT "problem_report_resolved_at_matches_status"
    CHECK (("status" = 'open') = ("resolved_at" IS NULL))
);

COMMENT ON TABLE "problem_report" IS
  '문항 신고 — 쓰다가 이상하면 누른 기록. 문항 47,049건은 전량 검수가 불가능하므로 '
  '이것이 마지막 안전망이자 다음 검수의 대기열이다. '
  '⚠️ 신고는 문항을 바꾸지 않는다 — direct_use_allowed 를 신고가 직접 건드리면 '
  '오신고 한 건이 멀쩡한 문항을 지면에서 지운다. 빼는 것은 사람이 따로 결정한다.';

-- 대기열은 「안 처리된 것을 최근순으로」 읽는다.
CREATE INDEX "problem_report_status_created_at_idx"
  ON "problem_report" ("status", "created_at" DESC);

-- 문항 화면에서 「이 문항에 신고가 있나」를 묻는다.
CREATE INDEX "problem_report_problem_id_idx"
  ON "problem_report" ("problem_id");

-- 같은 사람이 같은 문항을 같은 사유로 거듭 누르는 것은 한 건으로 본다.
-- (처리된 뒤 다시 누르는 것은 새 기록이어야 하므로 status='open' 일 때만 막는다.)
--
-- 🔴 `NULLS NOT DISTINCT` 가 **반드시** 있어야 한다. 이것이 없으면 포스트그레스는
--    유니크 인덱스에서 NULL 을 서로 다른 값으로 보아, reporter_id 가 비어 있는
--    신고는 **중복이 그냥 들어간다.** 롤백 검증에서 실제로 두 건이 들어갔다
--    (2026-08-20). 「빈 값」이 조용히 규칙을 비켜 가는 자리다.
CREATE UNIQUE INDEX "problem_report_open_unique"
  ON "problem_report" ("problem_id", "reporter_id", "reason")
  NULLS NOT DISTINCT
  WHERE "status" = 'open';
