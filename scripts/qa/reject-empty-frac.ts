/**
 * **분자를 되살릴 수 없는 문항**을 출제에서 뺀다.
 *
 *   npx tsx scripts/qa/reject-empty-frac.ts                     # 드라이런(기본)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/reject-empty-frac.ts --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/reject-empty-frac.ts --revert --apply
 *
 * `repair-empty-frac.ts` 가 73자리를 되살리고 **5자리를 못 고쳤다.** 그 다섯은
 * 분자가 DB 에 **아예 없다** — `lim` 문항의 분수에서 분자만 통째로 빠졌다
 * (`t→1(\frac{}{t^{2}-1}`). 원본 PDF 를 다시 뽑기 전에는 되살릴 수 없다.
 *
 * 그런데 다섯 다 **출제 가능**이었다. 그대로 두면 지면 전처리가 `\frac{0}{…}`
 * 로 채워 **답이 될 수 없는 식**이 학생 시험지에 나간다.
 *
 * ## 왜 `directUseAllowed` 가 아니라 `reviewStatus` 인가
 *
 * 그 컬럼은 이미 두 스크립트(그림 유실 · 보기그림)가 잠그고 있다. 서로 모르면
 * 한쪽을 되돌릴 때 다른 쪽이 풀린다(CLAUDE.md 2026-08-18). `findEligibleProblems`
 * 는 `approved` 만 보므로 `rejected` 로 두면 출제에서 빠지고, 검수 화면에는
 * 남아 원장님이 나중에 되살릴 수 있다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient, ReviewStatus } from "@prisma/client";

import { isDirectScript } from "../import/isDirectScript";

const LEDGER = "scripts/qa/reports/empty-frac-reject.json";

interface LedgerRow {
  id: string;
  code: string;
  before: ReviewStatus;
  왜: string;
}

async function main(): Promise<void> {
  const APPLY = process.argv.includes("--apply");
  const REVERT = process.argv.includes("--revert");
  if ((APPLY || REVERT) && process.env.ALLOW_SHARED_IMPORT !== "1") {
    console.error(
      "공유 DB 쓰기가 막혀 있다(D-31). ALLOW_SHARED_IMPORT=1 이 필요하다.",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    if (REVERT) return await revert(prisma, APPLY);

    // 🔴 무리 필터를 **첫 가드**로 둔다. 대상은 「지금도 빈 분수가 남아 있고
    //    출제 가능한」 행뿐이다 — 수리된 42행이 여기 섞이면 안 된다
    //    (2026-08-18 「43이 433」과 같은 자리).
    const 후보 = await prisma.problem.findMany({
      where: {
        reviewStatus: ReviewStatus.approved,
        directUseAllowed: true,
        OR: [
          { content: { contains: "\\frac{}" } },
          { solution: { contains: "\\frac{}" } },
        ],
      },
      select: {
        id: true,
        problemCode: true,
        reviewStatus: true,
        content: true,
        solution: true,
      },
      orderBy: { problemCode: "asc" },
    });

    const ledger: LedgerRow[] = [];
    for (const r of 후보) {
      const 자리 = [r.content, r.solution]
        .filter((s): s is string => typeof s === "string")
        .flatMap((s) => s.match(/\\frac\{\}/g) ?? []).length;
      ledger.push({
        id: r.id,
        code: r.problemCode,
        before: r.reviewStatus,
        왜: `빈 분수 ${자리}자리 — 분자가 DB 에 없다`,
      });
    }

    console.log(`빈 분수가 남은 **출제 가능** 문항 ${후보.length}`);
    ledger.forEach((l) => console.log(`   ${l.code} — ${l.왜}`));

    // 무엇을 잃는가 (D-20) — 건수만 보면 범위가 새도 그럴듯하다.
    const 단원 = await prisma.problem.groupBy({
      by: ["unitId"],
      where: { id: { in: ledger.map((l) => l.id) } },
      _count: true,
    });
    console.log(`  영향 단원 ${단원.length}개`);
    for (const u of 단원) {
      const 남는수 = await prisma.problem.count({
        where: {
          unitId: u.unitId,
          reviewStatus: ReviewStatus.approved,
          directUseAllowed: true,
          id: { notIn: ledger.map((l) => l.id) },
        },
      });
      console.log(`   단원 ${u.unitId} — 빼는 ${u._count} · 남는 ${남는수}`);
    }

    if (!APPLY) {
      console.log("\n드라이런이다 — DB 를 한 건도 안 바꿨다.");
      return;
    }
    if (ledger.length === 0) return;

    mkdirSync(path.dirname(LEDGER), { recursive: true });
    writeFileSync(
      LEDGER,
      JSON.stringify(
        {
          note: "되돌리기 자료. 되돌리기: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/reject-empty-frac.ts --revert --apply",
          rows: ledger,
        },
        null,
        1,
      ),
      "utf-8",
    );
    console.log(
      `\n되돌리기 원장 → ${LEDGER} (${ledger.length}행) — DB 보다 먼저 썼다`,
    );

    for (const l of ledger)
      await prisma.problem.update({
        where: { id: l.id },
        data: { reviewStatus: ReviewStatus.rejected },
      });
    console.log(`적용 완료 ${ledger.length}건`);
  } finally {
    await prisma.$disconnect();
  }
}

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
      select: { reviewStatus: true, content: true, solution: true },
    });
    // 🔴 지금 값이 우리가 쓴 값일 때만, 그리고 **아직 빈 분수가 남아 있으면**
    //    되돌리지 않는다 — 되살리지도 않았는데 출제 풀에 다시 넣으면 안 된다.
    const 아직깨졌다 = [cur?.content, cur?.solution].some(
      (s) => typeof s === "string" && s.includes("\\frac{}"),
    );
    if (!cur || cur.reviewStatus !== ReviewStatus.rejected || 아직깨졌다) {
      skipped++;
      continue;
    }
    if (apply)
      await prisma.problem.update({
        where: { id: r.id },
        data: { reviewStatus: r.before },
      });
    done++;
  }
  console.log(
    `되돌리기${apply ? "" : " (드라이런)"}: ${done} · 건너뜀 ${skipped}` +
      (skipped ? " — 아직 빈 분수가 남았거나 남이 바꾼 것이다." : ""),
  );
}

if (isDirectScript(import.meta.url)) void main();
