/**
 * POST /api/tests/generate — 진도 해석 + 출제 엔진 + draft TEST/TEST_PROBLEM 원자 생성.
 * 엔진(selectProblems)은 순수 함수이므로 여기서 DB 조회 결과만 조립해 넘긴다.
 */
import type { DifficultyRatio } from "@/contracts/common.contract";
import type { TestGenerateRequest } from "@/contracts/test.contract";
import {
  insufficientProblemsErrorResponseSchema,
  testGenerateResponseSchema,
} from "@/contracts/test.contract";
import { jsonError, jsonOk } from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { findEligibleProblems } from "@/lib/findEligibleProblems";
import { resolveRange } from "@/lib/generator/resolveRange";
import { selectProblems } from "@/lib/generator/selectProblems";
import { requireOwnedClass, requireOwnedStudentInClass } from "@/lib/ownership";
import { getCurrentProgress } from "@/lib/progressResolver";
import {
  serializeProgress,
  serializeTest,
  serializeTestProblemItem,
} from "@/lib/serializers";
import type { SessionUser } from "@/lib/session";

import { loadRecentProblemIds } from "./recentProblemIds";

export async function generateDraftTest(
  session: SessionUser,
  input: TestGenerateRequest,
) {
  const owned = await requireOwnedClass(input.classId, session.id);
  if (!owned.ok) return owned.response;

  if (input.studentId) {
    const studentOwned = await requireOwnedStudentInClass(
      input.studentId,
      input.classId,
      session.id,
    );
    if (!studentOwned.ok) return studentOwned.response;
  }

  // 진도 이력은 append-only 라 전량 읽으면 학기가 갈수록 자란다. `getCurrentProgress`
  // 와 **같은 정렬**(recordedAt desc, 동률이면 createdAt desc)을 DB 로 내리고 1건만 읽는다.
  // 반/개별 구분과 개별 이력 0건 시 반 진도 폴백은 그대로다(GET /api/progress 와 동일).
  const latestFirst = [
    { recordedAt: "desc" as const },
    { createdAt: "desc" as const },
  ];
  const [classProgress, studentProgressRows, student] = await Promise.all([
    db.progress.findMany({
      where: { classId: input.classId, studentId: null },
      orderBy: latestFirst,
      take: 1,
    }),
    input.studentId
      ? db.progress.findMany({
          where: { classId: input.classId, studentId: input.studentId },
          orderBy: latestFirst,
          take: 1,
        })
      : Promise.resolve([]),
    input.studentId
      ? db.student.findUnique({ where: { id: input.studentId } })
      : Promise.resolve(null),
  ]);

  const current = getCurrentProgress({
    classProgress: classProgress.map(serializeProgress),
    studentProgress: studentProgressRows.map(serializeProgress),
    useIndividualProgress: student?.useIndividualProgress ?? false,
  });
  if (!current) {
    return jsonError("VALIDATION_ERROR", "진도가 기록되지 않았습니다.", 400);
  }

  const units = await db.unit.findMany();
  let unitIds: string[];
  try {
    const range =
      input.testType === "daily"
        ? resolveRange({
            testType: "daily",
            currentProgressUnitId: current.unitId,
            units,
          })
        : resolveRange({
            testType: "review",
            rangeStartUnitId: input.rangeStartUnitId!,
            rangeEndUnitId: input.rangeEndUnitId!,
            units,
          });
    unitIds = range.unitIds;
  } catch {
    return jsonError(
      "VALIDATION_ERROR",
      "확인테스트 범위 단원을 찾을 수 없습니다.",
      400,
    );
  }

  const count = input.problemCount ?? owned.data.defaultProblemCount;
  const difficultyRatio = (input.difficultyRatio ??
    owned.data.difficultyRatio) as DifficultyRatio;

  const eligible = await findEligibleProblems({
    userId: session.id,
    unitIds,
  });
  const recentProblemIds = await loadRecentProblemIds(
    session.id,
    input.testDate,
  );

  const selected = selectProblems({
    pool: eligible,
    difficultyRatio,
    count,
    recentProblemIds,
    seed: `${input.classId}:${input.testDate}:${input.testType}`,
  });

  if (selected.problems.length < count) {
    const recentSet = new Set(recentProblemIds);
    const available = eligible.filter((p) => !recentSet.has(p.id)).length;
    return jsonOk(
      insufficientProblemsErrorResponseSchema,
      {
        error: {
          code: "INSUFFICIENT_PROBLEMS",
          message: "이 단원에 등록된 문제가 부족합니다.",
          details: {
            unitId:
              input.testType === "daily"
                ? current.unitId
                : (input.rangeEndUnitId ?? current.unitId),
            available,
            required: count,
          },
        },
      },
      { status: 422 },
    );
  }

  const rangeEndUnitId =
    input.testType === "daily"
      ? current.unitId
      : (input.rangeEndUnitId ?? current.unitId);
  const rangeStartUnitId =
    input.testType === "daily" ? null : (input.rangeStartUnitId ?? null);

  const created = await db.$transaction(async (tx) => {
    const test = await tx.test.create({
      data: {
        userId: session.id,
        classId: input.classId,
        studentId: input.studentId ?? null,
        testType: input.testType,
        rangeStartUnitId,
        rangeEndUnitId,
        status: "draft",
        modified: false,
        testDate: new Date(`${input.testDate}T00:00:00.000Z`),
      },
    });

    // 🔴 문항 수만큼 INSERT 를 순차로 await 하던 자리다(25문항이면 25왕복).
    //    한 INSERT 로 넣는다 — 같은 트랜잭션 안이라 원자성은 그대로다.
    await tx.testProblem.createMany({
      data: selected.problems.map((problem, index) => ({
        testId: test.id,
        problemId: problem.id,
        orderIndex: index + 1,
        replaced: false,
      })),
    });

    const items = await tx.testProblem.findMany({
      where: { testId: test.id },
      include: { problem: true },
      orderBy: { orderIndex: "asc" },
    });
    return { test, items };
  });

  return jsonOk(
    testGenerateResponseSchema,
    {
      data: {
        test: serializeTest(created.test),
        problems: created.items.map(serializeTestProblemItem),
        shortfall: selected.shortfall,
      },
    },
    { status: 201 },
  );
}
