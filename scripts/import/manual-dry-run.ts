/**
 * math_test 자작 시드 dry-run. 원본 F:\math_test 는 읽기만 한다.
 *
 * 사용: python scripts/import/dump_math_test_seeds.py > scripts/import/reports/manual-dump.json
 *       npx tsx scripts/import/manual-dry-run.ts --in scripts/import/reports/manual-dump.json
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { classifyDrafts } from "../../src/lib/import/buildReport";
import { convertManualSeedQuestion } from "../../src/lib/import/convertManualSeed";
import {
  filterReportItems,
  summarizeImportReport,
} from "../../src/lib/import/parseReport";
import { isDirectScript } from "./isDirectScript";
import { seedUnitsAsLike } from "./loadUnits";
import { writeJson } from "./writeJson";

function parseArgs(argv: string[]) {
  const inIndex = argv.indexOf("--in");
  const outIndex = argv.indexOf("--out-dir");
  return {
    input:
      inIndex >= 0
        ? argv[inIndex + 1]
        : "scripts/import/reports/manual-dump.json",
    outDir: outIndex >= 0 ? argv[outIndex + 1] : "scripts/import/reports",
  };
}

export async function runManualDryRun(inputPath: string, outDir: string) {
  const raw = JSON.parse(await readFile(inputPath, "utf8")) as {
    questions?: Array<Parameters<typeof convertManualSeedQuestion>[0]>;
  };
  const drafts = (raw.questions ?? []).map(convertManualSeedQuestion);
  const { classified, report } = classifyDrafts(
    "manual",
    drafts,
    seedUnitsAsLike(),
  );
  await writeJson(path.join(outDir, "manual-report.json"), report);
  await writeJson(
    path.join(outDir, "manual-unclassified.json"),
    filterReportItems(report, "unclassified"),
  );
  await writeJson(
    path.join(outDir, "manual-figures.json"),
    filterReportItems(report, "skipped_figure"),
  );
  await writeJson(
    path.join(outDir, "manual-classified.json"),
    classified.map((draft) => ({
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
  const summary = summarizeImportReport(report);
  console.log(
    `[manual-dry-run] total=${report.total} ok=${report.ok} unclassified=${report.unclassified} skippedFigure=${report.skippedFigure}`,
  );
  return { report, summary };
}

async function main() {
  const { input, outDir } = parseArgs(process.argv.slice(2));
  await runManualDryRun(input, outDir);
}

if (isDirectScript(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
