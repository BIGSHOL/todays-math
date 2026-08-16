/**
 * 정답에서 **`$` 밖에 나와 있는 LaTeX 명령**을 전수로 센다 (트랙 B).
 *
 * 왜 따로 재나: `renderMathHtml` 은 `$...$` 안만 KaTeX 에 넘긴다. 밖에 있는
 * `\degree` 는 **오류를 내지 않고 그대로 지면에 찍힌다** — `30\degree`.
 * 렌더 실패 검사가 이걸 못 잡는다(실제로 "렌더 실패 0" 이라고 잘못 보고했다).
 *
 * ⚠️ 이 파일을 고칠 때 정규식의 역슬래시를 확인할 것. heredoc 으로 쓰면 셸이
 * `\\` 를 `\` 로 먹어 `/\\[a-zA-Z]+/` 가 `/\[a-zA-Z]+/` 가 된다 — 그러면 0건이
 * 나오고 **문제가 없는 것처럼 보인다.** 실제로 그렇게 한 번 오측정했다.
 *
 *   npx tsx scripts/qa/audit-bare-latex.ts
 *
 * **DB 를 건드리지 않는다.**
 */
import { mkdir, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import { renderMathHtml } from "../../src/lib/math/renderMathHtml";

const OUT = "scripts/qa/reports/bare-latex-audit.json";

/** `$...$` 구간을 들어낸 나머지. 여기 남은 LaTeX 명령이 지면에 평문으로 찍힌다. */
export function outsideMath(answer: string): string {
  return answer.split(/\$[^$]*\$/).join(" ");
}

export function bareCommands(answer: string): string[] {
  return outsideMath(answer).match(/\\[a-zA-Z]+/g) ?? [];
}

/**
 * `\frac` 의 인자 경계가 명확한지.
 *
 * `\frac{1}{2}` 는 중괄호로 둘러싸여 있어 `$...$` 로 감싸기 안전하다.
 * `\frac 12` `\frac{a+b}c` 처럼 중괄호가 빠진 것은 경계를 잘못 잡으면
 * 수식이 통째로 깨지므로 **손대면 안 된다.**
 */
export function fracShape(answer: string): "명확" | "불명확" | null {
  const outside = outsideMath(answer);
  const hits = outside.match(/\\frac[^]{0,24}/g);
  if (!hits) return null;
  return hits.every((h) => /^\\frac\s*\{[^{}]*\}\s*\{[^{}]*\}/.test(h))
    ? "명확"
    : "불명확";
}

/**
 * 값 전체를 `$...$` 로 감싸면 **실제로 렌더되는지**.
 *
 * 인자 경계가 명확해도 감싸도 되는 것은 아니다 — 괄호가 안 맞거나 `\square`
 * 자리표가 섞인 값은 감싸면 통째로 깨진다. 모양 추정 대신 **직접 렌더해 본다.**
 */
function wrapsCleanly(answer: string): boolean {
  try {
    const html = renderMathHtml(`$${answer}$`);
    return !(
      html.includes("math-raw") ||
      html.includes("katex-error") ||
      /#cc0000/i.test(html)
    );
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.problem.findMany({
      select: { id: true, source: true, externalId: true, answer: true },
    });

    const hits = rows.filter(
      (r) =>
        r.answer &&
        !r.answer.includes("정답 없음") &&
        bareCommands(r.answer).length > 0,
    );

    const byCommand = new Map<string, number>();
    const rowsByCommand = new Map<string, typeof hits>();
    for (const row of hits) {
      for (const cmd of new Set(bareCommands(row.answer))) {
        byCommand.set(cmd, (byCommand.get(cmd) ?? 0) + 1);
        if (!rowsByCommand.has(cmd)) rowsByCommand.set(cmd, []);
        (rowsByCommand.get(cmd) as typeof hits).push(row);
      }
    }

    const bySource = new Map<string, number>();
    for (const row of hits) {
      bySource.set(row.source, (bySource.get(row.source) ?? 0) + 1);
    }

    console.log("── 정답의 `$` 밖 LaTeX 명령 ──");
    console.log(`전체 ${rows.length}문항 · 해당 ${hits.length}건`);
    console.log(
      `  출처별 ${[...bySource].map(([s, n]) => `${s} ${n}`).join(" · ")}`,
    );
    console.log("\n명령별 (한 행에 여러 종류가 있으면 각각 셈):");
    for (const [cmd, n] of [...byCommand].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${cmd.padEnd(14)} ${String(n).padStart(4)}`);
    }

    // `\frac` 만 인자 경계를 따로 본다 — 감싸도 되는지 판단해야 한다.
    const fracRows = rowsByCommand.get("\\frac") ?? [];
    const shapes = new Map<string, typeof hits>();
    for (const row of fracRows) {
      const shape = fracShape(row.answer) ?? "불명확";
      if (!shapes.has(shape)) shapes.set(shape, []);
      (shapes.get(shape) as typeof hits).push(row);
    }
    if (fracRows.length > 0) {
      console.log("\n`\\frac` 인자 경계:");
      for (const [shape, list] of shapes) {
        console.log(`  ${shape} ${list.length}`);
        for (const row of list.slice(0, 4)) {
          console.log(
            `      ${(row.externalId ?? row.id).slice(0, 14).padEnd(15)} ${JSON.stringify(row.answer).slice(0, 60)}`,
          );
        }
      }
    }

    // `\degree` 는 `$` 안에도 나온다 — 그건 KaTeX 가 제대로 그리므로 건드리면 안 된다.
    const degreeInside = rows.filter(
      (r) =>
        r.answer &&
        /\$[^$]*\\degree[^$]*\$/.test(r.answer) &&
        !bareCommands(r.answer).includes("\\degree"),
    ).length;
    console.log(
      `\n참고 — \`$\` **안**에만 \`\\degree\` 가 있는 문항 ${degreeInside}건 (건드리지 않는다)`,
    );

    await mkdir("scripts/qa/reports", { recursive: true });
    await writeFile(
      OUT,
      JSON.stringify(
        {
          total: rows.length,
          bare: hits.length,
          bySource: Object.fromEntries(bySource),
          byCommand: Object.fromEntries(byCommand),
          fracShapes: Object.fromEntries(
            [...shapes].map(([k, v]) => [k, v.length]),
          ),
          fracWrapsCleanly: fracRows.filter((r) => wrapsCleanly(r.answer)).length,
          bareWrapsCleanly: hits.filter((r) => wrapsCleanly(r.answer)).length,
          degreeOnlyInsideMath: degreeInside,
          rows: hits.map((r) => ({
            id: r.id,
            source: r.source,
            externalId: r.externalId,
            answer: r.answer,
            commands: [...new Set(bareCommands(r.answer))],
          })),
        },
        null,
        1,
      ),
      "utf-8",
    );
    console.log(`\n→ ${OUT}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
