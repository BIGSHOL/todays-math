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
  notFoundError,
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
    return jsonError("CONFLICT", "확정된 테스트만 인쇄할 수 있습니다.", 409);
  }

  const result = await db.test.updateMany({
    where: { id, userId: session.id, status: "confirmed" },
    data: { status: "printed", printedAt: new Date() },
  });

  if (result.count === 0) {
    const current = await db.test.findUnique({ where: { id } });
    if (!current) return notFoundError("테스트");
    if (current.status === "printed") {
      return jsonOk(testPrintResponseSchema, { data: serializeTest(current) });
    }
    return jsonError("CONFLICT", "확정된 테스트만 인쇄할 수 있습니다.", 409);
  }

  const updated = await db.test.findUnique({ where: { id } });
  if (!updated) return notFoundError("테스트");

  return jsonOk(testPrintResponseSchema, { data: serializeTest(updated) });
}
