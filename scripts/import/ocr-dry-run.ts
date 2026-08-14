/**
 * 기출 OCR(ocr_pilot) dry-run — 원본 파일은 읽기만 한다.
 *
 * 사용: npx tsx scripts/import/ocr-dry-run.ts --dir "F:\\시험지변환기\\db\\ocr_pilot"
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { classifyDrafts } from "../../src/lib/import/buildReport";
import {
  convertPastExamPaper,
  normalizePastExamPaper,
  type PastExamAnswer,
  type PastExamPaper,
} from "../../src/lib/import/convertPastExam";
import {
  filterReportItems,
  mergeImportReports,
  summarizeImportReport,
} from "../../src/lib/import/parseReport";
import { seedUnitsAsLike } from "./loadUnits";
import { isDirectScript } from "./isDirectScript";
import { writeJson } from "./writeJson";

function parseArgs(argv: string[]) {
  const dirIndex = argv.indexOf("--dir");
  const outIndex = argv.indexOf("--out-dir");
  return {
    dir: dirIndex >= 0 ? argv[dirIndex + 1] : "F:\\시험지변환기\\db\\ocr_pilot",
    outDir: outIndex >= 0 ? argv[outIndex + 1] : "scripts/import/reports",
  };
}

export async function runOcrDryRun(dir: string, outDir: string) {
  const units = seedUnitsAsLike();
  const files = (await readdir(dir)).filter(
    (name) => name.endsWith(".json") && !name.endsWith(".answers.json"),
  );

  const reports = [];
  const classifiedDrafts: Array<
    ReturnType<typeof classifyDrafts>["classified"][number]
  > = [];
  let paperCount = 0;
  let parseErrors = 0;
  for (const file of files) {
    if (file.includes("extracted")) continue;
    paperCount += 1;
    let paperRaw: PastExamPaper;
    try {
      paperRaw = JSON.parse(
        await readFile(path.join(dir, file), "utf8"),
      ) as PastExamPaper;
    } catch {
      parseErrors += 1;
      continue;
    }
    const paper = normalizePastExamPaper(paperRaw, path.parse(file).name);
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
    const drafts = convertPastExamPaper(paper, answers);
    const classified = classifyDrafts(
      "past_exam",
      drafts,
      units,
      paper.meta?.subject ?? paper.meta?.grade,
    );
    reports.push(classified.report);
    classifiedDrafts.push(...classified.classified);
  }

  const report = mergeImportReports("past_exam", reports);
  await writeJson(path.join(outDir, "ocr-report.json"), report);
  await writeJson(
    path.join(outDir, "ocr-unclassified.json"),
    filterReportItems(report, "unclassified"),
  );
  await writeJson(
    path.join(outDir, "ocr-figures.json"),
    filterReportItems(report, "skipped_figure"),
  );
  await writeJson(
    path.join(outDir, "ocr-classified.json"),
    classifiedDrafts.map((draft) => ({
      externalId: draft.externalId,
      unitId: draft.unitId,
      source: draft.source,
      directUseAllowed: draft.directUseAllowed,
      difficulty: draft.difficulty,
      problemType: draft.problemType,
      content: draft.content,
      answer: draft.answer,
      solution: draft.solution,
    })),
  );

  const summary = {
    ...summarizeImportReport(report),
    papers: paperCount,
    parseErrors,
  };
  console.log(
    `[ocr-dry-run] papers=${paperCount} parseErrors=${parseErrors} total=${report.total} ok=${report.ok} unclassified=${report.unclassified} skippedFigure=${report.skippedFigure}`,
  );
  return { report, summary };
}

async function main() {
  const { dir, outDir } = parseArgs(process.argv.slice(2));
  await runOcrDryRun(dir, outDir);
}

if (isDirectScript(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
