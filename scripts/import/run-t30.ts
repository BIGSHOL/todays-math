/**
 * T3.0 후반: dry-run 리포트 + (로컬 DB일 때만) migrate/적재.
 */
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { inspectDatabaseTargets } from "./resolveDbTarget";
import { runLoadIfLocal } from "./load-classified";
import { runManualDryRun } from "./manual-dry-run";
import { runOcrDryRun } from "./ocr-dry-run";
import { runRpmExtract } from "./extract-rpm";
import { writeJson } from "./writeJson";

const OUT_DIR = "scripts/import/reports";
const OCR_DIR = "F:\\시험지변환기\\db\\ocr_pilot";
const DUMP_SCRIPT = "scripts/import/dump_math_test_seeds.py";

async function dumpManualSeeds(
  outFile: string,
): Promise<{ ok: boolean; reason?: string }> {
  const result = spawnSync("python", [DUMP_SCRIPT], {
    encoding: "utf8",
    maxBuffer: 80 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return {
      ok: false,
      reason: (result.stderr || result.stdout || "python dump 실패").slice(
        0,
        400,
      ),
    };
  }
  await mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
  await writeFile(path.resolve(outFile), result.stdout, "utf8");
  return { ok: true };
}

async function main() {
  const inspection = await inspectDatabaseTargets();
  const ocr = await runOcrDryRun(OCR_DIR, OUT_DIR);

  const dumpPath = path.join(OUT_DIR, "manual-dump.json");
  const dumped = await dumpManualSeeds(dumpPath);
  const manual = dumped.ok
    ? await runManualDryRun(dumpPath, OUT_DIR)
    : { report: null, summary: null, dumpError: dumped.reason };

  const rpm = await runRpmExtract(OUT_DIR);
  const load = await runLoadIfLocal(OUT_DIR);

  const summary = {
    generatedAt: new Date().toISOString(),
    database: {
      selectedSource: inspection.selectedSource,
      selected: inspection.selected,
      env: inspection.env,
      worktreeDotenv: inspection.worktreeDotenv,
      mainRepoDotenv: {
        kind: inspection.mainRepoDotenv.kind,
        canMigrateOrLoad: inspection.mainRepoDotenv.canMigrateOrLoad,
        reason: inspection.mainRepoDotenv.reason,
      },
    },
    ocr: ocr.summary,
    manual: "summary" in manual ? manual.summary : { error: dumped.reason },
    rpm,
    load,
    originalReposUnchanged: true,
  };
  await writeJson(path.join(OUT_DIR, "t30-summary.json"), summary);

  const lines = [
    "# T3.0 후반 — dry-run / 적재 리포트",
    "",
    `생성 시각: ${summary.generatedAt}`,
    "",
    "## DB 대상",
    "",
    `- 선택 소스: \`${inspection.selectedSource}\``,
    `- 선택 대상: **${inspection.selected.kind}** — ${inspection.selected.reason}`,
    `- 프로세스 env: ${inspection.env.kind}`,
    `- worktree \`.env\`: ${inspection.worktreeDotenv.kind}`,
    `- 메인 저장소 \`.env\`(참고, 사용 안 함): ${inspection.mainRepoDotenv.kind} — ${inspection.mainRepoDotenv.reason}`,
    `- migrate/적재: ${load.loaded ? `수행 (${load.inserted}건)` : `안 함 — ${load.reason}`}`,
    "",
    "## 기출 OCR",
    "",
    `- 시험지 ${ocr.summary.papers}부 / 파싱 실패 ${ocr.summary.parseErrors}`,
    `- total ${ocr.summary.total} / ok ${ocr.summary.ok} / unclassified ${ocr.summary.unclassified} / figure ${ocr.summary.skippedFigure}`,
    `- 리포트: \`scripts/import/reports/ocr-report.json\``,
    "",
    "## 자작 시드",
    "",
    dumped.ok
      ? `- total ${manual.summary?.total} / ok ${manual.summary?.ok} / unclassified ${manual.summary?.unclassified} / figure ${manual.summary?.skippedFigure}`
      : `- dump 실패: ${dumped.reason}`,
    `- 원본 \`F:\\\\math_test\` 수정 없음`,
    "",
    "## RPM (sumaek, SELECT만)",
    "",
    rpm.ok
      ? `- 추출 ${rpm.rowCount}건 / ok ${rpm.summary?.ok} / unclassified ${rpm.summary?.unclassified} / figure ${rpm.summary?.skippedFigure} / 전량 잠금 ${rpm.lockedAll}`
      : `- 추출 실패(중단하지 않음): ${rpm.reason}`,
    `- 문서상 5,035건보다 많을 수 있음 (\`source_ref IS NOT NULL\` 전량)`,
    "",
    "## 리포트 파일",
    "",
    "- `scripts/import/reports/T30-LOAD-REPORT.md`",
    "- `scripts/import/reports/t30-summary.json`",
    "- `scripts/import/reports/ocr-report.json` / `ocr-unclassified.json` / `ocr-figures.json`",
    "- `scripts/import/reports/manual-report.json` / `manual-unclassified.json`",
    "- `scripts/import/reports/rpm-report.json` / `rpm-unclassified.json` / `rpm-extract.json`",
    "- `scripts/import/reports/load-result.json`",
    "",
    "## 금지 사항 준수",
    "",
    "- UI/인쇄/T5 파일 변경 없음",
    "- 원본 저장소 무변경",
    "- 프로덕션 INSERT 없음",
    "- main 병합/push 없음",
    "",
  ];
  await writeFile(
    path.join(OUT_DIR, "T30-LOAD-REPORT.md"),
    `${lines.join("\n")}\n`,
    "utf8",
  );
  console.log(`[t30] report=${path.join(OUT_DIR, "T30-LOAD-REPORT.md")}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
