/**
 * POST/GET /api/problems — 문제 등록(수동 자작/기출 직접 입력) · 공용 풀+본인 문제 목록
 * (필터: unitId/grade/chapter/chapterPrefix/difficulty/problemType/source/reviewStatus/pool,
 *  페이지네이션 — grade/chapter/chapterPrefix는 Unit relation 필터, S-08 계단식 단원 필터).
 * 대응 계약: src/contracts/problem.contract.ts
 *
 * ⚠️ reviewStatus는 등록 요청에 포함되지 않는다(계약이 strictObject로 거부) — 신규 문제는
 * 항상 review_status='pending'으로 시작하며, 승격은 PATCH /api/problems/{id}/review-status
 * 전용 엔드포인트를 통해서만 가능하다(D-22).
 */
import type { NextRequest } from "next/server";

import {
  problemCreateRequestSchema,
  problemFilterQuerySchema,
  problemListResponseSchema,
  problemResponseSchema,
} from "@/contracts/problem.contract";
import {
  jsonOk,
  notFoundError,
  unauthorizedError,
  validationError,
} from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { DEFAULT_PROBLEM_POOL, problemVisibleWhere } from "@/lib/problemPool";
import { isPrismaErrorCode } from "@/lib/prismaErrors";
import { serializeProblem } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

// POST /api/problems — 문제 등록(source: manual/past_exam만 허용 — 계약이 강제)
export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const body = await request.json().catch(() => undefined);
  const parsed = problemCreateRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const unit = await db.unit.findUnique({ where: { id: parsed.data.unitId } });
  if (!unit) return notFoundError("소단원");

  let created;
  try {
    created = await db.problem.create({
      data: {
        userId: session.id,
        unitId: parsed.data.unitId,
        source: parsed.data.source,
        difficulty: parsed.data.difficulty,
        problemType: parsed.data.problemType,
        content: parsed.data.content,
        answer: parsed.data.answer,
        solution: parsed.data.solution ?? null,
        pool: parsed.data.pool ?? DEFAULT_PROBLEM_POOL,
      },
    });
  } catch (error) {
    if (isPrismaErrorCode(error, "P2003")) {
      const currentUnit = await db.unit.findUnique({
        where: { id: parsed.data.unitId },
      });
      if (!currentUnit) return notFoundError("소단원");
    }
    throw error;
  }

  return jsonOk(
    problemResponseSchema,
    { data: serializeProblem(created) },
    { status: 201 },
  );
}

// GET /api/problems — 공용 풀 + 본인 private (필터 + 페이지네이션, D-31)
export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const url = new URL(request.url);
  const parsed = problemFilterQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsed.success) return validationError(parsed.error);

  const { page, pageSize, grade, chapter, chapterPrefix, ...filters } =
    parsed.data;
  // 계단식 단원 필터(S-08) — problem 컬럼이 아니라 Unit relation으로 거른다.
  // chapter(정확 일치)가 있으면 chapterPrefix(접두 일치)는 무시한다.
  const unitWhere: {
    grade?: string;
    chapter?: string | { startsWith: string };
  } = {};
  if (grade) unitWhere.grade = grade;
  if (chapter) unitWhere.chapter = chapter;
  else if (chapterPrefix) unitWhere.chapter = { startsWith: chapterPrefix };
  const where = {
    AND: [
      problemVisibleWhere(session.id),
      filters,
      ...(Object.keys(unitWhere).length > 0 ? [{ unit: unitWhere }] : []),
    ],
  };

  const [rows, total] = await Promise.all([
    db.problem.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      // 이관 배치는 createdAt이 같은 행이 수천 건이라 id 보조 키 없이는 페이지가 겹친다.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    db.problem.count({ where }),
  ]);

  return jsonOk(problemListResponseSchema, {
    data: rows.map(serializeProblem),
    meta: { page, pageSize, total },
  });
}
