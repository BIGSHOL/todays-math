/**
 * `source='transformed'` 문항의 현재 본문을 통째로 떠 둔다.
 *
 * 보기 마커 복원(`restore-choice-markers.ts`)은 **학생이 보는 지면**을 고친다.
 * 원본 `content` 를 다른 데 남겨 두지 않으면 되돌릴 방법이 없다.
 *
 *   npx tsx scripts/qa/backup-transformed-content.ts
 *   → scripts/qa/reports/transformed-content-backup.json  (gitignore 대상)
 */
import { mkdir, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

const OUT = "scripts/qa/reports/transformed-content-backup.json";

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.problem.findMany({
      where: { source: "transformed" },
      select: { id: true, content: true, answer: true },
    });
    await mkdir("scripts/qa/reports", { recursive: true });
    await writeFile(OUT, JSON.stringify(rows), "utf-8");
    const chars = rows.reduce((a, r) => a + r.content.length, 0);
    console.log(
      `백업 ${rows.length}행 · 본문 ${(chars / 1000).toFixed(0)}k자 → ${OUT}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
