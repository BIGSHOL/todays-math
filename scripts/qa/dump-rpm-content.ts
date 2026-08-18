/**
 * RPM 오려내기 관문이 대 볼 **DB 본문**을 뽑는다.
 *
 *   npx tsx scripts/qa/dump-rpm-content.ts
 *
 * 입력: `scripts/qa/reports/rpm-crop-plan.json` (좌표 계획)
 * 출력: `scripts/qa/reports/rpm-crop-content.json` `{problemId: content}`
 *
 * 관문(`scripts/figure/gate-rpm-crop.py`)은 좌표가 가리키는 상자의 글자를 이 본문과
 * 견주어 **좌표가 맞는지**를 숫자로 가른다. 파이썬이 DB 를 모르므로 파일로 건넨다.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PLAN = "scripts/qa/reports/rpm-crop-plan.json";
const OUT = "scripts/qa/reports/rpm-crop-content.json";

async function main(): Promise<void> {
  const plan = JSON.parse(readFileSync(PLAN, "utf8")) as {
    목록: { problemId: string }[];
  };
  const ids = [...new Set(plan.목록.map((r) => r.problemId))];
  const rows = await prisma.problem.findMany({
    where: { id: { in: ids } },
    select: { id: true, content: true },
  });
  writeFileSync(
    OUT,
    JSON.stringify(Object.fromEntries(rows.map((r) => [r.id, r.content]))),
    "utf8",
  );
  console.log(`본문 ${rows.length}/${ids.length}건 → ${OUT}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
