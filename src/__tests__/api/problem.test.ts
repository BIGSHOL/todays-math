/**
 * 🔴 RED — 대응 구현 태스크: Phase 3, T3.1 (문제 CRUD API RED→GREEN)
 *
 * `src/app/api/problems/**`가 아직 존재하지 않으므로 아래 import들은 런타임에 모듈 해석에
 * 실패해 이 파일 전체가 FAILED로 보고된다 — RED의 정상 상태다.
 * (`@ts-expect-error` 사용 이유는 src/__tests__/api/auth.test.ts 상단 주석 참조.)
 *
 * ⚠️ AI 생성(/generate)·변형(/transform) 엔드포인트는 T3.2(Claude API 래퍼) 범위이므로
 *    이 파일이 아니라 src/__tests__/unit/aiGenerator.test.ts(T3.2에서 신설)에서 다룬다.
 *
 * 대응 계약: src/contracts/problem.contract.ts
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

// ⚠️ named import를 문장별로 분리한 이유는 src/__tests__/api/class.test.ts 상단 주석 참조
//    (Prettier 줄바꿈으로 인한 @ts-expect-error 위치 어긋남 방지).
// @ts-expect-error TODO(T3.1) — src/app/api/problems/route.ts 구현 전까지 모듈이 없다.
import { GET as listProblems } from "@/app/api/problems/route";
// @ts-expect-error TODO(T3.1) — src/app/api/problems/route.ts 구현 전까지 모듈이 없다.
import { POST as createProblem } from "@/app/api/problems/route";
// @ts-expect-error TODO(T3.1) — src/app/api/problems/[id]/route.ts 구현 전까지 모듈이 없다.
import { GET as getProblem } from "@/app/api/problems/[id]/route";
// @ts-expect-error TODO(T3.1) — src/app/api/problems/[id]/route.ts 구현 전까지 모듈이 없다.
import { PATCH as patchProblem } from "@/app/api/problems/[id]/route";
// @ts-expect-error TODO(T3.1) — src/app/api/problems/[id]/route.ts 구현 전까지 모듈이 없다.
import { DELETE as deleteProblem } from "@/app/api/problems/[id]/route";
// @ts-expect-error TODO(T3.1) — src/app/api/problems/[id]/review-status/route.ts 구현 전까지 없다.
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
