/**
 * 🟢 GREEN — 대응 구현 태스크: Phase 7, T7.1(학생 풀이 결과 데이터 모델 + API 라우트)
 *
 * 구현: src/app/api/tests/[id]/submit, src/app/api/tests/[id]/results/**
 * 대응 계약: src/contracts/testresult.contract.ts
 *
 * ⚠️ predictedScore(판독기 계산값)는 v0 잠정 placeholder다 —
 *    src/lib/predictor/predictStudentScore.ts 상단 주석 참조. 실제 능력 추정 엔진(B)이
 *    아직 없어, 이 테스트는 "자동 채점 점수를 오답 난이도로 소폭 보정한다"는 v0 규칙만 검증한다.
 *
 * 채점 픽스처(src/mocks/data/testResults.ts): TEST_RESULT_FIXTURE_TEST_ID(반 A, 문항 3개) —
 *   1번 객관식(정답 2, 배점10, easy) · 2번 객관식(정답 4, 배점10, hard) · 3번 서술형(배점80, mid)
 */
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => ({
    id: "10000000-0000-4000-8000-000000000001",
    email: "teacher@todaysmath.test",
    name: "테스트 강사",
  })),
}));

import { POST as submitTestResult } from "@/app/api/tests/[id]/submit/route";
import { GET as listTestResults } from "@/app/api/tests/[id]/results/route";
import { GET as getTestResultDetail } from "@/app/api/tests/[id]/results/[studentId]/route";

import { errorResponseSchema } from "@/contracts/common.contract";
import {
  testResultDetailResponseSchema,
  testResultListResponseSchema,
  testResultSubmitResponseSchema,
} from "@/contracts/testresult.contract";
import {
  MOCK_UNITS,
  STUDENT_IDS,
  TEST_NOT_FOUND_ID,
  TEST_RESULT_FIXTURE_TEST_ID,
  TEST_RESULT_PROBLEM_ESSAY_ID,
  TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID,
  TEST_RESULT_PROBLEM_OBJECTIVE_WRONG_ID,
} from "@/mocks/data";
import { db } from "@/lib/db";

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

function withIdAndStudentId(id: string, studentId: string) {
  return { params: Promise.resolve({ id, studentId }) };
}

const STUDENT_A = STUDENT_IDS[0]!; // 반 A 소속
const STUDENT_B = STUDENT_IDS[1]!; // 반 A 소속
const STUDENT_WRONG_CLASS = STUDENT_IDS[3]!; // 반 B 소속(픽스처 시험은 반 A)

function submitUrl(testId: string) {
  return `http://localhost/api/tests/${testId}/submit`;
}

