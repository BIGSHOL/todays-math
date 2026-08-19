/**
 * 그림 유실 전수 조사 — **본문이 그림을 지목하는데 그림이 없는 문항**을 센다.
 *
 *   npx tsx scripts/qa/report-missing-figures.ts            # 집계만
 *   npx tsx scripts/qa/report-missing-figures.ts --list     # 대상 전량 목록
 *   npx tsx scripts/qa/report-missing-figures.ts --json     # scripts/qa/reports/ 에 기록
 *
 * 판정 규칙은 `missingFigureRule.ts` 하나뿐이다 — 잠그는 쪽(`apply-missing-figure-lock.ts`)도
 * 같은 파일을 읽는다. 목록을 양쪽에 각각 쓰면 **세는 쪽과 고치는 쪽이 같이 눈이 먼다.**
 *
 * ## 손으로 쓴 목록은 눈이 먼다 — 그래서 발견기를 같이 돌린다
 *
 * 첫 지시어 목록 5개는 198건을 못 봤다. 그 사실은 「그림」 전수와 대조해서야 드러났다.
 * 그래서 이 스크립트는 판정과 **함께** `미분류` 를 반드시 출력한다 —
 * 「그림」이 있는데 지시어에도 오탐 목록에도 안 걸린 것. 0이 아니면 목록이 아직 눈멀었다는
 * 뜻이고, 사람이 그 표본을 봐야 한다. 조용히 잘라내지 않는다.
 * (CLAUDE.md 2026-08-18 「목록을 손으로 쓰면 세는 쪽과 고치는 쪽이 같이 눈이 먼다」)
 *
 * 회수 진행 상황은 `docs/planning/16-figure-recovery-ledger.md` 에 누적한다.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import {
  classifyFigureNeed,
  MENTIONS_FIGURE_WHERE,
  NO_FIGURE_WHERE,
} from "../../src/lib/figure/missingFigureRule";

const prisma = new PrismaClient();

type Row = {
  id: string;
  externalId: string | null;
  source: string;
  content: string;
  directUseAllowed: boolean;
  reviewStatus: string;
};

const flat = (s: string) => s.replace(/\s+/g, " ");

async function main() {
  const list = process.argv.includes("--list");
  const json = process.argv.includes("--json");

  // 「그림」이 든 것만 끌어온다 — 판정은 여기 코드에서, DB 쿼리에서 하지 않는다.
  const rows = (await prisma.problem.findMany({
    where: { ...MENTIONS_FIGURE_WHERE, ...NO_FIGURE_WHERE },
    select: {
      id: true,
      externalId: true,
      source: true,
      content: true,
      directUseAllowed: true,
      reviewStatus: true,
    },
    orderBy: { id: "asc" },
  })) as Row[];

  const broken: Row[] = [];
  const contaminated: Row[] = [];
  const benign: Row[] = [];
  const unclassified: Row[] = [];

  const bucket = {
    유실: broken,
    오염: contaminated,
    불필요: benign,
    미분류: unclassified,
  };
  for (const r of rows) bucket[classifyFigureNeed(r.content)].push(r);

  const printable = (rs: Row[]) =>
    rs.filter((r) => r.directUseAllowed && r.reviewStatus === "approved")
      .length;
  const bySource = (rs: Row[]) => {
    const m: Record<string, number> = {};
    for (const r of rs) m[r.source] = (m[r.source] ?? 0) + 1;
    return m;
  };

  console.log(`본문에 「그림」 + 그림 파일 없음 = ${rows.length}건\n`);
  console.log(`■ 그림 유실 (지시어 있음)   ${broken.length}건`);
  console.log(`   · 지금 출제 가능           ${printable(broken)}건`);
  console.log(
    `   · source 별                ${JSON.stringify(bySource(broken))}`,
  );
  console.log(`■ 본문 오염 (\`[그림]\` 자국)  ${contaminated.length}건`);
  console.log(`   · 지금 출제 가능           ${printable(contaminated)}건`);
  console.log(`□ 그림이 필요 없는 것        ${benign.length}건`);
  console.log(
    `? 미분류 — 목록이 눈멀었는지 확인해야 한다  ${unclassified.length}건`,
  );

  if (unclassified.length > 0) {
    console.log("\n미분류 표본 (사람이 봐야 한다):");
    const step = Math.max(1, Math.floor(unclassified.length / 10));
    for (let i = 0; i < unclassified.length && i / step < 10; i += step) {
      console.log(`  · ${flat(unclassified[i]!.content).slice(0, 120)}`);
    }
  }

  if (list) {
    console.log("\n───── 그림 유실 전량 ─────");
    for (const r of broken) {
      console.log(
        `${r.id}\t${r.source}\t${r.externalId ?? "-"}\t${flat(r.content).slice(0, 90)}`,
      );
    }
  }

  if (json) {
    mkdirSync("scripts/qa/reports", { recursive: true });
    const out = "scripts/qa/reports/missing-figures.json";
    writeFileSync(
      out,
      JSON.stringify(
        {
          측정: "본문이 그림을 지목하는데 figureUrls·figureSvg 가 모두 빈 문항",
          전체: rows.length,
          그림유실: broken.length,
          그림유실_출제가능: printable(broken),
          본문오염: contaminated.length,
          그림불필요: benign.length,
          미분류: unclassified.length,
          목록: broken.map((r) => ({
            id: r.id,
            externalId: r.externalId,
            source: r.source,
            directUseAllowed: r.directUseAllowed,
            본문: flat(r.content).slice(0, 200),
          })),
        },
        null,
        1,
      ),
      "utf8",
    );
    console.log(`\n기록 → ${out}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
