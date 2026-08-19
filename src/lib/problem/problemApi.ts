import type { Difficulty, ReviewStatus } from "@/contracts/common.contract";
import type {
  ProblemCreateRequest,
  ProblemGenerateRequest,
  ProblemTransformAdoptRequest,
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
  /** 계단식 단원 필터(S-08) — unitId가 없을 때 grade(+chapter 또는 +chapterPrefix)로 좁힌다. */
  grade?: string;
  chapter?: string;
  chapterPrefix?: string;
  /** 그림(이미지 경로 또는 엔진 SVG)이 있는 문항만. 켤 때만 붙인다. */
  /** 본문 검색어. 비면 안 붙인다. */
  q?: string;
  hasFigure?: boolean;
  /** 해설(`solution`)이 있는 문항만. 켤 때만 붙인다. */
  hasSolution?: boolean;
  /**
   * 정답이 있는 문항만 — `MISSING_ANSWER` 자리표시자를 뺀다. 켤 때만 붙인다.
   * ⚠️ 「비어 있지 않은가」가 아니다. `answer` 는 빈 값이 0건이다.
   */
  hasAnswer?: boolean;
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
  if (filters.grade) params.set("grade", filters.grade);
  if (filters.chapter) params.set("chapter", filters.chapter);
  if (filters.chapterPrefix) params.set("chapterPrefix", filters.chapterPrefix);
  if (filters.q) params.set("q", filters.q);
  // 계약이 `"true"` 리터럴만 받는다 — 끌 때는 아예 안 붙인다("false" 를 보내면 안 된다).
  //
  // ⚠️ 켬/끔 토글은 **여기 한 곳에서** 이름을 세어 붙인다. 예전에는 줄마다 손으로
  // 적었는데, 그러면 토글을 늘릴 때 이 층을 빠뜨려도 타입 검사가 안 잡는다
  // (2026-08-19 에 실제로 그랬다 — 화면과 API 는 고쳤는데 여기만 안 고쳐 조용히
  // 안 붙었다). 목록을 손으로 쓰면 세는 쪽과 붙이는 쪽이 같이 눈이 먼다.
  for (const key of ["hasFigure", "hasSolution", "hasAnswer"] as const) {
    if (filters[key]) params.set(key, "true");
  }
  if (filters.difficulty) params.set("difficulty", filters.difficulty);
  if (filters.problemType) params.set("problemType", filters.problemType);
  if (filters.reviewStatus) params.set("reviewStatus", filters.reviewStatus);
  return params.toString();
}

/**
 * 서버가 보낸 사유를 **살려서** 던진다.
 *
 * 종전에는 `res.ok` 만 보고 "변형에 실패했습니다" 같은 한 줄로 갈아쳤다. 그래서 서버가
 * "DEEPSEEK_API_KEY가 설정되어 있지 않습니다" 라고 정확히 말하고 있어도 화면에는 아무
 * 단서가 없었다 — 2026-08-19 에 실제로 이것 때문에 원인을 못 찾았다. 서버는 이미
 * 내부 사정을 걷어낸 문구만 내려보내므로(라우트가 `jsonError` 로 정리한다) 그대로 쓴다.
 */
async function failWithServerReason(
  res: Response,
  fallback: string,
): Promise<never> {
  const body: unknown = await res.json().catch(() => undefined);
  const message = (body as { error?: { message?: unknown } } | undefined)?.error
    ?.message;
  throw new Error(typeof message === "string" && message ? message : fallback);
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
  if (!res.ok) await failWithServerReason(res, "등록에 실패했습니다");
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
  if (!res.ok) await failWithServerReason(res, "생성에 실패했습니다");
  return problemGenerateResponseSchema.parse(await res.json());
}

/**
 * 변형 **후보**를 받아 온다 — 아직 은행에 들어가지 않는다.
 * 채택한 것만 `adoptTransformed` 가 넣는다 (원장님 확정 2026-08-19 "미리보기 후 채택").
 */
export async function transformProblems(input: ProblemTransformRequest) {
  const { problemTransformRequestSchema, problemTransformResponseSchema } =
    await problemContract();
  const body = problemTransformRequestSchema.parse(input);
  const res = await fetch("/api/problems/transform", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await failWithServerReason(res, "변형에 실패했습니다");
  return problemTransformResponseSchema.parse(await res.json());
}

/** 미리보기에서 채택한 후보만 pending 으로 적재한다. */
export async function adoptTransformed(input: ProblemTransformAdoptRequest) {
  const {
    problemTransformAdoptRequestSchema,
    problemTransformAdoptResponseSchema,
  } = await problemContract();
  const body = problemTransformAdoptRequestSchema.parse(input);
  const res = await fetch("/api/problems/transform/adopt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await failWithServerReason(res, "채택에 실패했습니다");
  return problemTransformAdoptResponseSchema.parse(await res.json());
}
