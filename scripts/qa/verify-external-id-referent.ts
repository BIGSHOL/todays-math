/**
 * `externalId` 의 앞자리는 **지금도 같은 시험지를 가리키는가** — 원본 색인과 대조한다.
 *
 *   npx tsx scripts/qa/verify-external-id-referent.ts            # 요약
 *   npx tsx scripts/qa/verify-external-id-referent.ts --json     # scripts/qa/reports/ 에 기록
 *   TESTCHANGER_DIR=F:\시험지변환기 npx tsx …                    # 색인 위치 지정
 *
 * ## 읽기 전용이다 — 우리 DB 도 색인도 SELECT 만 한다.
 *
 * ## 왜 대조가 필요한가
 * `externalId` 는 `{exam_id}-{문항번호}` 이고(`convertPastExam.ts`), 그 `exam_id` 는
 * testchanger 색인 `db/exam_index.db` 의 **`exams.id`(SQLite rowid)** 다. 그런데
 * `db/build_index.py` 는 색인을 **통째로 지우고 다시 만든다**(`if DB.exists(): DB.unlink()`).
 * 행을 넣는 순서는 `(year, level, grade, school)` 정렬 순 — 즉 **이른 연도에 시험지가
 * 한 편만 새로 들어와도 그 뒤 번호가 전부 한 칸씩 밀린다.**
 *
 * 그러면 우리 DB 의 `externalId` 는 그대로인데 **가리키는 대상이 달라진다.** 이 스크립트는
 * 그 어긋남이 **이미 일어났는지**를 학교명 대조로 확인한다. 숨은 값은 눈으로 검산되지
 * 않으므로(원장님 결정 2026-08-18) 이런 대조를 자동으로 돌려야 한다.
 *
 * 색인 파일이 없으면 **조용히 통과시키지 않고** 그 사실을 출력하고 종료한다.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const OUT_DIR = path.join("scripts", "qa", "reports");
const OUT_FILE = path.join(OUT_DIR, "external-id-referent.json");

/** `scripts/qa/tc_paths.py` 와 같은 후보 목록 — 한 곳에서만 정한다. */
const CANDIDATES = ["F:\\시험지변환기", "D:\\시험지 한글화"];

function indexPath(): string | null {
  const env = process.env.TESTCHANGER_DIR;
  const roots = env ? [env, ...CANDIDATES] : CANDIDATES;
  for (const root of roots) {
    const candidate = path.join(root, "db", "exam_index.db");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function main() {
  const wantJson = process.argv.includes("--json");
  const dbPath = indexPath();
  if (!dbPath) {
    console.log(
      `색인 없음 — 대조할 수 없다. 후보: ${CANDIDATES.join(", ")} (TESTCHANGER_DIR 로 지정 가능)`,
    );
    console.log(
      "⚠️ 「대조 못 함」은 「어긋남 없음」이 아니다. 색인이 있는 컴퓨터에서 다시 돌릴 것.",
    );
    return;
  }

  const index = new DatabaseSync(dbPath, { readOnly: true });
  const exams = index
    .prepare("SELECT id, school, year, semester, round, subject FROM exams")
    .all() as Array<{
    id: number;
    school: string;
    year: number;
    semester: number;
    round: string;
    subject: string;
  }>;
  const examById = new Map(exams.map((e) => [String(e.id), e]));
  const questionCount = index
    .prepare("SELECT exam_id, count(*) AS n FROM questions GROUP BY exam_id")
    .all() as Array<{ exam_id: number; n: number }>;
  const qCountById = new Map(
    questionCount.map((q) => [String(q.exam_id), q.n]),
  );

  const rows = await prisma.problem.findMany({
    where: { examId: { not: null } },
    select: {
      externalId: true,
      examId: true,
      questionNumber: true,
      school: true,
      sourceFile: true,
    },
  });

  let matched = 0;
  let schoolMismatch = 0;
  let examMissing = 0;
  let numberOutOfRange = 0;
  const mismatchSamples: Array<Record<string, unknown>> = [];
  const missingSamples: string[] = [];

  for (const row of rows) {
    const exam = examById.get(row.examId!);
    if (!exam) {
      examMissing += 1;
      if (missingSamples.length < 10) missingSamples.push(row.externalId ?? "");
      continue;
    }
    // 학교명 표기는 우리 쪽이 정규화돼 있을 수 있어 «포함» 으로 견준다.
    const ours = (row.school ?? "").replace(/\s/g, "");
    const theirs = (exam.school ?? "").replace(/\s/g, "");
    if (ours && theirs && !(ours.includes(theirs) || theirs.includes(ours))) {
      schoolMismatch += 1;
      if (mismatchSamples.length < 10)
        mismatchSamples.push({
          externalId: row.externalId,
          우리: row.school,
          색인: exam.school,
          색인연도: exam.year,
        });
    } else {
      matched += 1;
    }
    const n = qCountById.get(row.examId!) ?? 0;
    if (row.questionNumber != null && n > 0 && row.questionNumber > n)
      numberOutOfRange += 1;
  }

  // 색인 자체의 성질 — 번호가 «무엇을 담고 있나» 를 같이 남긴다.
  const yearRanges = index
    .prepare(
      "SELECT year, count(*) n, min(id) mn, max(id) mx FROM exams GROUP BY year ORDER BY year",
    )
    .all();

  const report = {
    색인: dbPath,
    대조행: rows.length,
    학교일치: matched,
    학교불일치: schoolMismatch,
    색인에없는_examId: examMissing,
    문항번호_범위초과: numberOutOfRange,
    불일치표본: mismatchSamples,
    없는표본: missingSamples,
    색인_연도별_id범위: yearRanges,
  };

  console.log(`색인: ${dbPath}`);
  console.log(
    `대조 ${rows.length}행 — 학교 일치 ${matched} · 불일치 ${schoolMismatch} · 색인에 없는 exam_id ${examMissing} · 문항번호 범위 초과 ${numberOutOfRange}`,
  );
  if (mismatchSamples.length)
    console.log(`  불일치 표본 ${JSON.stringify(mismatchSamples.slice(0, 5))}`);
  console.log("색인 연도별 id 범위 (번호가 연도를 드러내는가):");
  for (const r of yearRanges) console.log("  ", JSON.stringify(r));

  if (wantJson) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), "utf8");
    console.log(`\n기록: ${OUT_FILE}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
