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
import { MISSING_ANSWER } from "@/lib/missingAnswer";
import { db } from "@/lib/db";
import { findEligibleProblems } from "@/lib/findEligibleProblems";
import { getSessionUser } from "@/lib/session";
import {
  MOCK_PENDING_PROBLEM,
  MOCK_PROBLEMS,
  MOCK_UNITS,
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

  // 계단식 단원 필터(S-08) — 아래 두 개는 **보내는 where 의 형태**를 spy 로 고정한다
  // (problem 컬럼으로 새면 Prisma 가 죽는 자리라 형태 자체가 계약이다).
  // 그 where 가 실제로 **거르는지**는 바로 아래 "관계 필터가 실제로 거른다" 가 잠근다 —
  // 형태만 보면 더블이 관계를 무시해도(전량 통과) 초록이라 그것만으로는 부족하다.
  it("grade/chapterPrefix는 problem 컬럼이 아니라 unit relation 필터로 보낸다", async () => {
    const spy = vi.spyOn(db.problem, "findMany");
    const res = await listProblems(
      jsonRequest(
        `http://localhost/api/problems?grade=${encodeURIComponent("초1")}&chapterPrefix=${encodeURIComponent("1-")}`,
        "GET",
      ),
    );
    expect(res.status).toBe(200);
    const where = spy.mock.calls.at(-1)![0]?.where as {
      AND: Record<string, unknown>[];
    };
    expect(where.AND).toContainEqual({
      unit: { grade: "초1", chapter: { startsWith: "1-" } },
    });
    // problem 컬럼 필터로 새면 Prisma가 알 수 없는 컬럼으로 죽는다.
    for (const clause of where.AND) {
      expect(clause).not.toHaveProperty("grade");
      expect(clause).not.toHaveProperty("chapterPrefix");
    }
    spy.mockRestore();
  });

  it("chapter가 있으면 정확 일치를 쓰고 chapterPrefix는 무시한다", async () => {
    const spy = vi.spyOn(db.problem, "findMany");
    const res = await listProblems(
      jsonRequest(
        `http://localhost/api/problems?grade=${encodeURIComponent("중2")}&chapter=${encodeURIComponent("2. 부등식")}&chapterPrefix=${encodeURIComponent("1-")}`,
        "GET",
      ),
    );
    expect(res.status).toBe(200);
    const where = spy.mock.calls.at(-1)![0]?.where as {
      AND: Record<string, unknown>[];
    };
    expect(where.AND).toContainEqual({
      unit: { grade: "중2", chapter: "2. 부등식" },
    });
    spy.mockRestore();
  });

  it("관계 필터가 실제로 거른다 — 형태만 맞고 결과가 안 걸리면 조용한 초록이다", async () => {
    // 픽스처 단원은 전부 중2 이고 중단원은 "1. 수와 식"·"2. 부등식" 둘뿐이다.
    const targetChapter = "2. 부등식";
    const targetUnitIds = new Set(
      MOCK_UNITS.filter((u) => u.chapter === targetChapter).map((u) => u.id),
    );
    expect(targetUnitIds.size).toBeGreaterThan(0);

    const res = await listProblems(
      jsonRequest(
        `http://localhost/api/problems?grade=${encodeURIComponent("중2")}&chapter=${encodeURIComponent(targetChapter)}&pageSize=100`,
        "GET",
      ),
    );
    expect(res.status).toBe(200);
    const body = problemListResponseSchema.parse(await res.json());

    // ① 걸러진 쪽이 비어 있으면 안 된다(관계 해석이 늘 null 이면 여기서 잡힌다).
    expect(body.data.length).toBeGreaterThan(0);
    // ② 다른 중단원 문항이 섞이면 안 된다(관계를 무시하고 전량 통과시키면 여기서 잡힌다).
    for (const problem of body.data) {
      expect(targetUnitIds.has(problem.unitId)).toBe(true);
    }
    // ③ 실제로 걸러 냈는지 — 픽스처에 다른 중단원 문항이 존재해야 이 검사가 의미를 갖는다.
    const otherChapterExists = MOCK_PROBLEMS.some(
      (p) => p.unitId !== null && !targetUnitIds.has(p.unitId),
    );
    expect(otherChapterExists).toBe(true);
  });

  it("일치하는 단원이 없으면 빈 목록이다 — 관계 조건을 무시하고 전량 돌려주지 않는다", async () => {
    const res = await listProblems(
      jsonRequest(
        `http://localhost/api/problems?grade=${encodeURIComponent("초1")}&pageSize=100`,
        "GET",
      ),
    );
    expect(res.status).toBe(200);
    const body = problemListResponseSchema.parse(await res.json());
    expect(body.data).toHaveLength(0);
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
    // 🔴 `rows[].reviewStatus` 를 보면 안 된다 — 이 조회는 엔진이 쓰는 5컬럼만 select 하므로
    //    그 필드가 애초에 없다. 필드가 없는 것을 `undefined === "approved"` 로 세면 조용히
    //    빨강이 되거나(다행) 조용히 초록이 된다(재앙). **픽스처 쪽에서** 규칙을 잠근다:
    //    approved 가 아닌 문항의 id 는 결과에 하나도 없어야 한다.
    const notApprovedIds = new Set(
      MOCK_PROBLEMS.filter((p) => p.reviewStatus !== "approved").map(
        (p) => p.id,
      ),
    );
    expect(rows.some((p) => notApprovedIds.has(p.id))).toBe(false);
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
    // `answer` 는 select 밖이라 결과 행에 없다. 제외 규칙은 **DB where 가** 계속 판정하고,
    // 여기서는 픽스처의 "정답 없음" 문항 id 가 전부 빠졌는지로 확인한다.
    const missingAnswerIds = new Set(
      [...MOCK_PROBLEMS, MOCK_PROBLEM_MISSING_ANSWER]
        .filter((p) => p.answer === "(정답 없음)")
        .map((p) => p.id),
    );
    expect(missingAnswerIds.size).toBeGreaterThan(0);
    expect(rows.some((p) => missingAnswerIds.has(p.id))).toBe(false);
  });

  it("difficulty를 주면 해당 난이도만 반환한다", async () => {
    const rows = await findEligibleProblems({
      userId: USER_TEACHER_ID,
      unitIds: [MOCK_PROBLEM_WITH_FRACTION.unitId],
      difficulty: "easy",
    });
    expect(rows.every((p) => p.difficulty === "easy")).toBe(true);
  });

  /**
   * ⑷ — 출제 엔진이 「이 문항이 지면 칸에 들어가는가」를 보려면 **본문과 그림**이
   * 후보 행에 실려 있어야 한다. 규칙만 넣고 이 조회를 안 고치면 정책이 실운영에서
   * **조용히 꺼진다** — 「규칙이 옳아도 배선이 한쪽만 되면 그쪽 지표만 좋아진다」
   * (CLAUDE.md 2026-08-18)가 정확히 그 자리다.
   */
  it("지면 판정에 필요한 본문·그림을 같이 읽는다 (⑷ 배선)", async () => {
    const rows = await findEligibleProblems({
      userId: USER_TEACHER_ID,
      unitIds: [MOCK_PROBLEM_WITH_FRACTION.unitId],
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(typeof row.content).toBe("string");
      expect(Array.isArray(row.figureUrls)).toBe(true);
      expect(Array.isArray(row.figureDims)).toBe(true);
    }
  });
});

