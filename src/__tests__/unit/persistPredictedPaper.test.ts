/**
 * 왜 이 테스트가 있는가 — **적재가 없으면 보정기는 아무것도 고치지 못한다.**
 *
 * 보정기가 만점 100 짜리 배점 벡터를 만들어도, 그 값이 `TestProblem.score` 에 실리지 않고
 * 채점이 그것을 읽지 않으면 §10.1 버그는 그대로다. 그래서 이 파일은 **저장 → 채점**까지
 * 한 바퀴를 건다. 마지막 테스트(`한 바퀴`)가 그 루프 전체를 지킨다.
 *
 * 특히 붙드는 것 세 가지.
 *
 *  1. **`Problem.score` 원본이 그대로다.** 조정 배점은 시험지 쪽에만 싣는다(11 §10.2-4).
 *     덮어쓰면 학습 코퍼스가 오염된다. 저장 전후로 문제은행 배점을 통째로 비교한다.
 *  2. **만점이 100 이 아니면 한 행도 쓰지 않는다.** D-45 는 만점 100 이 아닌 시험지를
 *     출제·채점에서 뺀다. 그 판정을 우회하는 유일한 길이 "손으로 만든 배점을 그대로
 *     저장하는 것"이라, 저장 직전에 다시 센다. 반만 쓰인 시험지를 남기지 않는다.
 *  3. **수동 조정은 합계가 100 이 아니면 거부하고 기존 배점을 건드리지 않는다**(11 §10.4).
 *     자동으로 다른 문항을 고쳐 사용자를 놀라게 하지 않는다.
 */
import { describe, expect, it } from "vitest";

import type { PredictedPaper } from "@/contracts/scoreNormalizer.contract";
import { db } from "@/lib/db";
import {
  persistPredictedPaper,
  saveManualScores,
} from "@/lib/predictor/persistPredictedPaper";
import { validateManualScores } from "@/lib/predictor/scoreNormalizer";
import { gradeAnswers } from "@/lib/testResults/gradeAnswers";
import {
  MOCK_CLASS_OTHER_USER,
  MOCK_CLASSES,
  MOCK_PROBLEMS,
  MOCK_UNITS,
  TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID,
  TEST_RESULT_PROBLEM_OBJECTIVE_WRONG_ID,
  USER_TEACHER_ID,
} from "@/mocks/data";

const CLASS_ID = MOCK_CLASSES[0]!.id;
const UNIT_ID = MOCK_UNITS[0]!.id;

/** 기출 2문항(원본 배점 10점) + 자작 3문항(원본 배점 NULL) — 11 §10.1 이 말하는 그 혼합이다. */
const MIXED_PROBLEM_IDS = [
  TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID,
  TEST_RESULT_PROBLEM_OBJECTIVE_WRONG_ID,
  MOCK_PROBLEMS[0]!.id,
  MOCK_PROBLEMS[1]!.id,
  MOCK_PROBLEMS[2]!.id,
];

function paper(
  scores: number[],
  problemIds = MIXED_PROBLEM_IDS,
): PredictedPaper {
  return {
    ok: true,
    series: { school: "대구여고", level: "고", grade: 2, subject: "수2" },
    period: { year: 2025, semester: 2, round: "기말" },
    questions: scores.map((score, i) => ({
      orderIndex: i + 1,
      problemId: problemIds[i]!,
      unitId: UNIT_ID,
      difficulty: "mid" as const,
      qtype: "객관식" as const,
      originalScore: i < 2 ? 10 : null,
      score,
      relaxed: [],
      schoolReuse: false,
    })),
    totalScore: 100,
    grid: [20],
    unfilled: [],
    referenceUsed: 1,
    referenceExcluded: 0,
  };
}

function baseInput() {
  return {
    userId: USER_TEACHER_ID,
    classId: CLASS_ID,
    testDate: "2026-09-01",
    rangeEndUnitId: UNIT_ID,
  };
}

async function problemScoreSnapshot() {
  const rows = await db.problem.findMany({});
  return rows
    .map((row) => `${row.id}:${row.score ?? "null"}`)
    .sort()
    .join("|");
}

