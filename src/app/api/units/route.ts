/**
 * GET /api/units — 교육과정 단원 목록 (확인테스트 범위 선택).
 */
import {
  unitListResponseSchema,
  type UnitEntity,
} from "@/contracts/unit.contract";
import { jsonOk, unauthorizedError } from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export async function GET() {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const units = (await db.unit.findMany({
    orderBy: { orderIndex: "asc" },
  })) as UnitEntity[];
  return jsonOk(unitListResponseSchema, { data: units });
}
