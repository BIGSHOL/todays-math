/**
 * MSW 핸들러 — 문제은행 + Claude AI 생성/변형 (T0.5.2).
 * 대응 계약: src/contracts/problem.contract.ts
 * 대응 API 경로:
 *   POST/GET /api/problems, GET/PATCH/DELETE /api/problems/{id}
 *   PATCH /api/problems/{id}/review-status
 *   POST /api/problems/generate, POST /api/problems/transform
 *
 * ⚠️ 생성/변형 응답은 src/mocks/data/aiProblems.ts의 고정 픽스처를 그대로 반환한다 — 테스트에서
 *    실제 Claude API를 호출하지 않는다(07-coding-convention §5, CLAUDE.md 절대 규칙 7).
 * ⚠️ 이 핸들러도 class.ts와 마찬가지로 stateless — POST/PATCH/DELETE는 고정 배열을 변형하지 않는다.
 */
import { http, type HttpHandler } from "msw";

import { deleteResponseSchema } from "@/contracts/common.contract";
import {
  problemCreateRequestSchema,
  problemFilterQuerySchema,
  problemGenerateRequestSchema,
  problemGenerateResponseSchema,
  problemListResponseSchema,
  problemResponseSchema,
  problemReviewStatusUpdateRequestSchema,
  problemTransformRequestSchema,
  problemTransformResponseSchema,
  problemUpdateRequestSchema,
} from "@/contracts/problem.contract";

import {
  MOCK_AI_GENERATED_PROBLEMS,
  MOCK_AI_TRANSFORMED_PROBLEMS,
  MOCK_PROBLEM_OTHER_SHARED,
  MOCK_PROBLEM_OTHER_USER,
  MOCK_PROBLEMS,
  PROBLEM_OTHER_ID,
  PROBLEM_OTHER_SHARED_ID,
  USER_TEACHER_ID,
} from "../data";
import {
  forbiddenError,
  jsonError,
  jsonOk,
  notFoundError,
  paginate,
  validationError,
} from "./_helpers";

/** 등록형(30개) + AI 생성/변형(8개) 전체 — GET 목록/단건 조회가 참조하는 전체 풀. */
const ALL_PROBLEMS = [
  ...MOCK_PROBLEMS,
  MOCK_PROBLEM_OTHER_SHARED,
  ...MOCK_AI_GENERATED_PROBLEMS,
  ...MOCK_AI_TRANSFORMED_PROBLEMS,
];

function findAccessibleProblem(id: string) {
  if (id === PROBLEM_OTHER_ID) {
    return { entity: MOCK_PROBLEM_OTHER_USER, accessible: false };
  }
  if (id === PROBLEM_OTHER_SHARED_ID) {
    return { entity: MOCK_PROBLEM_OTHER_SHARED, accessible: true };
  }
  const entity = ALL_PROBLEMS.find((p) => p.id === id);
  return entity
    ? { entity, accessible: true }
    : { entity: undefined, accessible: false };
}

/** AI_GENERATION_FAILED 실패 경로 재현 전용 sentinel — 실제 시드에 없는 임의의 유효 UUID. */
export const AI_GENERATION_FAILURE_UNIT_ID =
  "ffffffff-0000-4000-8000-000000000001";
export const AI_TRANSFORM_FAILURE_ORIGIN_ID =
  "ffffffff-0000-4000-8000-000000000002";

