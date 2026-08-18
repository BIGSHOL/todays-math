/**
 * **그림이 이미 붙어 있는 기출 행**의 지도. 앵커 어긋남 검사가 이걸 읽는다.
 *
 *   npx tsx scripts/qa/build-figure-row-map.ts
 *
 * 출력: `scripts/qa/reports/figure-row-map.json`  `[{e, q, db:[url…]}]`
 *
 * `recover-hwp-figures.py` 는 회수하려는 그림이 **같은 시험지의 다른 문항에 이미
 * 붙어 있는 그림과 같으면** 버린다. 지면 오른쪽에 떠 있는 그림은 HWP 문단 흐름에서
 * 앞 문항 범위에 걸리기 때문이다(실측 4321: 12번의 격자가 11번에 잡혔다).
 * 그 검사에 쓸 «이미 붙은 것» 목록을 DB 에서 뽑는다.
 *
 * 예전엔 `export-figure-rows.mjs` 가 이 파일을 만들었는데, 그건 트랙 D 의
 * `hwp-verdicts.jsonl`(이 컴퓨터에 없다)을 요구한다. 앵커 검사에 필요한 것은
 * 정렬이 아니라 **어느 문항에 어떤 파일이 붙어 있나**뿐이라 DB 만으로 충분하다.
 */
import { writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const OUT = "scripts/qa/reports/figure-row-map.json";

async function main(): Promise<void> {
  const rows = await prisma.problem.findMany({
    where: {
      source: "past_exam",
      NOT: { figureUrls: { isEmpty: true } },
    },
    select: { externalId: true, questionNumber: true, figureUrls: true },
  });
  const out = rows
    .map((r) => ({
      e: r.externalId?.split("-")[0] ?? "",
      q: r.questionNumber ?? Number(r.externalId?.split("-")[1] ?? 0),
      db: r.figureUrls,
    }))
    .filter((r) => r.e && r.q);
  writeFileSync(OUT, JSON.stringify(out, null, 1), "utf8");
  console.log(`그림 붙은 기출 ${out.length}행 → ${OUT}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
