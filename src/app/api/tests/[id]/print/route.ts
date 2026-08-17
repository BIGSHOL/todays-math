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
import { isPrismaErrorCode } from "@/lib/prismaErrors";
import { serializeTest } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationError(idResult.error);

  // 🔴 정상 경로가 3왕복이었다 — 소유권 findUnique → updateMany → 갱신본 findUnique.
  //    소유권·상태 조건을 `update` 의 where 에 그대로 실으면 **한 문장**으로 끝나고
  //    갱신된 행이 바로 돌아온다(Prisma 5+ extendedWhereUnique). 조건이 안 맞으면
  //    P2025 다 — 그때만 이유를 알아내려고 한 번 더 읽는다.
  //
  //    원자성은 오히려 그대로다: `status: "confirmed"` 가 여전히 UPDATE 의 where 에 있어
  //    두 요청이 동시에 와도 하나만 성공한다(예전 updateMany 가 하던 일과 같다).
  //    소유권이 where 에 있으므로 남의 시험지가 갱신될 여지도 없다.
  try {
    const updated = await db.test.update({
      where: { id, userId: session.id, status: "confirmed" },
      data: { status: "printed", printedAt: new Date() },
    });
    return jsonOk(testPrintResponseSchema, { data: serializeTest(updated) });
  } catch (error) {
    if (!isPrismaErrorCode(error, "P2025")) throw error;
  }

  // 여기부터는 "왜 안 됐는가" 를 가리는 길이다. 응답은 예전과 글자 그대로 같다:
  // 없으면 404, 남의 것이면 403, 이미 인쇄됐으면 200(멱등), 그 외 상태면 409.
  const owned = await requireOwnedTest(id, session.id);
  if (!owned.ok) return owned.response;

  if (owned.data.status === "printed") {
    return jsonOk(testPrintResponseSchema, {
      data: serializeTest(owned.data),
    });
  }

  return jsonError("CONFLICT", "확정된 테스트만 인쇄할 수 있습니다.", 409);
}
