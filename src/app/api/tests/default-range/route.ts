/**
 * GET /api/tests/default-range — 확인테스트가 **손대지 않아도 맞는** 범위.
 *
 * 대응 계약: src/contracts/test.contract.ts
 * 규칙(원장님 확정 2026-08-19): 끝은 항상 현재 진도, 시작은 직전 확인테스트의 끝
 * **다음** 소단원. 확인테스트를 한 번도 안 냈으면 그 반이 나간 진도의 첫 단원부터.
 * 판정 자체는 순수 함수 `resolveDefaultReviewRange` 한 곳에 있다 — 여기서는 조회만 한다.
 */
import type { TestStatus } from "@prisma/client";
import type { NextRequest } from "next/server";

import {
  defaultReviewRangeQuerySchema,
  defaultReviewRangeResponseSchema,
} from "@/contracts/test.contract";
import { jsonOk, unauthorizedError, validationError } from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { resolveDefaultReviewRange } from "@/lib/generator/defaultReviewRange";
import { resolveRange } from "@/lib/generator/resolveRange";
import { requireOwnedClass, requireOwnedStudentInClass } from "@/lib/ownership";
import { getCurrentProgress } from "@/lib/progressResolver";
import { serializeProgress } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

/**
 * **실제로 낸 시험만** 「직전 확인테스트」로 센다.
 *
 * 🔴 예전에는 `draft` 도 셌다. 출제를 누르면 그 순간 draft 가 만들어지므로, 검수만
 *    하고 버려도 다음 기본 범위가 그 끝 **다음**부터가 된다. 끝은 곧 현재 진도라
 *    시작이 진도보다 뒤가 되고 — 범위가 **현재 진도 한 단원으로 접혔다**(실측 4단원
 *    → 1단원). 그러면 D-54(단원을 고루)가 통째로 무력해지고, 「진도 기준 자동」이라는
 *    라벨을 단 채 8문항이 한 단원에서만 나간다. 적대적 리뷰(2026-08-19)에서 잡았다.
 */
const GIVEN_TESTS = {
  status: { in: ["confirmed", "printed"] satisfies TestStatus[] },
};

/** 「최신」 판정은 `getCurrentProgress` 와 **글자 그대로 같아야 한다**(진도 route 주석 참조). */
const LATEST_FIRST = [
  { recordedAt: "desc" as const },
  { createdAt: "desc" as const },
];

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const parsed = defaultReviewRangeQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return validationError(parsed.error);
  const { classId, studentId } = parsed.data;

  const owned = await requireOwnedClass(classId, session.id);
  if (!owned.ok) return owned.response;

  let useIndividualProgress = false;
  if (studentId) {
    const studentOwned = await requireOwnedStudentInClass(
      studentId,
      classId,
      session.id,
    );
    if (!studentOwned.ok) return studentOwned.response;
    useIndividualProgress = studentOwned.data.useIndividualProgress;
  }

  const [
    classProgress,
    studentProgressRows,
    classProgressUnits,
    studentProgressUnits,
    classReviews,
    studentReviews,
    units,
  ] = await Promise.all([
    db.progress.findMany({
      where: { classId, studentId: null },
      orderBy: LATEST_FIRST,
      take: 1,
    }),
    studentId
      ? db.progress.findMany({
          where: { classId, studentId },
          orderBy: LATEST_FIRST,
          take: 1,
        })
      : Promise.resolve([]),
    // 🔴 이력 **전량**을 읽지만 컬럼은 `unitId` 하나뿐이다. 「그 반이 나간 첫 단원」은
    //    orderIndex 로 정해지는데 PROGRESS 에는 그 값이 없어(단원 쪽에 있다) 관계
    //    정렬 대신 id 만 받아 순수 함수가 고르게 한다. 한 학기 이력이 수백 행이라
    //    uuid 하나씩이면 무겁지 않다.
    db.progress.findMany({
      where: { classId, studentId: null },
      select: { unitId: true },
    }),
    studentId
      ? db.progress.findMany({
          where: { classId, studentId },
          select: { unitId: true },
        })
      : Promise.resolve([]),
    db.test.findMany({
      where: {
        userId: session.id,
        classId,
        studentId: null,
        testType: "review",
        ...GIVEN_TESTS,
      },
      orderBy: [{ testDate: "desc" as const }, { createdAt: "desc" as const }],
      take: 1,
    }),
    studentId
      ? db.test.findMany({
          where: {
            userId: session.id,
            classId,
            studentId,
            testType: "review",
            ...GIVEN_TESTS,
          },
          orderBy: [
            { testDate: "desc" as const },
            { createdAt: "desc" as const },
          ],
          take: 1,
        })
      : Promise.resolve([]),
    db.unit.findMany(),
  ]);

  const current = getCurrentProgress({
    classProgress: classProgress.map(serializeProgress),
    studentProgress: studentProgressRows.map(serializeProgress),
    useIndividualProgress,
  });
  // 진도가 없으면 범위를 못 낸다. 오류가 아니다 — 화면은 범위를 비우고 직접 고르게 한다.
  if (!current) return jsonOk(defaultReviewRangeResponseSchema, { data: null });

  // 진도를 개별로 보는 학생이면 **그 학생의** 확인테스트가 기준이다. 개별 이력이
  // 없으면 진도와 같은 규칙으로 반 전체 것으로 폴백한다.
  const lastReview =
    (useIndividualProgress ? studentReviews[0] : undefined) ?? classReviews[0];
  const progressUnitIds = (
    useIndividualProgress && studentProgressUnits.length > 0
      ? studentProgressUnits
      : classProgressUnits
  ).map((row) => row.unitId);

  const range = resolveDefaultReviewRange({
    units,
    currentUnitId: current.unitId,
    lastReviewEndUnitId: lastReview?.rangeEndUnitId ?? null,
    progressUnitIds,
  });
  if (!range) return jsonOk(defaultReviewRangeResponseSchema, { data: null });

  // 「소단원 N개」는 출제가 실제로 쓸 범위와 **같은 함수**로 센다 — 두 벌이 되면
  // 화면이 10개라 적고 출제는 다른 수를 보는 일이 생긴다.
  const { unitIds } = resolveRange({
    testType: "review",
    rangeStartUnitId: range.startUnitId,
    rangeEndUnitId: range.endUnitId,
    units,
  });

  return jsonOk(defaultReviewRangeResponseSchema, {
    data: {
      rangeStartUnitId: range.startUnitId,
      rangeEndUnitId: range.endUnitId,
      unitCount: unitIds.length,
      startedFrom: range.startedFrom,
    },
  });
}
