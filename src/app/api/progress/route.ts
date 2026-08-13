/**
 * POST/GET /api/progress — 진도 기록(이력 누적, append-only) · 현재 진도 조회.
 * 대응 계약: src/contracts/class.contract.ts §진도
 * ⚠️ PROGRESS는 수정/삭제 엔드포인트가 없다 — 진도 갱신은 항상 새 행을 추가하는 POST로
 *    표현한다(계약 파일 상단 주석 참조).
 *
 * 반/개별 이중 구조 해석(개별 진도 우선 적용, use_individual_progress)은
 * src/lib/progressResolver.ts의 순수 함수 getCurrentProgress()에 위임한다
 * (T4.2 출제 API와 동일 판정 로직을 공유하기 위함).
 */
import type { NextRequest } from "next/server";

import {
  progressQuerySchema,
  progressRecordRequestSchema,
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
import { getCurrentProgress } from "@/lib/progressResolver";
import { serializeProgress } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

// POST /api/progress — 진도 기록(반 전체 또는 개별 학생, 이력 누적)
export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const body = await request.json().catch(() => undefined);
  const parsed = progressRecordRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const owned = await requireOwnedClass(parsed.data.classId, session.id);
  if (!owned.ok) return owned.response;

  if (parsed.data.studentId) {
    const studentOwned = await requireOwnedStudentInClass(
      parsed.data.studentId,
      parsed.data.classId,
      session.id,
    );
    if (!studentOwned.ok) return studentOwned.response;
  }

  const unit = await db.unit.findUnique({ where: { id: parsed.data.unitId } });
  if (!unit) return notFoundError("소단원");

  const created = await db.progress.create({
    data: {
      classId: parsed.data.classId,
      studentId: parsed.data.studentId ?? null,
      unitId: parsed.data.unitId,
      recordedAt: parsed.data.recordedAt
        ? new Date(parsed.data.recordedAt)
        : new Date(),
    },
  });

  return jsonOk(
    progressResponseSchema,
    { data: serializeProgress(created) },
    { status: 201 },
  );
}

// GET /api/progress?classId=&studentId= — 현재 진도 조회(개별 우선 적용)
export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const url = new URL(request.url);
  const parsed = progressQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
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

  return jsonOk(progressResponseSchema, { data: current });
}
