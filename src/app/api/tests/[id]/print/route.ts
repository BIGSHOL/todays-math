/**
 * POST /api/tests/{id}/print — 인쇄 기록 (confirmed → printed, printedAt).
 * 대응 계약: src/contracts/test.contract.ts
 */
import type { NextRequest } from "next/server";

import { idParamSchema } from "@/contracts/common.contract";
import { testPrintResponseSchema } from "@/contracts/test.contract";
import {
  jsonError,
  jsonOk,
  unauthorizedError,
  validationError,
} from "@/lib/apiResponse";
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

  if (owned.data.status === "printed") {
    return jsonOk(testPrintResponseSchema, {
      data: serializeTest(owned.data),
    });
  }

  if (owned.data.status !== "confirmed") {
    return jsonError(
      "CONFLICT",
      "확정된 테스트만 인쇄할 수 있습니다.",
      409,
    );
  }

  const updated = await db.test.update({
    where: { id },
    data: { status: "printed", printedAt: new Date() },
  });
  return jsonOk(testPrintResponseSchema, { data: serializeTest(updated) });
}
