/**
 * GET /api/metrics — 주간 사용 지표 요약.
 * 대응 계약: src/contracts/metrics.contract.ts
 */
import type { NextRequest } from "next/server";

import {
  metricsQuerySchema,
  metricsResponseSchema,
} from "@/contracts/metrics.contract";
import { jsonOk, unauthorizedError, validationError } from "@/lib/apiResponse";
import { db } from "@/lib/db";
import {
  computeWeeklyMetrics,
  resolveWeekWindow,
  weekWindowInstants,
} from "@/lib/metrics";
import { serializeTest } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const parsed = metricsQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return validationError(parsed.error);

  const window = resolveWeekWindow(parsed.data.weekStart);
  // 🔴 주간 창을 JS filter 로만 걸던 자리다 — 이 원장이 **여태까지 인쇄한 시험지 전부**를
  //    읽어 와서 그중 7일치만 세고 나머지를 버렸다. 쓰는 만큼만 읽게 창을 SQL 로 내린다.
  //    기준 컬럼은 test_date 가 아니라 printed_at 이다(weekWindowInstants 주석 참조).
  //    JS 판정(computeWeeklyMetrics)은 **그대로 둔다** — 두 판정이 같은 집합을 내므로
  //    where 가 나중에 어긋나도 지표가 조용히 부풀지 않는다.
  const printedWindow = weekWindowInstants(window);
  const rows = await db.test.findMany({
    where: {
      userId: session.id,
      status: "printed",
      printedAt: { gte: printedWindow.gte, lt: printedWindow.lt },
    },
  });

  return jsonOk(metricsResponseSchema, {
    data: computeWeeklyMetrics(rows.map(serializeTest), window),
  });
}
