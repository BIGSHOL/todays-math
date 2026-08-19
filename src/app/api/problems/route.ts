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
import { MISSING_ANSWER } from "@/lib/missingAnswer";
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
    // exam-wiring: 기출·원본없음 — 계약이 source=past_exam 도 받지만, 이 경로의 입력에는
    //   examId·sourceFile·questionNumber 가 **아예 없다**(problemCreateSchema). 원본 시험지를
    //   가리킬 값이 없으므로 Exam 을 만들 수 없다. 지어내지 않고 비워 둔다.
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

  const {
    page,
    pageSize,
    grade,
    chapter,
    chapterPrefix,
    hasFigure,
    hasSolution,
    hasAnswer,
    ...filters
  } = parsed.data;
  // 계단식 단원 필터(S-08) — problem 컬럼이 아니라 Unit relation으로 거른다.
  // chapter(정확 일치)가 있으면 chapterPrefix(접두 일치)는 무시한다.
  const unitWhere: {
    grade?: string;
    chapter?: string | { startsWith: string };
  } = {};
  if (grade) unitWhere.grade = grade;
  if (chapter) unitWhere.chapter = chapter;
  else if (chapterPrefix) unitWhere.chapter = { startsWith: chapterPrefix };
  // 「그림 있는 문제만」(S-08) — 그림은 두 갈래다. 원본 시험지에서 오려 온 이미지 경로
  // (`figureUrls`, 실측 8,442건)와 엔진이 그린 SVG(`figureSvg`, 현재 0건). 지금 0건이라고
  // 한쪽만 보면 SVG 가 채워지는 날 조용히 빠지므로 처음부터 둘 다 본다.
  const figureWhere = hasFigure
    ? [
        {
          OR: [
            { NOT: { figureUrls: { isEmpty: true } } },
            { figureSvg: { not: null } },
          ],
        },
      ]
    : [];
  // 「해설 있는 문제만」(2026-08-19) — `solution` 은 nullable 이고 **빈 문자열도
  // 들어 있다.** null 만 걸러도 빈 해설이 통과하므로 둘 다 본다.
  const solutionWhere = hasSolution
    ? [{ AND: [{ solution: { not: null } }, { solution: { not: "" } }] }]
    : [];
  // 「정답 있는 문제만」(2026-08-19) — 실측 45,041건(95.5%).
  //
  // ⚠️ `answer` 는 **빈 값이 0건**이다. 「비어 있지 않은가」로 만들면 100% 를
  // 통과시켜 아무것도 안 거른다. 실제 자리표시자는 `MISSING_ANSWER`("(정답 없음)")
  // 문자열 2,111건이다 — 빈 값이 빈 문자열이 아니라 **글자로 적혀 있다.**
  //
  // 이 상수는 **출제 자격(`findEligibleProblems`)이 쓰는 바로 그 값**이다. 화면
  // 필터가 따로 판정하면 「은행에는 보이는데 출제에는 안 뽑히는」 문항이 생긴다.
  const answerWhere = hasAnswer
    ? [{ AND: [{ answer: { not: MISSING_ANSWER } }, { answer: { not: "" } }] }]
    : [];
  const where = {
    AND: [
      problemVisibleWhere(session.id),
      filters,
      ...(Object.keys(unitWhere).length > 0 ? [{ unit: unitWhere }] : []),
      ...figureWhere,
      ...solutionWhere,
      ...answerWhere,
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
