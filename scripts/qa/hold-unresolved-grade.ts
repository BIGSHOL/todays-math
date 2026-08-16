/**
 * 학년이 틀렸는데 **옮길 자리를 근거 있게 정할 수 없는** 기출 문항을 출제에서만 뺀다.
 *
 * ## 왜 빼나 (코디네이터 판단, 2026-08-16)
 *
 * 그대로 두면 그 행들은 **틀린 학년의 진도에 계속 섞여 나간다.** 그건 원장님이 수업 중에
 * 발견하시는 종류의 오류다. 강등하면 그만큼 못 쓰게 되지만 **그건 되돌릴 수 있고,
 * 잘못 나가는 것은 되돌릴 수 없다.**
 *
 * ## 폐기가 아니라 **보류**다
 *
 * 행을 지우지 않고 `reviewStatus` 를 `approved` → `pending` 으로만 내린다. D-22 대로
 * `pending` 은 출제 풀에 안 잡힌다. **원본 시험지를 다시 보면 학년이 밝혀질 수 있는
 * 것들이라** 근거가 생기면 이 목록만 골라 되살린다.
 *
 * ## 되돌리기 목록을 125행과 **섞지 않는다**
 *
 * 성격이 다르다 — 125행은 `unitId` 를 옮긴 것이고(`unit-grade-revert.json`),
 * 이쪽은 `reviewStatus` 를 내린 것이다(`unit-grade-hold.json`). 나중에 이 34행만
 * 골라 살리려면 목록이 따로 있어야 한다.
 *
 *   npx tsx scripts/qa/hold-unresolved-grade.ts                드라이런
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/hold-unresolved-grade.ts --apply
 */
import { readFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { isDirectScript } from "../import/isDirectScript";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";
import { writeJson } from "../import/writeJson";

const AUDIT_PATH = "scripts/qa/reports/unit-grade-audit.json";
const PLAN_PATH = "scripts/qa/unit-grade-plan.json";
const HOLD_PATH = "scripts/qa/unit-grade-hold.json";

interface Audit {
  findings: Array<{
    problemId: string;
    externalId: string | null;
    school: string | null;
    sourceFile: string | null;
    currentGrade: string;
    expectedGrade: string;
    signals: string[];
  }>;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  if (apply) {
    const inspection = await inspectDatabaseTargets();
    if (
      !inspection.selected.canMigrateOrLoad &&
      !allowSharedImport(inspection.selected)
    ) {
      console.log(
        `차단 — ${inspection.selected.reason}\nALLOW_SHARED_IMPORT=1 을 명시하세요.`,
      );
      process.exitCode = 1;
      return;
    }
  }

  const audit = JSON.parse(await readFile(AUDIT_PATH, "utf8")) as Audit;
  const plan = JSON.parse(await readFile(PLAN_PATH, "utf8")) as {
    moves: Array<{ problemId: string }>;
  };
  const moved = new Set(plan.moves.map((move) => move.problemId));
  const held = audit.findings.filter((f) => !moved.has(f.problemId));

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.problem.findMany({
      where: { id: { in: held.map((f) => f.problemId) } },
      select: {
        id: true,
        externalId: true,
        school: true,
        examId: true,
        questionNumber: true,
        reviewStatus: true,
        unit: { select: { grade: true, chapter: true, section: true } },
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));

    console.log("── 학년 오배정 중 자리를 못 정한 행 보류 ──");
    console.log(`감사 ${audit.findings.length} · 이동 ${moved.size} · **보류 대상 ${held.length}**`);

    const bySchool = new Map<string, number>();
    const byUnit = new Map<string, number>();
    for (const f of held) {
      const row = byId.get(f.problemId);
      bySchool.set(f.school ?? "(없음)", (bySchool.get(f.school ?? "(없음)") ?? 0) + 1);
      const unit = row
        ? `${row.unit.grade} / ${row.unit.chapter} / ${row.unit.section}`
        : "(없음)";
      byUnit.set(unit, (byUnit.get(unit) ?? 0) + 1);
    }
    console.log("\n[학교별]");
    for (const [school, n] of [...bySchool.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n}행  ${school}`);
    }
    console.log("\n[지금 붙어 있는 단원별]");
    for (const [unit, n] of [...byUnit.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n}행  ${unit}`);
    }

    const alreadyPending = rows.filter((row) => row.reviewStatus === "pending").length;
    if (!apply) {
      console.log(
        `\n드라이런 — 변경 없음. 승인 후 --apply` +
          ` (보류 ${held.length}${alreadyPending > 0 ? ` · 이미 pending ${alreadyPending}` : ""})`,
      );
      return;
    }

    // 되돌리기 목록을 **먼저** 쓴다. 125행 목록과 섞지 않는다.
    await writeJson(HOLD_PATH, {
      note:
        "학년이 틀렸으나 옮길 자리를 근거 있게 정할 수 없어 출제에서만 뺀 행. " +
        "**영구 폐기가 아니라 보류다** — 원본 시험지를 다시 보면 학년이 밝혀질 수 있다. " +
        "되살리려면 이 목록의 problemId 에 reviewStatus 를 previous 로 되돌린다. " +
        "unitId 를 옮긴 125행은 unit-grade-revert.json 에 따로 있다(섞지 말 것).",
      count: held.length,
      rows: held.map((f) => {
        const row = byId.get(f.problemId);
        return {
          problemId: f.problemId,
          externalId: f.externalId,
          school: f.school,
          examId: row?.examId ?? null,
          questionNumber: row?.questionNumber ?? null,
          currentUnit: row
            ? `${row.unit.grade} / ${row.unit.chapter} / ${row.unit.section}`
            : null,
          paperGrade: f.expectedGrade,
          sourceFile: f.sourceFile,
          signals: f.signals,
          previous: row?.reviewStatus ?? "approved",
          next: "pending",
        };
      }),
    });

    const result = await prisma.problem.updateMany({
      where: { id: { in: held.map((f) => f.problemId) }, reviewStatus: "approved" },
      data: { reviewStatus: "pending" },
    });
    console.log(`\n보류 완료 — ${result.count}행 (approved → pending) · 목록 ${HOLD_PATH}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  void main();
}
