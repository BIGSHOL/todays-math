/**
 * 이미 DB 에 들어간 `externalId` 를 파일로 내린다. **읽기 전용.**
 *
 *   npx tsx -r dotenv/config scripts/classify/dump-loaded-ids.ts
 *
 * 트랙 F 가 신규 적재를 계속하므로, 판정 대상을 "편이 DB 에 없는가" 로 잡으면
 * F 가 그 편의 일부(소단원 힌트가 있던 문항)를 적재한 순간 대상이 통째로 사라진다.
 * 대상은 **문항 단위 `externalId`** 로 걸러야 한다 — 열쇠는 externalId 다(원장 §2.2).
 */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { OUT_DIR } from "./paths";

const OUT = `${OUT_DIR}/loaded-external-ids.json`;

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.problem.findMany({
      where: { externalId: { not: null } },
      select: { externalId: true },
    });
    const ids = rows.map((r) => r.externalId as string).sort();
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT, JSON.stringify({ count: ids.length, ids }), "utf8");
    console.log(`적재된 externalId ${ids.length}개 → ${OUT}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
