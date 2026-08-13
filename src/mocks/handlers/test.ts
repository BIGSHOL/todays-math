/**
 * MSW 핸들러 — 출제/검수/교체/확정/인쇄 (T0.5.2).
 * 대응 계약: src/contracts/test.contract.ts
 * 대응 API 경로:
 *   POST /api/tests/generate, GET /api/tests, GET /api/tests/{id}
 *   PUT /api/tests/{id}/problems/{seq}, POST /api/tests/{id}/confirm, POST /api/tests/{id}/print
 *
 * ⚠️ stateless — class.ts/problem.ts와 동일하게 고정 배열을 변형하지 않는다.
 */
import { http, type HttpHandler } from "msw";

import {
  insufficientProblemsErrorResponseSchema,
  testConfirmResponseSchema,
  testDetailResponseSchema,
  testGenerateRequestSchema,
  testGenerateResponseSchema,
  testListQuerySchema,
  testListResponseSchema,
  testPrintResponseSchema,
  testProblemReplaceResponseSchema,
} from "@/contracts/test.contract";

import {
  CLASS_STARVED_ID,
  MOCK_EMPTY_PROBLEM_UNIT,
  MOCK_PROBLEMS,
  MOCK_TEST_DRAFT,
  MOCK_TEST_DRAFT_PROBLEMS,
  MOCK_TEST_PROBLEMS_BY_TEST_ID,
  MOCK_TESTS,
  USER_TEACHER_ID,
} from "../data";
import { jsonOk, notFoundError, paginate, validationError } from "./_helpers";

function findTest(id: string) {
  return MOCK_TESTS.find((t) => t.id === id);
}

export const testHandlers: HttpHandler[] = [
  // POST /api/tests/generate — 자동 출제 실행(draft TEST + TEST_PROBLEM 생성)
  http.post("/api/tests/generate", async ({ request }) => {
    const parsed = testGenerateRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      // 계약 자체의 refine(확인테스트 범위 누락 등) 위반도 VALIDATION_ERROR로 통일한다.
      return validationError(parsed.error);
    }

    // 대표 실패 경로 — 문제 부족(INSUFFICIENT_PROBLEMS). CLASS_STARVED_ID는 현재 진도 단원에
    // 등록된 문제가 0건인 전용 픽스처(src/mocks/data/classes.ts, progress.ts 참조).
    if (parsed.data.classId === CLASS_STARVED_ID) {
      const required = parsed.data.problemCount ?? 8;
      return jsonOk(
        insufficientProblemsErrorResponseSchema,
        {
          error: {
            code: "INSUFFICIENT_PROBLEMS",
            message: "이 단원에 등록된 문제가 부족합니다.",
            details: {
              unitId: MOCK_EMPTY_PROBLEM_UNIT.id,
              available: 0,
              required,
            },
          },
        },
        { status: 422 },
      );
    }

    // 그 외 — MOCK_TEST_DRAFT를 요청 내용으로 새로 만든 것처럼 반환(shortfall 없음).
    return jsonOk(
      testGenerateResponseSchema,
      {
        data: {
          test: {
            ...MOCK_TEST_DRAFT,
            id: crypto.randomUUID(),
            userId: USER_TEACHER_ID,
            classId: parsed.data.classId,
            studentId: parsed.data.studentId ?? null,
            testType: parsed.data.testType,
            rangeStartUnitId: parsed.data.rangeStartUnitId ?? null,
            rangeEndUnitId:
              parsed.data.rangeEndUnitId ?? MOCK_TEST_DRAFT.rangeEndUnitId,
            testDate: parsed.data.testDate,
            createdAt: new Date().toISOString(),
          },
          problems: MOCK_TEST_DRAFT_PROBLEMS,
          shortfall: [],
        },
      },
      { status: 201 },
    );
  }),

  // GET /api/tests?classId=&studentId=&status= — 목록 조회
  http.get("/api/tests", ({ request }) => {
    const url = new URL(request.url);
    const parsed = testListQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    if (!parsed.success) return validationError(parsed.error);

    const filtered = MOCK_TESTS.filter(
      (t) =>
        (!parsed.data.classId || t.classId === parsed.data.classId) &&
        (!parsed.data.studentId || t.studentId === parsed.data.studentId) &&
        (!parsed.data.status || t.status === parsed.data.status),
    );
    return jsonOk(
      testListResponseSchema,
      paginate(filtered, {
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
      }),
    );
  }),

  // GET /api/tests/:id — 단건 조회(문항 목록 포함 — 검수 화면 S-05)
  http.get("/api/tests/:id", ({ params }) => {
    const test = findTest(String(params.id));
    if (!test) return notFoundError("테스트");
    return jsonOk(testDetailResponseSchema, {
      data: { test, problems: MOCK_TEST_PROBLEMS_BY_TEST_ID[test.id] ?? [] },
    });
  }),

  // PUT /api/tests/:id/problems/:seq — 문제 교체(1클릭, 중복 제외 유지)
  http.put("/api/tests/:id/problems/:seq", ({ params }) => {
    const test = findTest(String(params.id));
    if (!test) return notFoundError("테스트");

    const seq = Number(params.seq);
    const items = MOCK_TEST_PROBLEMS_BY_TEST_ID[test.id] ?? [];
    const target = items.find((i) => i.orderIndex === seq);
    if (!target) return notFoundError("문항");

    // 같은 단원/난이도의 다른 문제 중 하나로 교체된 것처럼 응답(결정론적 재현 — 목록의 다음 문제).
    const pool = MOCK_PROBLEMS.filter(
      (p) => p.unitId === target.problem.unitId && p.id !== target.problem.id,
    );
    const replacement = pool[0] ?? target.problem;

    return jsonOk(testProblemReplaceResponseSchema, {
      data: {
        test: { ...test, modified: true },
        problem: { ...target, replaced: true, problem: replacement },
      },
    });
  }),

  // POST /api/tests/:id/confirm — 확정(draft → confirmed)
  http.post("/api/tests/:id/confirm", ({ params }) => {
    const test = findTest(String(params.id));
    if (!test) return notFoundError("테스트");
    return jsonOk(testConfirmResponseSchema, {
      data: { ...test, status: "confirmed" },
    });
  }),

  // POST /api/tests/:id/print — 인쇄 기록(confirmed → printed, printedAt 기록)
  http.post("/api/tests/:id/print", ({ params }) => {
    const test = findTest(String(params.id));
    if (!test) return notFoundError("테스트");
    return jsonOk(testPrintResponseSchema, {
      data: { ...test, status: "printed", printedAt: new Date().toISOString() },
    });
  }),
];
