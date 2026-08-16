/**
 * POST|GET /api/predictions/{id}/actual — T7.10 실측 점수 저장 · 잔차 조회.
 *
 * 대응 계약: src/contracts/calibration.contract.ts
 * 구현: src/lib/predictor/actualScoreService.ts (IO) · src/lib/predictor/calibration.ts (계산)
 *
 * 소유권은 **이중**이다.
 *   ① 회차 자체 — `PredictionRun.userId` 가 로그인 원장이어야 한다. 남의 회차에는
 *      실측을 붙일 수도, 조회할 수도 없다. 이게 1차 경계다.
 *   ② 학생 — 붙이려는 학생이 로그인 원장의 반에 속해야 한다(`requireOwnedStudent`).
 *      조회도 같은 기준으로 한 번 더 걸러 다른 원장의 학생 점수가 새지 않게 한다.
 *
 * 소유권과 **응시 여부**는 다른 질문이다. 내 학생이어도 다른 학교·학년이면 이 시험을
 * 보지 않는다 — 그 판정은 `examRoster.takesExam` 이 하고, 화면도 같은 함수를 쓴다.
 * (예전에는 "회차의 predictedScores 에 있는 학생인가"로 판정했는데, 그 Json 이 늘 비어 있어
 *  모든 실점수가 422 로 거절됐다 — 보정 루프가 통째로 닫혀 있었다. adv-보정루프.md 🔴1.)
 *
 * ⚠️ T7.7 이 `predictionRunService.requireOwnedPredictionRun` 을 갖고 있지만 아직
 *    main 에 없다(확인 완료). 그 파일은 T7.7 소유라 손대지 않고, 여기서는 이미 읽어 둔
 *    회차의 `ownerUserId` 로 직접 비교한다. T7.7 병합 뒤 그 헬퍼로 합치면 된다.
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
  forbiddenError,
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
  if (index.ownerUserId !== session.id) return forbiddenError();

  // 학생 소유권을 먼저 전부 확인한다 — 한 명이라도 남의 학생이면 아무것도 저장하지 않는다.
  // 확인하면서 읽은 학생 행을 그대로 서비스에 넘긴다(응시 명단 판정의 근거다).
  // 다시 읽지 않는다 — 두 번 읽으면 그 사이에 바뀐 값으로 판정이 갈릴 수 있다.
  const roster = [];
  for (const entry of parsed.data.scores) {
    const owned = await requireOwnedStudent(entry.studentId, session.id);
    if (!owned.ok) return owned.response;
    roster.push(owned.data);
  }

  const result = await attachActualScores(
    index,
    parsed.data,
    session.id,
    roster,
  );

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
      "이 시험을 보지 않는 학생이 있습니다.",
      422,
      result.studentIds.map((studentId) => ({
        field: "scores.studentId",
        message: `${studentId} — 재학 학교·학년이 이 회차의 시험과 다릅니다.`,
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
  if (index.ownerUserId !== session.id) return forbiddenError();

  const payload = await listActualScores(id, session.id);
  return jsonOk(actualScoreResponseSchema, { data: payload });
}
