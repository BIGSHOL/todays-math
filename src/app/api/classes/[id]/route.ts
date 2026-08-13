/**
 * GET/PATCH/DELETE /api/classes/{id} — 반 단건 조회 · 수정 · 삭제.
 * 대응 계약: src/contracts/class.contract.ts
 * 소유권 검증(존재하지 않으면 404, 타 사용자 소유면 403): src/lib/ownership.ts requireOwnedClass
 */
import type { NextRequest } from "next/server";

import {
  classResponseSchema,
  classUpdateRequestSchema,
} from "@/contracts/class.contract";
import {
  deleteResponseSchema,
  idParamSchema,
} from "@/contracts/common.contract";
import { jsonOk, unauthorizedError, validationError } from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { requireOwnedClass } from "@/lib/ownership";
import { serializeClass } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/classes/{id} — 단건 조회
export async function GET(request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser(request);
  if (!session) return unauthorizedError();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationError(idResult.error);

  const owned = await requireOwnedClass(id, session.id);
  if (!owned.ok) return owned.response;

  return jsonOk(classResponseSchema, { data: serializeClass(owned.data) });
}

// PATCH /api/classes/{id} — 반 수정
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser(request);
  if (!session) return unauthorizedError();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationError(idResult.error);

  const owned = await requireOwnedClass(id, session.id);
  if (!owned.ok) return owned.response;

  const body = await request.json().catch(() => undefined);
  const parsed = classUpdateRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const updated = await db.class.update({ where: { id }, data: parsed.data });
  return jsonOk(classResponseSchema, { data: serializeClass(updated) });
}

// DELETE /api/classes/{id} — 반 삭제 (cascade: 소속 학생/진도/시험지, schema.prisma 참조)
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser(request);
  if (!session) return unauthorizedError();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationError(idResult.error);

  const owned = await requireOwnedClass(id, session.id);
  if (!owned.ok) return owned.response;

  await db.class.delete({ where: { id } });
  return jsonOk(deleteResponseSchema, { data: { id } });
}
