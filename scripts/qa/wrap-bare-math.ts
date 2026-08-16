/**
 * `$` 밖에 나와 있는 **순수 수식 정답을 `$...$` 로 감싼다** (트랙 B, 6단계).
 *
 * 왜: `renderMathHtml` 은 `$...$` 안만 KaTeX 에 넘긴다. 밖에 있는 `\frac{12}{13}` 은
 * 오류 없이 그대로 찍혀 학생 시험지에 `\frac{12}{13}` 으로 인쇄된다.
 *
 * **감싸는 것과 고치는 것은 다르다.** 감싸면 렌더는 통과하지만 값이 답으로
 * 읽히지 않는 것은 「깨지지 않은 틀린 답」이 되어 더 나쁘다. 그래서 넷을 뺀다:
 *
 * | 빼는 것 | 왜 |
 * |---|---|
 * | `\square` 보유 | 자리표와 안 맞는 괄호가 든 훼손 값이다. 감싸면 훼손이 숨는다 |
 * | `\text` 보유 | KaTeX 가 한글을 못 그린다. 감싸면 지금보다 나빠진다 |
 * | 한글이 섞인 값 | 위와 같다. `또는`·단위를 어떻게 인쇄할지는 표기 결정 사항이다 |
 * | 이미 `$` 가 있는 값 | 통째로 감싸면 `$…$…$` 로 중첩돼 깨진다 |
 *
 * 남은 것도 **값 전체를 감싸 실제로 렌더해 보고** 성공한 것만 바꾼다 —
 * 모양 추정으로는 인자 경계를 잘못 잡는다.
 *
 *   npx tsx scripts/qa/wrap-bare-math.ts                    드라이런(기본)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/wrap-bare-math.ts --apply
 *
 * 되돌리기 목록은 이 단계 것만 `scripts/qa/applied/phase6-wrap-math.json` 에 남긴다.
 */
import { mkdir, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { renderMathHtml } from "../../src/lib/math/renderMathHtml";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";
import { writeAppliedLog } from "./applied-log";
import { bareCommands } from "./audit-bare-latex";

const BACKUP = "scripts/qa/reports/wrap-bare-math.json";

function rendersCleanly(text: string): boolean {
  try {
    const html = renderMathHtml(text);
    return !(
      html.includes("math-raw") ||
      html.includes("katex-error") ||
      /#cc0000/i.test(html)
    );
  } catch {
    return false;
  }
}

/** 감싸면 안 되는 값인지. 사유를 돌려준다(보고용). */
export function excuse(answer: string, commands: string[]): string | null {
  if (commands.includes("\\square")) return "자리표(\\square)가 든 훼손 값";
  if (commands.includes("\\text")) return "\\text — KaTeX 가 한글을 못 그린다";
  if (/[가-힣]/.test(answer)) return "한글이 섞여 있다 — 표기 결정 사항";
  if (answer.includes("$")) return "이미 수식 구간이 있다";
  // 분수 바로 뒤에 숫자가 붙은 것은 값이 중복돼 들어간 훼손이다 — `\frac\{16\}\{17\}17`.
  // 감싸면 렌더는 되지만 답으로는 안 읽힌다. `\square` 와 같은 성격이라 뺀다.
  if (/\\t?frac\{[^{}]*\}\{[^{}]*\}\d/.test(answer)) {
    return "분수 뒤에 숫자가 붙은 훼손 값";
  }
  return null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.problem.findMany({
      select: { id: true, source: true, externalId: true, answer: true },
    });

    const bare = rows.filter(
      (r) =>
        r.answer &&
        !r.answer.includes("정답 없음") &&
        bareCommands(r.answer).length > 0,
    );

    const ready: Array<{ row: (typeof bare)[number]; next: string }> = [];
    const held = new Map<string, typeof bare>();
    for (const row of bare) {
      const why =
        excuse(row.answer, bareCommands(row.answer)) ??
        (rendersCleanly(`$${row.answer}$`) ? null : "감싸면 렌더가 깨진다");
      if (why) {
        if (!held.has(why)) held.set(why, []);
        (held.get(why) as typeof bare).push(row);
        continue;
      }
      ready.push({ row, next: `$${row.answer}$` });
    }

    console.log("── `$` 밖 수식을 `$...$` 로 감싸기 ──");
    console.log(`전체 ${rows.length}문항 · 수식 구간 밖 명령 보유 ${bare.length}건`);
    console.log(`  감쌀 것 ${ready.length}`);
    for (const [why, list] of [...held].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  보류 — ${why} ${list.length}`);
    }
    console.log("\n전후 표본:");
    for (const item of ready.slice(0, 5)) {
      console.log(
        `   ${(item.row.externalId ?? item.row.id).slice(0, 14).padEnd(15)} ${JSON.stringify(item.row.answer).slice(0, 40).padEnd(42)} → ${JSON.stringify(item.next).slice(0, 42)}`,
      );
    }
    if (ready.length === 0) return;

    await mkdir("scripts/qa/reports", { recursive: true });
    await writeFile(
      BACKUP,
      JSON.stringify(
        {
          ready: ready.map((x) => ({
            id: x.row.id,
            externalId: x.row.externalId,
            before: x.row.answer,
            after: x.next,
          })),
          held: Object.fromEntries(
            [...held].map(([why, list]) => [
              why,
              list.map((r) => ({
                id: r.id,
                externalId: r.externalId,
                answer: r.answer,
              })),
            ]),
          ),
        },
        null,
        1,
      ),
      "utf-8",
    );
    console.log(`\n백업·보류 목록 → ${BACKUP}`);

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
    for (const item of ready) {
      const current = await prisma.problem.findUnique({
        where: { id: item.row.id },
        select: { answer: true },
      });
      if (current?.answer !== item.row.answer) {
        console.log(
          `   건너뜀 ${item.row.externalId ?? item.row.id} — 그 사이 값이 바뀌었다`,
        );
        skipped += 1;
        continue;
      }
      await prisma.problem.update({
        where: { id: item.row.id },
        data: { answer: item.next },
      });
      applied.push({
        id: item.row.id,
        externalId: item.row.externalId,
        before: item.row.answer,
        after: item.next,
      });
    }
    const logPath = await writeAppliedLog(
      "phase6-wrap-math",
      "scripts/qa/wrap-bare-math.ts",
      applied,
    );
    console.log(`\n적용 — ${applied.length}건 감쌈 · 건너뜀 ${skipped}`);
    console.log(`되돌리기 목록(이 단계만) → ${logPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
