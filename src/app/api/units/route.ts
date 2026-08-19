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

  // 🔴 예전에는 행 전체를 `as UnitEntity[]` 로 우겨넣었다. 계약이 strictObject 라
  //    **컬럼이 하나 늘 때마다 이 응답이 500 이 된다** — 실제로 `problem_code_prefix`(D-53)를
  //    넣자마자 그렇게 됐다. 계약에 있는 것만 골라 읽어 그 고리를 끊는다.
  const units: UnitEntity[] = await db.unit.findMany({
    select: {
      id: true,
      grade: true,
      chapter: true,
      section: true,
      orderIndex: true,
    },
    orderBy: { orderIndex: "asc" },
  });
  return jsonOk(unitListResponseSchema, { data: units });
}
