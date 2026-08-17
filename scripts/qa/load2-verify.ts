/**
 * 트랙 F 2차 검증 — **적재된 행을 DB 에서 직접 읽어 확인한다.**
 *
 *   npx tsx scripts/qa/load2-verify.ts
 *
 * 읽기 전용. 내가 만든 파일이 아니라 **DB 가 실제로 무엇을 갖고 있는지**를 본다.
 * 커밋된 `handoff/load2-external-ids.json` 을 정답지로 삼는다 — 그 목록이 되돌리기
 * 수단이자 «추정 배정분» 의 유일한 기록이므로, 목록과 DB 가 어긋나면 되돌릴 수도
 * 없고 어느 행이 추정인지도 답할 수 없다는 뜻이다.
 *
 * 언제든 다시 돌릴 수 있다. 나중에 "그 적재가 정말 그 4,513행이었나" 를 묻는 답이다.
 */
import { readFile } from "node:fs/promises";

import { isDirectScript } from "../import/isDirectScript";
import { MISSING_ANSWER } from "./load-candidates";

const IDS = "scripts/qa/handoff/load2-external-ids.json";

export async function runVerify2(): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const list = JSON.parse(await readFile(IDS, "utf8")) as {
      총: number;
      externalIds: string[];
      출제보류_pending: string[];
      입력corpus: { fingerprint: string };
      판정: Array<{ externalId: string; unitId: string; 학년?: string | null }>;
    };
    const pending = new Set(list.출제보류_pending);
    const unitOf = new Map(list.판정.map((p) => [p.externalId, p.unitId]));

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
      directUseAllowed: boolean;
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
          directUseAllowed: true,
        },
      });
      found.push(...page);
    }

    const units = await prisma.unit.findMany({ select: { id: true, grade: true } });
    const unitById = new Map(units.map((u) => [u.id, u]));

    const missing = list.externalIds.filter(
      (id) => !found.some((f) => f.externalId === id),
    );
    const check = (label: string, bad: number): void => {
      console.log(`  ${bad === 0 ? "✅" : "❌"} ${label.padEnd(46)} ${bad === 0 ? "" : bad}`);
    };

    const total = await prisma.problem.count();
    const pastExam = await prisma.problem.count({ where: { source: "past_exam" } });
    const papers = await prisma.problem.findMany({
      where: { source: "past_exam", examId: { not: null } },
      select: { examId: true },
      distinct: ["examId"],
    });

    // `findEligibleProblems` 와 같은 조건.
    const eligible = await prisma.problem.count({
      where: {
        pool: "shared",
        reviewStatus: "approved",
        directUseAllowed: true,
        answer: { not: MISSING_ANSWER },
      },
    });

    console.log("── 2차 적재 검증 (DB 에서 직접 읽음) ──");
    console.log(
      `목록 ${list.총}행 · corpus ${list.입력corpus.fingerprint}\n` +
        `DB 총행 ${total} · past_exam ${pastExam} · 편 ${papers.length}`,
    );
    console.log(`\n출제 자격 문항 (pool=shared · approved · directUse · 정답 있음): ${eligible}`);

    console.log("\n목록 대조:");
    check("목록 전량이 DB 에 있다", missing.length);
    check("source=past_exam", found.filter((f) => f.source !== "past_exam").length);
    check("pool=shared", found.filter((f) => f.pool !== "shared").length);
    check("unitId 가 Unit 에 실재", found.filter((f) => !unitById.has(f.unitId)).length);
    check(
      "unitId 가 커밋본 판정과 같다",
      found.filter((f) => unitOf.get(f.externalId ?? "") !== f.unitId).length,
    );
    check(
      "figureUrls 가 비어 있다 (트랙 A 소유)",
      found.filter((f) => (f.figureUrls ?? []).length > 0).length,
    );
    check(
      "sourceFile 이 완료본 (D-37)",
      found.filter((f) => !/[(（]\s*완\s*료\s*[)）]/.test(f.sourceFile ?? "")).length,
    );
    check(
      "역추적 메타(examId·school·questionNumber) 결손",
      found.filter((f) => !f.examId || !f.school || f.questionNumber === null).length,
    );
    check(
      "출제보류 목록만 pending",
      found.filter(
        (f) =>
          (f.reviewStatus === "pending") !== pending.has(f.externalId ?? ""),
      ).length,
    );

    const withAnswer = found.filter((f) => f.answer !== MISSING_ANSWER).length;
    const approved = found.filter((f) => f.reviewStatus === "approved").length;
    const nowEligible = found.filter(
      (f) =>
        f.pool === "shared" &&
        f.reviewStatus === "approved" &&
        f.directUseAllowed &&
        f.answer !== MISSING_ANSWER,
    ).length;
    console.log(
      `\n적재분 — 정답 보유 ${withAnswer} · approved ${approved} · pending ${found.length - approved}`,
    );
    console.log(`적재분 중 지금 자동 출제 자격: ${nowEligible}`);
    console.log(
      `  (정답 없음 ${found.length - withAnswer} + 출제보류 ${found.length - approved} 은 빠진다)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  runVerify2().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
