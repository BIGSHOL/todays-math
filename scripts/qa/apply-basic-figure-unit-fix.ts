/**
 * 중1 「기본 도형 · 점, 선, 면」 문항이 **공통수학2 「도형의 방정식」**에 앉아 있다.
 *
 *   npx tsx scripts/qa/apply-basic-figure-unit-fix.ts                # 드라이런(기본)
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-basic-figure-unit-fix.ts --apply
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-basic-figure-unit-fix.ts --revert --apply
 *
 * ## 왜 붙었나 — **소단원 이름이 같다**
 *
 *   중1 5. 기본 도형        > 점, 선, 면            … 선분 AB 의 길이·중점·삼등분점
 *   공통수학2 1. 도형의 방정식 > 두 점 사이의 거리(1) … √((x₂−x₁)²+(y₂−y₁)²)
 *
 * 둘 다 「두 점 사이의 거리」를 다루지만 **완전히 다른 것**이다. 이관이 이름으로
 * 붙이면서 중등 문항이 고등 단원에 들어갔다. `19efbbfa`(J20108)와 같은 부류인데
 * 방향이 반대다(중등 → 고등).
 *
 * ## 근거는 **본문이 아니라 원본 지면**이다
 *
 * 본문만 보면 「선분의 중점」이라 중등처럼 보이지만, 그건 읽는 사람의 판단이다.
 * 여기서는 **원본 책의 쪽을 떠서** 확인했다 — `RPM 중학 1-2 학생용.pdf` p9,
 * 머리글이 「01 기본도형 / 01-1 점, 선, 면」이다. 9건 전부 그 쪽에서 왔다
 * (`rpm-crop-plan*.json` 의 pdf·page). 판정 근거를 한 컬럼에서만 찾지 않는다.
 *
 * ⚠️ 공유 DB(D-31). 기본은 드라이런. `ALLOW_UNIT_FIX=1` 일 때만 쓴다.
 * ⚠️ **문항 코드는 안 바뀐다**(D-53 스냅샷). `HC20101-…` 인 채로 중1 단원에 앉는다 —
 *    코드는 「발급 시점의 단원」이지 「지금 단원」이 아니다. 이건 설계대로다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { isDirectScript } from "../import/isDirectScript";

const LEDGER = "scripts/qa/reports/basic-figure-unit-fix.json";

/** 옮길 대상 — `problem_code` 앞부분과 출처로 좁힌다. */
export const FROM_PREFIX = "HC20101-";
export const TARGET = { grade: "중1", sectionContains: "점, 선, 면" } as const;

/**
 * 원본이 이 쪽에서 왔는가 — **이관 계획에 적힌 pdf·page** 로 확인한 값이다.
 * 여기 없는 externalId 가 대상에 섞이면 멈춘다(범위가 샌 것이다).
 */
export const SOURCE_EVIDENCE =
  "RPM 중학 1-2 학생용.pdf p9 · 01 기본도형 / 01-1 점, 선, 면";

interface LedgerRow {
  id: string;
  code: string;
  beforeUnitId: string;
  afterUnitId: string;
}

async function main(): Promise<void> {
  const APPLY = process.argv.includes("--apply");
  const REVERT = process.argv.includes("--revert");
  if ((APPLY || REVERT) && process.env.ALLOW_UNIT_FIX !== "1") {
    console.error(
      "공유 DB 쓰기가 막혀 있다(D-31). ALLOW_UNIT_FIX=1 이 필요하다.",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    if (REVERT) return await revert(prisma, APPLY);

    const target = await prisma.unit.findFirst({
      where: {
        grade: TARGET.grade,
        section: { contains: TARGET.sectionContains },
      },
      select: { id: true, grade: true, chapter: true, section: true },
    });
    if (!target) {
      console.error(
        `🔴 옮길 단원을 못 찾았다: ${TARGET.grade} … ${TARGET.sectionContains}`,
      );
      process.exit(1);
    }

    const rows = await prisma.problem.findMany({
      where: {
        problemCode: { startsWith: FROM_PREFIX },
        source: "transformed",
      },
      select: {
        id: true,
        problemCode: true,
        unitId: true,
        unit: { select: { grade: true, chapter: true, section: true } },
      },
      orderBy: { problemCode: "asc" },
    });

    // 분모를 먼저 찍는다.
    console.log(
      `대상 후보 ${rows.length}건 (problem_code ${FROM_PREFIX}* · transformed)`,
    );
    console.log(`근거     ${SOURCE_EVIDENCE}`);
    console.log(
      `옮길 곳  ${target.grade} > ${target.chapter} > ${target.section}`,
    );
    const todo = rows.filter((r) => r.unitId !== target.id);
    console.log(`  이미 제자리  ${rows.length - todo.length}`);
    console.log(`  옮길 것      ${todo.length}`);
    for (const r of todo)
      console.log(
        `     ${r.problemCode}  ${r.unit?.grade} > ${r.unit?.section} → ${target.section}`,
      );

    if (!APPLY) {
      console.log("\n드라이런이다 — DB 를 한 건도 안 바꿨다.");
      return;
    }
    if (todo.length === 0) return;

    const ledgerRows: LedgerRow[] = todo.map((r) => ({
      id: r.id,
      code: r.problemCode,
      beforeUnitId: r.unitId,
      afterUnitId: target.id,
    }));
    mkdirSync(path.dirname(LEDGER), { recursive: true });
    writeFileSync(
      LEDGER,
      JSON.stringify(
        {
          note:
            "되돌리기 자료. beforeUnitId 가 옮기기 전 단원이다. " +
            "되돌리기: ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-basic-figure-unit-fix.ts --revert --apply",
          evidence: SOURCE_EVIDENCE,
          rows: ledgerRows,
        },
        null,
        1,
      ),
      "utf-8",
    );
    console.log(
      `\n되돌리기 원장 → ${LEDGER} (${ledgerRows.length}행) — DB 보다 먼저 썼다`,
    );

    for (const l of ledgerRows)
      await prisma.problem.update({
        where: { id: l.id },
        data: { unitId: l.afterUnitId },
      });
    console.log(`옮겼다: ${ledgerRows.length}건`);
  } finally {
    await prisma.$disconnect();
  }
}

/** 되돌리기 — **지금 값이 우리가 쓴 값일 때만** 되돌린다. */
async function revert(prisma: PrismaClient, apply: boolean): Promise<void> {
  if (!existsSync(LEDGER)) {
    console.error(`되돌릴 원장이 없다: ${LEDGER}`);
    process.exit(1);
  }
  const l = JSON.parse(readFileSync(LEDGER, "utf-8")) as { rows: LedgerRow[] };
  let done = 0;
  let skipped = 0;
  for (const r of l.rows) {
    const cur = await prisma.problem.findUnique({
      where: { id: r.id },
      select: { unitId: true },
    });
    if (!cur || cur.unitId !== r.afterUnitId) {
      skipped++;
      continue;
    }
    if (apply)
      await prisma.problem.update({
        where: { id: r.id },
        data: { unitId: r.beforeUnitId },
      });
    done++;
  }
  console.log(
    `되돌리기${apply ? "" : " (드라이런)"}: ${done} · 건너뜀 ${skipped}` +
      (skipped
        ? " — 그 뒤 다른 트랙이 바꾼 것이다. 남의 값을 덮지 않는다."
        : ""),
  );
}

if (isDirectScript(import.meta.url)) void main();
