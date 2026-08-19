/**
 * 그림 149건을 붙이기 **전에** 「무엇이 바뀌고 무엇을 잃는가」를 센다 (D-20).
 *
 *   npx tsx scripts/qa/report-rpm-figure-attach-impact.ts
 *
 * 읽기만 한다. 산출: `scripts/qa/reports/rpm-figure-attach-impact.json`
 *
 * ## 왜 붙이기 전에 세나
 *
 * 2026-08-18 에 「불가 43건을 뺀다」가 **433건을 뺄 뻔했다.** 건수만 보면 433도
 * 그럴듯했다 — 잡아낸 것은 **손실 집계**뿐이었다(영향 단원이 25개가 아니라 100개,
 * 정원 아래로 내려가는 단원 2개). 이번은 방향이 반대(푸는 쪽)지만 같은 이유로 센다:
 *
 * - **덮어쓰기로 잃는 것**: 이미 `figureUrls` 가 있는 행에 새 그림을 쓰면 옛 그림이
 *   사라진다. 0이어야 한다 — 0이 아니면 멈추고 사람이 봐야 한다.
 * - **잠금 원장에 없는 행**: `--revert --recovered` 는 원장에 있는 것만 푼다.
 *   원장에 없으면 그림만 붙고 **잠긴 채로 남는다**(회수와 해제는 한 세트다).
 * - **풀에 들어오는 것**: 단원마다 몇 문항이 늘어나는가. 늘어나는 것이므로 «정원
 *   미달»이 생기지는 않지만, **어느 단원이 얼마나 늘어나는지**는 적어 둬야 다음
 *   사람이 「출제 결과가 왜 달라졌나」를 되짚을 수 있다.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const RESULTS = [
  "scripts/qa/reports/rpm-crop-result-gated.json",
  "scripts/qa/reports/rpm-crop-result-group.json",
];
const LOCK_LEDGER = "scripts/qa/reports/missing-figure-lock.json";
const OUT = "scripts/qa/reports/rpm-figure-attach-impact.json";

async function main() {
  const targets = new Map<string, string>();
  for (const p of RESULTS) {
    const one = JSON.parse(await readFile(p, "utf8")) as {
      성공: Array<{ problemId: string; publicPath: string }>;
    };
    for (const r of one.성공) targets.set(r.problemId, r.publicPath);
  }
  const ids = [...targets.keys()];
  console.log(`■ 붙일 대상 ${ids.length}건 (분모)`);

  const rows = await prisma.problem.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      unitId: true,
      source: true,
      figureUrls: true,
      figureSvg: true,
      directUseAllowed: true,
      reviewStatus: true,
    },
  });
  if (rows.length !== ids.length) {
    console.log(
      `⚠️ DB 에 없는 행 ${ids.length - rows.length}건 — 멈춰야 한다.`,
    );
  }

  // ⑴ 덮어쓰기로 잃는 것
  const overwrite = rows.filter(
    (r) => r.figureUrls.length > 0 || (r.figureSvg ?? "") !== "",
  );
  console.log(`\n■ 덮어쓰기로 잃는 것: ${overwrite.length}건 / ${rows.length}`);
  for (const r of overwrite.slice(0, 10)) {
    console.log(
      `   ${r.id.slice(0, 8)} figureUrls=${JSON.stringify(r.figureUrls)}`,
    );
  }

  // ⑵ 잠금 원장에 있나 — 없으면 그림만 붙고 잠긴 채로 남는다
  const ledger = JSON.parse(await readFile(LOCK_LEDGER, "utf8")) as {
    이전상태: Array<{ id: string; directUseAllowed: boolean }>;
  };
  const inLedger = new Set(ledger.이전상태.map((p) => p.id));
  const missing = rows.filter((r) => !inLedger.has(r.id));
  console.log(
    `\n■ 잠금 원장에 없는 행: ${missing.length}건 / ${rows.length}` +
      (missing.length > 0 ? "  ← 이 행은 붙여도 잠긴 채로 남는다" : ""),
  );

  // ⑶ 지금 잠겨 있나
  const locked = rows.filter((r) => !r.directUseAllowed);
  console.log(
    `■ 지금 잠겨 있는 행: ${locked.length}건 / ${rows.length} (해제 대상)`,
  );

  // ⑷ 풀에 들어오는 것 — 단원별
  const byUnit = new Map<string, number>();
  for (const r of rows) byUnit.set(r.unitId, (byUnit.get(r.unitId) ?? 0) + 1);
  const before = await prisma.problem.groupBy({
    by: ["unitId"],
    where: { unitId: { in: [...byUnit.keys()] }, directUseAllowed: true },
    _count: { _all: true },
  });
  const nowOf = new Map(before.map((b) => [b.unitId, b._count._all]));
  const units = await prisma.unit.findMany({
    where: { id: { in: [...byUnit.keys()] } },
    select: { id: true, grade: true, chapter: true, section: true },
  });
  const nameOf = new Map(
    units.map((u) => [u.id, `${u.grade} ${u.chapter} > ${u.section}`]),
  );

  const table = [...byUnit]
    .map(([unitId, add]) => ({
      unitId,
      단원: nameOf.get(unitId) ?? "(이름 없음)",
      지금: nowOf.get(unitId) ?? 0,
      늘어남: add,
      뒤: (nowOf.get(unitId) ?? 0) + add,
    }))
    .sort((a, b) => b.늘어남 - a.늘어남);

  console.log(`\n■ 영향 단원 ${table.length}개 — 출제 가능 문항이 늘어난다`);
  for (const t of table.slice(0, 12)) {
    console.log(
      `   +${String(t.늘어남).padStart(3)}  ${String(t.지금).padStart(4)} → ${String(t.뒤).padStart(4)}  ${t.단원}`,
    );
  }
  if (table.length > 12) console.log(`   … 그 외 ${table.length - 12}개 단원`);
  const empty = table.filter((t) => t.지금 === 0);
  console.log(
    `   그중 **지금 출제 가능 문항이 0개**이던 단원: ${empty.length}개` +
      (empty.length > 0 ? ` (이 단원은 이번에 처음 채워진다)` : ""),
  );

  const review = new Map<string, number>();
  for (const r of rows)
    review.set(r.reviewStatus, (review.get(r.reviewStatus) ?? 0) + 1);
  console.log(
    `\n■ 검수 상태: ${[...review].map(([k, v]) => `${k} ${v}`).join(" · ")}`,
  );

  // 🔴 는 **되돌릴 수 없는 손실**에만 쓴다. 「잠긴 채 남는다」는 손실이 아니라
  // **다른 원장이 잠근 행**이라는 뜻이다 — 실측 1건은 RPM 중복 정책이 내린 것이었다
  // (`scripts/qa/rpm-duplicate-decision.json` 의 `drop`). 내가 안 잠근 것은 내가 안 푼다
  // (문서 16 §5.1). 그래도 조용히 넘기면 다음 사람이 「회수했는데 왜 안 풀렸나」로 헤맨다.
  console.log(
    `\n${overwrite.length === 0 ? "✅" : "🔴"} 덮어써서 잃는 것 ${overwrite.length}건` +
      `\n${missing.length === 0 ? "✅" : "⚠️"} 붙여도 잠긴 채 남을 것 ${missing.length}건` +
      (missing.length > 0
        ? " — 누가 잠갔는지 확인하고 그 원장에 맡겨라(여기서 풀지 않는다)"
        : ""),
  );

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify(
      {
        기준: "붙이기 전 D-20 손실 집계",
        대상: rows.length,
        덮어쓰기로_잃는_행: overwrite.map((r) => r.id),
        잠금원장에_없는_행: missing.map((r) => r.id),
        지금_잠긴_행: locked.length,
        단원별: table,
        검수상태: Object.fromEntries(review),
      },
      null,
      1,
    ),
    "utf8",
  );
  console.log(`→ ${OUT}`);
  if (overwrite.length > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
