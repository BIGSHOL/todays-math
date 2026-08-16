/**
 * DB 정답에 남은 **글꼴 사용자영역(PUA) 잔재를 사람이 읽는 문자로 되돌린다** (트랙 B-1).
 *
 * 왜: 정답 `answer` 는 학생 시험지에 그대로 인쇄된다. `U+F081`~`U+F085` 는
 * HWP 기호폰트의 ①~⑤ 인데, 우리 지면 폰트에는 그 자리에 글리프가 없어
 * **네모 상자(tofu)** 로 찍힌다. 학생은 답을 못 읽는다.
 *
 * 근거는 추측이 아니다 — 해당 문항이 있는 시험지 7편의 정답면을 렌더해
 * 96건을 전수 대조했고 전부 일치했다(`answer-notation.ts` 주석에 편별 건수).
 *
 *   npx tsx scripts/qa/repair-answer-glyphs.ts                    드라이런(기본)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/repair-answer-glyphs.ts --apply
 *
 * 되돌릴 수 있게 바꾸기 전 값을 `scripts/qa/reports/answer-glyph-backup.json` 에 남긴다.
 */
import { mkdir, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";
import { hasBrokenGlyph, repairGlyphs } from "./answer-notation";
import { writeAppliedLog } from "./applied-log";

const BACKUP = "scripts/qa/reports/answer-glyph-backup.json";
/** 되돌릴 표를 아직 못 만든 PUA. 고쳐 쓰지 말고 보고만 한다. */
const UNMAPPED = /[\uE000-\uF080\uF086-\uF8FF]/;

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.problem.findMany({
      select: { id: true, externalId: true, source: true, answer: true },
    });

    const fixable = rows.filter((r) => hasBrokenGlyph(r.answer));
    const unknown = rows.filter((r) => UNMAPPED.test(r.answer));

    const bySource = new Map<string, number>();
    for (const row of fixable) {
      bySource.set(row.source, (bySource.get(row.source) ?? 0) + 1);
    }

    console.log("── 정답 글리프 복구 ──");
    console.log(`전체 문항 ${rows.length}`);
    console.log(
      `복구 대상 ${fixable.length} (${[...bySource].map(([s, n]) => `${s} ${n}`).join(" · ")})`,
    );
    console.log(`되돌릴 표가 없는 PUA ${unknown.length} — 손대지 않는다`);
    for (const row of unknown.slice(0, 5)) {
      const codes = [...row.answer]
        .filter((ch) => UNMAPPED.test(ch))
        .map((ch) => `U+${(ch.codePointAt(0) as number).toString(16).toUpperCase()}`);
      console.log(`   ${row.externalId ?? row.id} ${row.source} ${codes.join(",")}`);
    }
    for (const row of fixable.slice(0, 3)) {
      console.log(
        `   보기 ${row.externalId ?? row.id} → ${JSON.stringify(repairGlyphs(row.answer))}`,
      );
    }
    if (fixable.length === 0) return;

    await mkdir("scripts/qa/reports", { recursive: true });
    await writeFile(
      BACKUP,
      JSON.stringify(
        fixable.map((r) => ({
          id: r.id,
          externalId: r.externalId,
          before: r.answer,
          after: repairGlyphs(r.answer),
        })),
        null,
        1,
      ),
      "utf-8",
    );
    console.log(`백업 → ${BACKUP}`);

    if (!apply) {
      console.log("\n드라이런이다. 반영하려면 --apply (+ ALLOW_SHARED_IMPORT=1)");
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
    for (const row of fixable) {
      // 공유 DB 를 네 트랙이 같이 쓴다. 우리가 본 값 그대로일 때만 덮는다.
      const current = await prisma.problem.findUnique({
        where: { id: row.id },
        select: { answer: true },
      });
      if (current?.answer !== row.answer) {
        console.log(`   건너뜀 ${row.externalId ?? row.id} — 그 사이 값이 바뀌었다`);
        skipped += 1;
        continue;
      }
      const after = repairGlyphs(row.answer);
      await prisma.problem.update({
        where: { id: row.id },
        data: { answer: after },
      });
      applied.push({
        id: row.id,
        externalId: row.externalId,
        before: row.answer,
        after,
      });
    }
    const logPath = await writeAppliedLog(
      "phase1-glyph",
      "scripts/qa/repair-answer-glyphs.ts",
      applied,
    );
    console.log(`
적용 — ${applied.length}건 복구 · 건너뜀 ${skipped}`);
    console.log(`되돌리기 목록(이 단계만) → ${logPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
