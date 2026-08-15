/**
 * POST /api/tests/{id}/submit — 채점 결과 입력(자동 채점 + 예상 점수 산출).
 * 대응 계약: src/contracts/testresult.contract.ts
 */
import type { NextRequest } from "next/server";

import { idParamSchema } from "@/contracts/common.contract";
import { testResultSubmitRequestSchema } from "@/contracts/testresult.contract";
import {
  jsonError,
  unauthorizedError,
  validationError,
} from "@/lib/apiResponse";
import { getSessionUser } from "@/lib/session";
import { submitTestResult } from "@/lib/testResults/submitTestResult";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationError(idResult.error);

  const body = await request.json().catch(() => undefined);
  const parsed = testResultSubmitRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    return await submitTestResult(session, id, parsed.data);
  } catch {
    console.error("[POST /api/tests/{id}/submit] submission failed");
    return jsonError("INTERNAL_ERROR", "채점 처리 중 오류가 발생했습니다.", 500);
  }
}
