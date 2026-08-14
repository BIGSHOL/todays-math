/**
 * PATCH /api/problems/{id}/review-status — 검수 승격 전용 엔드포인트(pending → approved 등, D-22).
 * 대응 계약: src/contracts/problem.contract.ts (problemReviewStatusUpdateRequestSchema)
 *
 * ⚠️ 등록(POST /api/problems)·수정(PATCH /api/problems/{id})은 reviewStatus를 받지 않는다 —
 * 검수 승격 경로를 이 엔드포인트로만 강제해 클라이언트가 등록과 동시에 스스로 승인 처리하는
 * 경로를 원천 차단한다(problem.contract.ts 상단 주석 참조).
 */
import type { NextRequest } from "next/server";

import {
  problemResponseSchema,
  problemReviewStatusUpdateRequestSchema,
} from "@/contracts/problem.contract";
import { idParamSchema } from "@/contracts/common.contract";
import { jsonOk, unauthorizedError, validationError } from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { requireAccessibleProblem } from "@/lib/ownership";
import { serializeProblem } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/problems/{id}/review-status — 검수 상태 승격
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationError(idResult.error);

  const accessible = await requireAccessibleProblem(id, session.id);
  if (!accessible.ok) return accessible.response;

  const body = await request.json().catch(() => undefined);
  const parsed = problemReviewStatusUpdateRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const updated = await db.problem.update({
    where: { id },
    data: { reviewStatus: parsed.data.reviewStatus },
  });
  return jsonOk(problemResponseSchema, { data: serializeProblem(updated) });
}
