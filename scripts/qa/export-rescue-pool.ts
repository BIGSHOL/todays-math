/**
 * 트랙 «HWP 회수» — 공유 DB 스냅샷 (**읽기 전용 · 한 건도 쓰지 않는다**, D-31).
 *
 *   npx tsx scripts/qa/export-rescue-pool.ts
 *
 * 출력
 *   scripts/qa/reports/rescue-pool.jsonl    출제 가능 풀 전량 (분모)
 *   scripts/qa/reports/rescue-align.jsonl   추출한 편의 **모든** past_exam 행 (정렬 닻)
 *   scripts/qa/reports/rescue-pool-meta.json  읽은 시각·건수 = 이 측정의 분모 지문
 *
 * ## 왜 두 벌인가
 *
 * 판정·분모는 **풀**에서 나온다(`findEligibleProblems` 의 where 절 그대로).
 * 그런데 편 정렬의 닻은 풀 밖 행도 써야 한다 — 승인 안 된 행·정답 없는 행을 빼고
 * 정렬하면 닻이 성긴 편에서 오프셋이 흔들린다. **정렬 입력과 판정 입력은 다르다.**
 *
 * ## 분모 지문
 *
 * 공유 DB 는 조사 도중에도 움직인다(앞 트랙 실측: 한 시간에 44,125 → 44,396).
 * 그래서 «몇 건이었나»를 파일에 박아 둔다. 보고서의 모든 비율이 이 수를 분모로 쓴다.
 */
import fs from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const POOL = "scripts/qa/reports/rescue-pool.jsonl";
const ALIGN = "scripts/qa/reports/rescue-align.jsonl";
const META = "scripts/qa/reports/rescue-pool-meta.json";
const HWP_DIR = "scripts/qa/reports/hwp-latex";

const prisma = new PrismaClient();

interface PoolRow {
  id: string;
  content: string;
  answer: string;
  figureUrls: string[];
  questionType: string | null;
  source: string;
  sourceFile: string | null;
  school: string | null;
  questionNumber: number | null;
  unitId: string | null;
  examId: string | null;
  externalId: string | null;
  score: number | null;
  problemType: string;
}

async function main(): Promise<void> {
  fs.mkdirSync(path.dirname(POOL), { recursive: true });

  // ── ㉠ 출제 가능 풀 — `report-unusable-problems.ts` 와 **글자 그대로 같은 where 절**.
  //    두 벌로 쓰면 분모가 조용히 갈라진다.
  const pool = (await prisma.$queryRawUnsafe(
    `SELECT id, content, answer, figure_urls AS "figureUrls",
            question_type AS "questionType", source::text AS source,
            source_file AS "sourceFile", school,
            question_number AS "questionNumber", unit_id AS "unitId",
            exam_id AS "examId", external_id AS "externalId",
            score, problem_type::text AS "problemType"
       FROM problem
      WHERE pool = 'shared' AND review_status = 'approved'
        AND direct_use_allowed = true AND answer <> '(정답 없음)'
      ORDER BY id`,
  )) as PoolRow[];

  const ps = fs.createWriteStream(POOL, { encoding: "utf-8" });
  for (const r of pool) ps.write(JSON.stringify(r) + "\n");
  await new Promise((res) => ps.end(res));

  // ── ㉡ 정렬 닻 — 추출한 편의 **모든** past_exam 행 (풀 밖 행 포함).
  const examIds = fs.existsSync(HWP_DIR)
    ? fs
        .readdirSync(HWP_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
    : [];

  let align: PoolRow[] = [];
  if (examIds.length > 0) {
    align = (await prisma.$queryRawUnsafe(
      `SELECT id, content, answer, figure_urls AS "figureUrls",
              question_type AS "questionType", source::text AS source,
              source_file AS "sourceFile", school,
              question_number AS "questionNumber", unit_id AS "unitId",
              exam_id AS "examId", external_id AS "externalId",
              score, problem_type::text AS "problemType"
         FROM problem
        WHERE source = 'past_exam' AND exam_id = ANY($1::text[])
        ORDER BY exam_id, question_number`,
      examIds,
    )) as PoolRow[];
  }

  const as = fs.createWriteStream(ALIGN, { encoding: "utf-8" });
  for (const r of align) as.write(JSON.stringify(r) + "\n");
  await new Promise((res) => as.end(res));

  const poolIds = new Set(pool.map((p) => p.id));
  const meta = {
    읽은시각: new Date().toISOString(),
    출제가능풀: pool.length,
    정렬닻편: examIds.length,
    정렬닻행: align.length,
    풀에속한정렬행: align.filter((r) => poolIds.has(r.id)).length,
  };
  fs.writeFileSync(META, JSON.stringify(meta, null, 1), "utf-8");

  console.log("── 회수 측정용 스냅샷 (읽기 전용) ──");
  console.log(`출제 가능 풀 ${pool.length}건`);
  console.log(`정렬 닻 ${examIds.length}편 / ${align.length}행`);
  console.log(`→ ${POOL} · ${ALIGN} · ${META}`);
  await prisma.$disconnect();
}

void main();
