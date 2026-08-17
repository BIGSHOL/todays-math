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
import { db } from "@/lib/db";
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
  //
  // 🔴 예전에는 학생마다 `requireOwnedStudent` 를 순차로 await 했다. 그 헬퍼는 학생 1회 +
  //    소속 반 1회를 읽으므로 **30명이면 60번 순차 왕복**이었다. 반을 조인해 한 번에 읽는다.
  //
  //    거부 응답 계약은 그대로다. `requireOwnedStudent` 는 "없으면 404(학생), 있는데 내
  //    반이 아니면 403" 이었고, 여러 명이 문제면 **요청 순서상 처음 걸린 한 명**의 응답을
  //    냈다. 그래서 여기서도 `parsed.data.scores` 를 원래 순서대로 훑으며 처음 걸린 것을
  //    낸다 — 조회만 한 번으로 합치고 판정 순서는 건드리지 않는다.
  //    (반은 Student.class_id NOT NULL 이라 학생이 있으면 반드시 있다.)
  const studentOwners = await db.student.findMany({
    where: {
      id: { in: [...new Set(parsed.data.scores.map((s) => s.studentId))] },
    },
    select: { id: true, class: { select: { userId: true } } },
  });
  const ownerByStudent = new Map(
    studentOwners.map((row) => [row.id, row.class.userId]),
  );
  for (const entry of parsed.data.scores) {
    const ownerUserId = ownerByStudent.get(entry.studentId);
    if (ownerUserId === undefined) return notFoundError("학생");
    if (ownerUserId !== session.id) return forbiddenError();
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
  if (index.ownerUserId !== session.id) return forbiddenError();

  const payload = await listActualScores(id, session.id);
  return jsonOk(actualScoreResponseSchema, { data: payload });
}
