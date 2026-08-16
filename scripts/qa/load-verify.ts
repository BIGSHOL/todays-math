/**
 * 트랙 F · F-4 검증 — **적재된 행을 DB 에서 직접 읽어 확인한다.**
 *
 *   npx tsx scripts/qa/load-verify.ts
 *
 * 읽기 전용. 내가 만든 파일이 아니라 **DB 가 실제로 무엇을 갖고 있는지**를 본다.
 * 커밋된 `handoff/load-external-ids.json` 을 정답지로 삼는다 — 그 목록이 되돌리기
 * 수단이므로, 목록과 DB 가 어긋나면 되돌릴 수도 없다는 뜻이다.
 *
 * 언제든 다시 돌릴 수 있다. 나중에 "그 적재가 정말 그 6,042행이었나" 를 묻는 답이다.
 */
import { readFile } from "node:fs/promises";

import { isDirectScript } from "../import/isDirectScript";

const IDS = "scripts/qa/handoff/load-external-ids.json";

export async function runVerify(): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const list = JSON.parse(await readFile(IDS, "utf8")) as {
      총: number;
      externalIds: string[];
      출제보류_pending: string[];
      입력corpus: { fingerprint: string };
    };

    // 목록의 externalId 로 DB 에서 되찾는다.
    const found: Array<{
      externalId: string | null;
      source: string;
      pool: string;
      reviewStatus: string;
      unitId: string;
      answer: string;
      figureUrls: string[];
      questionType: string | null;
      sourceFile: string | null;
      examId: string | null;
      school: string | null;
      questionNumber: number | null;
      content: string;
    }> = [];
    for (let i = 0; i < list.externalIds.length; i += 1000) {
      const page = await prisma.problem.findMany({
        where: { externalId: { in: list.externalIds.slice(i, i + 1000) } },
        select: {
          externalId: true,
          source: true,
          pool: true,
          reviewStatus: true,
          unitId: true,
          answer: true,
          figureUrls: true,
          questionType: true,
          sourceFile: true,
          examId: true,
          school: true,
          questionNumber: true,
          content: true,
        },
      });
      found.push(...(page as (typeof found)[number][]));
    }

    const byId = new Map(found.map((r) => [r.externalId ?? "", r]));
    const missing = list.externalIds.filter((id) => !byId.has(id));
    const pendingWant = new Set(list.출제보류_pending);
    const pendingGot = found.filter((r) => r.reviewStatus === "pending");

    const tally = (key: (r: (typeof found)[number]) => string): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const r of found) out[key(r)] = (out[key(r)] ?? 0) + 1;
      return out;
    };

    const 위반 = {
      "목록에 있는데 DB 에 없음": missing.length,
      "source 가 past_exam 아님": found.filter((r) => r.source !== "past_exam").length,
      "pool 이 shared 아님": found.filter((r) => r.pool !== "shared").length,
      "unitId 없음": found.filter((r) => !r.unitId).length,
      "figureUrls 가 비어 있지 않음": found.filter((r) => r.figureUrls.length > 0).length,
      "sourceFile 이 완료본 아님": found.filter(
        (r) => !/[(（]\s*완\s*료\s*[)）]/.test(r.sourceFile ?? ""),
      ).length,
      "역추적 메타 결손": found.filter(
        (r) => !r.examId || !r.school || r.questionNumber == null,
      ).length,
      "pending 이어야 하는데 approved": [...pendingWant].filter(
        (id) => byId.get(id)?.reviewStatus !== "pending",
      ).length,
      "approved 여야 하는데 pending": pendingGot.filter(
        (r) => !pendingWant.has(r.externalId ?? ""),
      ).length,
    };

    // 자동 출제 자격(D-22/D-26/§6) — approved + directUseAllowed + 정답 있음.
    const withAnswer = found.filter((r) => r.answer !== "(정답 없음)").length;
    const eligibleNow = found.filter(
      (r) => r.reviewStatus === "approved" && r.answer !== "(정답 없음)",
    ).length;

    const total = await prisma.problem.count();
    const past = await prisma.problem.count({ where: { source: "past_exam" } });

    console.log("── F-4 적재 검증 (DB 에서 직접 읽음) ──");
    console.log(`목록 ${list.총}행 · DB 에서 되찾음 ${found.length}`);
    console.log(`corpus ${list.입력corpus.fingerprint}`);
    console.log(`DB 총행 ${total} · past_exam ${past}`);
    console.log("\n위반 검사 (전부 0 이어야 한다):");
    for (const [k, v] of Object.entries(위반)) {
      console.log(`  ${v === 0 ? "✅" : "❌"} ${k.padEnd(28)} ${v}`);
    }
    console.log(
      `\nreviewStatus ${JSON.stringify(tally((r) => r.reviewStatus))}` +
        ` · pool ${JSON.stringify(tally((r) => r.pool))}`,
    );
    console.log(
      `출제형식 ${JSON.stringify(tally((r) => r.questionType ?? "(없음)"))}`,
    );
    console.log(
      `정답 보유 ${withAnswer} · 지금 자동 출제 자격 ${eligibleNow}` +
        `  (정답 없음 ${found.length - withAnswer} + 출제보류 ${pendingGot.length} 은 빠진다)`,
    );
    console.log(`\n출제보류 ${pendingGot.length}행: ${pendingGot.map((r) => r.externalId).join(" ")}`);

    const bad = Object.values(위반).some((v) => v !== 0);
    if (bad) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  runVerify().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
