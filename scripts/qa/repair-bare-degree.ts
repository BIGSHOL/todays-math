/**
 * 정답의 **`$` 밖에 있는 `\degree` 를 `°` 로** 바꾼다 (트랙 B, 5단계).
 *
 * 왜: `renderMathHtml` 은 `$...$` 안만 KaTeX 에 넘긴다. 밖에 있는 `\degree` 는
 * 오류를 내지 않고 그대로 지면에 찍힌다 — 학생 시험지에 `30\degree` 로 인쇄된다.
 * 렌더 실패 검사가 이걸 못 잡았다.
 *
 * **뜻이 안 바뀌는 치환이라 안전하다.** 다만 두 가지를 지킨다:
 *
 * 1. **`$...$` 안의 `\degree` 는 건드리지 않는다.** 거긴 KaTeX 가 제대로 그린다
 *    (실측 43문항). 수식 구간을 통째로 떼어 두고 바깥만 바꾼다.
 * 2. `\degree` 뒤에 글자가 이어지면 다른 명령이다 (`\degrees`). 명령 경계를 본다.
 *
 *   npx tsx scripts/qa/repair-bare-degree.ts                    드라이런(기본)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/repair-bare-degree.ts --apply
 *
 * 되돌리기 목록은 이 단계 것만 `scripts/qa/applied/phase5-bare-latex.json` 에 남긴다.
 */
import { mkdir, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";
import { writeAppliedLog } from "./applied-log";

const BACKUP = "scripts/qa/reports/bare-degree-repair.json";

/**
 * 수식 구간(`$...$`)은 그대로 두고 **바깥에서만** `\degree` 를 `°` 로 바꾼다.
 *
 * 쪼갤 때 구분자를 보존해야 다시 붙일 수 있다 — 캡처 그룹이 있는 정규식으로 split 하면
 * 구분자도 배열에 남는다. 홀수 번째 조각이 수식 구간이다.
 */
export function degreeOutsideMath(answer: string): string {
  return answer
    .split(/(\$[^$]*\$)/)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(/\\degree(?![a-zA-Z])/g, "°"),
    )
    .join("");
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.problem.findMany({
      select: { id: true, source: true, externalId: true, answer: true },
    });

    const ready = rows
      .filter((r) => r.answer && !r.answer.includes("정답 없음"))
      .map((r) => ({ row: r, next: degreeOutsideMath(r.answer) }))
      .filter((x) => x.next !== x.row.answer);

    const bySource = new Map<string, number>();
    for (const x of ready) {
      bySource.set(x.row.source, (bySource.get(x.row.source) ?? 0) + 1);
    }
    const untouched = rows.filter(
      (r) =>
        r.answer &&
        /\$[^$]*\\degree[^$]*\$/.test(r.answer) &&
        degreeOutsideMath(r.answer) === r.answer,
    ).length;

    console.log("── `$` 밖 `\\degree` → `°` ──");
    console.log(`전체 ${rows.length}문항 · 바꿀 것 ${ready.length}건`);
    console.log(
      `  출처별 ${[...bySource].map(([s, n]) => `${s} ${n}`).join(" · ")}`,
    );
    console.log(
      `  수식 구간 안에만 있어 건드리지 않는 문항 ${untouched}건`,
    );
    console.log("\n치환 전후 표본:");
    for (const x of ready.slice(0, 5)) {
      console.log(
        `   ${(x.row.externalId ?? x.row.id).slice(0, 14).padEnd(15)} ${JSON.stringify(x.row.answer).slice(0, 46).padEnd(48)} → ${JSON.stringify(x.next).slice(0, 40)}`,
      );
    }
    if (ready.length === 0) return;

    await mkdir("scripts/qa/reports", { recursive: true });
    await writeFile(
      BACKUP,
      JSON.stringify(
        ready.map((x) => ({
          id: x.row.id,
          externalId: x.row.externalId,
          before: x.row.answer,
          after: x.next,
        })),
        null,
        1,
      ),
      "utf-8",
    );
    console.log(`\n백업 → ${BACKUP}`);

    if (!apply) {
      console.log("드라이런이다. 반영하려면 --apply (+ ALLOW_SHARED_IMPORT=1)");
      return;
    }
    const inspection = await inspectDatabaseTargets();
    if (
      !inspection.selected.canMigrateOrLoad &&
      !allowSharedImport(inspection.selected)
    ) {
      console.log(
        `\n차단 — ${inspection.selected.reason}\nALLOW_SHARED_IMPORT=1 을 명시하세요.`,
      );
      return;
    }
    const applied = [];
    let skipped = 0;
    for (const x of ready) {
      // 공유 DB 를 여러 트랙이 같이 쓴다. 우리가 본 값 그대로일 때만 덮는다.
      const current = await prisma.problem.findUnique({
        where: { id: x.row.id },
        select: { answer: true },
      });
      if (current?.answer !== x.row.answer) {
        console.log(`   건너뜀 ${x.row.externalId ?? x.row.id} — 그 사이 값이 바뀌었다`);
        skipped += 1;
        continue;
      }
      await prisma.problem.update({
        where: { id: x.row.id },
        data: { answer: x.next },
      });
      applied.push({
        id: x.row.id,
        externalId: x.row.externalId,
        before: x.row.answer,
        after: x.next,
      });
    }
    const logPath = await writeAppliedLog(
      "phase5-bare-latex",
      "scripts/qa/repair-bare-degree.ts",
      applied,
    );
    console.log(`\n적용 — ${applied.length}건 치환 · 건너뜀 ${skipped}`);
    console.log(`되돌리기 목록(이 단계만) → ${logPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
