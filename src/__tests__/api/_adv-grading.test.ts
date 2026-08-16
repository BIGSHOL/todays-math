/**
 * 적대적 재현 — 채점 접합. **읽기 전용 조사용.**
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
import { errorResponseSchema } from "@/contracts/common.contract";
import { testResultSubmitResponseSchema } from "@/contracts/testresult.contract";
import { db } from "@/lib/db";
import {
  STUDENT_IDS,
  TEST_RESULT_FIXTURE_TEST_ID,
  TEST_RESULT_PROBLEM_ESSAY_ID,
  TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID,
  TEST_RESULT_PROBLEM_OBJECTIVE_WRONG_ID,
} from "@/mocks/data";

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const withId = (id: string) => ({ params: Promise.resolve({ id }) });
const STUDENT_A = STUDENT_IDS[0]!;
const url = (id: string) => `http://localhost/api/tests/${id}/submit`;

describe("[적대] 같은 문항 응답을 두 번 보낸다", () => {
  it("400 으로 거부하고 채점 결과를 남기지 않는다 (2026-08-16 수리)", async () => {
    // 픽스처 시험지: 3문항 (객관식 정답 배점10 · 객관식 오답 배점10 · 서술형 배점80)
    // 정상 제출이면 10 + 0 + 60 = 70 점이다.
    const res = await submitTestResult(
      jsonRequest(url(TEST_RESULT_FIXTURE_TEST_ID), "POST", {
        studentId: STUDENT_A,
        answers: [
          {
            problemId: TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID,
            selectedChoice: 2,
            essayScore: null,
            sequence: 1,
          },
          // ↓ 같은 문항을 한 번 더. 고유 problemId 개수는 여전히 3 이라 검사를 통과한다.
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

    // 수리 전: 201 · 총점 80(정상 70) · ProblemAnswer 4행(문항은 3개)
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    console.log("중복 제출 응답:", res.status, body.error.message);

    // 한 행도 쓰지 않는다.
    expect(await db.testResult.findMany({})).toHaveLength(0);
    expect(await db.problemAnswer.findMany({})).toHaveLength(0);
  });
});

describe("[적대/회귀] 배점 없는 옛 일일테스트 채점이 D-42 변경 후에도 같은가", () => {
  it("TestProblem.score 가 NULL 이면 예전 규칙(Problem.score ?? 균등배분) 그대로다", async () => {
    // 픽스처 시험지의 TestProblem.score 는 전부 NULL 이다(일일/확인테스트).
    const rows = await db.testProblem.findMany({
      where: { testId: TEST_RESULT_FIXTURE_TEST_ID },
    });
    console.log("옛 시험지 TestProblem.score:", rows.map((r) => r.score));
    expect(rows.every((r) => r.score === null || r.score === undefined)).toBe(true);

    const res = await submitTestResult(
      jsonRequest(url(TEST_RESULT_FIXTURE_TEST_ID), "POST", {
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
    const body = testResultSubmitResponseSchema.parse(await res.json());
    console.log("옛 시험지 채점 총점:", body.data.testResult.score);
    expect(body.data.testResult.score).toBe(70);
  });
});
