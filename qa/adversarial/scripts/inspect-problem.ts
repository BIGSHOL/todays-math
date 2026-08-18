/**
 * 적대적 리뷰 — 문항 하나를 옛 코드/새 코드로 나란히 본다. **읽기 전용.**
 *
 * 실행: npx tsx qa/adversarial/scripts/inspect-problem.ts <id 앞부분> [--raw]
 */
import { PrismaClient } from "@prisma/client";

import { parseProblemContent as parseNew } from "../../../src/lib/problem/parseProblemContent";
import { parseProblemContent as parseOld } from "../baseline/problem/parseProblemContent";

const prisma = new PrismaClient();

function show(label: string, text: string) {
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(text));
}

async function main() {
  const prefix = process.argv[2];
  if (!prefix) throw new Error("id 앞부분을 넘겨라");
  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; content: string }>
  >(
    `select id, content from problem where id::text like $1 limit 1`,
    `${prefix}%`,
  );
  const row = rows[0];
  if (!row) throw new Error(`없는 id: ${prefix}`);
  const content = row.content ?? "";
  console.log(`id ${row.id}`);
  if (process.argv.includes("--raw")) show("RAW", content);
  const a = parseOld(content);
  const b = parseNew(content);
  show("OLD question", a.question);
  show("NEW question", b.question);
  console.log(`\nOLD choices ${JSON.stringify(a.choices)}`);
  console.log(`NEW choices ${JSON.stringify(b.choices)}`);
  // 첫 차이 지점
  const n = Math.min(a.question.length, b.question.length);
  let i = 0;
  while (i < n && a.question[i] === b.question[i]) i += 1;
  console.log(
    `\n첫 차이 ${i}자째: OLD ${JSON.stringify(a.question.slice(i - 30, i + 60))}`,
  );
  console.log(
    `             NEW ${JSON.stringify(b.question.slice(i - 30, i + 60))}`,
  );
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
