/** 풀 0 갈래 검산 — 시안 데이터의 poolTotal 이 DB 와 맞는가 (일회성). */
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

interface G {
  start: { section: string };
  end: { grade: string; chapter: string; section: string };
  unitCount: number;
  poolTotal: number;
}

async function main() {
  const prisma = new PrismaClient();
  const d = JSON.parse(
    readFileSync(
      "src/app/dev/eywa-daily-wire/data-chapter-2026-08-10.json",
      "utf8",
    ),
  ) as { groups: G[] };
  const g = d.groups.find((x) => x.end.grade === "중1" && x.poolTotal === 0)!;
  console.log(
    "갈래:",
    g.start.section,
    "~",
    g.end.section,
    "· 단원",
    g.unitCount,
  );
  const units = await prisma.unit.findMany({
    where: { grade: "중1", chapter: g.end.chapter },
    orderBy: { orderIndex: "asc" },
    select: { id: true, section: true },
  });
  for (const u of units) {
    const total = await prisma.problem.count({ where: { unitId: u.id } });
    const ok = await prisma.problem.count({
      where: { unitId: u.id, reviewStatus: "approved", directUseAllowed: true },
    });
    console.log(` ${u.section}: 전체 ${total} · 승인+직접사용 ${ok}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