describe("[T7.9] 예측 문제지 적재 — TestProblem.score", () => {
  it("조정 배점이 TestProblem.score 에 실리고 합이 정확히 100 이다", async () => {
    const result = await persistPredictedPaper({
      ...baseInput(),
      paper: paper([20, 20, 20, 20, 20]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questionCount).toBe(5);
    expect(result.totalScore).toBe(100);

    const rows = await db.testProblem.findMany({
      where: { testId: result.testId },
      orderBy: { orderIndex: "asc" },
    });
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.score)).toEqual([20, 20, 20, 20, 20]);
    expect(rows.map((r) => r.orderIndex)).toEqual([1, 2, 3, 4, 5]);
  });

  it("`Problem.score` 원본을 건드리지 않는다 — 학습 코퍼스 오염 금지", async () => {
    const before = await problemScoreSnapshot();

    const result = await persistPredictedPaper({
      ...baseInput(),
      // 기출 원본은 10점인데 시험지에서는 20점으로 조정된다.
      paper: paper([20, 20, 20, 20, 20]),
    });
    expect(result.ok).toBe(true);

    expect(await problemScoreSnapshot()).toBe(before);

    // 조정 배점과 원본 배점이 실제로 다른 값이어야 이 테스트가 의미가 있다.
    const original = await db.problem.findUnique({
      where: { id: TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID },
    });
    expect(original?.score).toBe(10);
  });

  it("만점이 100 이 아니면 한 행도 쓰지 않는다 (D-45)", async () => {
    const before = (await db.test.findMany({})).length;

    const result = await persistPredictedPaper({
      ...baseInput(),
      // 합계 98 — 보정기를 거치지 않고 손으로 만든 배점이 들어온 상황.
      paper: paper([20, 20, 20, 20, 18]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("만점_불일치");
    expect(result.detail).toContain("98");
    expect((await db.test.findMany({})).length).toBe(before);
  });

  it("판단 불가 문제지는 저장하지 않는다 — 근거 없는 시험지를 남기지 않는다", async () => {
    const before = (await db.test.findMany({})).length;

    const result = await persistPredictedPaper({
      ...baseInput(),
      paper: {
        ok: false,
        judgement: "판단 불가",
        reason: "눈금_없음",
        detail: "그 학교의 배점 눈금 이력이 없어 배점을 정할 수 없습니다.",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("판단_불가");
    expect((await db.test.findMany({})).length).toBe(before);
  });

  it("남의 반에는 저장하지 못한다", async () => {
    const result = await persistPredictedPaper({
      ...baseInput(),
      classId: MOCK_CLASS_OTHER_USER.id,
      paper: paper([20, 20, 20, 20, 20]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("권한_없음");
  });

  it("없는 반이면 대상_없음", async () => {
    const result = await persistPredictedPaper({
      ...baseInput(),
      classId: "99999999-9999-4999-8999-999999999999",
      paper: paper([20, 20, 20, 20, 20]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("대상_없음");
  });
});

describe("[T7.9] 원장 수동 조정 저장 (11 §10.4)", () => {
  async function seedTest() {
    const created = await persistPredictedPaper({
      ...baseInput(),
      paper: paper([20, 20, 20, 20, 20]),
    });
    if (!created.ok) throw new Error("픽스처 적재 실패");
    return created.testId;
  }

  it("합계가 100 이면 저장한다", async () => {
    const testId = await seedTest();

    const result = await saveManualScores({
      userId: USER_TEACHER_ID,
      testId,
      scores: [
        { orderIndex: 1, score: 15 },
        { orderIndex: 2, score: 15 },
        { orderIndex: 3, score: 20 },
        { orderIndex: 4, score: 20 },
        { orderIndex: 5, score: 30 },
      ],
    });

    expect(result.ok).toBe(true);
    const rows = await db.testProblem.findMany({
      where: { testId },
      orderBy: { orderIndex: "asc" },
    });
    expect(rows.map((r) => r.score)).toEqual([15, 15, 20, 20, 30]);
  });

  it("합계가 100 이 아니면 거부하고 기존 배점을 그대로 둔다", async () => {
    const testId = await seedTest();

    const result = await saveManualScores({
      userId: USER_TEACHER_ID,
      testId,
      scores: [
        { orderIndex: 1, score: 20 },
        { orderIndex: 2, score: 20 },
        { orderIndex: 3, score: 20 },
        { orderIndex: 4, score: 20 },
        { orderIndex: 5, score: 18.5 },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("만점_불일치");
    expect(result.detail).toBe("합계 98.5 — 1.5점 남음");

    // 자동으로 다른 문항을 건드리지 않는다 — 저장 전 배점 그대로다.
    const rows = await db.testProblem.findMany({
      where: { testId },
      orderBy: { orderIndex: "asc" },
    });
    expect(rows.map((r) => r.score)).toEqual([20, 20, 20, 20, 20]);
  });

  it("문항 수가 시험지와 다르면 거부한다", async () => {
    const testId = await seedTest();

    const result = await saveManualScores({
      userId: USER_TEACHER_ID,
      testId,
      scores: [
        { orderIndex: 1, score: 50 },
        { orderIndex: 2, score: 50 },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("문항_불일치");
  });

  it("같은 문항 번호를 두 번 보내면 거부한다 — 개수·합계가 맞아도", async () => {
    // 🔴 적대적 리뷰에서 재현된 결함(2026-08-16): 개수와 존재 여부만 보면
    //    [1,1,1,2,3] 이 "5개 = 문항 5개"로 통과했다. 저장은 orderIndex 로 되짚어
    //    update 하므로 1번 행만 마지막 값으로 덮이고 4·5번은 옛 배점이 남아
    //    만점이 100 이 아닌 시험지가 저장됐다(재현: 응답 100 / 실제 148).
    const testId = await seedTest();

    const result = await saveManualScores({
      userId: USER_TEACHER_ID,
      testId,
      scores: [
        { orderIndex: 1, score: 25 },
        { orderIndex: 1, score: 25 },
        { orderIndex: 1, score: 25 },
        { orderIndex: 2, score: 12.5 },
        { orderIndex: 3, score: 12.5 },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("문항_불일치");
    expect(result.detail).toContain("1");

    // 한 행도 건드리지 않는다.
    const rows = await db.testProblem.findMany({
      where: { testId },
      orderBy: { orderIndex: "asc" },
    });
    expect(rows.map((r) => r.score)).toEqual([20, 20, 20, 20, 20]);
  });

  it("보정기의 수동 조정 검증도 같은 번호를 두 번 세지 않는다", () => {
    const check = validateManualScores([
      { number: 1, score: 50 },
      { number: 1, score: 50 },
    ]);

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.issue).toBe("문항_중복");
  });

  it("남의 시험지는 고치지 못한다", async () => {
    const testId = await seedTest();

    const result = await saveManualScores({
      userId: "88888888-8888-4888-8888-888888888888",
      testId,
      scores: [{ orderIndex: 1, score: 100 }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("권한_없음");
  });
});

describe("[T7.9] 한 바퀴 — 보정 → 적재 → 채점의 만점이 100 이다", () => {
  it("보정 전에는 만점이 100 이 아니고, 적재 후에는 정확히 100 이다", async () => {
    const answers = MIXED_PROBLEM_IDS.map((problemId, i) => ({
      problemId,
      selectedChoice: null,
      essayScore: null,
      sequence: i + 1,
    }));

    const created = await persistPredictedPaper({
      ...baseInput(),
      paper: paper([20, 20, 20, 20, 20]),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const rows = await db.testProblem.findMany({
      where: { testId: created.testId },
      include: { problem: true },
    });

    // (1) 보정 전 — submitTestResult 가 예전에 쓰던 규칙(Problem.score ?? 균등배분).
    const before = gradeAnswers(
      answers,
      rows.map((tp) => ({
        id: tp.problem.id,
        unitId: tp.problem.unitId,
        difficulty: tp.problem.difficulty,
        answer: tp.problem.answer,
        score: tp.problem.score ?? null,
      })),
    );
    const fullMarkBefore = before.graded.reduce((s, g) => s + g.maxPoints, 0);
    expect(fullMarkBefore).toBe(80); // 10 + 10 + 20×3 — 100 이 아니다
    expect(fullMarkBefore).not.toBe(100);

    // (2) 보정 후 — 지금 submitTestResult 가 쓰는 규칙(TestProblem.score 우선).
    const after = gradeAnswers(
      answers,
      rows.map((tp) => ({
        id: tp.problem.id,
        unitId: tp.problem.unitId,
        difficulty: tp.problem.difficulty,
        answer: tp.problem.answer,
        score: tp.problem.score ?? null,
        adjustedScore: tp.score ?? null,
      })),
    );
    expect(after.graded.reduce((s, g) => s + g.maxPoints, 0)).toBe(100);
  });

  it("조정 배점이 없는 기존 시험지의 채점은 바뀌지 않는다", () => {
    // 회귀 방지 — adjustedScore 를 넣은 것이 기존 시험지 결과를 흔들면 안 된다.
    const problems = [
      {
        id: "p1",
        unitId: UNIT_ID,
        difficulty: "mid" as const,
        answer: "1",
        score: 40,
      },
      {
        id: "p2",
        unitId: UNIT_ID,
        difficulty: "mid" as const,
        answer: "1",
        score: null,
      },
    ];
    const answers = problems.map((p, i) => ({
      problemId: p.id,
      selectedChoice: 1,
      essayScore: null,
      sequence: i + 1,
    }));

    const withField = gradeAnswers(
      answers,
      problems.map((p) => ({ ...p, adjustedScore: null })),
    );
    const withoutField = gradeAnswers(answers, problems);

    expect(withField).toEqual(withoutField);
    expect(withField.graded.map((g) => g.maxPoints)).toEqual([40, 50]);
  });
});
