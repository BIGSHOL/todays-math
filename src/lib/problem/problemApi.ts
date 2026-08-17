import type { Difficulty, ReviewStatus } from "@/contracts/common.contract";
import type {
  ProblemCreateRequest,
  ProblemGenerateRequest,
  ProblemTransformRequest,
  ProblemType,
} from "@/contracts/problem.contract";

/**
 * 계약 스키마는 **런타임 값으로 정적 import 하지 않는다** (성능 수리 C-1).
 *
 * 문제은행(/problems)이 초기 JS 1,256KB 로 가장 무거웠고 그 중 279KB 가
 * zod + 계약 모듈이었다. 이 파일의 검증은 전부 `fetch` 응답 직후(목록/응답 parse)
 * 이거나 사용자가 등록·생성·변형 버튼을 누른 뒤(요청 parse)라, 첫 페인트를 막을
 * 이유가 없다. **검증은 하나도 지우지 않았다 — 불러오는 시점만 옮겼다.**
 */
const problemContract = () => import("@/contracts/problem.contract");

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
  const { problemListResponseSchema } = await problemContract();
  return problemListResponseSchema.parse(await res.json());
}

export async function createProblem(input: ProblemCreateRequest) {
  const { problemCreateRequestSchema, problemResponseSchema } =
    await problemContract();
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
  const { problemGenerateRequestSchema, problemGenerateResponseSchema } =
    await problemContract();
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
  const { problemTransformRequestSchema, problemTransformResponseSchema } =
    await problemContract();
  const body = problemTransformRequestSchema.parse(input);
  const res = await fetch("/api/problems/transform", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("변형에 실패했습니다");
  return problemTransformResponseSchema.parse(await res.json());
}
