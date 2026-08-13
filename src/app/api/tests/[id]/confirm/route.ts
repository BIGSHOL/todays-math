/**
 * POST /api/tests/{id}/confirm — 테스트 확정 (draft → confirmed).
 * 대응 계약: src/contracts/test.contract.ts
 */
import type { NextRequest } from "next/server";

import { idParamSchema } from "@/contracts/common.contract";
import { testConfirmResponseSchema } from "@/contracts/test.contract";
import { jsonOk, unauthorizedError, validationError } from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { requireOwnedTest } from "@/lib/ownership";
import { serializeTest } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationError(idResult.error);

  const owned = await requireOwnedTest(id, session.id);
  if (!owned.ok) return owned.response;

  const updated = await db.test.update({
    where: { id },
    data: { status: "confirmed" },
  });
  return jsonOk(testConfirmResponseSchema, { data: serializeTest(updated) });
}
