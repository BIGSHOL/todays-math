/**
 * POST /api/predictions — 예측 실행 + `PredictionRun` 저장
 * GET  /api/predictions — 회차 목록(계기판)
 *
 * 대응 계약: src/contracts/predictionRun.contract.ts
 */
import type { NextRequest } from "next/server";

import {
  createPredictionRunRequestSchema,
  predictionRunDetailResponseSchema,
  predictionRunListQuerySchema,
  predictionRunListResponseSchema,
} from "@/contracts/predictionRun.contract";
import {
  jsonError,
  jsonOk,
  unauthorizedError,
  validationError,
} from "@/lib/apiResponse";
import {
  listPredictionRuns,
  PredictionInputInvalidError,
  PredictionInputNotFoundError,
  PredictionLeakageError,
  runPrediction,
} from "@/lib/predictor/predictionRunService";
import { getSessionUser } from "@/lib/session";

export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const body = await request.json().catch(() => undefined);
  const parsed = createPredictionRunRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const run = await runPrediction({ userId: session.id, ...parsed.data });
    return jsonOk(
      predictionRunDetailResponseSchema,
      { data: run },
      { status: 201 },
    );
  } catch (error) {
    // 🔴 시간 분리 위반 — 요청 형식은 맞지만 그 입력으로는 예측을 만들 수 없다(422).
    //    저장은 이미 거부됐다(서비스가 DB 쓰기 전에 던진다).
    if (error instanceof PredictionLeakageError) {
      return jsonError("VALIDATION_ERROR", error.message, 422, error.detail);
    }
    if (error instanceof PredictionInputNotFoundError) {
      return jsonError("NOT_FOUND", error.message, 404);
    }
    if (error instanceof PredictionInputInvalidError) {
      return jsonError("VALIDATION_ERROR", error.message, 400, error.issues);
    }
    console.error("[POST /api/predictions] prediction run failed", error);
    return jsonError("INTERNAL_ERROR", "예측 중 오류가 발생했습니다.", 500);
  }
}

const LIST_QUERY_KEYS = ["school", "grade", "level", "subject"] as const;

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const searchParams = request.nextUrl.searchParams;
  const raw: Record<string, string> = {};
  for (const key of LIST_QUERY_KEYS) {
    const value = searchParams.get(key);
    if (value !== null) raw[key] = value;
  }

  const parsed = predictionRunListQuerySchema.safeParse(raw);
  if (!parsed.success) return validationError(parsed.error);

  const runs = await listPredictionRuns({
    userId: session.id,
    ...parsed.data,
  });
  return jsonOk(predictionRunListResponseSchema, { data: runs });
}
