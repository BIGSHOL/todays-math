/**
 * 적대적 재현 — 원장 수동 배점 조정(PATCH /api/tests/{id}/scores).
 * 읽기 전용 조사용. 기존 파일은 건드리지 않는다.
 */
import { describe, expect, it } from "vitest";

import type { PredictedPaper } from "@/contracts/scoreNormalizer.contract";
import { db } from "@/lib/db";
import {
  persistPredictedPaper,
  saveManualScores,
} from "@/lib/predictor/persistPredictedPaper";
import { validateManualScores } from "@/lib/predictor/scoreNormalizer";
import {
  MOCK_CLASSES,
  MOCK_PROBLEMS,
  MOCK_UNITS,
  TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID,
  TEST_RESULT_PROBLEM_OBJECTIVE_WRONG_ID,
  USER_TEACHER_ID,
} from "@/mocks/data";

const CLASS_ID = MOCK_CLASSES[0]!.id;
const UNIT_ID = MOCK_UNITS[0]!.id;
const IDS = [
  TEST_RESULT_PROBLEM_OBJECTIVE_CORRECT_ID,
  TEST_RESULT_PROBLEM_OBJECTIVE_WRONG_ID,
  MOCK_PROBLEMS[0]!.id,
  MOCK_PROBLEMS[1]!.id,
  MOCK_PROBLEMS[2]!.id,
];

function paper(scores: number[]): PredictedPaper {
  return {
    ok: true,
    series: { school: "대구여고", level: "고", grade: 2, subject: "수2" },
    period: { year: 2025, semester: 2, round: "기말" },
    questions: scores.map((score, i) => ({
      orderIndex: i + 1,
      problemId: IDS[i]!,
      unitId: UNIT_ID,
      difficulty: "mid" as const,
      qtype: "객관식" as const,
      originalScore: null,
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

async function seedTest() {
  const created = await persistPredictedPaper({
    userId: USER_TEACHER_ID,
    classId: CLASS_ID,
    testDate: "2026-09-01",
    rangeEndUnitId: UNIT_ID,
    paper: paper([20, 20, 20, 20, 20]),
  });
  if (!created.ok) throw new Error("픽스처 적재 실패");
  return created.testId;
}

describe("[적대] 수동 조정 — 같은 orderIndex 를 두 번 보낸다", () => {
  it("거부하고 한 행도 건드리지 않는다 (2026-08-16 수리)", async () => {
    const testId = await seedTest();

    // 5문항 시험지. orderIndex 1 을 세 번, 4·5 는 아예 안 보낸다.
    // 개수(5) 는 맞고, 모든 orderIndex 가 시험지에 존재하고, 합계는 정확히 100.
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

    // 수리 전: ok=true · totalScore 100 을 돌려주고 DB 만점은 90 이었다.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("문항_불일치");
    expect(result.detail).toContain("1");

    const rows = await db.testProblem.findMany({
      where: { testId },
      orderBy: { orderIndex: "asc" },
    });
    const stored = rows.map((r) => r.score);
    const storedTotal = stored.reduce<number>((a, b) => a + (b ?? 0), 0);

    console.log("저장된 배점:", stored, "실제 만점:", storedTotal);

    // 적재 당시 값 그대로 — 반만 쓰인 시험지를 남기지 않는다.
    expect(stored).toEqual([20, 20, 20, 20, 20]);
    expect(storedTotal).toBe(100);
  });
});

describe("[적대] validateManualScores 자체의 구멍", () => {
  it("같은 번호를 여러 번 세어 100 을 만들지 못한다 (2026-08-16 수리)", () => {
    const check = validateManualScores([
      { number: 1, score: 50 },
      { number: 1, score: 50 },
    ]);
    // 수리 전: ok=true (같은 문항을 두 번 세어 합계 100 을 통과시켰다)
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.issue).toBe("문항_중복");
    expect(check.message).toContain("1번");
  });
});
