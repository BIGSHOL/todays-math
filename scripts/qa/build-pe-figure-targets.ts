/**
 * 그림 유실 **기출** 문항 + 그 원본 파일이 지금도 N드라이브에 있는지.
 *
 *   npx tsx scripts/qa/build-pe-figure-targets.ts
 *
 * 선행: `npx tsx scripts/qa/report-missing-figures.ts --json`
 * 출력: `scripts/qa/reports/pe-figure-targets.json`
 *
 * 회수는 **원본이 있어야** 시작된다. `problem.source_file` 에 N드라이브 경로가 적혀
 * 있으므로(08-import-ledger.md) 실재 여부를 여기서 한 번에 확인하고, 뒤 단계
 * (`build-hwp-figure-candidates.ts`)는 그 목록만 본다.
 *
 * ⚠️ 「편이 그림 대장(`figure-manifest.json`)에 없다」를 「원본이 없다」로 읽지 말 것.
 *    대장은 **PDF 오려내기**가 만든 것이라, HWP 정본만 있는 편은 애초에 안 들어간다.
 *    실측(2026-08-18): 대장에 없던 58편이 **전부** N드라이브에 살아 있었다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const REPORT = "scripts/qa/reports/missing-figures.json";
const OUT = "scripts/qa/reports/pe-figure-targets.json";

async function main(): Promise<void> {
  const rep = JSON.parse(readFileSync(REPORT, "utf8")) as {
    목록: { id: string; source: string }[];
  };
  const ids = rep.목록.filter((r) => r.source === "past_exam").map((r) => r.id);
  const rows = await prisma.problem.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      externalId: true,
      examId: true,
      questionNumber: true,
      school: true,
      subject: true,
      sourceFile: true,
      content: true,
    },
  });

  const alive = rows.filter((r) => r.sourceFile && existsSync(r.sourceFile));
  const dead = rows.filter((r) => r.sourceFile && !existsSync(r.sourceFile));
  const none = rows.filter((r) => !r.sourceFile);

  const exts: Record<string, number> = {};
  const exams = new Map<string, string>();
  for (const r of alive) {
    const e = r.externalId?.split("-")[0];
    if (e && !exams.has(e)) exams.set(e, r.sourceFile!);
  }
  for (const f of exams.values()) {
    const e = f.slice(f.lastIndexOf(".")).toLowerCase();
    exts[e] = (exts[e] ?? 0) + 1;
  }

  console.log(
    `그림 유실 기출 ${rows.length}행\n` +
      `  원본이 지금도 있다  ${alive.length}행 (${exams.size}편 ${JSON.stringify(exts)})\n` +
      `  경로는 있는데 파일이 없다 ${dead.length}행\n` +
      `  sourceFile 자체가 없다 ${none.length}행 (2026-08-14 이전 이관분 — 역추적 불가)`,
  );
  writeFileSync(
    OUT,
    JSON.stringify({ 건수: rows.length, 목록: alive }, null, 1),
    "utf8",
  );
  console.log(`→ ${OUT}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
