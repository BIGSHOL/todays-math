/**
 * PUT /api/tests/{id}/problems/{seq} — 동일 단원/난이도 + 최근 14일 중복 제외로 1클릭 교체.
 */
import type { Difficulty, DifficultyRatio } from "@/contracts/common.contract";
import {
  insufficientProblemsErrorResponseSchema,
  testProblemReplaceResponseSchema,
} from "@/contracts/test.contract";
import { jsonOk, notFoundError } from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { findEligibleProblems } from "@/lib/findEligibleProblems";
import { selectProblems } from "@/lib/generator/selectProblems";
import { requireOwnedTest } from "@/lib/ownership";
import { serializeTest, serializeTestProblemItem } from "@/lib/serializers";
import type { SessionUser } from "@/lib/session";

import { loadRecentProblemIds } from "./recentProblemIds";

function ratioFor(difficulty: Difficulty): DifficultyRatio {
  return {
    easy: difficulty === "easy" ? 1 : 0,
    mid: difficulty === "mid" ? 1 : 0,
    hard: difficulty === "hard" ? 1 : 0,
  };
}

const ADJACENT: Record<Difficulty, Difficulty[]> = {
  easy: ["mid"],
  mid: ["easy", "hard"],
  hard: ["mid"],
};

export async function replaceTestProblemAtSeq(
  session: SessionUser,
  testId: string,
  seq: number,
) {
  const owned = await requireOwnedTest(testId, session.id);
  if (!owned.ok) return owned.response;

  const items = await db.testProblem.findMany({
    where: { testId },
    include: { problem: true },
    orderBy: { orderIndex: "asc" },
  });
  const target = items.find((item) => item.orderIndex === seq);
  if (!target?.problem) return notFoundError("문항");

  const today = owned.data.testDate.toISOString().slice(0, 10);
  const usedOnThisTest = items.map((item) => item.problemId);
  const recentProblemIds = [
    ...new Set([
      ...(await loadRecentProblemIds(session.id, today)),
      ...usedOnThisTest,
    ]),
  ];

  const difficulties: Difficulty[] = [
    target.problem.difficulty,
    ...ADJACENT[target.problem.difficulty],
  ];

  let replacementId: string | undefined;
  for (const difficulty of difficulties) {
    const pool = (
      await findEligibleProblems({
        unitIds: [target.problem.unitId],
        difficulty,
      })
    ).filter((problem) => problem.userId === session.id);

    const picked = selectProblems({
      pool,
      difficultyRatio: ratioFor(difficulty),
      count: 1,
      recentProblemIds,
      seed: `${testId}:${seq}:${difficulty}`,
    });
    if (picked.problems[0]) {
      replacementId = picked.problems[0].id;
      break;
    }
  }

  if (!replacementId) {
    return jsonOk(
      insufficientProblemsErrorResponseSchema,
      {
        error: {
          code: "INSUFFICIENT_PROBLEMS",
          message: "이 단원에 등록된 문제가 부족합니다.",
          details: {
            unitId: target.problem.unitId,
            available: 0,
            required: 1,
          },
        },
      },
      { status: 422 },
    );
  }

  const [updatedItem, updatedTest] = await db.$transaction(async (tx) => {
    const item = await tx.testProblem.update({
      where: { id: target.id },
      data: { problemId: replacementId, replaced: true },
    });
    const test = await tx.test.update({
      where: { id: testId },
      data: { modified: true },
    });
    return [item, test] as const;
  });

  const problem = await db.problem.findUnique({
    where: { id: updatedItem.problemId },
  });
  if (!problem) return notFoundError("문항");

  return jsonOk(testProblemReplaceResponseSchema, {
    data: {
      test: serializeTest(updatedTest),
      problem: serializeTestProblemItem({ ...updatedItem, problem }),
    },
  });
}
