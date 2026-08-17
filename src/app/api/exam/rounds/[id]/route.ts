/**
 * GET /api/exam/rounds/{id} — '오늘의 시험' 회차 상세 (예측 | 실측) (T7.14).
 *
 * ⚠️ 역할 구분은 `../route.ts` 머리주석 참조 — 여기는 **화면 조회 전용**이고
 *    T7.7 의 `/api/predictions` 가 엔진 실행·저장이다.
 *
 * 🔴 GET 만 있다. 쓰기 금지.
 * 🔴 남의 회차는 403 이 아니라 **404** 다 — 존재 여부 자체를 알리지 않는다.
 */
import type { NextRequest } from "next/server";

import { examRoundDetailResponseSchema } from "@/components/exam/examScreen.contract";
import { jsonOk, notFoundError, unauthorizedError } from "@/lib/apiResponse";
import { toRoundDetail } from "@/lib/exam/composeRounds";
import { loadVisibleRun } from "@/lib/exam/loadRounds";
import { getSessionUser } from "@/lib/session";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { id } = await params;
  // 🔴 예전에는 `loadVisibleRuns` 로 내 회차를 **전부** 읽고 JS find 로 한 건을 골랐다.
  //    상세 1건의 비용이 회차 수에 비례해 커지는 구조였다. 소유권 판정은 그대로
  //    (`isRunVisibleTo`) 두고 조회만 이 회차로 좁힌다 — 남의 회차는 여전히 **404** 다.
  const visible = await loadVisibleRun(session.id, id);
  if (!visible) return notFoundError("회차");
  const { run, actuals, ownedStudents, linkedTests } = visible;

  const detail = toRoundDetail(run, actuals, ownedStudents, linkedTests);
  if (!detail) return notFoundError("회차");

  return jsonOk(examRoundDetailResponseSchema, { data: detail });
}
