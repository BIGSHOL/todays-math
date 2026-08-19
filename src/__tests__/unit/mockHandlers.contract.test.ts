// T0.5.2 — MSW Mock 핸들러 ↔ Zod 계약 응답 스키마 표류 방지 검증.
// 각 핸들러(src/mocks/handlers/*.ts)는 이미 내부에서 `.parse()`하지만(_helpers.ts jsonOk/jsonError),
// 이 테스트는 실제 fetch 왕복(HTTP status + JSON body)까지 계약을 통과하는지 별도로 재확인한다
// (06-tasks.md T0.5.2 완료 조건 "모든 핸들러 응답이 Zod 계약 파싱 통과").
// ⚠️ 아래 각 케이스는 `schema.parse(body)`를 그대로 호출한다 — 계약과 표류하면 ZodError가 던져져
//    테스트가 바로 실패하므로 별도의 `expect(...).not.toThrow()` 래핑이 필요 없다.
import { describe, expect, it } from "vitest";

import { authSignupResponseSchema } from "@/contracts/auth.contract";
import {
  classListResponseSchema,
  classResponseSchema,
  progressResponseSchema,
  studentListResponseSchema,
  studentResponseSchema,
} from "@/contracts/class.contract";
import {
  deleteResponseSchema,
  errorResponseSchema,
} from "@/contracts/common.contract";
import {
  problemGenerateResponseSchema,
  problemListResponseSchema,
  problemResponseSchema,
  problemTransformAdoptResponseSchema,
  problemTransformResponseSchema,
} from "@/contracts/problem.contract";
import {
  insufficientProblemsErrorResponseSchema,
  testConfirmResponseSchema,
  testDetailResponseSchema,
  testGenerateResponseSchema,
  testListResponseSchema,
  testPrintResponseSchema,
  testProblemReplaceResponseSchema,
} from "@/contracts/test.contract";
import { unitListResponseSchema } from "@/contracts/unit.contract";

import {
  AI_GENERATION_FAILURE_UNIT_ID,
  AI_TRANSFORM_FAILURE_ORIGIN_ID,
} from "@/mocks/handlers/problem";
import {
  CLASS_A_ID,
  CLASS_OTHER_ID,
  CLASS_STARVED_ID,
  MOCK_EXISTING_SIGNUP_EMAIL,
  MOCK_PROBLEMS,
  MOCK_STUDENT_1,
  NOT_FOUND_ID,
  PROBLEM_OTHER_ID,
  TEST_DRAFT_ID,
  TEST_NOT_FOUND_ID,
} from "@/mocks/data";

async function postJson(url: string, body: unknown) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function errorBody(res: Response) {
  return errorResponseSchema.parse(await res.json());
}

