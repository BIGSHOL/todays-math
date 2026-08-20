/**
 * 그림 칸 원장(㉮)이 대 볼 **DB 본문**을 뽑는다. **읽기만 한다.**
 *
 *   npx tsx scripts/qa/dump-rpm-figure-content.ts
 *
 * 입력: `scripts/qa/reports/rpm-origin.json` (2026-08-19 에 sumaek 에서 1회 수확한
 *       `source_coords`·책·쪽. 이 뒤로 원본 접속 없음)
 * 출력: `scripts/qa/reports/rpm-figure-content.json` `{problemId: content}`
 *
 * 왜 필요한가: `crop-rpm-from-pdf.figure_rect()` 는 「그림은 DB 본문에 없는 것」을
 * 열쇠로 발문과 그림을 가른다. 본문 없이 부르면 발문이 딸려 들어와 **원장의 rect 가
 * 실제 오려낸 칸과 달라진다.** 파이썬이 DB 를 모르므로 파일로 건넨다.
 *
 * ⚠️ `dump-rpm-content.ts` 와 낼 곳을 나눈 이유: 그쪽은 `rpm-crop-plan.json` 을
 * 입력으로 삼는데 그 계획 파일은 이 컴퓨터에 없고, 같은 이름에 쓰면 다른 세션의
 * 입력을 조용히 갈아치운다.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ORIGIN = "scripts/qa/reports/rpm-origin.json";
const OUT = "scripts/qa/reports/rpm-figure-content.json";

async function main(): Promise<void> {
  const origin = JSON.parse(readFileSync(ORIGIN, "utf8")) as {
    목록: { problemId: string; externalId: string }[];
  };
  const ids = [...new Set(origin.목록.map((r) => r.problemId))];
  const out: Record<string, string> = {};
  // 4,843건을 한 번에 물으면 파라미터 한도에 걸린다 — 나눠 묻는다.
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await prisma.problem.findMany({
      where: { id: { in: ids.slice(i, i + 500) } },
      select: { id: true, content: true },
    });
    for (const r of rows) out[r.id] = r.content;
  }
  writeFileSync(OUT, JSON.stringify(out), "utf8");
  console.log(`본문 ${Object.keys(out).length}/${ids.length}건 → ${OUT}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
