/**
 * PATCH/DELETE /api/students/{id} — 학생 수정(이름/개별 진도 사용 여부) · 삭제.
 * 대응 계약: src/contracts/class.contract.ts
 * 소유권 검증(존재하지 않으면 404, 소속 반이 타 사용자 소유면 403): src/lib/ownership.ts requireOwnedStudent
 */
import type { NextRequest } from "next/server";

import {
  studentResponseSchema,
  studentUpdateRequestSchema,
} from "@/contracts/class.contract";
import {
  deleteResponseSchema,
  idParamSchema,
} from "@/contracts/common.contract";
import {
  jsonData,
  unauthorizedErrorResponse,
  validationErrorResponse,
} from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { requireOwnedStudent } from "@/lib/ownership";
import { serializeStudent } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/students/{id} — 학생 수정
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser(request);
  if (!session) return unauthorizedErrorResponse();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationErrorResponse(idResult.error);

  const owned = await requireOwnedStudent(id, session.id);
  if (!owned.ok) return owned.response;

  const body = await request.json().catch(() => undefined);
  const parsed = studentUpdateRequestSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const updated = await db.student.update({ where: { id }, data: parsed.data });
  return jsonData(studentResponseSchema, { data: serializeStudent(updated) });
}

// DELETE /api/students/{id} — 학생 삭제
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser(request);
  if (!session) return unauthorizedErrorResponse();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationErrorResponse(idResult.error);

  const owned = await requireOwnedStudent(id, session.id);
  if (!owned.ok) return owned.response;

  await db.student.delete({ where: { id } });
  return jsonData(deleteResponseSchema, { data: { id } });
}
