/**
 * 적대적 리뷰 — 임시 조회용. **읽기 전용**(SELECT 만 허용한다).
 *
 * 실행: npx tsx qa/adversarial/scripts/sql.ts "select id from problem limit 3"
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const query = process.argv[2];
  if (!query) throw new Error("질의를 넘겨라");
  if (!/^\s*select\b/i.test(query))
    throw new Error("SELECT 만 된다 (읽기 전용)");
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(query);
  for (const row of rows) console.log(JSON.stringify(row));
  console.log(`(${rows.length}행)`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
