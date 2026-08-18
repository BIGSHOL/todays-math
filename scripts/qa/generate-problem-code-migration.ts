/**
 * 문항 코드 마이그레이션 SQL 을 **만든다** (D-53).
 *
 *   npx tsx scripts/qa/generate-problem-code-migration.ts          # 대조만 (기본)
 *   npx tsx scripts/qa/generate-problem-code-migration.ts --write  # 파일에 쓴다
 *
 * **왜 손으로 안 쓰나**: 단원 코드 735줄을 손으로 옮기면 오탈자가 난다. 더 중요한 것은,
 * 코드 만드는 규칙이 SQL 에도 한 벌 생기면 **둘이 갈라져도 아무도 모른다**는 것이다
 * (CLAUDE.md 2026-08-18 「목록을 손으로 쓰면 세는 쪽과 고치는 쪽이 같이 눈이 먼다」).
 * 그래서 SQL 에는 규칙이 아니라 규칙의 **산출물**만 넣고, 규칙은
 * `src/lib/problemCode.ts` 한 곳에 둔다. 둘이 같은지는
 * `src/__tests__/unit/problemCode.test.ts` 가 매번 대조한다.
 *
 * ⚠️ **적용된 뒤에는 다시 만들지 마라.** 파일이 한 글자만 바뀌어도 Prisma 체크섬이
 *    달라져 `migrate status` 가 「수정됨」으로 잡는다. 규칙이 바뀌면 이 파일을 고치는 게
 *    아니라 **새 마이그레이션**을 쓴다 — 이미 부여된 코드는 스냅샷이라 바뀌지 않는다.
 */
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { CURRICULUM_UNITS } from "../../prisma/seed-data/units";
import {
  PROBLEM_CODE_ALPHABET,
  PROBLEM_CODE_PATTERN,
  PROBLEM_CODE_SUFFIX_LENGTH,
} from "../../src/contracts/problemCode.contract";
import { renderUnitCodePrefixSql } from "../../src/lib/problemCode";

export const MIGRATION_PATH = join(
  process.cwd(),
  "prisma/migrations/20260818210000_problem_code/migration.sql",
);

