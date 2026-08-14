/**
 * 🟢 GREEN — Phase 3, T3.2 (Claude API 래퍼 라우트).
 *
 * 단위 테스트(src/__tests__/unit/aiGenerator.test.ts)가 생성/변형 순수 래퍼를 검증하고,
 * 이 파일은 HTTP 계층(세션·계약·영속·에러 매핑)만 검증한다.
 * Claude SDK는 호출하지 않는다 — generateProblems/transformProblem을 모킹한다.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => ({
    id: "10000000-0000-4000-8000-000000000001",
    email: "teacher@todaysmath.test",
    name: "테스트 강사",
  })),
}));

const { mockGenerateProblems, mockTransformProblem } = vi.hoisted(() => ({
  mockGenerateProblems: vi.fn(),
  mockTransformProblem: vi.fn(),
}));

vi.mock("@/lib/ai/generator", () => ({
  generateProblems: mockGenerateProblems,
}));

vi.mock("@/lib/ai/transformer", () => ({
  transformProblem: mockTransformProblem,
}));

import { POST as generateProblemsRoute } from "@/app/api/problems/generate/route";
import { POST as transformProblemsRoute } from "@/app/api/problems/transform/route";
import { AiGenerationError } from "@/lib/ai/errors";
import { errorResponseSchema } from "@/contracts/common.contract";
import {
  problemGenerateResponseSchema,
  problemTransformResponseSchema,
} from "@/contracts/problem.contract";
import {
  MOCK_EMPTY_PROBLEM_UNIT,
  MOCK_PROBLEM_OTHER_USER,
  MOCK_PROBLEMS,
  NOT_FOUND_ID,
} from "@/mocks/data";

function jsonRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  mockGenerateProblems.mockReset();
  mockTransformProblem.mockReset();
});

describe("[T3.2] POST /api/problems/generate", () => {
  it("유효한 요청이면 201과 pending/ai_generated 문제를 반환한다", async () => {
    mockGenerateProblems.mockResolvedValueOnce([
      {
        unitId: MOCK_EMPTY_PROBLEM_UNIT.id,
        difficulty: "easy",
        problemType: "계산",
        content: "생성된 문제",
        answer: "1",
        solution: null,
        source: "ai_generated",
        originProblemId: null,
        reviewStatus: "pending",
      },
    ]);

    const res = await generateProblemsRoute(
      jsonRequest("http://localhost/api/problems/generate", {
        unitId: MOCK_EMPTY_PROBLEM_UNIT.id,
        difficulty: "easy",
        count: 1,
      }),
    );
    expect(res.status).toBe(201);
    const body = problemGenerateResponseSchema.parse(await res.json());
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.source).toBe("ai_generated");
    expect(body.data[0]?.reviewStatus).toBe("pending");
    expect(body.data[0]?.originProblemId).toBeNull();
  });

  it("unitId가 없으면 VALIDATION_ERROR(400)를 반환한다", async () => {
    const res = await generateProblemsRoute(
      jsonRequest("http://localhost/api/problems/generate", {
        difficulty: "easy",
      }),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("존재하지 않는 unitId는 NOT_FOUND(404)를 반환한다", async () => {
    const res = await generateProblemsRoute(
      jsonRequest("http://localhost/api/problems/generate", {
        unitId: NOT_FOUND_ID,
        difficulty: "easy",
      }),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("생성 실패는 AI_GENERATION_FAILED(502)로 매핑한다", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockGenerateProblems.mockRejectedValueOnce(
      new AiGenerationError("ANTHROPIC_API_KEY=top-secret"),
    );

    const res = await generateProblemsRoute(
      jsonRequest("http://localhost/api/problems/generate", {
        unitId: MOCK_EMPTY_PROBLEM_UNIT.id,
        difficulty: "easy",
        count: 1,
      }),
    );
    expect(res.status).toBe(502);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("AI_GENERATION_FAILED");
    expect(body.error.message).toBe("AI 문제 생성에 실패했습니다.");
    expect(JSON.stringify(body)).not.toContain("top-secret");
    log.mockRestore();
  });
});

describe("[T3.2] POST /api/problems/transform", () => {
  it("원본이 있으면 201과 transformed/pending 문제를 반환한다", async () => {
    const origin = MOCK_PROBLEMS[0]!;
    mockTransformProblem.mockResolvedValueOnce([
      {
        unitId: origin.unitId,
        difficulty: origin.difficulty,
        problemType: origin.problemType,
        content: "변형된 문제",
        answer: "2",
        solution: null,
        source: "transformed",
        originProblemId: origin.id,
        reviewStatus: "pending",
      },
    ]);

    const res = await transformProblemsRoute(
      jsonRequest("http://localhost/api/problems/transform", {
        originProblemId: origin.id,
        count: 1,
      }),
    );
    expect(res.status).toBe(201);
    const body = problemTransformResponseSchema.parse(await res.json());
    expect(body.data[0]?.source).toBe("transformed");
    expect(body.data[0]?.originProblemId).toBe(origin.id);
    expect(body.data[0]?.reviewStatus).toBe("pending");
  });

  it("없는 originProblemId는 NOT_FOUND(404)를 반환한다", async () => {
    const res = await transformProblemsRoute(
      jsonRequest("http://localhost/api/problems/transform", {
        originProblemId: NOT_FOUND_ID,
      }),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("타 사용자 원본은 FORBIDDEN(403)을 반환한다", async () => {
    const res = await transformProblemsRoute(
      jsonRequest("http://localhost/api/problems/transform", {
        originProblemId: MOCK_PROBLEM_OTHER_USER.id,
      }),
    );
    expect(res.status).toBe(403);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("변형 실패 응답에 내부 오류 메시지를 노출하지 않는다", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockTransformProblem.mockRejectedValueOnce(
      new AiGenerationError("upstream request id secret-123"),
    );

    const res = await transformProblemsRoute(
      jsonRequest("http://localhost/api/problems/transform", {
        originProblemId: MOCK_PROBLEMS[0]!.id,
        count: 1,
      }),
    );
    expect(res.status).toBe(502);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.message).toBe("AI 문제 변형에 실패했습니다.");
    expect(JSON.stringify(body)).not.toContain("secret-123");
    log.mockRestore();
  });
});
