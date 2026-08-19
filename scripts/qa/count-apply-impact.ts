/**
 * 적용 **전에** 「무엇이 늘고 무엇이 주는가」를 센다 (D-20).
 *
 *   npx tsx scripts/qa/count-apply-impact.ts
 *
 * 건수만 보면 다 그럴듯하다. 이 트랙 앞에서 **433건 잠금이 그럴듯해 보였는데 실은
 * 멀쩡한 문항 390건이 섞여 있었고**, 그걸 잡아낸 것은 건수가 아니라 **손실 분포**였다
 * (영향 단원 25 → 100, 정원 아래로 내려가는 단원 2개). 그래서 단원별로 센다.
 *
 * 세는 것:
 *   ① 그림이 붙어 출제 풀로 **돌아오는** 행 (+)
 *   ② 새로 찾은 유실로 **빠지는** 행 (−)
 *   ③ 본문이 바뀌는 행 (지면이 달라진다 — 늘지도 줄지도 않는다)
 *   ④ ①·② 가 닿는 **단원**과, 그 단원의 출제 가능 문항 수가 어떻게 변하나
 */
import { existsSync, readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import {
  classifyFigure,
  MENTIONS_FIGURE_WHERE,
  NO_FIGURE_WHERE,
} from "../../src/lib/figure/missingFigureRule";

const prisma = new PrismaClient();

/** 한 단원이 이 아래로 내려가면 출제가 흔들린다(D-20 의 정원 기준과 같은 수). */
const FLOOR = 8;

function planIds(path: string, key = "계획"): string[] {
  if (!existsSync(path)) return [];
  const j = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const rows = (Array.isArray(j) ? j : (j[key] as unknown[])) ?? [];
  return (rows as { id: string }[]).map((r) => r.id).filter(Boolean);
}

async function main(): Promise<void> {
  // ── ① 그림이 붙는 행
  const attach = [
    ...planIds("scripts/qa/reports/figure-recover-plan.json"),
    ...planIds("scripts/qa/reports/pdf-figure-result-hwp.json"),
    ...planIds("scripts/qa/reports/table-crop-result.json"),
  ];
  const attachIds = [...new Set(attach)];

  // ── ② 새로 «유실» 로 갈려 잠길 행 (지금 출제 가능한 것만 실제 손실이다)
  const cand = await prisma.problem.findMany({
    where: { ...MENTIONS_FIGURE_WHERE, ...NO_FIGURE_WHERE },
    select: {
      id: true,
      externalId: true,
      content: true,
      directUseAllowed: true,
      reviewStatus: true,
      unitId: true,
    },
  });
  const willLock = cand.filter(
    (r) => classifyFigure(r.content) === "유실" && r.directUseAllowed,
  );

  // ── ③ 본문이 바뀌는 행
  const replaceIds = existsSync("scripts/qa/reports/hwp-verdicts.jsonl")
    ? readFileSync("scripts/qa/reports/hwp-verdicts.jsonl", "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { id: string; verdict: string })
        .filter((v) => v.verdict === "교체")
        .map((v) => v.id)
    : [];

  // ── ④ 보기 그림 짝이 붙어 잠금이 풀릴 행
  const choiceIds = planIds(
    "scripts/qa/reports/choice-figure-pairs-hwp.json",
    "",
  );

  const rows = await prisma.problem.findMany({
    where: { id: { in: [...attachIds, ...choiceIds, ...replaceIds] } },
    select: {
      id: true,
      externalId: true,
      unitId: true,
      directUseAllowed: true,
    },
  });
  const by = new Map(rows.map((r) => [r.id, r]));

  const unlockIds = [...attachIds, ...choiceIds].filter(
    (id) => by.get(id)?.directUseAllowed === false,
  );

  console.log("── 적용하면 무엇이 달라지나 (D-20) ──");
  console.log(`  ① 그림이 붙는 행            ${attachIds.length}`);
  console.log(
    `     └ 그중 지금 잠겨 있어 **풀릴** 행 ${attachIds.filter((id) => by.get(id)?.directUseAllowed === false).length}`,
  );
  console.log(`  ② 보기 그림 짝이 붙는 행    ${choiceIds.length}`);
  console.log(
    `     └ 그중 지금 잠겨 있어 **풀릴** 행 ${choiceIds.filter((id) => by.get(id)?.directUseAllowed === false).length}`,
  );
  console.log(
    `  ③ 본문이 바뀌는 행          ${replaceIds.length} (늘지도 줄지도 않는다)`,
  );
  console.log(`  ④ 새로 **잠길** 행          ${willLock.length}`);
  for (const r of willLock)
    console.log(`     · ${r.externalId ?? r.id.slice(0, 8)}`);

  // ── 단원별 손익
  const unitIds = new Set<string>();
  for (const id of unlockIds) {
    const u = by.get(id)?.unitId;
    if (u) unitIds.add(u);
  }
  for (const r of willLock) if (r.unitId) unitIds.add(r.unitId);

  const before = new Map<string, number>();
  for (const u of unitIds) {
    before.set(
      u,
      await prisma.problem.count({
        where: { unitId: u, directUseAllowed: true, reviewStatus: "approved" },
      }),
    );
  }
  const delta = new Map<string, number>();
  for (const id of unlockIds) {
    const u = by.get(id)?.unitId;
    if (u) delta.set(u, (delta.get(u) ?? 0) + 1);
  }
  for (const r of willLock) {
    if (r.unitId && r.reviewStatus === "approved")
      delta.set(r.unitId, (delta.get(r.unitId) ?? 0) - 1);
  }

  const units = await prisma.unit.findMany({
    where: { id: { in: [...unitIds] } },
    select: { id: true, grade: true, chapter: true, section: true },
  });
  const name = new Map(
    units.map((u) => [u.id, `${u.grade} ${u.chapter} > ${u.section}`]),
  );

  let dropped = 0;
  console.log(`\n  영향 단원 ${unitIds.size}개`);
  for (const [u, d] of [...delta].sort((a, b) => a[1] - b[1])) {
    const b = before.get(u) ?? 0;
    const after = b + d;
    const flag = after < FLOOR && b >= FLOOR ? "  ← 정원 아래로 내려간다" : "";
    if (flag) dropped++;
    if (d < 0 || flag)
      console.log(
        `    ${name.get(u) ?? u}  ${b} → ${after} (${d > 0 ? "+" : ""}${d})${flag}`,
      );
  }
  console.log(`  정원(${FLOOR}) 아래로 내려가는 단원 ${dropped}개`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
