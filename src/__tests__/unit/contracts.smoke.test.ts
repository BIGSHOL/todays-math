// T0.5.1 계약 스모크 테스트 — 각 Zod 스키마가 유효 샘플을 parse하고 무효 샘플을 reject하는지만
// 확인한다. 도메인 시나리오(비즈니스 규칙) 테스트는 T0.5.3(RED 테스트)에서 작성한다.
import { describe, expect, it } from "vitest";

import {
  authLoginRequestSchema,
  authSignupRequestSchema,
} from "@/contracts/auth.contract";
import {
  classCreateRequestSchema,
  progressAdvanceRequestSchema,
  progressRecordRequestSchema,
  studentCreateRequestSchema,
} from "@/contracts/class.contract";
import {
  difficultyRatioSchema,
  errorResponseSchema,
  idParamSchema,
} from "@/contracts/common.contract";
import {
  problemCreateRequestSchema,
  problemFilterQuerySchema,
  problemGenerateRequestSchema,
  problemReviewStatusUpdateRequestSchema,
  problemTransformRequestSchema,
} from "@/contracts/problem.contract";
import {
  insufficientProblemsErrorResponseSchema,
  testGenerateRequestSchema,
  testProblemReplaceRequestSchema,
  testSchema,
} from "@/contracts/test.contract";

const UUID_1 = "11111111-1111-4111-8111-111111111111";
const UUID_2 = "22222222-2222-4222-8222-222222222222";