/**
 * 「자료」 토글 셋 — **서버가 실제로 거르는지** 잠근다 (원장님 지시 2026-08-19).
 *
 * ⚠️ 화면 검사(`ProblemBank.test.tsx`)는 **파라미터가 붙는지**만 본다. 그것만으로는
 *    서버가 그 파라미터를 **읽고 거르는지** 알 수 없다 — 이 저장소는 실제로
 *    「where 모양만 spy 로 보고 진짜 필터링은 안 잠근」 검사를 만든 적이 있다
 *    (2026-08-18, 가짜 DB 가 관계 필터를 모르던 건).
 *
 * 실측 근거 (DB 47,152건): 그림 9,448(20.0%) · 해설 13,909(29.5%) · 정답 45,041(95.5%).
 * 셋 다 뜻이 있다.
 */
describe("[S-08] GET /api/problems — 자료 토글(그림·해설·정답) 서버 필터", () => {
  it("hasSolution=true 면 해설이 **있는** 문항만 온다", async () => {
    const res = await listProblems(
      jsonRequest(
        "http://localhost/api/problems?hasSolution=true&pageSize=100",
        "GET",
      ),
    );
    expect(res.status).toBe(200);
    const body = problemListResponseSchema.parse(await res.json());
    expect(body.data.length).toBeGreaterThan(0);
    for (const p of body.data) {
      expect(p.solution ?? "").not.toBe("");
    }
  });

  it("hasSolution 을 안 붙이면 해설 없는 문항도 온다 — 필터가 항상 켜져 있으면 안 된다", async () => {
    const res = await listProblems(
      jsonRequest("http://localhost/api/problems?pageSize=100", "GET"),
    );
    const body = problemListResponseSchema.parse(await res.json());
    expect(body.data.some((p) => (p.solution ?? "") === "")).toBe(true);
  });

  /**
   * ⚠️ 여기가 이 필터의 핵심이다. `answer` 는 **빈 값이 0건**이라
   * 「비어 있지 않은가」로 만들면 100% 를 통과시켜 아무것도 안 거른다.
   * 실제 자리표시자는 `MISSING_ANSWER`("(정답 없음)") 문자열이다.
   */
  it("hasAnswer=true 면 `(정답 없음)` 자리표시자를 뺀다", async () => {
    const before = problemListResponseSchema.parse(
      await (
        await listProblems(
          jsonRequest("http://localhost/api/problems?pageSize=100", "GET"),
        )
      ).json(),
    );
    // 픽스처에 자리표시자가 실제로 있어야 이 검사가 무언가를 가른다.
    expect(before.data.some((p) => p.answer === MISSING_ANSWER)).toBe(true);

    const res = await listProblems(
      jsonRequest(
        "http://localhost/api/problems?hasAnswer=true&pageSize=100",
        "GET",
      ),
    );
    expect(res.status).toBe(200);
    const body = problemListResponseSchema.parse(await res.json());
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((p) => p.answer !== MISSING_ANSWER)).toBe(true);
  });

  it("정답 필터는 **출제 자격과 같은 상수**를 쓴다 — 갈리면 「보이는데 안 뽑히는」 문항이 생긴다", () => {
    // `findEligibleProblems` 가 쓰는 값과 같아야 한다. 다른 문자열을 새로 적으면
    // 화면과 출제가 서로 다른 문항을 「정답 있음」으로 본다.
    expect(MISSING_ANSWER).toBe("(정답 없음)");
  });

  it("셋을 같이 켜도 서로를 지우지 않는다 (AND)", async () => {
    const res = await listProblems(
      jsonRequest(
        "http://localhost/api/problems?hasSolution=true&hasAnswer=true&pageSize=100",
        "GET",
      ),
    );
    expect(res.status).toBe(200);
    const body = problemListResponseSchema.parse(await res.json());
    for (const p of body.data) {
      expect(p.solution ?? "").not.toBe("");
      expect(p.answer).not.toBe(MISSING_ANSWER);
    }
  });

  it('`hasAnswer=false` 는 계약이 거절한다 — 문자열 "false" 가 참이 되는 함정', async () => {
    const res = await listProblems(
      jsonRequest("http://localhost/api/problems?hasAnswer=false", "GET"),
    );
    expect(res.status).toBe(400);
  });
});

