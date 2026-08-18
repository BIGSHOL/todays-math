// 적재 경로 배선 — 기출 문항이 들어오면 그 시험지의 `Exam`/`ExamQuestion` 도 함께 선다.
//
// 이 배선이 없으면 「오늘 넣은 데이터에만 유효한 수리」가 된다(BRIEF · CLAUDE.md 2026-08-18).
// 대역 단원은 전부 중2 라서(`src/mocks/data/units.ts`) 표본도 중2 시험지를 쓴다.
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { syncExamMetadata } from "@/lib/import/syncExamMetadata";
import { MOCK_UNITS } from "@/mocks/data/units";

const prisma = db as unknown as PrismaClient;
const UNIT_ID = MOCK_UNITS[0]!.id;
const USER_ID = "00000000-0000-4000-8000-000000000001";
const SOURCE_FILE = "N:\\기출\\[동부중][2][24-1-중간][비상] (완료).hwp";
const KEY = "동부중|중2|중2|2024-1-중간";

async function addProblem(over: Record<string, unknown> = {}) {
  await (
    prisma as unknown as {
      problem: { create: (a: unknown) => Promise<unknown> };
    }
  )// exam-wiring: 테스트 — 이 배선 자체를 검증하는 테스트다
  .problem
    .create({
      data: {
        userId: USER_ID,
        unitId: UNIT_ID,
        source: "past_exam",
        difficulty: "mid",
        problemType: "계산",
        questionType: "객관식",
        content: "다음 중 옳은 것은?",
        answer: "1",
        solution: null,
        figureUrls: [],
        figureDims: [],
        reviewStatus: "approved",
        directUseAllowed: true,
        score: 50,
        examId: "9001",
        sourceFile: SOURCE_FILE,
        questionNumber: 1,
        ...over,
      },
    });
}

describe("syncExamMetadata", () => {
  it("기출 문항이 있으면 그 편의 Exam 과 ExamQuestion 을 세운다", async () => {
    await addProblem({ questionNumber: 1, score: 50 });
    await addProblem({ questionNumber: 2, score: 50 });

    const result = await syncExamMetadata(prisma, ["9001"]);
    expect(result.inserted).toBe(1);

    const exam = await prisma.exam.findUnique({
      where: { externalExamId: KEY },
    });
    expect(exam).toMatchObject({
      school: "동부중",
      level: "중",
      grade: 2,
      subject: "중2",
      year: 2024,
      semester: 1,
      round: "중간",
      questionCount: 2,
      totalScore: 100,
    });

    const questions = (await prisma.examQuestion.findMany({
      where: { examId: exam!.id },
    })) as unknown as Array<{ problemId: string | null; number: number }>;
    expect(questions).toHaveLength(2);
    // 문제은행과 이어져 있어야 한다 — 이게 「몇 번 문항인가」를 되짚는 길이다.
    expect(questions.every((q) => q.problemId !== null)).toBe(true);
  });

  it("두 번 돌려도 exam 1행 그대로다 (멱등)", async () => {
    await addProblem({ questionNumber: 1, score: 100 });

    const first = await syncExamMetadata(prisma, ["9001"]);
    const second = await syncExamMetadata(prisma, ["9001"]);
    expect(first.inserted).toBe(1);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(1);
    expect(await prisma.exam.findMany({ where: {} })).toHaveLength(1);
  });

  it("정체를 못 정하는 편은 Exam 을 만들지 않고 **세어서** 돌려준다", async () => {
    await addProblem({ examId: "9002", sourceFile: "이상한이름.pdf" });

    const r = await syncExamMetadata(prisma, ["9002"]);
    expect(r.inserted).toBe(0);
    expect(r.unclassified).toHaveLength(1);
    expect(r.unclassified[0]?.examId).toBe("9002");
    expect(await prisma.exam.findMany({ where: {} })).toHaveLength(0);
  });

  it("⭐ 파일명에 「대비」가 있으면 문서 제목 없이는 세우지 않는다", async () => {
    await addProblem({
      examId: "9003",
      sourceFile: "N:\\기출\\[동부중][2][25-2-중간대비][비상] (완료).PDF",
    });

    const r = await syncExamMetadata(prisma, ["9003"]);
    expect(r.inserted).toBe(0);
    expect(r.unclassified).toHaveLength(1);
    expect(await prisma.exam.findMany({ where: {} })).toHaveLength(0);
  });

  it("⭐ 서로 다른 편이 같은 자연키를 내면 **양쪽 다** 막는다", async () => {
    // 같은 학교·학년·시점인데 원본 편이 둘이다 — upsert 로 넣으면 하나가 조용히 덮인다.
    await addProblem({ examId: "9010", questionNumber: 1, score: 100 });
    await addProblem({ examId: "9011", questionNumber: 1, score: 100 });

    const r = await syncExamMetadata(prisma, ["9010", "9011"]);
    expect(r.inserted).toBe(0);
    expect(r.collided.map((c) => c.examId).sort()).toEqual(["9010", "9011"]);
    expect(await prisma.exam.findMany({ where: {} })).toHaveLength(0);
  });

  it("빈 목록을 주면 아무것도 하지 않는다", async () => {
    const r = await syncExamMetadata(prisma, []);
    expect(r).toMatchObject({ inserted: 0, updated: 0 });
    expect(await prisma.exam.findMany({ where: {} })).toHaveLength(0);
  });

  it("문항이 하나도 없는 편은 미분류로 센다", async () => {
    const r = await syncExamMetadata(prisma, ["없는편"]);
    expect(r.unclassified).toHaveLength(1);
    expect(r.inserted).toBe(0);
  });
});
