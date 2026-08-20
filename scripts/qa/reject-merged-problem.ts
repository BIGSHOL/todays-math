/**
 * 여러 문항이 **한 행에 뭉친** 추출 실패본을 출제 풀에서 뺀다.
 *
 *   npx tsx scripts/qa/reject-merged-problem.ts                 # 드라이런(기본)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/reject-merged-problem.ts --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/reject-merged-problem.ts --revert --apply
 *
 * ## 왜 `directUseAllowed` 가 아니라 `reviewStatus` 인가
 *
 * `directUseAllowed` 를 **새로** 잠그려면 원장님 확인이 필요하고(스키마 주석),
 * 2026-08-18 지시는 **그림 유실** 결함군에 한정이다. 이건 다른 결함이다.
 * 그리고 이 저장소에는 이미 그 일을 하는 장치가 있다 — D-22 의 검수 판정이다
 * (`findEligibleProblems` 는 `approved` 만 본다). 새 잠금 장치를 만들 이유가 없다.
 *
 * ⚠️ `directUseAllowed` 는 **안 건드린다.** 그 컬럼은 그림 유실 잠금과 보기그림
 *    잠금이 이미 쓰고 있어서, 여기서 같이 쓰면 되돌릴 때 서로를 푼다
 *    (16 §3 「같은 컬럼을 두 스크립트가 잠근다」).
 *
 * ## 되돌리기
 *
 * 원장(`scripts/qa/reports/merged-problem-reject.json`)에 **이전 값**이 남는다.
 * 되돌릴 때는 **지금 값이 우리가 쓴 값일 때만** 되돌린다 — 그 사이 다른 트랙이
 * 바꿨으면 남의 값을 덮지 않는다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient, ReviewStatus } from "@prisma/client";

import { isDirectScript } from "../import/isDirectScript";

const LEDGER = "scripts/qa/reports/merged-problem-reject.json";

/**
 * 손으로 적은 목록이다 — **한 건씩 눈으로 보고** 넣는다.
 * 자동 판정기를 만들지 않는 이유: 「여러 문항이 뭉쳤다」는 본문 모양이 제각각이라
 * (「[서술형 1]…[서술형 4]」·번호 되풀이·정답 여러 개) 낱말로 세면 멀쩡한 것을
 * 같이 잡는다. 지금 대상은 한 건이고, 늘어나면 그때 열쇠를 찾는다.
 */
export const MERGED_ROWS: ReadonlyArray<{ code: string; why: string }> = [
  {
    code: "HC20207-MV4Q",
    why:
      "서술형 4문항이 한 행에 뭉쳤다 — 본문에 [서술형 1]~[서술형 4] 가 다 있고 " +
      "정답도 «[1]…[2]…[3]…[4]…» 로 넷이 붙어 있다. 한 문항으로는 못 낸다.",
  },
];

interface LedgerRow {
  id: string;
  code: string;
  beforeStatus: ReviewStatus;
  afterStatus: ReviewStatus;
  reportId: string | null;
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

    const codes = MERGED_ROWS.map((r) => r.code);
    const rows = await prisma.problem.findMany({
      where: { problemCode: { in: codes } },
      select: { id: true, problemCode: true, reviewStatus: true },
    });

    // 분모를 먼저 찍는다 — 목록과 실제가 안 맞으면 멈춘다.
    console.log(`목록 ${codes.length}건 · DB 에서 찾은 것 ${rows.length}건`);
    if (rows.length !== codes.length) {
      console.error(
        `🔴 못 찾은 문항이 있다: ${codes.filter((c) => !rows.some((r) => r.problemCode === c)).join(", ")}`,
      );
      process.exit(1);
    }

    const todo = rows.filter((r) => r.reviewStatus !== ReviewStatus.rejected);
    console.log(`  이미 rejected  ${rows.length - todo.length}`);
    console.log(`  바꿀 것        ${todo.length}`);
    for (const r of todo)
      console.log(`     ${r.problemCode}  ${r.reviewStatus} → rejected`);

    if (!APPLY) {
      console.log("\n드라이런이다 — DB 를 한 건도 안 바꿨다.");
      return;
    }
    if (todo.length === 0) return;

    // 되돌리기 원장을 **DB 보다 먼저** 쓴다.
    const ledgerRows: LedgerRow[] = todo.map((r) => ({
      id: r.id,
      code: r.problemCode,
      beforeStatus: r.reviewStatus,
      afterStatus: ReviewStatus.rejected,
      reportId: null,
    }));
    mkdirSync(path.dirname(LEDGER), { recursive: true });
    writeFileSync(
      LEDGER,
      JSON.stringify(
        {
          note:
            "되돌리기 자료. beforeStatus 가 바꾸기 전 값이다. " +
            "되돌리기: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/reject-merged-problem.ts --revert --apply",
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

    for (const l of ledgerRows) {
      const why = MERGED_ROWS.find((m) => m.code === l.code)!.why;
      // 「왜 뺐나」가 남아야 다음 사람이 같은 것을 또 조사하지 않는다.
      const report = await prisma.problemReport.create({
        data: { problemId: l.id, reason: "content", note: why },
        select: { id: true },
      });
      l.reportId = report.id;
      await prisma.problem.update({
        where: { id: l.id },
        data: { reviewStatus: ReviewStatus.rejected },
      });
      console.log(`  ${l.code} → rejected · 신고 ${report.id}`);
    }
    writeFileSync(
      LEDGER,
      JSON.stringify(
        { note: "되돌리기 자료.", applied: true, rows: ledgerRows },
        null,
        1,
      ),
      "utf-8",
    );
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
      select: { reviewStatus: true },
    });
    if (!cur || cur.reviewStatus !== r.afterStatus) {
      skipped++;
      continue;
    }
    if (apply) {
      await prisma.problem.update({
        where: { id: r.id },
        data: { reviewStatus: r.beforeStatus },
      });
      if (r.reportId)
        await prisma.problemReport.updateMany({
          where: { id: r.reportId, status: "open" },
          data: {
            status: "resolved",
            resolutionNote: "되돌렸다 — 다시 검수 대상이다.",
            resolvedAt: new Date(),
          },
        });
    }
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
