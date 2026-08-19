/**
 * 보기 그림 짝을 못 찾아 **출제에서 뺀 행**의 DB 값을 파일로 뽑는다.
 *
 *   npx tsx scripts/qa/export-choice-rows.ts
 *
 * 출력: `scripts/qa/reports/rows-choice-hwp.json`
 * 쓰는 곳: `recover-choice-index-from-hwp.py` (파일 in / 파일 out — 08 §4)
 *
 * `hwpNumber` 는 교체 판정(`hwp-verdicts.jsonl`)이 이미 맞춰 둔 값을 그대로 쓴다.
 * 없으면 `null` 로 두고, 회수기가 DB 문항번호로 대신한다 — **추측한 값을 적어 두면
 * 다음 사람이 그것을 사실로 읽는다.**
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const LOCK = "scripts/qa/reports/choice-figure-discard-lock.json";
const VERDICTS = "scripts/qa/reports/hwp-verdicts.jsonl";
const OUT = "scripts/qa/reports/rows-choice-hwp.json";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const lock = JSON.parse(readFileSync(LOCK, "utf8")) as {
    이전상태: { id: string }[];
  };
  const ids = lock.이전상태.map((r) => r.id);
  const rows = await prisma.problem.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      externalId: true,
      questionNumber: true,
      figureUrls: true,
      answer: true,
    },
  });

  const hwpNumber = new Map<string, number>();
  if (existsSync(VERDICTS)) {
    for (const line of readFileSync(VERDICTS, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const j = JSON.parse(line) as {
        externalId?: string;
        hwpNumber?: number;
      };
      if (j.externalId && j.hwpNumber) hwpNumber.set(j.externalId, j.hwpNumber);
    }
  }

  const out = rows.map((r) => ({
    ...r,
    hwpNumber: hwpNumber.get(r.externalId ?? "") ?? null,
  }));
  writeFileSync(OUT, JSON.stringify(out, null, 1), "utf8");
  console.log(
    `${out.length}행 · HWP 순번을 아는 것 ${out.filter((r) => r.hwpNumber).length} → ${OUT}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
