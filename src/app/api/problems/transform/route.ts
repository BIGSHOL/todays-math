/**
 * POST /api/problems/transform — 원본 문제를 변형해 **후보만** 돌려준다.
 *
 * ⚠️ 이 엔드포인트는 **DB 를 건드리지 않는다** (원장님 확정 2026-08-19 "미리보기 후 채택").
 *    종전에는 생성과 적재가 한 몸이라, 결과를 보기도 전에 은행에 pending 이 쌓였다.
 *    채택한 후보의 저장은 `POST /api/problems/transform/adopt` 가 맡는다.
 *
 * 대응 계약: src/contracts/problem.contract.ts
 */
import type { NextRequest } from "next/server";

import {
  problemTransformRequestSchema,
  problemTransformResponseSchema,
} from "@/contracts/problem.contract";
import { AiConfigError, AiGenerationError } from "@/lib/ai/errors";
import { transformProblem } from "@/lib/ai/transformer";
import {
  jsonError,
  jsonOk,
  unauthorizedError,
  validationError,
} from "@/lib/apiResponse";
import { transformFigureBlockReason } from "@/lib/figure/transformFigureBlock";
import { requireAccessibleProblem } from "@/lib/ownership";
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
    const candidates = await transformProblem({
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
      mode: parsed.data.mode,
      difficultyShift: parsed.data.difficultyShift,
    });

    // 201 이 아니라 **200** 이다 — 만든 것이 없다(created nothing). 아직 자원이 아니다.
    // 그림에 기대는 원본이면 후보는 보여 주되 채택을 막는다 — 사유를 문구째 싣는다.
    return jsonOk(problemTransformResponseSchema, {
      data: candidates,
      meta: { figureBlockedReason: transformFigureBlockReason(origin) },
    });
  } catch (error) {
    // ⚠️ `AiConfigError` 는 `AiGenerationError` 의 하위 타입이다 — **이 검사가 먼저** 와야
    //    한다. 순서를 뒤집으면 설정 누락이 다시 일반 실패로 뭉개져 화면에서 원인을 못 본다.
    if (error instanceof AiConfigError) {
      console.error("[POST /api/problems/transform] AI not configured");
      return jsonError(
        "AI_GENERATION_FAILED",
        "AI 설정이 없습니다 — 서버 환경변수 DEEPSEEK_API_KEY 를 확인해주세요.",
        503,
      );
    }
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
