/**
 * KaTeX 가 **못 그리는 명령**을 전수로 센다 — 지면에 붉은 날 글자로 나가는 것들.
 *
 * 원장님 지적(2026-08-18, 스크린샷 2건): `\htmlClass` · `\overarc` 가 붉은 글씨로
 * 그대로 나온다. CLAUDE.md 2026-08-14 교훈이 이미 적어 둔 자리다 —
 * **KaTeX 0.16 은 모르는 명령을 `.katex-error` 가 아니라 `color:#cc0000` 인
 * `.mord.text` 로 그린다.** 클래스만 보는 가드는 이걸 못 잡는다.
 *
 * 여기서는 클래스도 색도 보지 않고 **실제로 렌더해서** 붉은 조각이 나오는지 센다.
 * 렌더가 유일한 심판이다 — 명령 목록을 손으로 유지하면 반드시 새는 것이 생긴다.
 *
 *   npx tsx scripts/qa/measure-katex-unknown.ts
 *   npx tsx scripts/qa/measure-katex-unknown.ts --samples
 */
import katex from "katex";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MATH_SPAN = /\$([^$]+)\$/g;
/** KaTeX 0.16 이 «모르는 명령»을 그릴 때 쓰는 색. 클래스가 아니라 인라인 스타일이다. */
const RED = "#cc0000";

/** 붉게 그려진 조각에서 명령 이름만 뽑는다 (`\overarc` 처럼). */
const COMMAND = /\\[A-Za-z@]+/g;

function redCommands(expr: string): string[] {
  let html: string;
  try {
    html = katex.renderToString(expr, {
      throwOnError: false,
      output: "html",
      displayMode: false,
    });
  } catch {
    return ["(렌더 예외)"];
  }
  if (!html.includes(RED) && !html.includes("katex-error")) return [];
  // 붉은 조각 안의 명령만 센다. 식 전체에서 뽑으면 멀쩡한 명령까지 섞인다.
  const found = new Set<string>();
  for (const chunk of html.split("<span")) {
    if (!chunk.includes(RED) && !chunk.includes("katex-error")) continue;
    for (const m of chunk.matchAll(COMMAND)) found.add(m[0]);
  }
  if (found.size === 0) found.add("(명령 없음 — 구조 오류)");
  return [...found];
}

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const total = await prisma.problem.count();
  console.log(`문항 ${total.toLocaleString()}건 — 전수 렌더\n`);

  const byCommand = new Map<string, number>();
  const samples = new Map<string, Array<{ id: string; expr: string }>>();
  let badRows = 0;
  let badSpans = 0;
  let spans = 0;
  let scanned = 0;

  const PAGE = 1000;
  for (let skip = 0; skip < total; skip += PAGE) {
    const rows = await prisma.problem.findMany({
      select: { id: true, content: true },
      orderBy: { id: "asc" },
      skip,
      take: PAGE,
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      let rowBad = false;
      for (const m of (row.content ?? "").matchAll(MATH_SPAN)) {
        spans += 1;
        const expr = m[1] ?? "";
        const commands = redCommands(expr);
        if (commands.length === 0) continue;
        badSpans += 1;
        rowBad = true;
        for (const command of commands) {
          byCommand.set(command, (byCommand.get(command) ?? 0) + 1);
          if (!samples.has(command)) samples.set(command, []);
          const bucket = samples.get(command)!;
          if (bucket.length < 4) bucket.push({ id: row.id, expr });
        }
      }
      if (rowBad) badRows += 1;
    }
    if (skip % 10000 === 0 && skip > 0)
      console.log(`  … ${skip.toLocaleString()}건`);
  }

  console.log(
    `\n붉게 나가는 문항 ${badRows.toLocaleString()}건 (${((badRows * 100) / scanned).toFixed(2)}%)` +
      ` · 수식 span ${badSpans.toLocaleString()} / ${spans.toLocaleString()}`,
  );
  console.log("\n명령별 출현 수");
  for (const [command, count] of [...byCommand].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${command.padEnd(22)} ${count}`);
  }

  if (wantSamples) {
    console.log("\n\n표본 — 눈으로 볼 것");
    for (const [command, bucket] of samples) {
      console.log(`\n### ${command}`);
      for (const s of bucket) {
        console.log(`  · ${s.id.slice(0, 8)} ${s.expr.slice(0, 160)}`);
      }
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