/**
 * 본문 검색 — **서버가 실제로 거르는지** 잠근다 (원장님 지시 2026-08-19).
 * 화면 검사는 `q` 가 붙는지만 본다.
 */
describe("[S-08] GET /api/problems — 본문 검색", () => {
  it("q 로 본문을 거른다 — 안 맞는 문항은 안 온다", async () => {
    const all = problemListResponseSchema.parse(
      await (
        await listProblems(
          jsonRequest("http://localhost/api/problems?pageSize=100", "GET"),
        )
      ).json(),
    );
    // 픽스처에서 실제로 갈리는 낱말을 고른다 — 안 갈리면 이 검사는 아무것도 안 잠근다.
    const needle = all.data[0]!.content.slice(0, 4);
    expect(all.data.some((p) => !p.content.includes(needle))).toBe(true);

    const res = await listProblems(
      jsonRequest(
        `http://localhost/api/problems?q=${encodeURIComponent(needle)}&pageSize=100`,
        "GET",
      ),
    );
    expect(res.status).toBe(200);
    const body = problemListResponseSchema.parse(await res.json());
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.length).toBeLessThan(all.data.length);
    for (const p of body.data) {
      expect(p.content.toLowerCase()).toContain(needle.toLowerCase());
    }
  });

  it("q 는 자료 토글과 **같이** 걸린다 — 서로를 지우지 않는다", async () => {
    const all = problemListResponseSchema.parse(
      await (
        await listProblems(
          jsonRequest("http://localhost/api/problems?pageSize=100", "GET"),
        )
      ).json(),
    );
    const needle = all.data[0]!.content.slice(0, 3);
    const res = await listProblems(
      jsonRequest(
        `http://localhost/api/problems?q=${encodeURIComponent(needle)}&hasAnswer=true&pageSize=100`,
        "GET",
      ),
    );
    const body = problemListResponseSchema.parse(await res.json());
    for (const p of body.data) {
      expect(p.content.toLowerCase()).toContain(needle.toLowerCase());
      expect(p.answer).not.toBe(MISSING_ANSWER);
    }
  });

  it("빈 q 는 계약이 거절한다 — 붙이면 전량이 통과해 뜻이 없다", async () => {
    const res = await listProblems(
      jsonRequest("http://localhost/api/problems?q=", "GET"),
    );
    expect(res.status).toBe(400);
  });
});
