/**
 * POST /api/problems/{id}/reports — 문항 신고 (검수 콘솔 17).
 * 대응 계약: src/contracts/problemReport.contract.ts
 *
 * 왜 있나: 문항이 47,049건이라 **전량 검수가 불가능하다**(한 문항 10초로도 131시간).
 * 마지막 안전망은 「쓰다가 이상하면 누른다」이고, 그 기록이 다음 검수의 대기열이 된다.
 *
 * ⚠️ **신고는 문항을 바꾸지 않는다.** `directUseAllowed` 나 `reviewStatus` 를 여기서
 *    건드리면 오신고 한 건이 멀쩡한 문항을 지면에서 지운다. 신고는 **기록**이고,
 *    빼는 것은 사람이 따로 결정한다(D-22 와 같은 결).
 *
 * ⚠️ 접근은 `requireAccessibleProblem` 을 쓴다 — **남의 공용 문항도 신고할 수 있어야
 *    한다.** 검수 계정은 자기 문항이 없으므로, 소유 검사로 막으면 콘솔이 통째로
 *    무의미해진다(D-31 공용 풀).
 */
import type { NextRequest } from "next/server";

import { idParamSchema } from "@/contracts/common.contract";
import {
  problemReportCreateRequestSchema,
  problemReportResponseSchema,
} from "@/contracts/problemReport.contract";
import { jsonOk, unauthorizedError, validationError } from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { requireAccessibleProblem } from "@/lib/ownership";
import { serializeProblemReport } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationError(idResult.error);

  const accessible = await requireAccessibleProblem(id, session.id);
  if (!accessible.ok) return accessible.response;

  const body = await request.json().catch(() => undefined);
  const parsed = problemReportCreateRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  /**
   * 같은 사람이 같은 문항을 같은 사유로 거듭 누르면 **한 건**으로 본다.
   * 두 번째 이후는 200 으로 이미 있는 기록을 돌려준다 — 실패가 아니다.
   * (DB 에도 같은 규칙이 유니크 인덱스로 걸려 있다. 한쪽만 있으면 API 를 우회한
   *  적재가 그 규칙을 그냥 지나간다.)
   */
  const existing = await db.problemReport.findFirst({
    where: {
      problemId: id,
      reporterId: session.id,
      reason: parsed.data.reason,
      status: "open",
    },
  });
  if (existing) {
    return jsonOk(problemReportResponseSchema, {
      data: serializeProblemReport(existing),
    });
  }

  const created = await db.problemReport.create({
    data: {
      problemId: id,
      reporterId: session.id,
      reason: parsed.data.reason,
      note: parsed.data.note ?? null,
    },
  });

  return jsonOk(
    problemReportResponseSchema,
    { data: serializeProblemReport(created) },
    { status: 201 },
  );
}
