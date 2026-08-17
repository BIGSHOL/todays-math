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
  // 🔴 PROGRESS 는 append-only 다 — 진도를 한 번 옮길 때마다 행이 하나씩 쌓인다.
  //    예전에는 그 이력을 **전부** 읽어 와서 `findLatestProgress` 가 JS 로 최신 1건을
  //    골랐다. 한 학기만 지나도 조회량이 계속 자란다. 정렬 키를 DB 로 내리고 1건만 읽는다.
  //    ⚠️ 정렬은 `findLatestProgress` 와 **글자 그대로 같아야 한다** — recordedAt(날짜)
  //    내림차순, 같은 날짜면 createdAt(기록 시각) 내림차순. 보조 키를 빠뜨리면 같은 날
  //    두 번 기록한 진도에서 "최신"이 아무거나 나온다.
  //    반/개별 구분은 그대로다 — 반 이력(studentId=null)과 개별 이력을 따로 읽어
  //    `getCurrentProgress` 가 use_individual_progress 로 고른다. 개별 이력이 0건이면
  //    take:1 이 빈 배열을 내므로 반 진도로 폴백하는 동작도 유지된다.
  const latestFirst = [
    { recordedAt: "desc" as const },
    { createdAt: "desc" as const },
  ];
  const [classProgress, studentProgress] = await Promise.all([
    db.progress.findMany({
      where: { classId, studentId: null },
      orderBy: latestFirst,
      take: 1,
    }),
    studentId
      ? db.progress.findMany({
          where: { classId, studentId },
          orderBy: latestFirst,
          take: 1,
        })
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
