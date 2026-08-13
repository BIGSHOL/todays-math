/**
 * POST /api/progress/advance — "다음 소단원 1클릭 진행"(D-19, order_index 기준).
 * 현재 진도 소단원의 orderIndex+1에 해당하는 다음 소단원으로 새 PROGRESS 행을 추가한다
 * (Unit.orderIndex는 전역 연속 값 — D-27). 다음 소단원이 없으면 NOT_FOUND(교육과정 마지막 단원).
 *
 * 대응 계약: src/contracts/class.contract.ts §진도
 * 현재 진도 판정은 GET /api/progress와 동일하게 src/lib/progressResolver.ts의
 * getCurrentProgress()에 위임한다.
 */
import type { NextRequest } from "next/server";

import {
  progressAdvanceRequestSchema,
  progressResponseSchema,
} from "@/contracts/class.contract";
import {
  jsonOk,
  notFoundError,
  unauthorizedError,
  validationError,
} from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { requireOwnedClass, requireOwnedStudentInClass } from "@/lib/ownership";
import { getCurrentProgress, nextOrderIndex } from "@/lib/progressResolver";
import { serializeProgress } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

// POST /api/progress/advance — 현재 진도 소단원의 다음 소단원으로 1클릭 진행
export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const body = await request.json().catch(() => undefined);
  const parsed = progressAdvanceRequestSchema.safeParse(body);
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

  // "현재 진도"는 GET /api/progress와 동일한 반/개별 이중 구조 판정을 그대로 적용한다
  // (개별 진도 이력이 아직 없는 학생은 반 진도를 기준선으로 다음 소단원을 계산한다).
  const [classProgress, studentProgress] = await Promise.all([
    db.progress.findMany({ where: { classId, studentId: null } }),
    studentId
      ? db.progress.findMany({ where: { classId, studentId } })
      : Promise.resolve([]),
  ]);

  const current = getCurrentProgress({
    classProgress: classProgress.map(serializeProgress),
    studentProgress: studentProgress.map(serializeProgress),
    useIndividualProgress,
  });
  if (!current) return notFoundError("진도 기록");

  const currentUnit = await db.unit.findUnique({
    where: { id: current.unitId },
  });
  if (!currentUnit) return notFoundError("현재 진도 소단원");

  const nextUnit = await db.unit.findFirst({
    where: { orderIndex: nextOrderIndex(currentUnit.orderIndex) },
  });
  if (!nextUnit) return notFoundError("다음 소단원");

  // 진행 결과는 요청이 지정한 대상(반 전체 또는 특정 학생) 기준으로 새로 기록한다 —
  // 개별 진도가 아직 반 진도를 기준선으로 삼았더라도(위 폴백), 결과 행은 학생 개별 진도로 남는다.
  const created = await db.progress.create({
    data: {
      classId,
      studentId: studentId ?? null,
      unitId: nextUnit.id,
      recordedAt: new Date(),
    },
  });

  return jsonOk(
    progressResponseSchema,
    { data: serializeProgress(created) },
    { status: 201 },
  );
}
