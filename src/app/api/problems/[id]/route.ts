/**
 * GET/PATCH/DELETE /api/problems/{id} — 문제 단건 조회 · 수정(본문/정답/풀이 등) · 삭제.
 * 대응 계약: src/contracts/problem.contract.ts
 * 소유권 검증(존재하지 않으면 404, 타 사용자 소유면 403): src/lib/ownership.ts requireOwnedProblem
 *
 * ⚠️ reviewStatus는 이 엔드포인트로 수정할 수 없다(계약이 strictObject로 거부) — 승격은
 * PATCH /api/problems/{id}/review-status 전용 엔드포인트를 통해서만 가능하다(D-22).
 */
import type { NextRequest } from "next/server";

import {
  problemResponseSchema,
  problemUpdateRequestSchema,
} from "@/contracts/problem.contract";
import {
  deleteResponseSchema,
  idParamSchema,
} from "@/contracts/common.contract";
import { jsonOk, unauthorizedError, validationError } from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { requireOwnedProblem } from "@/lib/ownership";
import { serializeProblem } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/problems/{id} — 단건 조회(LaTeX 본문 무손실 반환)
export async function GET(request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationError(idResult.error);

  const owned = await requireOwnedProblem(id, session.id);
  if (!owned.ok) return owned.response;

  return jsonOk(problemResponseSchema, { data: serializeProblem(owned.data) });
}

// PATCH /api/problems/{id} — 문제 수정
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationError(idResult.error);

  const owned = await requireOwnedProblem(id, session.id);
  if (!owned.ok) return owned.response;

  const body = await request.json().catch(() => undefined);
  const parsed = problemUpdateRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const updated = await db.problem.update({
    where: { id },
    data: parsed.data,
  });
  return jsonOk(problemResponseSchema, { data: serializeProblem(updated) });
}

// DELETE /api/problems/{id} — 문제 삭제
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationError(idResult.error);

  const owned = await requireOwnedProblem(id, session.id);
  if (!owned.ok) return owned.response;

  await db.problem.delete({ where: { id } });
  return jsonOk(deleteResponseSchema, { data: { id } });
}
