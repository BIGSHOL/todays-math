/**
 * PUT /api/tests/{id}/problems/{seq} — 1클릭 문제 교체 (중복 제외 유지).
 * 대응 계약: src/contracts/test.contract.ts
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { idParamSchema } from "@/contracts/common.contract";
import { unauthorizedError, validationError } from "@/lib/apiResponse";
import { getSessionUser } from "@/lib/session";
import { replaceTestProblemAtSeq } from "@/lib/tests/replaceTestProblem";

type RouteContext = { params: Promise<{ id: string; seq: string }> };

const seqParamSchema = z.coerce
  .number()
  .int()
  .min(1, { error: "문항 번호가 올바르지 않습니다." });

export async function PUT(_request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { id, seq } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationError(idResult.error);

  const seqResult = seqParamSchema.safeParse(seq);
  if (!seqResult.success) return validationError(seqResult.error);

  return replaceTestProblemAtSeq(session, id, seqResult.data);
}