export const problemHandlers: HttpHandler[] = [
  // POST /api/problems — 문제 등록(수동 자작/기출 직접 입력)
  http.post("/api/problems", async ({ request }) => {
    const parsed = problemCreateRequestSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    return jsonOk(
      problemResponseSchema,
      {
        data: {
          id: crypto.randomUUID(),
          userId: USER_TEACHER_ID,
          unitId: parsed.data.unitId,
          source: parsed.data.source,
          originProblemId: null,
          difficulty: parsed.data.difficulty,
          problemType: parsed.data.problemType,
          content: parsed.data.content,
          answer: parsed.data.answer,
          solution: parsed.data.solution ?? null,
          reviewStatus: "pending",
          directUseAllowed: true,
          pool: parsed.data.pool,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      { status: 201 },
    );
  }),

  // GET /api/problems — 필터 조회(unitId/difficulty/problemType/source/reviewStatus)
  http.get("/api/problems", ({ request }) => {
    const url = new URL(request.url);
    const parsed = problemFilterQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    if (!parsed.success) return validationError(parsed.error);
    const { page, pageSize, ...filters } = parsed.data;

    const filtered = ALL_PROBLEMS.filter((p) => {
      if (p.pool === "private" && p.userId !== USER_TEACHER_ID) return false;
      if (filters.unitId && p.unitId !== filters.unitId) return false;
      if (filters.difficulty && p.difficulty !== filters.difficulty)
        return false;
      if (filters.problemType && p.problemType !== filters.problemType)
        return false;
      if (filters.source && p.source !== filters.source) return false;
      if (filters.reviewStatus && p.reviewStatus !== filters.reviewStatus)
        return false;
      if (filters.pool && p.pool !== filters.pool) return false;
      return true;
    });
    return jsonOk(
      problemListResponseSchema,
      paginate(filtered, { page, pageSize }),
    );
  }),

  // GET /api/problems/:id — 단건 조회
  http.get("/api/problems/:id", ({ params }) => {
    const found = findAccessibleProblem(String(params.id));
    if (!found.entity) return notFoundError("문제");
    if (!found.accessible) return forbiddenError();
    return jsonOk(problemResponseSchema, { data: found.entity });
  }),

  // PATCH /api/problems/:id — 수정(본문/정답/풀이 등)
  http.patch("/api/problems/:id", async ({ params, request }) => {
    const found = findAccessibleProblem(String(params.id));
    if (!found.entity) return notFoundError("문제");
    if (!found.accessible) return forbiddenError();

    const parsed = problemUpdateRequestSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    return jsonOk(problemResponseSchema, {
      data: {
        ...found.entity,
        ...parsed.data,
        updatedAt: new Date().toISOString(),
      },
    });
  }),

  // DELETE /api/problems/:id — 삭제
  http.delete("/api/problems/:id", ({ params }) => {
    const found = findAccessibleProblem(String(params.id));
    if (!found.entity) return notFoundError("문제");
    if (!found.accessible) return forbiddenError();
    return jsonOk(deleteResponseSchema, { data: { id: found.entity.id } });
  }),

  // PATCH /api/problems/:id/review-status — 검수 승격(D-22)
  http.patch("/api/problems/:id/review-status", async ({ params, request }) => {
    const found = findAccessibleProblem(String(params.id));
    if (!found.entity) return notFoundError("문제");
    if (!found.accessible) return forbiddenError();
    const entity = found.entity;

    const parsed = problemReviewStatusUpdateRequestSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) return validationError(parsed.error);

    return jsonOk(problemResponseSchema, {
      data: {
        ...entity,
        reviewStatus: parsed.data.reviewStatus,
        updatedAt: new Date().toISOString(),
      },
    });
  }),

  // POST /api/problems/generate — AI 문제 생성(unitId, difficulty, count)
  http.post("/api/problems/generate", async ({ request }) => {
    const parsed = problemGenerateRequestSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    // 대표 실패 경로 — AI 생성 실패(재시도 후에도 실패했다고 가정).
    if (parsed.data.unitId === AI_GENERATION_FAILURE_UNIT_ID) {
      return jsonError(
        "AI_GENERATION_FAILED",
        "AI 문제 생성에 실패했습니다. 잠시 후 다시 시도해주세요.",
        502,
      );
    }

    const problems = MOCK_AI_GENERATED_PROBLEMS.slice(0, parsed.data.count).map(
      (p) => ({
        ...p,
        unitId: parsed.data.unitId,
        difficulty: parsed.data.difficulty,
      }),
    );
    return jsonOk(
      problemGenerateResponseSchema,
      { data: problems },
      { status: 201 },
    );
  }),

  // POST /api/problems/transform — 기존 문제 변형(originProblemId, count)
  http.post("/api/problems/transform", async ({ request }) => {
    const parsed = problemTransformRequestSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) return validationError(parsed.error);

    if (parsed.data.originProblemId === AI_TRANSFORM_FAILURE_ORIGIN_ID) {
      return jsonError(
        "AI_GENERATION_FAILED",
        "AI 문제 변형에 실패했습니다. 잠시 후 다시 시도해주세요.",
        502,
      );
    }

    const origin = ALL_PROBLEMS.find(
      (p) => p.id === parsed.data.originProblemId,
    );
    if (!origin) return notFoundError("원본 문제");

    const problems = MOCK_AI_TRANSFORMED_PROBLEMS.slice(
      0,
      parsed.data.count,
    ).map((p) => ({
      ...p,
      originProblemId: origin.id,
      unitId: origin.unitId,
      difficulty: origin.difficulty,
      problemType: origin.problemType,
    }));
    return jsonOk(
      problemTransformResponseSchema,
      { data: problems },
      { status: 201 },
    );
  }),
];
