/**
 * 단원 트리(id 포함)를 파일로 내린다. **읽기 전용** — 트랙 G 는 DB 에 쓰지 않는다.
 * 이후 학습·판정·평가는 전부 오프라인으로 돈다.
 *
 *   npx tsx -r dotenv/config scripts/classify/dump-units.ts
 */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const OUT = "scripts/classify/reports/units-db.json";

async function main() {
  const prisma = new PrismaClient();
  try {
    const units = await prisma.unit.findMany({
      select: { id: true, grade: true, chapter: true, section: true, orderIndex: true },
      orderBy: { orderIndex: "asc" },
    });
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(units, null, 1), "utf8");
    console.log(`단원 ${units.length}개 → ${OUT}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
