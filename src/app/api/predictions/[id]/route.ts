/**
 * GET /api/predictions/{id} — 예측 회차 상세.
 *
 * 대응 계약: src/contracts/predictionRun.contract.ts
 */
import type { NextRequest } from "next/server";

import { idParamSchema } from "@/contracts/common.contract";
import { predictionRunDetailResponseSchema } from "@/contracts/predictionRun.contract";
import { jsonOk, unauthorizedError, validationError } from "@/lib/apiResponse";
import {
  requireOwnedPredictionRun,
  serializePredictionRunDetail,
} from "@/lib/predictor/predictionRunService";
import { getSessionUser } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationError(idResult.error);

  const owned = await requireOwnedPredictionRun(id, session.id);
  if (!owned.ok) return owned.response;

  return jsonOk(predictionRunDetailResponseSchema, {
    data: serializePredictionRunDetail(owned.data),
  });
}
