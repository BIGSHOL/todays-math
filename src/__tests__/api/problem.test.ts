/**
 * 🟢 GREEN — 대응 구현 태스크: Phase 3, T3.1 (문제 CRUD API RED→GREEN)
 *
 * 구현: src/app/api/problems/**
 * (RED 단계의 `@ts-expect-error` 임시 주석은 구현 완료로 제거됨 — 이유는
 * src/__tests__/api/auth.test.ts 상단 주석 참조.)
 *
 * ⚠️ AI 생성(/generate)·변형(/transform) 엔드포인트는 T3.2(Claude API 래퍼) 범위이므로
 *    이 파일이 아니라 src/__tests__/unit/aiGenerator.test.ts(T3.2에서 신설)에서 다룬다.
 *
 * 대응 계약: src/contracts/problem.contract.ts
 */
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// T1.1(실제 Auth.js 세션) 병합 이후: 이 테스트는 인증 자체가 아니라 CRUD·소유권 검증이
// 목적이므로 세션을 고정 강사(USER_TEACHER_ID)로 모킹한다(src/__tests__/api/class.test.ts와
// 동일 패턴 — Mock 문제 픽스처가 모두 USER_TEACHER_ID 소유이므로 이 값과 맞춰야 한다).
vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => ({
    id: "10000000-0000-4000-8000-000000000001",
    email: "teacher@todaysmath.test",
    name: "테스트 강사",
  })),
}));

import { GET as listProblems } from "@/app/api/problems/route";
import { POST as createProblem } from "@/app/api/problems/route";
import { GET as getProblem } from "@/app/api/problems/[id]/route";
import { PATCH as patchProblem } from "@/app/api/problems/[id]/route";
import { DELETE as deleteProblem } from "@/app/api/problems/[id]/route";
import { PATCH as patchReviewStatus } from "@/app/api/problems/[id]/review-status/route";

import {
  problemListResponseSchema,
  problemResponseSchema,
} from "@/contracts/problem.contract";
import { errorResponseSchema } from "@/contracts/common.contract";
import {
  MOCK_PENDING_PROBLEM,
  MOCK_PROBLEM_WITH_FRACTION,
  NOT_FOUND_ID,
} from "@/mocks/data";

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function withId(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("[T3.1] POST /api/problems — LaTeX 본문 무손실 저장", () => {
  it("분수 LaTeX 수식을 포함한 문제를 등록하면 content가 원본 그대로 저장된다", async () => {
    const content = "$\\frac{7}{25}$를 유한소수로 나타내어라.";
    const res = await createProblem(
      jsonRequest("http://localhost/api/problems", "POST", {
        unitId: MOCK_PROBLEM_WITH_FRACTION.unitId,
        source: "manual",
        difficulty: "easy",
        problemType: "계산",
        content,
        answer: "0.28",
      }),
    );
    expect(res.status).toBe(201);
    const body = problemResponseSchema.parse(await res.json());
    expect(body.data.content).toBe(content);
  });

  it("등록 요청 출처(source)로 ai_generated/transformed는 거부한다(계약 강제)", async () => {
    const res = await createProblem(
      jsonRequest("http://localhost/api/problems", "POST", {
        unitId: MOCK_PROBLEM_WITH_FRACTION.unitId,
        source: "ai_generated",
        difficulty: "easy",
        problemType: "계산",
        content: "$1+1=?$",
        answer: "2",
      }),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("빈 본문(필수 필드 누락)은 VALIDATION_ERROR(400)를 반환한다", async () => {
    const res = await createProblem(
      jsonRequest("http://localhost/api/problems", "POST", {}),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("[T3.1] GET /api/problems — 단원/난이도/유형/출처/검수상태 필터 조회", () => {
  it("unitId/difficulty/problemType 조합으로 필터링한다", async () => {
    const res = await listProblems(
      jsonRequest(
        `http://localhost/api/problems?unitId=${MOCK_PROBLEM_WITH_FRACTION.unitId}&difficulty=easy&problemType=계산`,
        "GET",
      ),
    );
    expect(res.status).toBe(200);
    const body = problemListResponseSchema.parse(await res.json());
    expect(
      body.data.every(
        (p) =>
          p.unitId === MOCK_PROBLEM_WITH_FRACTION.unitId &&
          p.difficulty === "easy",
      ),
    ).toBe(true);
  });
});

describe("[T3.1] GET /api/problems/{id} — LaTeX 본문 무손실 조회", () => {
  it("등록된 문제의 LaTeX 본문이 그대로 반환된다", async () => {
    const res = await getProblem(
      jsonRequest(
        `http://localhost/api/problems/${MOCK_PROBLEM_WITH_FRACTION.id}`,
        "GET",
      ),
      withId(MOCK_PROBLEM_WITH_FRACTION.id),
    );
    expect(res.status).toBe(200);
    const body = problemResponseSchema.parse(await res.json());
    expect(body.data.content).toBe(MOCK_PROBLEM_WITH_FRACTION.content);
  });

  it("존재하지 않는 id는 NOT_FOUND(404)를 반환한다", async () => {
    const res = await getProblem(
      jsonRequest(`http://localhost/api/problems/${NOT_FOUND_ID}`, "GET"),
      withId(NOT_FOUND_ID),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("[T3.1] PATCH /api/problems/{id}", () => {
  it("빈 본문은 VALIDATION_ERROR(400)를 반환한다", async () => {
    const res = await patchProblem(
      jsonRequest(
        `http://localhost/api/problems/${MOCK_PROBLEM_WITH_FRACTION.id}`,
        "PATCH",
        {},
      ),
      withId(MOCK_PROBLEM_WITH_FRACTION.id),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("[T3.1] DELETE /api/problems/{id}", () => {
  it("존재하지 않는 id는 NOT_FOUND(404)를 반환한다", async () => {
    const res = await deleteProblem(
      jsonRequest(`http://localhost/api/problems/${NOT_FOUND_ID}`, "DELETE"),
      withId(NOT_FOUND_ID),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("[T3.1] PATCH /api/problems/{id}/review-status — 검수 승격(D-22)", () => {
  it("pending 상태 문제를 approved로 승격한다", async () => {
    const res = await patchReviewStatus(
      jsonRequest(
        `http://localhost/api/problems/${MOCK_PENDING_PROBLEM.id}/review-status`,
        "PATCH",
        { reviewStatus: "approved" },
      ),
      withId(MOCK_PENDING_PROBLEM.id),
    );
    expect(res.status).toBe(200);
    const body = problemResponseSchema.parse(await res.json());
    expect(body.data.reviewStatus).toBe("approved");
  });

  it("정의되지 않은 상태값은 VALIDATION_ERROR(400)를 반환한다", async () => {
    const res = await patchReviewStatus(
      jsonRequest(
        `http://localhost/api/problems/${MOCK_PENDING_PROBLEM.id}/review-status`,
        "PATCH",
        { reviewStatus: "done" },
      ),
      withId(MOCK_PENDING_PROBLEM.id),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
