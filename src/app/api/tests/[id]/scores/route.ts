/**
 * PATCH /api/tests/{id}/scores — 원장 수동 배점 조정 (T7.9, 11 §10.4).
 *
 * **합계가 100 이 아니면 422 로 거부하고 남은 점수를 그대로 알린다**
 * (예: `합계 98.5 — 1.5점 남음`). 자동으로 다른 문항을 건드려 사용자를 놀라게 하지 않는다 —
 * 화면은 이 문구를 그대로 띄우기만 하면 된다.
 *
 * 대응 계약: src/contracts/scoreNormalizer.contract.ts
 */
import type { NextRequest } from "next/server";

import { idParamSchema } from "@/contracts/common.contract";
import {
  testScoresUpdateRequestSchema,
  testScoresUpdateResponseSchema,
} from "@/contracts/scoreNormalizer.contract";
import {
  forbiddenError,
  jsonError,
  jsonOk,
  notFoundError,
  unauthorizedError,
  validationError,
} from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { saveManualScores } from "@/lib/predictor/persistPredictedPaper";
import { getSessionUser } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationError(idResult.error);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("VALIDATION_ERROR", "요청 본문이 올바르지 않습니다.", 400);
  }

  const parsed = testScoresUpdateRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const result = await saveManualScores({
    userId: session.id,
    testId: idResult.data.id,
    scores: parsed.data.scores,
  });

  if (!result.ok) {
    if (result.reason === "권한_없음") return forbiddenError();
    if (result.reason === "대상_없음") return notFoundError("테스트");
    if (result.reason === "문항_불일치") {
      return jsonError("VALIDATION_ERROR", result.detail, 400);
    }
    // 합계가 100 이 아니다 — 남은 점수를 그대로 실어 보낸다.
    return jsonError("VALIDATION_ERROR", result.detail, 422);
  }

  const rows = await db.testProblem.findMany({
    where: { testId: result.testId },
    orderBy: { orderIndex: "asc" },
  });

  return jsonOk(testScoresUpdateResponseSchema, {
    data: {
      testId: result.testId,
      questionCount: result.questionCount,
      totalScore: result.totalScore,
      problems: rows.map((row) => ({
        orderIndex: row.orderIndex,
        problemId: row.problemId,
        score: row.score ?? 0,
      })),
    },
  });
}
