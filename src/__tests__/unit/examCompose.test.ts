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
  type OwnedStudent,
  type PredictionRunRow,
} from "@/lib/exam/composeRounds";

const STUDENT_A = "30000000-0000-4000-8000-000000000001";
const STUDENT_B = "30000000-0000-4000-8000-000000000002";
const RUN_ID = "70000000-0000-4000-8000-0000000000f1";
const OWNER = "10000000-0000-4000-8000-00000000000a";
const OTHER_OWNER = "10000000-0000-4000-8000-00000000000b";

/** 재학 정보를 모르는 학생 — 실데이터의 기본 상태다(채우는 화면이 아직 없다). */
function student(id: string, name: string, over: Partial<OwnedStudent> = {}): OwnedStudent {
  return { id, name, schoolName: null, schoolLevel: null, schoolGrade: null, ...over };
}

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
    userId: OWNER,
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

describe("isRunVisibleTo — 판정 근거는 PredictionRun.userId 하나다", () => {
  it("내가 만든 회차는 보인다", () => {
    expect(isRunVisibleTo(run(), OWNER)).toBe(true);
  });

  it("남이 만든 회차는 안 보인다", () => {
    expect(isRunVisibleTo(run({ userId: OTHER_OWNER }), OWNER)).toBe(false);
  });

  /**
   * 🔴 회귀 가드 (adv-보정루프.md 🔴1).
   * 예측값이 비어 있어도 **내 회차는 내 계기판에 떠야 한다.** 예전에는 가시성을
   * `predictedScores` 안의 학생으로 판정해서, 학생 능력 엔진이 없는 지금은
   * 원장 본인의 새 회차가 통째로 사라졌다.
   */
  it("예측값이 비어 있어도 내 회차는 보인다", () => {
    expect(isRunVisibleTo(run({ predictedScores: [] }), OWNER)).toBe(true);
  });
});

describe("toRoundSummary", () => {
  const roster = [student(STUDENT_A, "이서준"), student(STUDENT_B, "김하윤")];

  it("학교급이 중/고가 아니면 회차를 만들지 않는다 — 억지로 그리지 않는다", () => {
    expect(toRoundSummary(run({ level: "초" }), [], roster)).toBeNull();
  });

  it("학기가 1/2가 아니면 회차를 만들지 않는다", () => {
    expect(toRoundSummary(run({ targetSemester: 3 }), [], roster)).toBeNull();
  });

  it("근거 회차 수는 inputExamIds 개수다", () => {
    const summary = toRoundSummary(
      run({ inputExamIds: ["a", "b", "c"] }),
      [],
      roster,
    );
    expect(summary!.evidenceCount).toBe(3);
  });

  /**
   * 실점수 단계의 분모는 **응시 명단**이지 예측 학생 수가 아니다.
   * 예측이 없으면 분모가 0 이 되어 "0/0 완료"처럼 보이던 자리다.
   */
  it("실점수가 응시 명단을 채우면 실점수 단계가 완료된다", () => {
    const row = run({ predictedScores: [] });
    const one = toRoundSummary(
      row,
      [{ runId: RUN_ID, studentId: STUDENT_A, actualScore: 91 }],
      roster,
    );
    expect(one!.stages[3]).toEqual({
      key: "actual",
      done: false,
      progress: { current: 1, total: 2 },
    });

    const both = toRoundSummary(
      row,
      [
        { runId: RUN_ID, studentId: STUDENT_A, actualScore: 91 },
        { runId: RUN_ID, studentId: STUDENT_B, actualScore: 61 },
      ],
      roster,
    );
    expect(both!.stages[3]!.done).toBe(true);
  });

  it("다른 학교 학생은 분모에 들어가지 않는다", () => {
    const summary = toRoundSummary(run(), [], [
      student(STUDENT_A, "이서준", { schoolName: "정화중" }),
      student(STUDENT_B, "김하윤", { schoolName: "가람중" }),
    ]);
    expect(summary!.stages[3]!.progress).toEqual({ current: 0, total: 1 });
  });

  it("다른 회차의 실점수를 이 회차로 세지 않는다", () => {
    const summary = toRoundSummary(
      run(),
      [
        {
          runId: "70000000-0000-4000-8000-0000000000f9",
          studentId: STUDENT_A,
          actualScore: 91,
        },
      ],
      [student(STUDENT_A, "이서준")],
    );
    expect(summary!.stages[3]!.progress).toEqual({ current: 0, total: 1 });
  });
});

describe("toRoundDetail", () => {
  const owned = [student(STUDENT_A, "이서준"), student(STUDENT_B, "김하윤")];

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
    // 중복 판정만 보려고 명단을 한 명으로 좁힌다.
    const detail = toRoundDetail(row, [], [student(STUDENT_A, "이서준")]);
    expect(detail!.students).toHaveLength(1);
    expect(detail!.students[0]!.prediction!.expectedScore).toBe(88);
  });

  /**
   * 🔴 회귀 가드 (adv-보정루프.md 🔴1).
   * 학생 능력 엔진(11 §3 L3)이 없어 `predictedScores` 는 항상 빈 배열이다. 그래도
   * **점수를 넣을 학생 행은 나와야 한다.** 예전에는 예측에 있는 학생만 실었기 때문에
   * 상세 화면에 학생이 한 명도 뜨지 않았고, 보정 루프의 입력구가 통째로 닫혀 있었다.
   */
  it("예측이 하나도 없어도 내 학생 행이 나온다 — 점수를 넣을 자리가 있어야 한다", () => {
    const detail = toRoundDetail(run({ predictedScores: [] }), [], owned);
    expect(detail!.students).toHaveLength(2);
    expect(detail!.students.every((s) => s.prediction === null)).toBe(true);
    expect(detail!.students.every((s) => s.actualScore === null)).toBe(true);
  });

  it("다른 학교·학년 학생은 명단에서 뺀다", () => {
    const detail = toRoundDetail(run({ predictedScores: [] }), [], [
      student(STUDENT_A, "이서준", { schoolName: "정화중", schoolGrade: 3 }),
      student(STUDENT_B, "김하윤", { schoolName: "정화중", schoolGrade: 1 }),
    ]);
    expect(detail!.students.map((s) => s.studentName)).toEqual(["이서준"]);
  });

  /**
   * 명단 규칙이 나중에 좁아져도(원장이 학생의 학교를 뒤늦게 고쳐도) **이미 넣은 점수를
   * 감추지 않는다.** 감추면 원장은 점수가 지워진 줄 안다.
   */
  it("명단에서 빠진 학생이라도 실점수가 있으면 계속 보인다", () => {
    const detail = toRoundDetail(
      run({ predictedScores: [] }),
      [{ runId: RUN_ID, studentId: STUDENT_B, actualScore: 61 }],
      [
        student(STUDENT_A, "이서준", { schoolName: "정화중" }),
        student(STUDENT_B, "김하윤", { schoolName: "가람중" }),
      ],
    );
    const byName = Object.fromEntries(
      detail!.students.map((s) => [s.studentName, s]),
    );
    expect(byName["김하윤"]!.actualScore).toBe(61);
  });
});
