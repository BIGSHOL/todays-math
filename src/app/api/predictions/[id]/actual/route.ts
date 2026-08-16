/**
 * POST|GET /api/predictions/{id}/actual — T7.10 실측 점수 저장 · 잔차 조회.
 *
 * 대응 계약: src/contracts/calibration.contract.ts
 * 구현: src/lib/predictor/actualScoreService.ts (IO) · src/lib/predictor/calibration.ts (계산)
 *
 * 소유권: `PredictionRun` 에는 소유자 컬럼이 없다(예측 대상은 학교·시리즈이지 원장이 아니다).
 * 그래서 경계는 **학생**에 건다 — 학생이 로그인 원장의 반에 속해야 한다(`requireOwnedStudent`).
 * 조회도 같은 기준으로 걸러 다른 원장의 학생 점수가 새지 않게 한다.
 *
 * ⚠️ 422 의 코드가 `VALIDATION_ERROR` 인 이유: 에러 코드 목록(common.contract.ts)은
 *    공유 SSOT라 이 트랙에서 고치지 않는다. "요청 형식은 맞지만 이 회차에서는 처리할 수 없다"는
 *    구분은 HTTP 상태 422 가 진다(트랙 E 의 T7.7 누출 차단 422 와 같은 규약).
 */
import type { NextRequest } from "next/server";

import {
  actualScoreResponseSchema,
  actualScoreUpsertRequestSchema,
} from "@/contracts/calibration.contract";
import { idParamSchema } from "@/contracts/common.contract";
import {
  jsonError,
  jsonOk,
  notFoundError,
  unauthorizedError,
  validationError,
} from "@/lib/apiResponse";
import { requireOwnedStudent } from "@/lib/ownership";
import {
  attachActualScores,
  listActualScores,
  loadRunPredictions,
} from "@/lib/predictor/actualScoreService";
import { getSessionUser } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/predictions/{id}/actual — 실측 점수 저장(같은 학생이면 갱신)
export async function POST(request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationError(idResult.error);

  const body = await request.json().catch(() => undefined);
  const parsed = actualScoreUpsertRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const index = await loadRunPredictions(id);
  if (!index) return notFoundError("예측 회차");

  // 학생 소유권을 먼저 전부 확인한다 — 한 명이라도 남의 학생이면 아무것도 저장하지 않는다.
  for (const entry of parsed.data.scores) {
    const owned = await requireOwnedStudent(entry.studentId, session.id);
    if (!owned.ok) return owned.response;
  }

  const result = await attachActualScores(index, parsed.data, session.id);

  if (!result.ok && result.kind === "예측값_읽기실패") {
    return jsonError(
      "VALIDATION_ERROR",
      "이 회차의 예측값을 읽을 수 없습니다.",
      422,
    );
  }
  if (!result.ok) {
    return jsonError(
      "VALIDATION_ERROR",
      "이 회차의 예측 대상이 아닌 학생이 있습니다.",
      422,
      result.studentIds.map((studentId) => ({
        field: "scores.studentId",
        message: `${studentId} — 이 회차의 예측 대상이 아닙니다.`,
      })),
    );
  }

  return jsonOk(actualScoreResponseSchema, { data: result.payload });
}

// GET /api/predictions/{id}/actual — 저장된 실측과 잔차 요약
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationError(idResult.error);

  const index = await loadRunPredictions(id);
  if (!index) return notFoundError("예측 회차");

  const payload = await listActualScores(id, session.id);
  return jsonOk(actualScoreResponseSchema, { data: payload });
}
