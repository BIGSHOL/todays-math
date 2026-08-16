/**
 * 🔴→🟢 T7.14 — DB 행 → 화면 계약 조합 규칙 (src/lib/exam/composeRounds.ts).
 *
 * 이 테스트가 있는 이유:
 * `PredictionRun.predictedScores` 와 `predictedBlueprint` 는 **Json 컬럼**이라 DB 가
 * 형태를 지켜 주지 않는다. 엔진 버전이 올라가면 모양이 바뀌고, 과거 행은 옛 모양으로 남는다.
 * 그때 조합기가 (a) 통째로 터지거나 (b) 검증 안 된 값을 그대로 흘리면 둘 다 사고다.
 * 여기서 정한 답은 **원소 단위로 버리고 나머지는 살린다**이다.
 *
 * 라우트를 거쳐서는 만들기 번거로운 "일부만 깨진 입력"을 여기서 직접 넣는다.
 */
import { describe, expect, it } from "vitest";

import {
  isRunVisibleTo,
  parseBlueprint,
  parsePredictedScores,
  runStudentIds,
  toRoundDetail,
  toRoundSummary,
  type PredictionRunRow,
} from "@/lib/exam/composeRounds";

const STUDENT_A = "30000000-0000-4000-8000-000000000001";
const STUDENT_B = "30000000-0000-4000-8000-000000000002";
const RUN_ID = "70000000-0000-4000-8000-0000000000f1";

function prediction(studentId: string | null, expectedScore: number) {
  return {
    studentId,
    series: { school: "정화중", level: "중", grade: 3, subject: "중3" },
    period: { year: 2025, semester: 2, round: "중간" },
    expectedScore,
    interval: {
      lower: expectedScore - 8,
      upper: expectedScore + 5,
      coverage: 0.8,
    },
    byUnit: [],
    riskFlags: [],
  };
}

function run(over: Partial<PredictionRunRow> = {}): PredictionRunRow {
  return {
    id: RUN_ID,
    createdAt: new Date("2026-08-16T00:00:00.000Z"),
    engineVersion: "0.5.0",
    school: "정화중",
    level: "중",
    grade: 3,
    subject: "중3",
    targetYear: 2025,
    targetSemester: 2,
    targetRound: "중간",
    inputExamIds: ["e1", "e2"],
    predictedBlueprint: null,
    predictedScores: [prediction(STUDENT_A, 88)],
    ...over,
  };
}

describe("parsePredictedScores", () => {
  it("계약에 맞는 원소만 남기고 깨진 원소는 버린다", () => {
    const parsed = parsePredictedScores([
      prediction(STUDENT_A, 88),
      { studentId: STUDENT_B, expectedScore: "일흔넷" }, // 깨진 행
      prediction(STUDENT_B, 74),
    ]);

    expect(parsed).toHaveLength(2);
    expect(parsed.map((p) => p.expectedScore)).toEqual([88, 74]);
  });

  it("배열이 아니면 빈 배열이다 — 던지지 않는다", () => {
    expect(parsePredictedScores(null)).toEqual([]);
    expect(parsePredictedScores({ oops: true })).toEqual([]);
  });
});

describe("parseBlueprint", () => {
  it("계약을 통과하지 못하면 null 이다 — 검증 안 된 숫자를 흘리지 않는다", () => {
    expect(
      parseBlueprint({ kind: "predicted", questionCount: "스물넷" }),
    ).toBeNull();
    expect(parseBlueprint(null)).toBeNull();
    expect(parseBlueprint(undefined)).toBeNull();
  });
});

describe("runStudentIds", () => {
  it("studentId 가 null 인 항목(시험지 평균 예측)은 학생으로 세지 않는다", () => {
    const row = run({
      predictedScores: [prediction(null, 68), prediction(STUDENT_A, 88)],
    });
    expect(runStudentIds(row)).toEqual([STUDENT_A]);
  });
});

