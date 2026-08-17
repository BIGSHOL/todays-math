import type { Difficulty, ReviewStatus } from "@/contracts/common.contract";
import {
  problemCreateRequestSchema,
  problemGenerateRequestSchema,
  problemGenerateResponseSchema,
  problemListResponseSchema,
  problemResponseSchema,
  problemTransformRequestSchema,
  problemTransformResponseSchema,
  type ProblemCreateRequest,
  type ProblemGenerateRequest,
  type ProblemTransformRequest,
  type ProblemType,
} from "@/contracts/problem.contract";

export type ProblemListFilters = {
  unitId?: string;
  difficulty?: Difficulty;
  problemType?: ProblemType;
  reviewStatus?: ReviewStatus;
};

/** 문제은행 목록 페이지 크기 — 계약 기본값(paginationParamsSchema)과 동일. */
export const PROBLEM_PAGE_SIZE = 20;

function listQuery(filters: ProblemListFilters, page: number) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(PROBLEM_PAGE_SIZE),
  });
  if (filters.unitId) params.set("unitId", filters.unitId);
  if (filters.difficulty) params.set("difficulty", filters.difficulty);
  if (filters.problemType) params.set("problemType", filters.problemType);
  if (filters.reviewStatus) params.set("reviewStatus", filters.reviewStatus);
  return params.toString();
}

export async function loadProblems(filters: ProblemListFilters, page = 1) {
  const res = await fetch(`/api/problems?${listQuery(filters, page)}`);
  if (!res.ok) throw new Error("목록을 불러오지 못했습니다");
  return problemListResponseSchema.parse(await res.json());
}

export async function createProblem(input: ProblemCreateRequest) {
  const body = problemCreateRequestSchema.parse(input);
  const res = await fetch("/api/problems", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("등록에 실패했습니다");
  return problemResponseSchema.parse(await res.json());
}

export async function generateProblems(input: ProblemGenerateRequest) {
  const body = problemGenerateRequestSchema.parse(input);
  const res = await fetch("/api/problems/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("생성에 실패했습니다");
  return problemGenerateResponseSchema.parse(await res.json());
}

export async function transformProblems(input: ProblemTransformRequest) {
  const body = problemTransformRequestSchema.parse(input);
  const res = await fetch("/api/problems/transform", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("변형에 실패했습니다");
  return problemTransformResponseSchema.parse(await res.json());
}