export function buildMigrationSql(): string {
  const values = renderUnitCodePrefixSql(CURRICULUM_UNITS);
  return `-- 문항 코드 (D-53, 원장님 확정 2026-08-18) — 문항마다 «저장된» 짧은 코드 하나.
--
--     초·중   J31402-K7M2     J=중 · 3=학년 · 14=대단원 · 02=소단원 · 무작위4
--     고등    HC10305-Q4XZ    학년 자리에 과목 코드 2자
--
-- 왜 컬럼인가: 원장님이 화면·대화에서 문항을 **지목**할 값이다. 지금은 그럴 값이 없다 —
-- \`id\` 는 36자 uuid, \`external_id\` 는 4.4% 가 비어 있고 지면에 찍으면 학교·연도가
-- 드러난다(id-scheme-review §2.4). 그래서 새 컬럼 하나를 둔다.
--
-- ⚠️ **파생이 아니라 저장이다.** 뜻 부분(학교급·학년·대단원·소단원)은 **부여 당시의
--    스냅샷**이고 진실은 언제나 \`unit_id\` 컬럼이다. 다시 계산하면 단원 재배정(관측
--    149건)·교육과정 시드 변경 때 원장님이 적어 둔 코드가 **다른 문항을 가리킨다.**
--    그래서 부여는 BEFORE **INSERT** 트리거뿐이고, 아래 \`problem_code_freeze\` 가
--    한 번 붙은 코드의 변경을 막는다.
--
-- 되돌리기 — 순수 추가라 기존 데이터를 한 바이트도 안 건드린다:
--
--     DROP TRIGGER IF EXISTS "problem_code_assign" ON "problem";
--     DROP TRIGGER IF EXISTS "problem_code_freeze" ON "problem";
--     DROP FUNCTION IF EXISTS "problem_code_assign"(), "problem_code_freeze"(),
--                             "problem_code_next"(uuid), "problem_code_suffix"();
--     ALTER TABLE "problem" DROP COLUMN "problem_code";
--     ALTER TABLE "unit"    DROP COLUMN "problem_code_prefix";
--
--   (컬럼을 드롭하면 딸린 인덱스·CHECK 도 같이 사라진다. 이미 종이·대화에 나간 코드를
--    되살려야 하면 \`scripts/qa/reports/problem-code-ledger.json.gz\` 로 복원한다.)
--
-- ⚠️ 이 파일은 \`scripts/qa/generate-problem-code-migration.ts\` 의 **산출물**이다.
--    규칙(\`src/lib/problemCode.ts\`)과 글자까지 같은지 테스트가 대조한다. 손으로 고치지 말 것.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. 단원 코드 — 코드의 «뜻» 부분은 오직 \`unit\` 행의 함수다
-- ═══════════════════════════════════════════════════════════════════════
-- 문항은 뜻 부분에 아무것도 보태지 않는다. 그래서 여기 한 번 계산해 두고,
-- 문항 부여는 \`prefix || '-' || 무작위4\` 로 끝난다 — SQL 에 규칙이 생기지 않는다.
--
-- 번호 세는 법이 **부류마다 다르다**(실측 2026-08-18, 전량 조회):
--   · 중·고 대단원은 \`1. 실수와 그 계산\` 이라 **앞 숫자**를 쓴다.
--   · 초등은 \`1-1 9까지의 수\` 가 «학년-학기»라 앞 숫자를 쓰면 초1 의 다섯 대단원이
--     전부 01 로 뭉개진다. 그래서 초등만 \`order_index\` 순번으로 센다.
--   · 소단원은 대단원 안에서의 순번. 최대 32개(공통수학1 「2. 방정식과 부등식」) → 2자리.
ALTER TABLE "unit" ADD COLUMN "problem_code_prefix" VARCHAR(8);

-- 아래 목록은 규칙의 산출물이다. \`grade\` 를 같이 실어 대조한다 — 시드와 DB 의
-- \`order_index\` 가 어긋나 있으면 붙지 않고, 바로 다음 검사가 **멈춘다**.
UPDATE "unit" AS u
   SET "problem_code_prefix" = v.prefix
  FROM (VALUES
${values}
  ) AS v(order_index, grade, prefix)
 WHERE u."order_index" = v.order_index
   AND u."grade" = v.grade;

DO $do$
DECLARE missing int;
BEGIN
  SELECT count(*) INTO missing FROM "unit" WHERE "problem_code_prefix" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION '[문항 코드] 코드가 안 붙은 단원이 %건 있다. 이 DB 의 unit 이 prisma/seed-data/units.ts 와 다르다 — 마이그레이션을 멈춘다.', missing;
  END IF;
END
$do$;

-- 빈 DB(마이그레이션이 시드보다 먼저 도는 자리)에서는 0행이라 그대로 지난다.
ALTER TABLE "unit" ALTER COLUMN "problem_code_prefix" SET NOT NULL;
CREATE UNIQUE INDEX "unit_problem_code_prefix_key" ON "unit"("problem_code_prefix");

-- ═══════════════════════════════════════════════════════════════════════
-- 2. 문항 코드 컬럼
-- ═══════════════════════════════════════════════════════════════════════
-- 길이: 고등이 최장 \`HC10305-Q4XZ\` 12자. VarChar(16)은 여유.
ALTER TABLE "problem" ADD COLUMN "problem_code" VARCHAR(16);
CREATE UNIQUE INDEX "problem_problem_code_key" ON "problem"("problem_code");

-- 형식 — src/contracts/problemCode.contract.ts 의 PROBLEM_CODE_PATTERN 을 그대로 옮겼다.
-- (테스트가 둘이 같은 문자열인지 대조한다. 한쪽만 고치면 빨개진다.)
-- NULL 은 CHECK 를 통과한다 — 백필 전 기존 행을 위해서다. 「있어야 한다」는 아래 제약이 본다.
ALTER TABLE "problem" ADD CONSTRAINT "problem_problem_code_format"
  CHECK ("problem_code" ~ '${PROBLEM_CODE_PATTERN}');

-- 「코드 없는 문항은 없다」 — NOT VALID 라 **기존 행은 안 보고 새 행만 본다.**
-- 백필이 끝나면 scripts/qa/backfill-problem-code.ts --apply 가 VALIDATE 한다.
-- 이 제약이 있으면 훗날 누가 트리거를 지워도 INSERT 가 **조용히 NULL 을 넣지 못하고 멈춘다.**
ALTER TABLE "problem" ADD CONSTRAINT "problem_problem_code_present"
  CHECK ("problem_code" IS NOT NULL) NOT VALID;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. 무작위 4자
-- ═══════════════════════════════════════════════════════════════════════
-- 글자 집합은 계약(PROBLEM_CODE_ALPHABET)과 같은 한 벌이다 — 헷갈리는 \`0 O 1 I l\` 을 뺀 32자.
-- 32 = 2^5 이라 치우침이 없다.
--
-- ⚠️ \`random()\` 을 쓴다(\`gen_random_bytes()\` 도 이 DB 에 있다 — pgcrypto 1.3 확인).
--    이유: \`setseed()\` 로 **같은 값을 두 번 뽑게 만들 수 있어서** 「충돌하면 정말 다시
--    뽑는가」를 실제 DB 에서 시험할 수 있다(scripts/qa/verify-problem-code-wiring.ts).
--    시험할 수 없는 가드는 장식이다. 이 코드는 비밀이 아니라 **표시용 식별자**라
--    예측 불가능성이 필요 없다 — 필요해지면 gen_random_bytes 로 바꾸면 된다.
CREATE OR REPLACE FUNCTION "problem_code_suffix"() RETURNS text
LANGUAGE plpgsql VOLATILE AS $fn$
DECLARE
  alphabet CONSTANT text := '${PROBLEM_CODE_ALPHABET}';
  result text := '';
  i int;
BEGIN
  FOR i IN 1..${PROBLEM_CODE_SUFFIX_LENGTH} LOOP
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  END LOOP;
  RETURN result;
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. 코드 하나 만들기 — 충돌하면 다시 뽑는다
-- ═══════════════════════════════════════════════════════════════════════
-- 트리거도 백필도 **이 함수 하나**를 부른다. 두 벌이 되지 않게.
CREATE OR REPLACE FUNCTION "problem_code_next"(p_unit_id uuid) RETURNS varchar
LANGUAGE plpgsql VOLATILE AS $fn$
DECLARE
  v_prefix text;
  v_code   text;
  v_tries  CONSTANT int := 20;
  i int;
BEGIN
  SELECT u."problem_code_prefix" INTO v_prefix FROM "unit" u WHERE u."id" = p_unit_id;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION '[문항 코드] 단원 % 에 problem_code_prefix 가 없다. 새 단원을 넣었다면 prisma/seed.ts 처럼 코드를 같이 넣어라.', p_unit_id;
  END IF;

  FOR i IN 1..v_tries LOOP
    v_code := v_prefix || '-' || "problem_code_suffix"();
    PERFORM 1 FROM "problem" p WHERE p."problem_code" = v_code;
    IF NOT FOUND THEN
      RETURN v_code;
    END IF;
  END LOOP;

  -- 여기까지 오면 그 단원 자리(32^4 = 1,048,576)가 사실상 찼다는 뜻이다.
  -- 조용히 아무 코드나 넣지 않고 멈춘다 — 겹친 코드는 다른 문항을 가리킨다.
  RAISE EXCEPTION '[문항 코드] % 자리에서 % 번 뽑았는데 전부 겹쳤다. 무작위 자릿수를 늘려야 한다.', v_prefix, v_tries;
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. 부여 — **모든 경로**가 자동으로 받는다
-- ═══════════════════════════════════════════════════════════════════════
-- 앱 라우트 3곳·적재 스크립트 3곳·시드·E2E·psql 을 각각 고치는 방식은 **또 한 곳을
-- 빠뜨린다**(오늘 그림 치수에서 이미 그랬다 — 적대적 리뷰 ④ §C). 그래서 부여 지점을
-- 테이블에 둔다. 여기를 지나지 않고 problem 에 행이 들어갈 방법은 없다.
CREATE OR REPLACE FUNCTION "problem_code_assign"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  -- 명시된 코드는 존중한다(백필 되돌림·복원). 형식·유일성은 위의 제약이 본다.
  IF NEW."problem_code" IS NULL THEN
    NEW."problem_code" := "problem_code_next"(NEW."unit_id");
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS "problem_code_assign" ON "problem";
CREATE TRIGGER "problem_code_assign"
  BEFORE INSERT ON "problem"
  FOR EACH ROW EXECUTE FUNCTION "problem_code_assign"();

-- ═══════════════════════════════════════════════════════════════════════
-- 6. 불변 — 한 번 붙은 코드는 못 바꾼다
-- ═══════════════════════════════════════════════════════════════════════
-- 「코드를 단원과 맞춰 주는」 선의의 수리를 **DB 가 거절한다.** 이게 없으면 언젠가
-- 누가 UPDATE 로 코드를 «고쳐» 놓고, 원장님이 적어 둔 코드가 다른 문항을 가리킨다.
-- NULL → 값(백필)은 허용한다. 값 → 다른 값, 값 → NULL 은 막는다.
CREATE OR REPLACE FUNCTION "problem_code_freeze"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD."problem_code" IS NOT NULL THEN
    RAISE EXCEPTION '[문항 코드] 이미 붙은 코드는 못 바꾼다: % → % (문항 %). 코드는 파생이 아니라 저장이다(D-53).',
      OLD."problem_code", COALESCE(NEW."problem_code", '(비움)'), OLD."id";
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS "problem_code_freeze" ON "problem";
CREATE TRIGGER "problem_code_freeze"
  BEFORE UPDATE ON "problem"
  FOR EACH ROW WHEN (OLD."problem_code" IS DISTINCT FROM NEW."problem_code")
  EXECUTE FUNCTION "problem_code_freeze"();
`;
}

function main() {
  const sql = buildMigrationSql();
  const write = process.argv.includes("--write");
  const exists = existsSync(MIGRATION_PATH);
  const current = exists ? readFileSync(MIGRATION_PATH, "utf8") : "";
  const same = current.replaceAll("\r", "") === sql;

  if (write) {
    mkdirSync(dirname(MIGRATION_PATH), { recursive: true });
    writeFileSync(MIGRATION_PATH, sql, "utf8");
    console.log(`${exists ? "덮어씀" : "새로 씀"}: ${MIGRATION_PATH}`);
  } else if (!exists) {
    console.log("아직 없다. `--write` 로 만들어라.");
    process.exitCode = 1;
  } else if (!same) {
    console.log("⚠️ 커밋된 SQL 이 지금 규칙과 다르다.");
    process.exitCode = 1;
  } else {
    console.log("같다.");
  }

  console.log(
    "  체크섬(Prisma 방식, CR 제거 후 sha256):",
    createHash("sha256").update(sql).digest("hex"),
  );
  console.log(`  줄 수 ${sql.split("\n").length} · ${sql.length}자`);
}

if (process.argv[1]?.endsWith("generate-problem-code-migration.ts")) main();
