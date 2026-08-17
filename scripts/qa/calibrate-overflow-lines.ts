/**
 * 넘침 줄 수 한계값 보정 — **같은 경고 건수로 맞춰** 비교한다.
 *
 * `printOverflow.ts` 주석이 이미 경고한다: 임계값을 바꿀 때 분모가 다르면
 * "새 규칙이 놓치는 게 없다"는 착시가 생긴다. 그래서 이 도구는 두 가지를 따로 낸다.
 *
 *   ① 폭 규칙(530)이 잡던 건수와 **같은 규모**가 되는 줄 수 한계값
 *   ② 그 한계값에서 줄 수 규칙이 **추가로** 잡는 문항 — 이게 상자·보기 1열
 *      수리로 실제 높아진 지면이다. 폭 총합은 이 변화를 한 글자도 못 본다.
 *
 *   npx tsx scripts/qa/calibrate-overflow-lines.ts
 *   npx tsx scripts/qa/calibrate-overflow-lines.ts --samples
 */
import { PrismaClient } from "@prisma/client";

import { displayWidth } from "../../src/lib/math/displayWidth";
import {
  OVERFLOW_WIDTH_LIMIT,
  estimateProblemLines,
} from "../../src/lib/printOverflow";

const prisma = new PrismaClient();

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const total = await prisma.problem.count();
  console.log(`문항 ${total.toLocaleString()}건 — 전수`);

  const rows: Array<{ id: string; width: number; lines: number }> = [];
  const PAGE = 2000;
  for (let skip = 0; skip < total; skip += PAGE) {
    const page = await prisma.problem.findMany({
      select: { id: true, content: true },
      orderBy: { id: "asc" },
      skip,
      take: PAGE,
    });
    if (page.length === 0) break;
    for (const row of page) {
      const content = row.content ?? "";
      rows.push({
        id: row.id,
        width: displayWidth(content),
        lines: estimateProblemLines(content),
      });
    }
  }

  const byWidth = rows.filter((r) => r.width > OVERFLOW_WIDTH_LIMIT);
  console.log(
    `\n폭 규칙(> ${OVERFLOW_WIDTH_LIMIT}) 이 잡는 문항: ${byWidth.length}건 (${((byWidth.length * 100) / rows.length).toFixed(2)}%)`,
  );

  // ① 같은 규모가 되는 줄 수 한계값 찾기
  console.log("\n줄 수 한계값별 경고 건수");
  console.log("  한계  경고건수    비율     폭규칙 대비");
  const target = byWidth.length;
  let best = { limit: 0, count: Number.MAX_SAFE_INTEGER };
  for (let limit = 4; limit <= 30; limit += 1) {
    const count = rows.filter((r) => r.lines > limit).length;
    const mark = Math.abs(count - target) < Math.abs(best.count - target);
    if (mark) best = { limit, count };
    if (limit <= 20 || count > 0) {
      console.log(
        `  ${String(limit).padStart(4)}  ${String(count).padStart(7)}  ${((count * 100) / rows.length).toFixed(2).padStart(6)}%  ${(count / Math.max(1, target)).toFixed(2)}배`,
      );
    }
  }
  console.log(
    `\n→ 폭 규칙과 가장 가까운 규모: 한계 ${best.limit} (${best.count}건, 폭 규칙 ${target}건)`,
  );

  // ② 그 한계에서 줄 수 규칙만 잡는 것 = 배치가 높아진 문항
  const byLines = rows.filter((r) => r.lines > best.limit);
  const widthIds = new Set(byWidth.map((r) => r.id));
  const onlyLines = byLines.filter((r) => !widthIds.has(r.id));
  const onlyWidth = byWidth.filter(
    (r) => !new Set(byLines.map((x) => x.id)).has(r.id),
  );

  console.log(`\n두 규칙의 관계 (한계 ${best.limit} 기준)`);
  console.log(`  둘 다 잡음          ${byLines.length - onlyLines.length}`);
  console.log(
    `  줄 수만 잡음        ${onlyLines.length}  ← 배치가 높아 잘릴 것`,
  );
  console.log(`  폭만 잡음           ${onlyWidth.length}`);

  if (wantSamples && onlyLines.length > 0) {
    console.log("\n줄 수만 잡은 표본 — 눈으로 볼 것");
    for (const r of onlyLines.slice(0, 10)) {
      const row = await prisma.problem.findUnique({
        where: { id: r.id },
        select: { content: true },
      });
      console.log(
        `\n· ${r.id.slice(0, 8)} 폭 ${r.width} / 줄 ${r.lines}\n  ${(row?.content ?? "").slice(0, 200).replace(/\n/g, " ⏎ ")}`,
      );
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
