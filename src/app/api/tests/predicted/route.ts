/**
 * POST /api/tests/predicted — 예측 문제지 생성 + 적재 (T7.9, D-42).
 *
 * 조립은 전부 `src/lib/predictor/generatePredictedPaper.ts` 가 한다. 여기서는 세션·검증·
 * 상태코드 매핑만 한다(`generateDraftTest` 와 같은 구조).
 *
 * 대응 계약: src/contracts/scoreNormalizer.contract.ts
 *
 * ⚠️ 근거가 없으면 **0문항 0점 시험지를 만들지 않고 422 로 거절한다.** 이 프로젝트는
 *    "0문항 0점짜리 시험이 예상됩니다" 를 화면에 낸 적이 있다.
 */
import type { NextRequest } from "next/server";

import {
  predictedPaperCreateRequestSchema,
  predictedPaperCreateResponseSchema,
} from "@/contracts/scoreNormalizer.contract";
import {
  forbiddenError,
  jsonError,
  jsonOk,
  notFoundError,
  unauthorizedError,
  validationError,
} from "@/lib/apiResponse";
import { generatePredictedPaper } from "@/lib/predictor/generatePredictedPaper";
import { getSessionUser } from "@/lib/session";

export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("VALIDATION_ERROR", "요청 본문이 올바르지 않습니다.", 400);
  }

  const parsed = predictedPaperCreateRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const result = await generatePredictedPaper({
    userId: session.id,
    ...parsed.data,
  });

  if (!result.ok) {
    if (result.refusal === "권한_없음") return forbiddenError();
    if (result.refusal === "대상_없음") return notFoundError("반");
    // 근거 없음 · 판단 불가 · 만점 불일치 — 전부 "지금은 만들 수 없다"이다.
    return jsonError("VALIDATION_ERROR", result.detail, 422, {
      judgement: "판단 불가",
      refusal: result.refusal,
      reason: result.reason ?? null,
    });
  }

  const { paper, blueprint } = result;
  return jsonOk(
    predictedPaperCreateResponseSchema,
    {
      data: {
        testId: result.testId,
        questionCount: paper.questions.length,
        totalScore: paper.totalScore,
        grid: paper.grid,
        questions: paper.questions,
        unfilled: paper.unfilled,
        referenceUsed: paper.referenceUsed,
        referenceExcluded: paper.referenceExcluded,
        evidenceCount: blueprint.evidenceCount,
        confidence: blueprint.confidence,
      },
    },
    { status: 201 },
  );
}