describe("isRunVisibleTo — 소유권은 없는 쪽으로 닫는다", () => {
  it("내 학생이 하나라도 있으면 보인다", () => {
    expect(isRunVisibleTo(run(), [], new Set([STUDENT_A]))).toBe(true);
  });

  it("내 학생이 하나도 없으면 안 보인다", () => {
    expect(isRunVisibleTo(run(), [], new Set([STUDENT_B]))).toBe(false);
  });

  it("예측에는 없어도 실점수가 내 학생이면 보인다", () => {
    const row = run({ predictedScores: [] });
    const actuals = [{ runId: RUN_ID, studentId: STUDENT_B, actualScore: 61 }];
    expect(isRunVisibleTo(row, actuals, new Set([STUDENT_B]))).toBe(true);
  });

  it("소유 학생 집합이 비면 아무것도 안 보인다", () => {
    expect(isRunVisibleTo(run(), [], new Set())).toBe(false);
  });
});

describe("toRoundSummary", () => {
  it("학교급이 중/고가 아니면 회차를 만들지 않는다 — 억지로 그리지 않는다", () => {
    expect(toRoundSummary(run({ level: "초" }), [])).toBeNull();
  });

  it("학기가 1/2가 아니면 회차를 만들지 않는다", () => {
    expect(toRoundSummary(run({ targetSemester: 3 }), [])).toBeNull();
  });

  it("근거 회차 수는 inputExamIds 개수다", () => {
    const summary = toRoundSummary(run({ inputExamIds: ["a", "b", "c"] }), []);
    expect(summary!.evidenceCount).toBe(3);
  });

  it("실점수가 예측 학생 수를 채우면 실점수 단계가 완료된다", () => {
    const row = run({
      predictedScores: [prediction(STUDENT_A, 88), prediction(STUDENT_B, 74)],
    });
    const one = toRoundSummary(row, [
      { runId: RUN_ID, studentId: STUDENT_A, actualScore: 91 },
    ]);
    expect(one!.stages[3]).toEqual({
      key: "actual",
      done: false,
      progress: { current: 1, total: 2 },
    });

    const both = toRoundSummary(row, [
      { runId: RUN_ID, studentId: STUDENT_A, actualScore: 91 },
      { runId: RUN_ID, studentId: STUDENT_B, actualScore: 61 },
    ]);
    expect(both!.stages[3]!.done).toBe(true);
  });

  it("다른 회차의 실점수를 이 회차로 세지 않는다", () => {
    const summary = toRoundSummary(run(), [
      {
        runId: "70000000-0000-4000-8000-0000000000f9",
        studentId: STUDENT_A,
        actualScore: 91,
      },
    ]);
    expect(summary!.stages[3]!.progress).toEqual({ current: 0, total: 1 });
  });
});

describe("toRoundDetail", () => {
  const owned = [
    { id: STUDENT_A, name: "이서준" },
    { id: STUDENT_B, name: "김하윤" },
  ];

  it("예측에 없고 실점수만 있는 학생도 버리지 않는다", () => {
    const row = run({ predictedScores: [prediction(STUDENT_A, 88)] });
    const detail = toRoundDetail(
      row,
      [{ runId: RUN_ID, studentId: STUDENT_B, actualScore: 61 }],
      owned,
    );

    const byName = Object.fromEntries(
      detail!.students.map((s) => [s.studentName, s]),
    );
    expect(byName["김하윤"]!.prediction).toBeNull();
    expect(byName["김하윤"]!.actualScore).toBe(61);
  });

  it("응시 여부 원천이 없으므로 아무도 '미응시'로 단정하지 않는다", () => {
    const detail = toRoundDetail(run(), [], owned);
    expect(detail!.students.every((s) => s.absent === false)).toBe(true);
  });

  it("같은 학생이 예측에 두 번 들어와도 행이 한 번만 생긴다", () => {
    const row = run({
      predictedScores: [prediction(STUDENT_A, 88), prediction(STUDENT_A, 90)],
    });
    const detail = toRoundDetail(row, [], owned);
    expect(detail!.students).toHaveLength(1);
    expect(detail!.students[0]!.prediction!.expectedScore).toBe(88);
  });
});
