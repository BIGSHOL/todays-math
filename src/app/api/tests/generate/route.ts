/**
 * POST /api/tests/generate — 자동 출제 실행 (draft TEST + TEST_PROBLEM 생성).
 * 대응 계약: src/contracts/test.contract.ts
 */
import type { NextRequest } from "next/server";

import { testGenerateRequestSchema } from "@/contracts/test.contract";
import { unauthorizedError, validationError } from "@/lib/apiResponse";
import { getSessionUser } from "@/lib/session";
import { generateDraftTest } from "@/lib/tests/generateDraftTest";

export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const body = await request.json().catch(() => undefined);
  const parsed = testGenerateRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  return generateDraftTest(session, parsed.data);
}
