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
  isRunOwnedBy,
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
const TEACHER = "10000000-0000-4000-8000-000000000001";
const OTHER_TEACHER = "10000000-0000-4000-8000-0000000000ff";

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
    userId: TEACHER,
    examDate: null,
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

describe("isRunOwnedBy — 소유자는 회차의 userId 다 (fail closed)", () => {
  it("내 회차면 보인다", () => {
    expect(isRunOwnedBy(run(), TEACHER)).toBe(true);
  });

  it("남의 회차면 안 보인다", () => {
    expect(isRunOwnedBy(run({ userId: OTHER_TEACHER }), TEACHER)).toBe(false);
  });

  it("🔴 학생별 예측이 비어 있어도 내 회차다 — 학생으로 되짚지 않는다", () => {
    // 실 엔진은 오늘 항상 이 모양을 저장한다. 학생으로 되짚던 시절 이 회차는
    // 목록에서 통째로 사라졌다(계기판이 영구히 빈 배열).
    expect(isRunOwnedBy(run({ predictedScores: [] }), TEACHER)).toBe(true);
  });

  it("🔴 남의 회차에 내 학생이 들어 있어도 내 회차가 아니다", () => {
    const row = run({
      userId: OTHER_TEACHER,
      predictedScores: [prediction(STUDENT_A, 88)],
    });
    expect(isRunOwnedBy(row, TEACHER)).toBe(false);
  });

  it("세션 id 가 빈 문자열이면 아무것도 안 보인다", () => {
    expect(isRunOwnedBy(run({ userId: "" }), "")).toBe(false);
  });
});

describe("toRoundSummary — 시행일", () => {
  it("🔴 exam_date 가 있으면 YYYY-MM-DD 로 낸다", () => {
    const summary = toRoundSummary(
      run({ examDate: new Date("2026-08-29T00:00:00.000Z") }),
      [],
    );
    expect(summary!.examDate).toBe("2026-08-29");
  });

  it("exam_date 가 NULL 이면 null 이다 — 대상 시점에서 지어내지 않는다", () => {
    expect(toRoundSummary(run({ examDate: null }), [])!.examDate).toBeNull();
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

const FOREIGN_STUDENT = "30000000-0000-4000-8000-000000000099";

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

  it("🔴 학생 표가 빈 이유 둘을 구분할 수 있게 예측 인원 수를 낸다", () => {
    // (a) 엔진이 개인 점수를 아직 못 냄 → 0
    const none = toRoundDetail(run({ predictedScores: [] }), [], owned);
    expect(none!.students).toEqual([]);
    expect(none!.predictedStudentCount).toBe(0);

    // (b) 예측은 냈는데 그 학생이 내 학생이 아님 → 0 이 아니다
    const foreign = toRoundDetail(
      run({ predictedScores: [prediction(FOREIGN_STUDENT, 71)] }),
      [],
      owned,
    );
    expect(foreign!.students).toEqual([]);
    expect(foreign!.predictedStudentCount).toBe(1);
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
