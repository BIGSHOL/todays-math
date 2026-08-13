/**
 * POST/GET /api/classes — 반 생성 · 본인 소유 반 목록 조회(페이지네이션).
 * 대응 계약: src/contracts/class.contract.ts
 */
import type { NextRequest } from "next/server";

import {
  classCreateRequestSchema,
  classListResponseSchema,
  classResponseSchema,
} from "@/contracts/class.contract";
import { paginationParamsSchema } from "@/contracts/common.contract";
import {
  jsonData,
  unauthorizedErrorResponse,
  validationErrorResponse,
} from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { serializeClass } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

// POST /api/classes — 반 생성
export async function POST(request: NextRequest) {
  const session = await getSessionUser(request);
  if (!session) return unauthorizedErrorResponse();

  const body = await request.json().catch(() => undefined);
  const parsed = classCreateRequestSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const created = await db.class.create({
    data: {
      userId: session.id,
      name: parsed.data.name,
      grade: parsed.data.grade,
      defaultProblemCount: parsed.data.defaultProblemCount,
      difficultyRatio: parsed.data.difficultyRatio,
    },
  });

  return jsonData(
    classResponseSchema,
    { data: serializeClass(created) },
    { status: 201 },
  );
}

// GET /api/classes — 본인 소유 반 목록(페이지네이션, 타 사용자 반 제외)
export async function GET(request: NextRequest) {
  const session = await getSessionUser(request);
  if (!session) return unauthorizedErrorResponse();

  const url = new URL(request.url);
  const parsedParams = paginationParamsSchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsedParams.success) return validationErrorResponse(parsedParams.error);
  const { page, pageSize } = parsedParams.data;

  const [rows, total] = await Promise.all([
    db.class.findMany({
      where: { userId: session.id },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    db.class.count({ where: { userId: session.id } }),
  ]);

  return jsonData(classListResponseSchema, {
    data: rows.map(serializeClass),
    meta: { page, pageSize, total },
  });
}
