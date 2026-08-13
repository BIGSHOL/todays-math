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
import { computeWeeklyMetrics, resolveWeekWindow } from "@/lib/metrics";
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
  const rows = await db.test.findMany({
    where: { userId: session.id, status: "printed" },
  });

  return jsonOk(metricsResponseSchema, {
    data: computeWeeklyMetrics(rows.map(serializeTest), window),
  });
}
