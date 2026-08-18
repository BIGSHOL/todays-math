/**
 * POST /api/problems/generate — AI 문제 생성 후 pending으로 적재.
 * 대응 계약: src/contracts/problem.contract.ts
 */
import type { NextRequest } from "next/server";

import {
  problemGenerateRequestSchema,
  problemGenerateResponseSchema,
} from "@/contracts/problem.contract";
import { generateProblems } from "@/lib/ai/generator";
import { AiGenerationError } from "@/lib/ai/errors";
import {
  jsonError,
  jsonOk,
  notFoundError,
  unauthorizedError,
  validationError,
} from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { serializeProblem } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const body = await request.json().catch(() => undefined);
  const parsed = problemGenerateRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const unit = await db.unit.findUnique({ where: { id: parsed.data.unitId } });
  if (!unit) return notFoundError("단원");

  try {
    const drafts = await generateProblems({
      unitId: parsed.data.unitId,
      unitLabel: `${unit.grade} ${unit.chapter} ${unit.section}`,
      difficulty: parsed.data.difficulty,
      count: parsed.data.count,
    });

    // 🔴 생성 개수만큼 INSERT 를 순차로 await 하던 자리다. `createManyAndReturn` 은
    //    PostgreSQL 의 `INSERT ... RETURNING` 이라 **한 문장**으로 넣고 넣은 행을 그대로
    //    돌려준다. 문장이 하나뿐이므로 트랜잭션 래퍼 없이도 전부 아니면 전무다.
    //    반환 순서는 입력 순서 = 응답 순서라 계약(배열)도 그대로다.
    // exam-wiring: 기출아님 — AI 생성물(source=ai_generated)만 넣는다. 원본 시험지가 없다
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
      problemGenerateResponseSchema,
      { data: created.map(serializeProblem) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AiGenerationError) {
      console.error("[POST /api/problems/generate] AI generation failed");
      return jsonError(
        "AI_GENERATION_FAILED",
        "AI 문제 생성에 실패했습니다.",
        502,
      );
    }
    throw error;
  }
}