describe("[T0.5.1] common.contract", () => {
  it("errorResponseSchema — 유효한 에러 응답을 parse한다", () => {
    const result = errorResponseSchema.safeParse({
      error: { code: "INSUFFICIENT_PROBLEMS", message: "문제가 부족합니다." },
    });
    expect(result.success).toBe(true);
  });

  it("errorResponseSchema — 정의되지 않은 에러 코드는 reject한다", () => {
    const result = errorResponseSchema.safeParse({
      error: { code: "UNKNOWN_CODE", message: "x" },
    });
    expect(result.success).toBe(false);
  });

  it("difficultyRatioSchema — 음수 배분은 reject한다", () => {
    const result = difficultyRatioSchema.safeParse({
      easy: -1,
      mid: 4,
      hard: 1,
    });
    expect(result.success).toBe(false);
  });

  it("idParamSchema — UUID가 아니면 reject한다", () => {
    expect(idParamSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
    expect(idParamSchema.safeParse({ id: UUID_1 }).success).toBe(true);
  });
});

describe("[T0.5.1] auth.contract", () => {
  it("authSignupRequestSchema — 유효한 가입 요청을 parse한다", () => {
    const result = authSignupRequestSchema.safeParse({
      email: "teacher@example.com",
      password: "password123",
      name: "김원장",
    });
    expect(result.success).toBe(true);
  });

  it("authSignupRequestSchema — 짧은 비밀번호는 reject한다", () => {
    const result = authSignupRequestSchema.safeParse({
      email: "teacher@example.com",
      password: "short",
      name: "김원장",
    });
    expect(result.success).toBe(false);
  });

  it("authLoginRequestSchema — 정의되지 않은 필드가 있으면 reject한다(strict)", () => {
    const result = authLoginRequestSchema.safeParse({
      email: "teacher@example.com",
      password: "password123",
      rememberMe: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("[T0.5.1] class.contract", () => {
  it("classCreateRequestSchema — 최소 필드만으로 기본값이 채워진다", () => {
    const result = classCreateRequestSchema.safeParse({
      name: "중2-A",
      grade: "중2",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultProblemCount).toBe(8);
      expect(result.data.difficultyRatio).toEqual({ easy: 3, mid: 4, hard: 1 });
    }
  });

  it("classCreateRequestSchema — 반 이름이 없으면 reject한다", () => {
    const result = classCreateRequestSchema.safeParse({
      name: "",
      grade: "중2",
    });
    expect(result.success).toBe(false);
  });

  it("studentCreateRequestSchema — 이름만으로 등록 요청을 parse한다(최소 수집)", () => {
    const result = studentCreateRequestSchema.safeParse({
      classId: UUID_1,
      name: "홍길동",
    });
    expect(result.success).toBe(true);
  });

  it("progressRecordRequestSchema — 필수 필드 누락 시 reject한다", () => {
    const result = progressRecordRequestSchema.safeParse({ classId: UUID_1 });
    expect(result.success).toBe(false);
  });

  it("progressAdvanceRequestSchema — classId만으로 1클릭 진행 요청을 parse한다", () => {
    const result = progressAdvanceRequestSchema.safeParse({ classId: UUID_1 });
    expect(result.success).toBe(true);
  });
});

describe("[T0.5.1] problem.contract", () => {
  it("problemCreateRequestSchema — 유효한 등록 요청을 parse한다", () => {
    const result = problemCreateRequestSchema.safeParse({
      unitId: UUID_1,
      source: "manual",
      difficulty: "mid",
      problemType: "계산",
      content: "$1+1=?$",
      answer: "2",
    });
    expect(result.success).toBe(true);
  });

  it("problemCreateRequestSchema — 정의되지 않은 problemType은 reject한다", () => {
    const result = problemCreateRequestSchema.safeParse({
      unitId: UUID_1,
      source: "manual",
      difficulty: "mid",
      problemType: "암기",
      content: "$1+1=?$",
      answer: "2",
    });
    expect(result.success).toBe(false);
  });

  it("problemCreateRequestSchema — ai_generated는 등록 요청 출처로 reject한다", () => {
    const result = problemCreateRequestSchema.safeParse({
      unitId: UUID_1,
      source: "ai_generated",
      difficulty: "mid",
      problemType: "계산",
      content: "$1+1=?$",
      answer: "2",
    });
    expect(result.success).toBe(false);
  });

  it("problemFilterQuerySchema — 빈 쿼리에도 페이지네이션 기본값이 채워진다", () => {
    const result = problemFilterQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({ page: 1, pageSize: 20 });
    }
  });

  it("problemGenerateRequestSchema — count 상한(10) 초과 시 reject한다", () => {
    const result = problemGenerateRequestSchema.safeParse({
      unitId: UUID_1,
      difficulty: "hard",
      count: 11,
    });
    expect(result.success).toBe(false);
  });

  it("problemTransformRequestSchema — originProblemId 없이는 reject한다", () => {
    const result = problemTransformRequestSchema.safeParse({ count: 2 });
    expect(result.success).toBe(false);
  });

  it("problemReviewStatusUpdateRequestSchema — 정의된 상태값만 허용한다", () => {
    expect(
      problemReviewStatusUpdateRequestSchema.safeParse({
        reviewStatus: "approved",
      }).success,
    ).toBe(true);
    expect(
      problemReviewStatusUpdateRequestSchema.safeParse({ reviewStatus: "done" })
        .success,
    ).toBe(false);
  });
});

describe("[T0.5.1] test.contract", () => {
  it("testGenerateRequestSchema — 일일테스트는 범위 단원 없이도 유효하다", () => {
    const result = testGenerateRequestSchema.safeParse({
      classId: UUID_1,
      testType: "daily",
      testDate: "2026-08-13",
    });
    expect(result.success).toBe(true);
  });

  it("testGenerateRequestSchema — 확인테스트는 범위 단원 없이 reject한다", () => {
    const result = testGenerateRequestSchema.safeParse({
      classId: UUID_1,
      testType: "review",
      testDate: "2026-08-13",
    });
    expect(result.success).toBe(false);
  });

  it("testGenerateRequestSchema — 확인테스트는 범위 단원이 있으면 유효하다", () => {
    const result = testGenerateRequestSchema.safeParse({
      classId: UUID_1,
      testType: "review",
      testDate: "2026-08-13",
      rangeStartUnitId: UUID_1,
      rangeEndUnitId: UUID_2,
    });
    expect(result.success).toBe(true);
  });

  it("testSchema — 서버 응답 형태의 엔티티를 parse한다", () => {
    const result = testSchema.safeParse({
      id: UUID_1,
      userId: UUID_1,
      classId: UUID_1,
      studentId: null,
      testType: "daily",
      rangeStartUnitId: null,
      rangeEndUnitId: UUID_2,
      status: "draft",
      modified: false,
      testDate: "2026-08-13",
      printedAt: null,
      createdAt: "2026-08-13T09:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("testProblemReplaceRequestSchema — 빈 본문만 허용한다(1클릭 교체)", () => {
    expect(testProblemReplaceRequestSchema.safeParse({}).success).toBe(true);
    expect(
      testProblemReplaceRequestSchema.safeParse({ problemId: UUID_1 }).success,
    ).toBe(false);
  });

  it("insufficientProblemsErrorResponseSchema — {unitId, available, required} 형태를 parse한다", () => {
    const result = insufficientProblemsErrorResponseSchema.safeParse({
      error: {
        code: "INSUFFICIENT_PROBLEMS",
        message: "이 단원의 문제가 부족합니다.",
        details: { unitId: UUID_1, available: 3, required: 8 },
      },
    });
    expect(result.success).toBe(true);
  });

  it("insufficientProblemsErrorResponseSchema — 다른 에러 코드는 reject한다", () => {
    const result = insufficientProblemsErrorResponseSchema.safeParse({
      error: {
        code: "VALIDATION_ERROR",
        message: "x",
        details: { unitId: UUID_1, available: 3, required: 8 },
      },
    });
    expect(result.success).toBe(false);
  });
});
