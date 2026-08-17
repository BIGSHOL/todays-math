/**
 * 🟢 GREEN — 대응 구현 태스크: Phase 3, T3.1 (문제 CRUD API RED→GREEN)
 *
 * 구현: src/app/api/problems/**
 * (RED 단계의 `@ts-expect-error` 임시 주석은 구현 완료로 제거됨 — 이유는
 * src/__tests__/api/auth.test.ts 상단 주석 참조.)
 *
 * ⚠️ AI 생성(/generate)·변형(/transform) 엔드포인트는 T3.2(AI API 래퍼) 범위이므로
 *    이 파일이 아니라 src/__tests__/unit/aiGenerator.test.ts(T3.2에서 신설)에서 다룬다.
 *
 * 대응 계약: src/contracts/problem.contract.ts
 */
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
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
import { db } from "@/lib/db";
import { findEligibleProblems } from "@/lib/findEligibleProblems";
import { getSessionUser } from "@/lib/session";
import {
  MOCK_PENDING_PROBLEM,
  MOCK_PROBLEM_OTHER_SHARED,
  MOCK_PROBLEM_OTHER_USER,
  MOCK_PROBLEM_WITH_FRACTION,
  NOT_FOUND_ID,
  PROBLEM_OTHER_ID,
  USER_TEACHER_ID,
  MOCK_PROBLEM_MISSING_ANSWER,
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
    expect(body.data.pool).toBe("shared");
  });

  it("등록 시 pool을 생략하면 공용 풀이다(D-31)", async () => {
    const res = await createProblem(
      jsonRequest("http://localhost/api/problems", "POST", {
        unitId: MOCK_PROBLEM_WITH_FRACTION.unitId,
        source: "manual",
        difficulty: "easy",
        problemType: "계산",
        content: "공용 기본 등록",
        answer: "1",
      }),
    );
    expect(res.status).toBe(201);
    const body = problemResponseSchema.parse(await res.json());
    expect(body.data.pool).toBe("shared");
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

  it("공용 풀과 본인 문항을 반환하고 타 사용자 private는 제외한다(D-31)", async () => {
    const res = await listProblems(
      jsonRequest("http://localhost/api/problems?pageSize=100", "GET"),
    );
    expect(res.status).toBe(200);
    const body = problemListResponseSchema.parse(await res.json());
    expect(body.data.some((p) => p.id === MOCK_PROBLEM_OTHER_SHARED.id)).toBe(
      true,
    );
    expect(body.data.every((p) => p.id !== PROBLEM_OTHER_ID)).toBe(true);
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

  // 이관 배치는 같은 초 안에 수천 건이 생겨 createdAt만으로는 순서가 유일하지 않다.
  // 보조 정렬 키가 없으면 페이지 사이에 같은 문항이 겹치거나 빠진다(실서버 실측: 1↔2페이지 4건 중복).
  it("createdAt이 같은 행이 많아도 페이지가 겹치지 않도록 id 보조 정렬 키를 쓴다", async () => {
    const spy = vi.spyOn(db.problem, "findMany");
    const res = await listProblems(
      jsonRequest("http://localhost/api/problems?page=1&pageSize=20", "GET"),
    );
    expect(res.status).toBe(200);
    expect(spy.mock.calls.at(-1)![0]?.orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
    spy.mockRestore();
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

  it("타 사용자 private 문제에 접근하면 FORBIDDEN(403)을 반환한다", async () => {
    const res = await getProblem(
      jsonRequest(`http://localhost/api/problems/${PROBLEM_OTHER_ID}`, "GET"),
      withId(PROBLEM_OTHER_ID),
    );
    expect(res.status).toBe(403);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("타 사용자 공용 문항은 조회한다(D-31)", async () => {
    const res = await getProblem(
      jsonRequest(
        `http://localhost/api/problems/${MOCK_PROBLEM_OTHER_SHARED.id}`,
        "GET",
      ),
      withId(MOCK_PROBLEM_OTHER_SHARED.id),
    );
    expect(res.status).toBe(200);
    const body = problemResponseSchema.parse(await res.json());
    expect(body.data.pool).toBe("shared");
    expect(body.data.id).toBe(MOCK_PROBLEM_OTHER_SHARED.id);
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

  it("타 사용자 공용 문항은 수정할 수 있다(D-31)", async () => {
    const res = await patchProblem(
      jsonRequest(
        `http://localhost/api/problems/${MOCK_PROBLEM_OTHER_SHARED.id}`,
        "PATCH",
        { content: "공용 문항 수정" },
      ),
      withId(MOCK_PROBLEM_OTHER_SHARED.id),
    );
    expect(res.status).toBe(200);
    const body = problemResponseSchema.parse(await res.json());
    expect(body.data.content).toBe("공용 문항 수정");
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

  it("시험지에 포함된 문제는 이력 보존을 위해 삭제를 거부한다", async () => {
    const res = await deleteProblem(
      jsonRequest(
        `http://localhost/api/problems/${MOCK_PROBLEM_WITH_FRACTION.id}`,
        "DELETE",
      ),
      withId(MOCK_PROBLEM_WITH_FRACTION.id),
    );
    expect(res.status).toBe(409);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("CONFLICT");

    const getRes = await getProblem(
      jsonRequest(
        `http://localhost/api/problems/${MOCK_PROBLEM_WITH_FRACTION.id}`,
        "GET",
      ),
      withId(MOCK_PROBLEM_WITH_FRACTION.id),
    );
    expect(getRes.status).toBe(200);
  });

  it("어떤 시험지에도 쓰이지 않은 문제는 삭제하고 id를 반환한다", async () => {
    const created = await createProblem(
      jsonRequest("http://localhost/api/problems", "POST", {
        unitId: MOCK_PROBLEM_WITH_FRACTION.unitId,
        source: "manual",
        difficulty: "easy",
        problemType: "계산",
        content: "아직 출제되지 않은 문제",
        answer: "1",
      }),
    );
    const createdBody = problemResponseSchema.parse(await created.json());

    const res = await deleteProblem(
      jsonRequest(
        `http://localhost/api/problems/${createdBody.data.id}`,
        "DELETE",
      ),
      withId(createdBody.data.id),
    );
    expect(res.status).toBe(200);
    const body = deleteResponseSchema.parse(await res.json());
    expect(body.data.id).toBe(createdBody.data.id);
  });

  it("사용 여부 확인 직후 시험지에 편입되는 경쟁 요청도 CONFLICT로 처리한다", async () => {
    const countSpy = vi.spyOn(db.testProblem, "count").mockResolvedValueOnce(0);
    const deleteSpy = vi.spyOn(db.problem, "delete").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError(
        "foreign key constraint failed",
        {
          code: "P2003",
          clientVersion: "6.19.3",
        },
      ),
    );

    try {
      const res = await deleteProblem(
        jsonRequest(
          `http://localhost/api/problems/${MOCK_PROBLEM_WITH_FRACTION.id}`,
          "DELETE",
        ),
        withId(MOCK_PROBLEM_WITH_FRACTION.id),
      );
      expect(res.status).toBe(409);
      const body = errorResponseSchema.parse(await res.json());
      expect(body.error.code).toBe("CONFLICT");
    } finally {
      countSpy.mockRestore();
      deleteSpy.mockRestore();
    }
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

  it("approved 문제만 반환하고 타 사용자 private는 제외하며 공용 풀은 포함한다", async () => {
    const rows = await findEligibleProblems({
      userId: USER_TEACHER_ID,
      unitIds: [MOCK_PROBLEM_WITH_FRACTION.unitId],
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((p) => p.reviewStatus === "approved")).toBe(true);
    expect(rows.some((p) => p.id === MOCK_PROBLEM_OTHER_USER.id)).toBe(false);
    expect(rows.some((p) => p.id === MOCK_PROBLEM_OTHER_SHARED.id)).toBe(true);
  });

  it("정답이 없는 문항((정답 없음) 센티널)은 출제 풀에서 제외한다", async () => {
    // OCR 이관분 5,781건(62.9%)이 이 상태였고, 출제되면 정답지가 비어 채점 불가.
    const rows = await findEligibleProblems({
      userId: USER_TEACHER_ID,
      unitIds: [MOCK_PROBLEM_MISSING_ANSWER.unitId],
    });
    expect(rows.some((p) => p.id === MOCK_PROBLEM_MISSING_ANSWER.id)).toBe(
      false,
    );
    expect(rows.every((p) => p.answer !== "(정답 없음)")).toBe(true);
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