describe("[T0.5.2] MSW ↔ 계약 — auth", () => {
  it("POST /api/auth/signup 성공 응답은 authSignupResponseSchema를 통과한다", async () => {
    const res = await postJson("/api/auth/signup", {
      email: "new-teacher@example.com",
      password: "password123",
      name: "신규강사",
    });
    expect(res.status).toBe(201);
    authSignupResponseSchema.parse(await res.json());
  });

  it("POST /api/auth/signup 중복 이메일은 CONFLICT 에러 응답을 반환한다", async () => {
    const res = await postJson("/api/auth/signup", {
      email: MOCK_EXISTING_SIGNUP_EMAIL,
      password: "password123",
      name: "신규강사",
    });
    expect(res.status).toBe(409);
    const body = await errorBody(res);
    expect(body.error.code).toBe("CONFLICT");
  });

  it("POST /api/auth/signup 잘못된 입력은 VALIDATION_ERROR를 반환한다", async () => {
    const res = await postJson("/api/auth/signup", {
      email: "not-an-email",
      password: "short",
      name: "",
    });
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("[T0.5.2] MSW ↔ 계약 — class/student/progress", () => {
  it("POST /api/classes 성공 응답은 classResponseSchema를 통과한다", async () => {
    const res = await postJson("/api/classes", {
      name: "테스트반",
      grade: "중1",
    });
    expect(res.status).toBe(201);
    classResponseSchema.parse(await res.json());
  });

  it("GET /api/classes 목록 응답은 classListResponseSchema를 통과한다", async () => {
    const res = await fetch("/api/classes");
    expect(res.status).toBe(200);
    classListResponseSchema.parse(await res.json());
  });

  it("GET /api/classes/{id} 존재하지 않는 id는 NOT_FOUND를 반환한다", async () => {
    const res = await fetch(`/api/classes/${NOT_FOUND_ID}`);
    expect(res.status).toBe(404);
    const body = await errorBody(res);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("GET /api/classes/{id} 타 사용자 소유 반은 FORBIDDEN(403)을 반환한다", async () => {
    const res = await fetch(`/api/classes/${CLASS_OTHER_ID}`);
    expect(res.status).toBe(403);
    const body = await errorBody(res);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("PATCH /api/classes/{id} 빈 본문은 VALIDATION_ERROR를 반환한다", async () => {
    const res = await fetch(`/api/classes/${CLASS_A_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("DELETE /api/classes/{id} 성공 응답은 deleteResponseSchema를 통과한다", async () => {
    const res = await fetch(`/api/classes/${CLASS_A_ID}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    deleteResponseSchema.parse(await res.json());
  });

  it("POST /api/students 성공 응답은 studentResponseSchema를 통과한다", async () => {
    const res = await postJson("/api/students", {
      classId: CLASS_A_ID,
      name: "홍길동",
    });
    expect(res.status).toBe(201);
    studentResponseSchema.parse(await res.json());
  });

  it("GET /api/students?classId= 목록 응답은 studentListResponseSchema를 통과한다", async () => {
    const res = await fetch(`/api/students?classId=${CLASS_A_ID}`);
    expect(res.status).toBe(200);
    studentListResponseSchema.parse(await res.json());
  });

  it("GET /api/students classId 누락 시 VALIDATION_ERROR를 반환한다", async () => {
    const res = await fetch("/api/students");
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("PATCH /api/students/{id} 존재하지 않는 id는 NOT_FOUND를 반환한다", async () => {
    const res = await fetch(`/api/students/${NOT_FOUND_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "새이름" }),
    });
    expect(res.status).toBe(404);
    const body = await errorBody(res);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("PATCH /api/students/{id} 성공 응답은 studentResponseSchema를 통과한다", async () => {
    const res = await fetch(`/api/students/${MOCK_STUDENT_1.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ useIndividualProgress: true }),
    });
    expect(res.status).toBe(200);
    studentResponseSchema.parse(await res.json());
  });

  it("POST /api/progress 성공 응답은 progressResponseSchema를 통과한다", async () => {
    const res = await postJson("/api/progress", {
      classId: CLASS_A_ID,
      unitId: MOCK_PROBLEMS[0]!.unitId,
    });
    expect(res.status).toBe(201);
    progressResponseSchema.parse(await res.json());
  });

  it("GET /api/progress 성공 응답은 progressResponseSchema를 통과한다", async () => {
    const res = await fetch(`/api/progress?classId=${CLASS_A_ID}`);
    expect(res.status).toBe(200);
    progressResponseSchema.parse(await res.json());
  });

  it("POST /api/progress/advance 성공 응답은 progressResponseSchema를 통과한다", async () => {
    const res = await postJson("/api/progress/advance", {
      classId: CLASS_A_ID,
    });
    expect(res.status).toBe(201);
    progressResponseSchema.parse(await res.json());
  });
});

describe("[T0.5.2] MSW ↔ 계약 — problem/AI 생성·변형", () => {
  it("POST /api/problems 성공 응답은 problemResponseSchema를 통과한다", async () => {
    const res = await postJson("/api/problems", {
      unitId: MOCK_PROBLEMS[0]!.unitId,
      source: "manual",
      difficulty: "mid",
      problemType: "계산",
      content: "$1+1=?$",
      answer: "2",
    });
    expect(res.status).toBe(201);
    problemResponseSchema.parse(await res.json());
  });

  it("GET /api/problems 목록 응답은 problemListResponseSchema를 통과한다", async () => {
    const res = await fetch("/api/problems");
    expect(res.status).toBe(200);
    problemListResponseSchema.parse(await res.json());
  });

  it("GET /api/problems/{id} 존재하지 않는 id는 NOT_FOUND를 반환한다", async () => {
    const res = await fetch(`/api/problems/${NOT_FOUND_ID}`);
    expect(res.status).toBe(404);
    const body = await errorBody(res);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("GET /api/problems/{id} 타 사용자 소유 문제는 FORBIDDEN(403)을 반환한다", async () => {
    const res = await fetch(`/api/problems/${PROBLEM_OTHER_ID}`);
    expect(res.status).toBe(403);
    const body = await errorBody(res);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("PATCH /api/problems/{id}/review-status 성공 응답은 problemResponseSchema를 통과한다", async () => {
    const res = await fetch(
      `/api/problems/${MOCK_PROBLEMS[0]!.id}/review-status`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewStatus: "approved" }),
      },
    );
    expect(res.status).toBe(200);
    problemResponseSchema.parse(await res.json());
  });

  it("POST /api/problems/generate 성공 응답은 problemGenerateResponseSchema를 통과한다", async () => {
    const res = await postJson("/api/problems/generate", {
      unitId: MOCK_PROBLEMS[0]!.unitId,
      difficulty: "mid",
      count: 3,
    });
    expect(res.status).toBe(201);
    problemGenerateResponseSchema.parse(await res.json());
  });

  it("POST /api/problems/generate AI 생성 실패는 AI_GENERATION_FAILED를 반환한다", async () => {
    const res = await postJson("/api/problems/generate", {
      unitId: AI_GENERATION_FAILURE_UNIT_ID,
      difficulty: "mid",
      count: 1,
    });
    expect(res.status).toBe(502);
    const body = await errorBody(res);
    expect(body.error.code).toBe("AI_GENERATION_FAILED");
  });

  it("POST /api/problems/transform 성공 응답은 problemTransformResponseSchema를 통과한다", async () => {
    const res = await postJson("/api/problems/transform", {
      originProblemId: MOCK_PROBLEMS[0]!.id,
      count: 2,
    });
    // 201 이 아니라 200 이다 — 이 엔드포인트는 후보만 만들고 **아무것도 저장하지 않는다**
    // (원장님 확정 2026-08-19 "미리보기 후 채택"). 저장은 /transform/adopt 가 201 로 한다.
    expect(res.status).toBe(200);
    const body = problemTransformResponseSchema.parse(await res.json());
    // mock 은 마지막 하나를 일부러 검사 탈락으로 둔다 — 화면의 「폐기」 경로를 밟게 한다.
    expect(body.data.some((candidate) => !candidate.verified)).toBe(true);
  });

  it("POST /api/problems/transform/adopt 성공 응답은 채택 계약을 통과하고 201 이다", async () => {
    const res = await postJson("/api/problems/transform/adopt", {
      originProblemId: MOCK_PROBLEMS[0]!.id,
      items: [{ content: "채택된 변형", answer: "0.275", solution: null }],
    });
    expect(res.status).toBe(201);
    const body = problemTransformAdoptResponseSchema.parse(await res.json());
    expect(body.data[0]!.source).toBe("transformed");
    expect(body.data[0]!.originProblemId).toBe(MOCK_PROBLEMS[0]!.id);
    expect(body.data[0]!.reviewStatus).toBe("pending");
  });

  it("POST /api/problems/transform 존재하지 않는 원본은 NOT_FOUND를 반환한다", async () => {
    const res = await postJson("/api/problems/transform", {
      originProblemId: NOT_FOUND_ID,
      count: 1,
    });
    expect(res.status).toBe(404);
    const body = await errorBody(res);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("POST /api/problems/transform AI 실패는 AI_GENERATION_FAILED를 반환한다", async () => {
    const res = await postJson("/api/problems/transform", {
      originProblemId: AI_TRANSFORM_FAILURE_ORIGIN_ID,
      count: 1,
    });
    expect(res.status).toBe(502);
    const body = await errorBody(res);
    expect(body.error.code).toBe("AI_GENERATION_FAILED");
  });
});

describe("[T0.5.2] MSW ↔ 계약 — test(출제/검수/교체/확정/인쇄)", () => {
  it("POST /api/tests/generate 성공 응답은 testGenerateResponseSchema를 통과한다", async () => {
    const res = await postJson("/api/tests/generate", {
      classId: CLASS_A_ID,
      testType: "daily",
      testDate: "2026-08-13",
    });
    expect(res.status).toBe(201);
    testGenerateResponseSchema.parse(await res.json());
  });

  it("POST /api/tests/generate 문제 부족 시 INSUFFICIENT_PROBLEMS를 반환한다", async () => {
    const res = await postJson("/api/tests/generate", {
      classId: CLASS_STARVED_ID,
      testType: "daily",
      testDate: "2026-08-13",
    });
    expect(res.status).toBe(422);
    const body = insufficientProblemsErrorResponseSchema.parse(
      await res.json(),
    );
    expect(body.error.details).toMatchObject({ available: 0 });
  });

  it("GET /api/tests 목록 응답은 testListResponseSchema를 통과한다", async () => {
    const res = await fetch(`/api/tests?classId=${CLASS_A_ID}`);
    expect(res.status).toBe(200);
    testListResponseSchema.parse(await res.json());
  });

  it("GET /api/tests/{id} 성공 응답은 testDetailResponseSchema를 통과한다", async () => {
    const res = await fetch(`/api/tests/${TEST_DRAFT_ID}`);
    expect(res.status).toBe(200);
    testDetailResponseSchema.parse(await res.json());
  });

  it("GET /api/tests/{id} 존재하지 않는 id는 NOT_FOUND를 반환한다", async () => {
    const res = await fetch(`/api/tests/${TEST_NOT_FOUND_ID}`);
    expect(res.status).toBe(404);
    const body = await errorBody(res);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("PUT /api/tests/{id}/problems/{seq} 성공 응답은 testProblemReplaceResponseSchema를 통과한다", async () => {
    const res = await fetch(`/api/tests/${TEST_DRAFT_ID}/problems/1`, {
      method: "PUT",
    });
    expect(res.status).toBe(200);
    testProblemReplaceResponseSchema.parse(await res.json());
  });

  it("POST /api/tests/{id}/confirm 성공 응답은 testConfirmResponseSchema를 통과한다", async () => {
    const res = await fetch(`/api/tests/${TEST_DRAFT_ID}/confirm`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    testConfirmResponseSchema.parse(await res.json());
  });

  it("POST /api/tests/{id}/print 성공 응답은 testPrintResponseSchema를 통과한다", async () => {
    const res = await fetch(`/api/tests/${TEST_DRAFT_ID}/print`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    testPrintResponseSchema.parse(await res.json());
  });
});

describe("[T0.5.2] MSW ↔ 계약 — unit", () => {
  it("GET /api/units 목록 응답은 unitListResponseSchema를 통과한다", async () => {
    const res = await fetch("/api/units");
    expect(res.status).toBe(200);
    unitListResponseSchema.parse(await res.json());
  });
});
