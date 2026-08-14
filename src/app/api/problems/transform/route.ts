/**
 * POST /api/problems/transform — 원본 문제를 변형해 pending으로 적재.
 * 대응 계약: src/contracts/problem.contract.ts
 */
import type { NextRequest } from "next/server";

import {
  problemTransformRequestSchema,
  problemTransformResponseSchema,
} from "@/contracts/problem.contract";
import { AiGenerationError } from "@/lib/ai/errors";
import { transformProblem } from "@/lib/ai/transformer";
import {
  jsonError,
  jsonOk,
  unauthorizedError,
  validationError,
} from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { requireAccessibleProblem } from "@/lib/ownership";
import { serializeProblem } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";
import type { ProblemType } from "@/contracts/problem.contract";

export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const body = await request.json().catch(() => undefined);
  const parsed = problemTransformRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const accessible = await requireAccessibleProblem(
    parsed.data.originProblemId,
    session.id,
  );
  if (!accessible.ok) return accessible.response;

  const origin = accessible.data;

  try {
    const drafts = await transformProblem({
      origin: {
        id: origin.id,
        unitId: origin.unitId,
        difficulty: origin.difficulty,
        problemType: origin.problemType as ProblemType,
        content: origin.content,
        answer: origin.answer,
        solution: origin.solution,
      },
      count: parsed.data.count,
    });

    const created = [];
    for (const draft of drafts) {
      created.push(
        await db.problem.create({
          data: {
            userId: session.id,
            unitId: draft.unitId,
            source: draft.source,
            originProblemId: draft.originProblemId,
            difficulty: draft.difficulty,
            problemType: draft.problemType,
            content: draft.content,
            answer: draft.answer,
            solution: draft.solution,
            reviewStatus: draft.reviewStatus,
          },
        }),
      );
    }

    return jsonOk(
      problemTransformResponseSchema,
      { data: created.map(serializeProblem) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AiGenerationError) {
      return jsonError("AI_GENERATION_FAILED", error.message, 502);
    }
    throw error;
  }
}
