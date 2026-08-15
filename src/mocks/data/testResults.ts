/**
 * Mock 응시 결과(TestResult/ProblemAnswer/AnalysisReport) 테스트 전용 픽스처 — T7.1.
 *
 * 자동 채점 로직(src/lib/testResults/gradeAnswers.ts)이 객관식은 Problem.answer(정답 텍스트)와
 * selectedChoice를 문자열로 비교한다 — MOCK_PROBLEMS(src/mocks/data/problems.ts)의 정답은
 * 전부 수식/소수 텍스트(예: "0.28")라 선택 번호(1~5) 비교에 쓸 수 없다. 그래서 채점 테스트
 * 전용으로 문항 3개(객관식 정답 1 · 객관식 오답 1 · 서술형 1)와 이를 담은 Test를 별도로 둔다.
 *
 * 대응 API 경로: POST /api/tests/{id}/submit, GET /api/tests/{id}/results,
 * GET /api/tests/{id}/results/{studentId} (src/contracts/testresult.contract.ts)
 */
import type { Difficulty, TestStatus, TestType } from "@/contracts/common.contract";
import type { ProblemType } from "@/contracts/problem.contract";

import {
  CLASS_A_ID,
  TEST_RESULT_FIXTURE_TEST_ID,
  testResultFixtureProblemId,
  USER_TEACHER_ID,
} from "./ids";
import { MOCK_UNITS } from "./units";

export const TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID =
  testResultFixtureProblemId(1);
export const TEST_RESULT_PROBLEM_OBJECTIVE_WRONG_ID =
  testResultFixtureProblemId(2);
export const TEST_RESULT_PROBLEM_ESSAY_ID = testResultFixtureProblemId(3);

interface FixtureProblemRow {
  id: string;
  userId: string;
  unitId: string;
  source: "manual";
  originProblemId: null;
  difficulty: Difficulty;
  problemType: ProblemType;
  content: string;
  answer: string;
  solution: string | null;
  reviewStatus: "approved";
  directUseAllowed: true;
  pool: "shared";
  /** 원본 배점 — 채점 가중치. 이 3문항 합이 100점이 되도록 맞췄다(10 + 10 + 80). */
  score: number;
  createdAt: string;
  updatedAt: string;
}

/** 객관식(정답 2번, 배점 10) — 하 난이도. */
export const MOCK_TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT: FixtureProblemRow = {
  id: TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID,
  userId: USER_TEACHER_ID,
  unitId: MOCK_UNITS[0]!.id,
  source: "manual",
  originProblemId: null,
  difficulty: "easy",
  problemType: "개념",
  content: "다음 중 옳은 것은? (채점 테스트 전용 객관식 문항)",
  answer: "2",
  solution: null,
  reviewStatus: "approved",
  directUseAllowed: true,
  pool: "shared",
  score: 10,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

/** 객관식(정답 4번, 배점 10) — 상 난이도. 채점 테스트에서 오답으로 제출한다. */
export const MOCK_TEST_RESULT_PROBLEM_OBJECTIVE_WRONG: FixtureProblemRow = {
  id: TEST_RESULT_PROBLEM_OBJECTIVE_WRONG_ID,
  userId: USER_TEACHER_ID,
  unitId: MOCK_UNITS[1]!.id,
  source: "manual",
  originProblemId: null,
  difficulty: "hard",
  problemType: "개념",
  content: "다음 중 옳은 것은? (채점 테스트 전용 객관식 문항, 상 난이도)",
  answer: "4",
  solution: null,
  reviewStatus: "approved",
  directUseAllowed: true,
  pool: "shared",
  score: 10,
  createdAt: "2026-08-01T00:01:00.000Z",
  updatedAt: "2026-08-01T00:01:00.000Z",
};

/** 서술형(배점 80) — 중 난이도. essayScore(0~100, 배점 대비 비율)로 채점한다. */
export const MOCK_TEST_RESULT_PROBLEM_ESSAY: FixtureProblemRow = {
  id: TEST_RESULT_PROBLEM_ESSAY_ID,
  userId: USER_TEACHER_ID,
  unitId: MOCK_UNITS[0]!.id,
  source: "manual",
  originProblemId: null,
  difficulty: "mid",
  problemType: "서술형",
  content: "풀이 과정을 서술하여라. (채점 테스트 전용 서술형 문항)",
  answer: "풀이 과정은 채점자가 직접 확인한다.",
  solution: null,
  reviewStatus: "approved",
  directUseAllowed: true,
  pool: "shared",
  score: 80,
  createdAt: "2026-08-01T00:02:00.000Z",
  updatedAt: "2026-08-01T00:02:00.000Z",
};

export const MOCK_TEST_RESULT_PROBLEMS: FixtureProblemRow[] = [
  MOCK_TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT,
  MOCK_TEST_RESULT_PROBLEM_OBJECTIVE_WRONG,
  MOCK_TEST_RESULT_PROBLEM_ESSAY,
];

interface FixtureTestRow {
  id: string;
  userId: string;
  classId: string;
  studentId: null;
  testType: TestType;
  rangeStartUnitId: null;
  rangeEndUnitId: string;
  status: TestStatus;
  modified: false;
  testDate: string;
  printedAt: string;
  createdAt: string;
}

/** 채점 테스트 전용 확정 시험지 — 반 A(CLASS_A_ID) 전체 대상, 문항 3개. */
export const MOCK_TEST_RESULT_FIXTURE_TEST: FixtureTestRow = {
  id: TEST_RESULT_FIXTURE_TEST_ID,
  userId: USER_TEACHER_ID,
  classId: CLASS_A_ID,
  studentId: null,
  testType: "daily",
  rangeStartUnitId: null,
  rangeEndUnitId: MOCK_UNITS[0]!.id,
  status: "printed",
  modified: false,
  testDate: "2026-08-14",
  printedAt: "2026-08-14T09:00:00+09:00",
  createdAt: "2026-08-14T08:00:00.000Z",
};

export const MOCK_TEST_RESULT_FIXTURE_TEST_PROBLEMS = [
  { problemId: TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID, orderIndex: 1 },
  { problemId: TEST_RESULT_PROBLEM_OBJECTIVE_WRONG_ID, orderIndex: 2 },
  { problemId: TEST_RESULT_PROBLEM_ESSAY_ID, orderIndex: 3 },
];
