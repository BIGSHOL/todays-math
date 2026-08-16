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
import { loadVisibleRuns } from "@/lib/exam/loadRounds";
import { getSessionUser } from "@/lib/session";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { id } = await params;
  const { runs, actuals, ownedStudents } = await loadVisibleRuns(session.id);

  // 내게 보이는 회차 목록에서만 찾는다 — 남의 회차는 애초에 여기 없다.
  const run = runs.find((r) => r.id === id);
  if (!run) return notFoundError("회차");

  const detail = toRoundDetail(run, actuals, ownedStudents);
  if (!detail) return notFoundError("회차");

  return jsonOk(examRoundDetailResponseSchema, { data: detail });
}
