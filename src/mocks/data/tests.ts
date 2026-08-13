/**
 * Mock 테스트(Test/TestProblem) 픽스처 (T0.5.2) — draft 1개 + confirmed 1개 + printed 1개.
 *
 * 대응 API 경로: POST /api/tests/generate, GET /api/tests, GET /api/tests/{id},
 * PUT /api/tests/{id}/problems/{seq}, POST /api/tests/{id}/confirm, POST /api/tests/{id}/print
 * (src/contracts/test.contract.ts)
 *
 * ⚠️ 아래 문항 선정(어떤 unit에서 몇 문제를 뽑는지)은 화면 개발이 쓸 "스키마상 유효한 예시"일
 *    뿐, 실제 출제 엔진의 배분/중복 제외 규칙(T4.1)을 재현하지 않는다. 엔진 규칙 자체의 단위
 *    테스트는 src/__tests__/unit/generator.test.ts가 별도 픽스처로 검증한다.
 */
import type { TestEntity, TestProblemItem } from "@/contracts/test.contract";

import {
  CLASS_A_ID,
  CLASS_B_ID,
  STUDENT_IDS,
  TEST_CONFIRMED_ID,
  TEST_DRAFT_ID,
  TEST_PRINTED_ID,
  testProblemId,
} from "./ids";
import { MOCK_PROBLEMS } from "./problems";
import {
  MOCK_CURRENT_PROGRESS_UNIT,
  MOCK_REVIEW_RANGE_END_UNIT,
  MOCK_REVIEW_RANGE_START_UNIT,
  MOCK_UNITS,
} from "./units";

function toTestProblemItems(
  problemIdxList: number[],
  opts: { idOffset: number; replacedAt?: number[] },
): TestProblemItem[] {
  return problemIdxList.map((problemIdx, i) => ({
    id: testProblemId(opts.idOffset + i + 1),
    problemId: MOCK_PROBLEMS[problemIdx]!.id,
    orderIndex: i + 1,
    replaced: opts.replacedAt?.includes(i + 1) ?? false,
    problem: MOCK_PROBLEMS[problemIdx]!,
  }));
}

// ─────────────────────────────────────────────
// draft — 반 A(CLASS_A_ID), daily, 검수 전(교체 없음)
// ─────────────────────────────────────────────
export const MOCK_TEST_DRAFT: TestEntity = {
  id: TEST_DRAFT_ID,
  userId: MOCK_PROBLEMS[0]!.userId,
  classId: CLASS_A_ID,
  studentId: null,
  testType: "daily",
  rangeStartUnitId: null,
  rangeEndUnitId: MOCK_CURRENT_PROGRESS_UNIT.id,
  status: "draft",
  modified: false,
  testDate: "2026-08-10",
  printedAt: null,
  createdAt: "2026-08-10T08:00:00Z",
};

export const MOCK_TEST_DRAFT_PROBLEMS: TestProblemItem[] = toTestProblemItems(
  [0, 3, 6, 9, 12, 15, 18, 21],
  { idOffset: 0 },
);

// ─────────────────────────────────────────────
// confirmed — 반 B(CLASS_B_ID), review(413~420 범위), 검수 중 1문항 교체됨(modified=true)
// ─────────────────────────────────────────────
export const MOCK_TEST_CONFIRMED: TestEntity = {
  id: TEST_CONFIRMED_ID,
  userId: MOCK_PROBLEMS[0]!.userId,
  classId: CLASS_B_ID,
  studentId: null,
  testType: "review",
  rangeStartUnitId: MOCK_REVIEW_RANGE_START_UNIT.id,
  rangeEndUnitId: MOCK_REVIEW_RANGE_END_UNIT.id,
  status: "confirmed",
  modified: true,
  testDate: "2026-07-28",
  printedAt: null,
  createdAt: "2026-07-27T08:00:00Z",
};

export const MOCK_TEST_CONFIRMED_PROBLEMS: TestProblemItem[] =
  toTestProblemItems([1, 4, 7, 10, 16, 20], { idOffset: 8, replacedAt: [6] });

// ─────────────────────────────────────────────
// printed — 반 A(CLASS_A_ID) 학생 개별(STUDENT_IDS[2], 개별 진도 우선), daily, 인쇄 완료
// ─────────────────────────────────────────────
export const MOCK_TEST_PRINTED: TestEntity = {
  id: TEST_PRINTED_ID,
  userId: MOCK_PROBLEMS[0]!.userId,
  classId: CLASS_A_ID,
  studentId: STUDENT_IDS[2]!,
  testType: "daily",
  rangeStartUnitId: null,
  rangeEndUnitId: MOCK_UNITS[5]!.id, // 418 단항식의 곱셈과 나눗셈 — 학생 개별 진도
  status: "printed",
  modified: false,
  testDate: "2026-07-22",
  printedAt: "2026-07-22T14:30:00+09:00",
  createdAt: "2026-07-22T08:00:00Z",
};

export const MOCK_TEST_PRINTED_PROBLEMS: TestProblemItem[] = toTestProblemItems(
  [2, 5, 8, 11, 14, 17, 20, 23],
  { idOffset: 14 },
);

export const MOCK_TESTS: TestEntity[] = [
  MOCK_TEST_DRAFT,
  MOCK_TEST_CONFIRMED,
  MOCK_TEST_PRINTED,
];

export const MOCK_TEST_PROBLEMS_BY_TEST_ID: Record<string, TestProblemItem[]> =
  {
    [MOCK_TEST_DRAFT.id]: MOCK_TEST_DRAFT_PROBLEMS,
    [MOCK_TEST_CONFIRMED.id]: MOCK_TEST_CONFIRMED_PROBLEMS,
    [MOCK_TEST_PRINTED.id]: MOCK_TEST_PRINTED_PROBLEMS,
  };
