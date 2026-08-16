/**
 * 단원을 옮겨 **강등 사유가 해소된** 기출 문항의 출제 자격을 되돌린다 (`pending` → `approved`).
 *
 * ## 왜 되돌리나 (코디네이터 승인, 2026-08-16)
 *
 * 이 행들이 내려간 사유는 2026-08-15 `fix-unit-assignments.ts` 의
 * 「올바른 학년에 붙을 소단원을 못 찾음」이었다. `fix-unit-grade.ts` 가 원본 `topic` 으로
 * 제자리를 찾아 넣어 **그 사유가 사라졌다.** 사유가 사라졌으면 강등도 풀리는 게 맞다.
 *
 * D-22 의 `pending` 은 **AI 생성물**을 사람이 검수하기 전까지 묶어 두는 장치다.
 * 이 행들은 AI 생성물이 아니라 학교 기출이므로 그 조항이 겨냥한 대상이 아니다.
 *
 * ## ⚠️ 강등 사유 해소 ≠ 출제해도 됨
 *
 * 둘은 다른 말이다. 그래서 올리기 전에 **출제 적격**을 따로 본다. 기준은
 * `findEligibleProblems` 가 실제로 요구하는 것 + 지면에서 깨지는 것들이다:
 *
 *   1. 정답이 있는가 (`MISSING_ANSWER` 센티널이 아닌가) — 없으면 채점이 안 된다
 *   2. 본문이 비어 있지 않은가
 *   3. 본문이 깨져 있지 않은가 — 치환문자(U+FFFD)·**HWP 수식폰트 PUA(U+E000~U+F8FF)**·
 *      `$` 홀수 개(수식이 안 닫혀 KaTeX 가 깨진다)
 *   4. 그림을 가리키는데 `figureUrls` 가 비어 있지 않은가 — `[그림]` 만 남으면 학생이 못 푼다
 *
 * 하나라도 걸리면 **올리지 않는다.** 그 수를 보고한다.
 *
 * ## 되돌리기 목록은 따로 남긴다
 *
 * 이번에 한 일은 둘이다 — **단원을 옮긴 것**(`unit-grade-revert.json`)과
 * **출제 자격을 준 것**(`unit-grade-restore.json`). 나중에 하나만 되돌려야 할 수 있어
 * 섞지 않는다.
 *
 *   npx tsx scripts/qa/restore-unit-grade-fixed.ts            드라이런
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/restore-unit-grade-fixed.ts --apply
 */
import { readFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { isDirectScript } from "../import/isDirectScript";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";
import { writeJson } from "../import/writeJson";

const PLAN_PATH = "scripts/qa/unit-grade-plan.json";
const RESTORE_PATH = "scripts/qa/unit-grade-restore.json";
const MISSING_ANSWER = "(정답 없음)";
/** HWP 수식폰트가 PUA 로 박히는 구간. 되돌려지지 않으면 지면에 네모로 나온다. */
const PUA = /[\uE000-\uF8FF]/;
const REPLACEMENT = /\uFFFD/;
/** 본문이 그림을 가리키는 표시 — `blocksToLatex`/`flattenStructured` 가 넣는 형태. */
const FIGURE_REF = /\[그림\]/;

export interface Row {
  id: string;
  content: string;
  answer: string;
  figureUrls: string[];
}

export type Block =
  | "정답 없음"
  | "본문 비어 있음"
  | "본문 깨짐(치환문자)"
  | "본문 깨짐(수식폰트 PUA)"
  | "수식 미종료($ 홀수)"
  | "그림 참조인데 figureUrls 비어 있음";

/** 출제에 내보내면 안 되는 사유를 모두 모은다. 하나라도 있으면 올리지 않는다. */
export function blockers(row: Row): Block[] {
  const found: Block[] = [];
  const answer = row.answer.trim();
  if (!answer || answer.includes(MISSING_ANSWER)) found.push("정답 없음");
  const content = row.content.trim();
  if (!content) found.push("본문 비어 있음");
  if (REPLACEMENT.test(content)) found.push("본문 깨짐(치환문자)");
  if (PUA.test(content)) found.push("본문 깨짐(수식폰트 PUA)");
  // `$$` 는 두 개로 세도 짝이 맞으므로 단순 개수로 충분하다.
  if ((content.match(/\$/g)?.length ?? 0) % 2 !== 0) found.push("수식 미종료($ 홀수)");
  if (FIGURE_REF.test(content) && row.figureUrls.length === 0) {
    found.push("그림 참조인데 figureUrls 비어 있음");
  }
  return found;
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

  const plan = JSON.parse(await readFile(PLAN_PATH, "utf8")) as {
    moves: Array<{ problemId: string; toGrade: string; toSection: string }>;
  };
  const wanted = new Map(plan.moves.map((move) => [move.problemId, move]));

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.problem.findMany({
      where: { id: { in: [...wanted.keys()] } },
      select: {
        id: true,
        externalId: true,
        school: true,
        content: true,
        answer: true,
        figureUrls: true,
        unitId: true,
        reviewStatus: true,
        directUseAllowed: true,
        unit: { select: { grade: true, section: true } },
      },
    });

    const ok: typeof rows = [];
    const blocked: Array<{ row: (typeof rows)[number]; reasons: Block[] }> = [];
    let alreadyApproved = 0;
    let movedAway = 0;

    for (const row of rows) {
      // 내가 옮겨 둔 자리에 그대로 있는지 먼저 본다 — 그 사이 누가 또 옮겼으면 건드리지 않는다.
      const move = wanted.get(row.id)!;
      if (row.unit.grade !== move.toGrade || row.unit.section !== move.toSection) {
        movedAway += 1;
        continue;
      }
      if (row.reviewStatus === "approved") {
        alreadyApproved += 1;
        continue;
      }
      const reasons = blockers(row);
      if (reasons.length > 0) blocked.push({ row, reasons });
      else ok.push(row);
    }

    console.log("── 단원을 옮겨 사유가 해소된 행의 출제 자격 복구 ──");
    console.log(
      `계획 ${plan.moves.length} · DB 확인 ${rows.length}` +
        ` — 올릴 수 있음 **${ok.length}** · 적격 미달 ${blocked.length}` +
        ` · 이미 approved ${alreadyApproved} · 자리가 바뀜 ${movedAway}`,
    );

    const byReason = new Map<string, number>();
    for (const item of blocked) {
      for (const reason of item.reasons) {
        byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
      }
    }
    if (byReason.size > 0) {
      console.log("\n[올리지 않는 사유 — 행 하나가 여러 사유에 걸릴 수 있다]");
      for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${count}행  ${reason}`);
      }
      for (const item of blocked.slice(0, 10)) {
        console.log(
          `    ${item.row.id.slice(0, 8)} ${item.row.school} — ${item.reasons.join(" · ")}`,
        );
      }
    }

    const notDirect = ok.filter((row) => !row.directUseAllowed).length;
    if (notDirect > 0) {
      console.log(`\n⚠️ directUseAllowed=false 인 행 ${notDirect} — 올려도 출제되지 않는다.`);
    }

    // 적용 전에 목록을 먼저 남길 수 있게 한다 — 지금까지의 절차와 같다.
    const planIndex = process.argv.indexOf("--plan");
    if (planIndex >= 0) {
      const out = process.argv[planIndex + 1] ?? RESTORE_PATH;
      await writeJson(out, {
        note:
          "출제 자격 복구 대상(적용 전 기록). 단원 이동분(unit-grade-revert.json)과 " +
          "성격이 다르므로 섞지 않는다.",
        count: ok.length,
        blockedCount: blocked.length,
        blocked: blocked.map((item) => ({
          problemId: item.row.id,
          externalId: item.row.externalId,
          school: item.row.school,
          reasons: item.reasons,
        })),
        rows: ok.map((row) => ({
          problemId: row.id,
          externalId: row.externalId,
          school: row.school,
          unit: `${row.unit.grade} / ${row.unit.section}`,
          previous: row.reviewStatus,
          next: "approved",
        })),
      });
      console.log(`\n계획 기록 — ${out}`);
    }

    if (!apply) {
      console.log(`\n드라이런 — 변경 없음. 승인 후 --apply (올릴 대상 ${ok.length})`);
      return;
    }

    // 되돌리기 목록을 **먼저** 쓴다. 단원 이동분(unit-grade-revert.json)과 섞지 않는다.
    await writeJson(RESTORE_PATH, {
      note:
        "단원을 옮겨 강등 사유가 해소된 기출 문항의 출제 자격 복구(pending → approved). " +
        "이번에 한 일은 둘이다 — 단원 이동(unit-grade-revert.json)과 출제 자격 부여(이 파일). " +
        "나중에 하나만 되돌릴 수 있게 섞지 않았다. 되돌리려면 이 목록의 problemId 에 " +
        "reviewStatus 를 previous 로 되돌린다.",
      count: ok.length,
      rows: ok.map((row) => ({
        problemId: row.id,
        externalId: row.externalId,
        school: row.school,
        unit: `${row.unit.grade} / ${row.unit.section}`,
        previous: row.reviewStatus,
        next: "approved",
      })),
    });

    const result = await prisma.problem.updateMany({
      where: { id: { in: ok.map((row) => row.id) }, reviewStatus: "pending" },
      data: { reviewStatus: "approved" },
    });
    console.log(`\n복구 완료 — ${result.count}행 (pending → approved) · 목록 ${RESTORE_PATH}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  void main();
}
