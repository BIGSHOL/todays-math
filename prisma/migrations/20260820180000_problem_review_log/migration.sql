-- 검수 기록 — 「사람이 이 문항을 보고 무엇이라 했나」 (검수 콘솔 4/n).
--
-- 🔴 **왜 `problem.review_status` 로 안 하나.**
--    그 컬럼이 적는 것은 「출제 자격」이지 「사람이 봤음」이 아니다. 이관 적재가
--    문항을 전부 `approved` 로 넣는다(`src/lib/import/toLoadRows.ts`) — 실측
--    approved 44,9xx건 대부분이 **아무도 안 본 것**이다. 그걸 「봤다」로 읽으면
--    대기열이 시작부터 거의 비어 보인다.
--    (2026-08-19 에 똑같이 당했다: 「직전 확인테스트」를 테이블에 행이 있는가로
--     읽었더니 **버린 초안**까지 시험으로 세어졌다. 기록을 쓰기 전에 그 테이블이
--     무엇을 적는 곳인지부터 묻는다.)
--
-- 🔴 **덧붙이기만 한다(append-only).** 같은 문항을 다시 봐도 앞 기록을 안 지운다 —
--    「전에는 통과라 했는데 지금은 아니다」가 남아야 판정 규칙을 나중에 검산할 수 있다.
--
-- ⚠️ 신고는 여기 verdict='defect' 로 남고, 실제 사유·설명은 `problem_report` 에 있다.
--    둘을 한 테이블에 합치지 않는다 — 「몇 건 신고됐나」가 「몇 건 봤나」에 섞이면
--    두 숫자가 다 못 쓰게 된다.

CREATE TYPE "review_verdict" AS ENUM ('pass', 'unsure', 'defect');

CREATE TABLE "problem_review_log" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "problem_id"  UUID NOT NULL,
  -- 검수자가 탈퇴해도 **기록은 남는다.** 지우면 「몇 건 봤나」가 거짓이 된다.
  "reviewer_id" UUID,
  "verdict"     "review_verdict" NOT NULL,
  "note"        TEXT,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "problem_review_log_problem_id_fkey"
    FOREIGN KEY ("problem_id") REFERENCES "problem"("id") ON DELETE CASCADE,
  CONSTRAINT "problem_review_log_reviewer_id_fkey"
    FOREIGN KEY ("reviewer_id") REFERENCES "user"("id") ON DELETE SET NULL
);

COMMENT ON TABLE "problem_review_log" IS
  '검수 기록 — 사람이 문항을 보고 내린 판정. pass=통과 / unsure=판단 못 하겠다 / defect=신고. '
  '⚠️ problem.review_status 와 다른 것을 적는다: 그쪽은 «출제 자격», 이쪽은 «사람이 봤음». '
  '이관 적재가 문항을 전부 approved 로 넣으므로 그 컬럼으로는 «봤나»를 물을 수 없다. '
  '덧붙이기만 한다 — 다시 봐도 앞 기록을 안 지운다.';

COMMENT ON COLUMN "problem_review_log"."verdict" IS
  'unsure 를 정식 결과로 둔다. 해설 없음이 32,931건(70%)이라 답을 검산할 수 없는 문항이 '
  '많은데, «통과/신고» 둘만 두면 확인 못 한 것에 통과를 누르게 되고 기록 전체가 잡음이 된다.';

-- 대기열이 「내가 아직 안 본 것」을 묻는다. 이 인덱스가 그 질의를 받는다.
CREATE INDEX "problem_review_log_reviewer_problem_idx"
  ON "problem_review_log" ("reviewer_id", "problem_id");

-- 「오늘 몇 건 봤나」·「최근에 무엇을 봤나」.
CREATE INDEX "problem_review_log_created_at_idx"
  ON "problem_review_log" ("created_at" DESC);

CREATE INDEX "problem_review_log_problem_id_idx"
  ON "problem_review_log" ("problem_id");
