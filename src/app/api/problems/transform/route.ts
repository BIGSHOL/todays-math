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

    // 🔴 생성 개수만큼 INSERT 를 순차로 await 하던 자리다. `createManyAndReturn` 은
    //    PostgreSQL 의 `INSERT ... RETURNING` 이라 **한 문장**으로 넣고 넣은 행을 그대로
    //    돌려준다. 문장이 하나뿐이므로 트랜잭션 래퍼 없이도 전부 아니면 전무다.
    //    반환 순서는 입력 순서 = 응답 순서라 계약(배열)도 그대로다.
    const created = await db.problem.createManyAndReturn({
      data: drafts.map((draft) => ({
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
      })),
    });

    return jsonOk(
      problemTransformResponseSchema,
      { data: created.map(serializeProblem) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AiGenerationError) {
      console.error("[POST /api/problems/transform] AI transform failed");
      return jsonError(
        "AI_GENERATION_FAILED",
        "AI 문제 변형에 실패했습니다.",
        502,
      );
    }
    throw error;
  }
}
