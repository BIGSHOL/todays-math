/**
 * GET /api/tests/{id} — 테스트 단건 조회 (문항 목록 포함, 검수 화면 S-05).
 * 대응 계약: src/contracts/test.contract.ts
 */
import type { NextRequest } from "next/server";

import { idParamSchema } from "@/contracts/common.contract";
import { testDetailResponseSchema } from "@/contracts/test.contract";
import { jsonOk, unauthorizedError, validationError } from "@/lib/apiResponse";
import { requireOwnedTest } from "@/lib/ownership";
import { serializeTest } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";
import { loadTestProblemItems } from "@/lib/tests/loadTestProblems";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationError(idResult.error);

  const owned = await requireOwnedTest(id, session.id);
  if (!owned.ok) return owned.response;

  const problems = await loadTestProblemItems(id);
  return jsonOk(testDetailResponseSchema, {
    data: { test: serializeTest(owned.data), problems },
  });
}