describe("[T7.1] POST /api/tests/{id}/submit — 자동 채점 + 예상 점수 산출", () => {
  it("객관식 정답/오답 + 서술형을 채점해 총점을 계산한다(오답 위주 -> 예상 점수는 위로 보정)", async () => {
    const res = await submitTestResult(
      jsonRequest(submitUrl(TEST_RESULT_FIXTURE_TEST_ID), "POST", {
        studentId: STUDENT_A,
        answers: [
          {
            problemId: TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID,
            selectedChoice: 2,
            essayScore: null,
            sequence: 1,
          },
          {
            problemId: TEST_RESULT_PROBLEM_OBJECTIVE_WRONG_ID,
            selectedChoice: 1,
            essayScore: null,
            sequence: 2,
          },
          {
            problemId: TEST_RESULT_PROBLEM_ESSAY_ID,
            selectedChoice: null,
            essayScore: 75,
            sequence: 3,
          },
        ],
      }),
      withId(TEST_RESULT_FIXTURE_TEST_ID),
    );
    expect(res.status).toBe(201);
    const body = testResultSubmitResponseSchema.parse(await res.json());

    // 10(객관식 정답) + 0(객관식 오답) + 60(서술형 75/100 × 배점80) = 70
    expect(body.data.testResult.score).toBe(70);
    expect(body.data.testResult.testId).toBe(TEST_RESULT_FIXTURE_TEST_ID);
    expect(body.data.testResult.studentId).toBe(STUDENT_A);

    // 판독기(v0) 호출 확인 — 유일한 오답이 hard 난이도라 위로 보정되어 score보다 커야 한다.
    expect(body.data.testResult.predictedScore).toBeGreaterThan(
      body.data.testResult.score,
    );
    expect(body.data.testResult.predictedScore).toBe(75);

    // 분석 리포트 — 단원별 성적 + 난이도 분포 + 복습 추천.
    const report = body.data.analysisReport;
    expect(report.difficultyDistribution.easy).toEqual({
      correct: 1,
      total: 1,
    });
    expect(report.difficultyDistribution.hard).toEqual({
      correct: 0,
      total: 1,
    });
    expect(report.difficultyDistribution.mid).toEqual({
      correct: 1,
      total: 1,
    });
    // 오답 문항(2번, hard)의 단원은 정답률 0% -> 추천 단원에 포함.
    expect(report.recommendedUnits).toContain(MOCK_UNITS[1]!.id);
    expect(report.unitScores[MOCK_UNITS[1]!.id]).toBe(0);
  });

  it("오답이 없으면 예상 점수는 자동 채점 점수와 같다(보정 없음)", async () => {
    const res = await submitTestResult(
      jsonRequest(submitUrl(TEST_RESULT_FIXTURE_TEST_ID), "POST", {
        studentId: STUDENT_B,
        answers: [
          {
            problemId: TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID,
            selectedChoice: 2,
            essayScore: null,
            sequence: 1,
          },
          {
            problemId: TEST_RESULT_PROBLEM_OBJECTIVE_WRONG_ID,
            selectedChoice: 4,
            essayScore: null,
            sequence: 2,
          },
          {
            problemId: TEST_RESULT_PROBLEM_ESSAY_ID,
            selectedChoice: null,
            essayScore: 100,
            sequence: 3,
          },
        ],
      }),
      withId(TEST_RESULT_FIXTURE_TEST_ID),
    );
    expect(res.status).toBe(201);
    const body = testResultSubmitResponseSchema.parse(await res.json());
    expect(body.data.testResult.score).toBe(100);
    expect(body.data.testResult.predictedScore).toBe(100);
    expect(body.data.analysisReport.recommendedUnits).toEqual([]);
  });

  it("이 시험지에 없는 문항이 포함되면 VALIDATION_ERROR(400)를 반환한다", async () => {
    const res = await submitTestResult(
      jsonRequest(submitUrl(TEST_RESULT_FIXTURE_TEST_ID), "POST", {
        studentId: STUDENT_A,
        answers: [
          {
            problemId: "50000000-0000-4000-8000-000000000001",
            selectedChoice: 1,
            essayScore: null,
            sequence: 1,
          },
        ],
      }),
      withId(TEST_RESULT_FIXTURE_TEST_ID),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("시험지 문항 중 일부만 응답하면 VALIDATION_ERROR(400)를 반환한다", async () => {
    const res = await submitTestResult(
      jsonRequest(submitUrl(TEST_RESULT_FIXTURE_TEST_ID), "POST", {
        studentId: STUDENT_A,
        answers: [
          {
            problemId: TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID,
            selectedChoice: 2,
            essayScore: null,
            sequence: 1,
          },
        ],
      }),
      withId(TEST_RESULT_FIXTURE_TEST_ID),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("같은 문항에 응답이 두 번 들어오면 VALIDATION_ERROR(400)로 거부한다", async () => {
    // 🔴 적대적 리뷰에서 재현된 결함(2026-08-16): 고유 problemId 개수만 세면
    //    [p1, p1, p2, p3] 이 "3개 = 문항 3개"로 통과해 p1 배점이 두 번 더해졌다.
    //    3문항(10·10·80) 시험지에서 정답 70점이 80점으로 나왔다.
    const res = await submitTestResult(
      jsonRequest(submitUrl(TEST_RESULT_FIXTURE_TEST_ID), "POST", {
        studentId: STUDENT_A,
        answers: [
          {
            problemId: TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID,
            selectedChoice: 2,
            essayScore: null,
            sequence: 1,
          },
          {
            problemId: TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID,
            selectedChoice: 2,
            essayScore: null,
            sequence: 1,
          },
          {
            problemId: TEST_RESULT_PROBLEM_OBJECTIVE_WRONG_ID,
            selectedChoice: 1,
            essayScore: null,
            sequence: 2,
          },
          {
            problemId: TEST_RESULT_PROBLEM_ESSAY_ID,
            selectedChoice: null,
            essayScore: 75,
            sequence: 3,
          },
        ],
      }),
      withId(TEST_RESULT_FIXTURE_TEST_ID),
    );

    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");

    // 한 행도 쓰지 않는다 — 반만 채점된 결과를 남기지 않는다.
    expect(await db.testResult.findMany({})).toHaveLength(0);
    expect(await db.problemAnswer.findMany({})).toHaveLength(0);
  });

  it("다른 반 소속 학생으로는 제출할 수 없다(NOT_FOUND 404)", async () => {
    const res = await submitTestResult(
      jsonRequest(submitUrl(TEST_RESULT_FIXTURE_TEST_ID), "POST", {
        studentId: STUDENT_WRONG_CLASS,
        answers: [
          {
            problemId: TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID,
            selectedChoice: 2,
            essayScore: null,
            sequence: 1,
          },
          {
            problemId: TEST_RESULT_PROBLEM_OBJECTIVE_WRONG_ID,
            selectedChoice: 4,
            essayScore: null,
            sequence: 2,
          },
          {
            problemId: TEST_RESULT_PROBLEM_ESSAY_ID,
            selectedChoice: null,
            essayScore: 100,
            sequence: 3,
          },
        ],
      }),
      withId(TEST_RESULT_FIXTURE_TEST_ID),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("존재하지 않는 테스트로는 제출할 수 없다(NOT_FOUND 404)", async () => {
    const res = await submitTestResult(
      jsonRequest(submitUrl(TEST_NOT_FOUND_ID), "POST", {
        studentId: STUDENT_A,
        answers: [
          {
            problemId: TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID,
            selectedChoice: 2,
            essayScore: null,
            sequence: 1,
          },
        ],
      }),
      withId(TEST_NOT_FOUND_ID),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("내부 예외 메시지를 INTERNAL_ERROR 응답에 노출하지 않는다", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(db.testProblem, "findMany").mockRejectedValueOnce(
      new Error("DATABASE_URL=postgresql://user:secret@internal/db"),
    );

    const res = await submitTestResult(
      jsonRequest(submitUrl(TEST_RESULT_FIXTURE_TEST_ID), "POST", {
        studentId: STUDENT_A,
        answers: [
          {
            problemId: TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID,
            selectedChoice: 2,
            essayScore: null,
            sequence: 1,
          },
        ],
      }),
      withId(TEST_RESULT_FIXTURE_TEST_ID),
    );
    expect(res.status).toBe(500);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.message).toBe("채점 처리 중 오류가 발생했습니다.");
    expect(JSON.stringify(body)).not.toContain("postgresql://");
    log.mockRestore();
  });
});

describe("[T7.1] GET /api/tests/{id}/results, GET /api/tests/{id}/results/{studentId}", () => {
  async function submitFixture(studentId: string) {
    return submitTestResult(
      jsonRequest(submitUrl(TEST_RESULT_FIXTURE_TEST_ID), "POST", {
        studentId,
        answers: [
          {
            problemId: TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID,
            selectedChoice: 2,
            essayScore: null,
            sequence: 1,
          },
          {
            problemId: TEST_RESULT_PROBLEM_OBJECTIVE_WRONG_ID,
            selectedChoice: 1,
            essayScore: null,
            sequence: 2,
          },
          {
            problemId: TEST_RESULT_PROBLEM_ESSAY_ID,
            selectedChoice: null,
            essayScore: 75,
            sequence: 3,
          },
        ],
      }),
      withId(TEST_RESULT_FIXTURE_TEST_ID),
    );
  }

  it("목록 조회는 응시 결과를 반환한다", async () => {
    await submitFixture(STUDENT_A);

    const res = await listTestResults(
      jsonRequest(
        `http://localhost/api/tests/${TEST_RESULT_FIXTURE_TEST_ID}/results`,
        "GET",
      ),
      withId(TEST_RESULT_FIXTURE_TEST_ID),
    );
    expect(res.status).toBe(200);
    const body = testResultListResponseSchema.parse(await res.json());
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.some((r) => r.studentId === STUDENT_A)).toBe(true);
  });

  it("상세 조회는 문항별 응답과 분석 리포트를 포함한다", async () => {
    await submitFixture(STUDENT_A);

    const res = await getTestResultDetail(
      jsonRequest(
        `http://localhost/api/tests/${TEST_RESULT_FIXTURE_TEST_ID}/results/${STUDENT_A}`,
        "GET",
      ),
      withIdAndStudentId(TEST_RESULT_FIXTURE_TEST_ID, STUDENT_A),
    );
    expect(res.status).toBe(200);
    const body = testResultDetailResponseSchema.parse(await res.json());
    expect(body.data.answers.length).toBe(3);
    expect(body.data.answers[0]!.sequence).toBe(1);
    expect(body.data.analysisReport.totalScore).toBe(70);
  });

  it("응시 기록이 없는 학생은 NOT_FOUND(404)를 반환한다", async () => {
    const res = await getTestResultDetail(
      jsonRequest(
        `http://localhost/api/tests/${TEST_RESULT_FIXTURE_TEST_ID}/results/${STUDENT_B}`,
        "GET",
      ),
      withIdAndStudentId(TEST_RESULT_FIXTURE_TEST_ID, STUDENT_B),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
