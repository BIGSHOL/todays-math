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
import {
  deleteResponseSchema,
  errorResponseSchema,
} from "@/contracts/common.contract";
import { findEligibleProblems } from "@/lib/findEligibleProblems";
import { getSessionUser } from "@/lib/session";
import {
  MOCK_PENDING_PROBLEM,
  MOCK_PROBLEM_OTHER_USER,
  MOCK_PROBLEM_WITH_FRACTION,
  NOT_FOUND_ID,
  PROBLEM_OTHER_ID,
  USER_TEACHER_ID,
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

  it("존재하지 않는 unitId는 NOT_FOUND(404)를 반환한다", async () => {
    const res = await createProblem(
      jsonRequest("http://localhost/api/problems", "POST", {
        unitId: NOT_FOUND_ID,
        source: "manual",
        difficulty: "easy",
        problemType: "계산",
        content: "$1+1=?$",
        answer: "2",
      }),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("source=past_exam 기출 등록은 201을 반환한다", async () => {
    const res = await createProblem(
      jsonRequest("http://localhost/api/problems", "POST", {
        unitId: MOCK_PROBLEM_WITH_FRACTION.unitId,
        source: "past_exam",
        difficulty: "mid",
        problemType: "개념",
        content: "기출 본문 $1+1$",
        answer: "2",
      }),
    );
    expect(res.status).toBe(201);
    const body = problemResponseSchema.parse(await res.json());
    expect(body.data.source).toBe("past_exam");
    expect(body.data.reviewStatus).toBe("pending");
  });

  it("세션이 없으면 UNAUTHORIZED(401)를 반환한다", async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce(null);
    const res = await createProblem(
      jsonRequest("http://localhost/api/problems", "POST", {
        unitId: MOCK_PROBLEM_WITH_FRACTION.unitId,
        source: "manual",
        difficulty: "easy",
        problemType: "계산",
        content: "$1+1$",
        answer: "2",
      }),
    );
    expect(res.status).toBe(401);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("UNAUTHORIZED");
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

  it("본인 소유 문제만 반환한다(타 사용자 문제 제외)", async () => {
    const res = await listProblems(
      jsonRequest("http://localhost/api/problems", "GET"),
    );
    expect(res.status).toBe(200);
    const body = problemListResponseSchema.parse(await res.json());
    expect(body.data.every((p) => p.id !== PROBLEM_OTHER_ID)).toBe(true);
    expect(body.data.every((p) => p.userId === USER_TEACHER_ID)).toBe(true);
  });

  it("세션이 없으면 UNAUTHORIZED(401)를 반환한다", async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce(null);
    const res = await listProblems(
      jsonRequest("http://localhost/api/problems", "GET"),
    );
    expect(res.status).toBe(401);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("UNAUTHORIZED");
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

  it("타 사용자 소유 문제에 접근하면 FORBIDDEN(403)을 반환한다", async () => {
    const res = await getProblem(
      jsonRequest(`http://localhost/api/problems/${PROBLEM_OTHER_ID}`, "GET"),
      withId(PROBLEM_OTHER_ID),
    );
    expect(res.status).toBe(403);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("FORBIDDEN");
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

  it("존재하지 않는 unitId로 변경하면 NOT_FOUND(404)를 반환한다", async () => {
    const res = await patchProblem(
      jsonRequest(
        `http://localhost/api/problems/${MOCK_PROBLEM_WITH_FRACTION.id}`,
        "PATCH",
        { unitId: NOT_FOUND_ID },
      ),
      withId(MOCK_PROBLEM_WITH_FRACTION.id),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("LaTeX 본문 수정이 원본 그대로 저장된다", async () => {
    const content = "$\\sqrt{2}+\\frac{1}{2}$의 값을 구하여라.";
    const res = await patchProblem(
      jsonRequest(
        `http://localhost/api/problems/${MOCK_PROBLEM_WITH_FRACTION.id}`,
        "PATCH",
        { content },
      ),
      withId(MOCK_PROBLEM_WITH_FRACTION.id),
    );
    expect(res.status).toBe(200);
    const body = problemResponseSchema.parse(await res.json());
    expect(body.data.content).toBe(content);
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

  it("성공 시 삭제된 문제의 id를 반환한다", async () => {
    const res = await deleteProblem(
      jsonRequest(
        `http://localhost/api/problems/${MOCK_PROBLEM_WITH_FRACTION.id}`,
        "DELETE",
      ),
      withId(MOCK_PROBLEM_WITH_FRACTION.id),
    );
    expect(res.status).toBe(200);
    const body = deleteResponseSchema.parse(await res.json());
    expect(body.data.id).toBe(MOCK_PROBLEM_WITH_FRACTION.id);
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

describe("[T3.1] findEligibleProblems — 출제 가능 풀 조회", () => {
  it("unitIds가 비어 있으면 빈 배열을 반환한다", async () => {
    const rows = await findEligibleProblems({
      userId: USER_TEACHER_ID,
      unitIds: [],
    });
    expect(rows).toEqual([]);
  });

  it("approved 문제만 반환하고 pending/rejected와 타 사용자 문항은 제외한다", async () => {
    const rows = await findEligibleProblems({
      userId: USER_TEACHER_ID,
      unitIds: [MOCK_PROBLEM_WITH_FRACTION.unitId],
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((p) => p.reviewStatus === "approved")).toBe(true);
    expect(rows.every((p) => p.userId === USER_TEACHER_ID)).toBe(true);
    expect(rows.some((p) => p.id === MOCK_PROBLEM_OTHER_USER.id)).toBe(false);
  });

  it("difficulty를 주면 해당 난이도만 반환한다", async () => {
    const rows = await findEligibleProblems({
      userId: USER_TEACHER_ID,
      unitIds: [MOCK_PROBLEM_WITH_FRACTION.unitId],
      difficulty: "easy",
    });
    expect(rows.every((p) => p.difficulty === "easy")).toBe(true);
  });
});
