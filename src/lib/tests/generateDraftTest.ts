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

  // 두 조회는 서로를 전혀 참조하지 않는다(풀은 단원, 최근 출제는 날짜로만 좁힌다).
  // 순차로 await 하면 그냥 두 왕복이 더해진다.
  const [eligible, recentProblemIds] = await Promise.all([
    findEligibleProblems({ userId: session.id, unitIds }),
    loadRecentProblemIds(session.id, input.testDate),
  ]);

  const selected = selectProblems({
    pool: eligible,
    difficultyRatio,
    count,
    recentProblemIds,
    seed: `${input.classId}:${input.testDate}:${input.testType}`,
  });

  if (selected.problems.length < count) {
    const recentSet = new Set(recentProblemIds);
    const usable = eligible.filter((p) => !recentSet.has(p.id));
    return jsonOk(
      insufficientProblemsErrorResponseSchema,
      {
        error: {
          code: "INSUFFICIENT_PROBLEMS",
          message:
            input.testType === "daily"
              ? "이 단원에 등록된 문제가 부족합니다."
              : "이 범위에 등록된 문제가 부족합니다.",
          details: {
            // 화면의 「AI 생성」이 이 단원에 문제를 만든다. 일일테스트는 단원이
            // 하나뿐이라 그것이고, 확인테스트는 **범위에서 가장 얇은 단원**이다 —
            // 예전에는 `rangeEndUnitId`(그냥 범위의 끝)를 가리켰는데, 그 단원이
            // 이미 700건을 갖고 있어도 그리로 보냈다. 부족한 곳을 가리켜야
            // 한 번 눌러서 실제로 채워진다.
            unitId:
              input.testType === "daily"
                ? current.unitId
                : thinnestUnitId(unitIds, usable, current.unitId),
            available: usable.length,
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

/**
 * 범위 안에서 **출제 가능 문항이 가장 적은 단원**. 동률이면 `unitIds` 순서(=orderIndex
 * 오름차순, `resolveRange` 가 그렇게 정렬해 준다)로 앞선 것 — 진도가 이른 쪽을 먼저
 * 메우는 편이 확인테스트의 앞부분을 채운다.
 *
 * ⚠️ 세는 것은 **최근 출제(D-20)를 뺀 나머지**다. 그래야 화면이 보는 「가용」과 같은
 *    기준이 된다 — 다른 기준으로 세면 「가용 3인데 왜 이 단원?」이 된다.
 */
function thinnestUnitId(
  unitIds: string[],
  usable: { unitId: string }[],
  fallbackUnitId: string,
): string {
  if (unitIds.length === 0) return fallbackUnitId;
  const counts = new Map(unitIds.map((id) => [id, 0]));
  for (const problem of usable) {
    const prev = counts.get(problem.unitId);
    if (prev !== undefined) counts.set(problem.unitId, prev + 1);
  }
  let best = unitIds[0]!;
  let bestCount = counts.get(best) ?? 0;
  for (const id of unitIds) {
    const count = counts.get(id) ?? 0;
    if (count < bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}
