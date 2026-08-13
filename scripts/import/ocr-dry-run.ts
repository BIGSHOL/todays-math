/**
 * 기출 OCR(ocr_pilot) dry-run — 원본 파일은 읽기만 한다.
 *
 * 사용: npx tsx scripts/import/ocr-dry-run.ts --dir "F:\\시험지변환기\\db\\ocr_pilot"
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { classifyDrafts } from "../../src/lib/import/buildReport";
import { convertPastExamPaper } from "../../src/lib/import/convertPastExam";
import type { PastExamAnswer } from "../../src/lib/import/convertPastExam";
import { CURRICULUM_UNITS } from "../../prisma/seed-data/units.ts";

function parseArgs(argv: string[]) {
  const dirIndex = argv.indexOf("--dir");
  const outIndex = argv.indexOf("--out");
  return {
    dir: dirIndex >= 0 ? argv[dirIndex + 1] : "F:\\시험지변환기\\db\\ocr_pilot",
    out:
      outIndex >= 0
        ? argv[outIndex + 1]
        : "scripts/import/reports/ocr-unclassified.json",
  };
}

async function main() {
  const { dir, out } = parseArgs(process.argv.slice(2));
  const files = (await readdir(dir)).filter(
    (name) => name.endsWith(".json") && !name.endsWith(".answers.json"),
  );

  const units = CURRICULUM_UNITS.map((unit, index) => ({
    id: `seed-${index + 1}`,
    grade: unit.grade,
    chapter: unit.chapter,
    section: unit.section,
  }));

  const allDrafts = [];
  for (const file of files) {
    if (file.includes("extracted")) continue;
    const paper = JSON.parse(
      await readFile(path.join(dir, file), "utf8"),
    ) as Parameters<typeof convertPastExamPaper>[0];
    const answerPath = path.join(dir, file.replace(/\.json$/, ".answers.json"));
    let answers: PastExamAnswer[] = [];
    try {
      const parsed = JSON.parse(await readFile(answerPath, "utf8")) as {
        items?: PastExamAnswer[];
      };
      answers = parsed.items ?? [];
    } catch {
      answers = [];
    }
    allDrafts.push(...convertPastExamPaper(paper, answers));
  }

  const { report } = classifyDrafts("past_exam", allDrafts, units);
  await writeFile(out, JSON.stringify(report, null, 2), "utf8");
  console.log(
    `[ocr-dry-run] total=${report.total} ok=${report.ok} unclassified=${report.unclassified} skippedFigure=${report.skippedFigure} out=${out}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
