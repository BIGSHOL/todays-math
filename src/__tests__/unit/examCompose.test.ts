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
const OWNER = "90000000-0000-4000-8000-00000000000a";
const OTHER = "90000000-0000-4000-8000-00000000000b";

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

/** 실제 저장 모양과 같은 청사진 Json. 계약을 통과하는 최소 형태다. */
const BLUEPRINT = {
  kind: "predicted",
  series: { school: "정화중", level: "중", grade: 3, subject: "중3" },
  period: { year: 2025, semester: 2, round: "중간" },
  questionCount: 24,
  totalScore: 100,
  typeMix: {
    객관식: { count: 18, score: 66 },
    단답형: { count: 2, score: 8 },
    서술형: { count: 4, score: 26 },
  },
  difficultyMix: {
    하: { count: 9, score: 30 },
    중: { count: 11, score: 44 },
    상: { count: 4, score: 26 },
    미표기: { count: 0, score: 0 },
  },
  scoreHistogram: [],
  positionCurve: [],
  unitMix: [{ unitId: null, topicRaw: "이차방정식", count: 24, score: 100 }],
  expectedMean: 68.4,
  expectedMeanInterval: { lower: 61, upper: 76, coverage: 0.8 },
  evidenceCount: 4,
  confidence: 0.62,
};

function run(over: Partial<PredictionRunRow> = {}): PredictionRunRow {
  return {
    id: RUN_ID,
    userId: OWNER,
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

describe("🔴 회귀 — 예측 점수가 비어도 내 회차는 보여야 한다", () => {
  /**
   * 실제로 터진 버그다. `PredictionRun.predictedScores` 는 **지금 항상 빈 배열**이다
   * (학생 개인 점수는 능력 추정·환산 계수가 없어 아직 못 낸다 — T7.7 보고 §3-C).
   * 그런데 회차 노출 판정이 "그 회차 예측에 내 학생이 있는가"였다. 둘을 겹치면
   * **원장이 예측을 실행해도 계기판에 아무것도 안 뜬다** — 기능이 통째로 죽은 것처럼 보인다.
   *
   * 소유자 컬럼(`PredictionRun.userId`)이 생겼으니 소유권은 그걸로 판정한다.
   */
  it("내가 만든 회차는 예측 점수가 0건이어도 보인다", () => {
    const row = run({ predictedScores: [], userId: OWNER });
    expect(isRunVisibleTo(row, OWNER)).toBe(true);
  });

  it("남이 만든 회차는 보이지 않는다", () => {
    const row = run({
      predictedScores: [prediction(STUDENT_A, 88)],
      userId: OTHER,
    });
    expect(isRunVisibleTo(row, OWNER)).toBe(false);
  });
});

describe("isRunVisibleTo — 소유권은 없는 쪽으로 닫는다", () => {
  /**
   * 예전 규칙("그 회차 예측에 내 학생이 하나라도 있으면 내 것")은 소유자 컬럼이 없던
   * 시절의 우회였고, 위 회귀 절이 보여주듯 실제로는 기능을 죽였다. 지금은 소유자를
   * 곧장 본다 — 학생이 반을 옮기거나 졸업해도 과거 회차가 사라지지 않는다.
   */
  it("내 회차는 보인다", () => {
    expect(isRunVisibleTo(run({ userId: OWNER }), OWNER)).toBe(true);
  });

  it("남의 회차는 안 보인다 — 학생이 겹쳐 보여도 마찬가지다", () => {
    const row = run({
      userId: OTHER,
      predictedScores: [prediction(STUDENT_A, 88)],
    });
    expect(isRunVisibleTo(row, OWNER)).toBe(false);
  });

  it("소유자를 알 수 없으면 안 보인다 — 없는 쪽으로 닫는다", () => {
    expect(isRunVisibleTo(run({ userId: "" }), OWNER)).toBe(false);
    expect(isRunVisibleTo(run({ userId: OWNER }), "")).toBe(false);
  });
});

describe("🔴 파이프라인 문제지·채점 단계 — FK 가 생겨 실데이터 판정이 된다 (15 §B)", () => {
  /**
   * 예전에는 이 두 단계가 "데이터 원천이 없어 항상 미완"이었다(스키마에 담을 자리가
   * 없었다). `Test.predictionRunId` 가 생겨 이제 판정할 수 있다:
   *   문제지 = 이 회차에 연결된 시험지가 존재  ·  채점 = 그 시험지에 채점 결과가 존재
   */
  it("연결된 시험지가 없으면 문제지·채점 둘 다 미완이다", () => {
    const summary = toRoundSummary(run(), [], []);
    expect(summary!.stages[1]).toMatchObject({ key: "paper", done: false });
    expect(summary!.stages[2]).toMatchObject({ key: "grading", done: false });
  });

  it("시험지가 연결되면 문제지 단계가 완료된다", () => {
    const summary = toRoundSummary(
      run(),
      [],
      [{ id: "t1", predictionRunId: RUN_ID, graded: false }],
    );
    expect(summary!.stages[1]).toMatchObject({ key: "paper", done: true });
    expect(summary!.stages[2]).toMatchObject({ key: "grading", done: false });
  });

  it("연결된 시험지에 채점 결과가 있으면 채점 단계도 완료된다", () => {
    const summary = toRoundSummary(
      run(),
      [],
      [{ id: "t1", predictionRunId: RUN_ID, graded: true }],
    );
    expect(summary!.stages[2]).toMatchObject({ key: "grading", done: true });
  });

  it("🔴 다른 회차의 시험지는 세지 않는다", () => {
    const summary = toRoundSummary(
      run(),
      [],
      [
        {
          id: "t9",
          predictionRunId: "99999999-0000-4000-8000-000000000000",
          graded: true,
        },
      ],
    );
    expect(summary!.stages[1]).toMatchObject({ done: false });
  });
});

describe("🔴 화면이 거짓말하지 않는가 — 근거 수 · 시행일", () => {
  /**
   * 적대적 리뷰가 잡은 둘. 화면이 원장님께 **틀린 사실**을 말하고 있었다.
   *
   * 1) `근거 5회차` 의 4편이 남의 학교 시험지였다. 화면이 `inputExamIds.length` 를 썼는데
   *    그 목록에는 코호트(다른 학교)가 함께 들어간다. 엔진이 세는 근거
   *    (`blueprint.evidenceCount = 그 학교 과거 편수`)와 다른 수다.
   *    그래서 우리 학교 기출 1편만 있어도 "근거 5회차"로 보이고 `MIN_EVIDENCE_ROUNDS = 2`
   *    가드가 통째로 무력해진다 — 근거 없는 확신을 막으려고 만든 문턱인데.
   *
   * 2) 원장님이 넣으신 시행일(`examDate`)이 컬럼에 있는데 화면은 늘 "일정 미정"이라 했다.
   */
  it("근거 회차 수는 **그 학교 과거 편수**다 — 코호트를 함께 세지 않는다", () => {
    const row = run({
      // 근거로 쓴 시험지는 5편이지만, 그중 우리 학교는 1편뿐이다.
      inputExamIds: ["우리-1", "남의-1", "남의-2", "남의-3", "남의-4"],
      predictedBlueprint: { ...BLUEPRINT, evidenceCount: 1 },
    });
    expect(toRoundSummary(row, [])!.evidenceCount).toBe(1);
  });

  it("청사진이 없으면 근거를 0으로 본다 — 지어내지 않는다", () => {
    const row = run({
      inputExamIds: ["a", "b", "c"],
      predictedBlueprint: null,
    });
    expect(toRoundSummary(row, [])!.evidenceCount).toBe(0);
  });

  it("시행일이 있으면 그대로 낸다 — 원장님이 넣은 값을 '모른다'고 하지 않는다", () => {
    const row = run({ examDate: new Date("2026-08-29T00:00:00.000Z") });
    expect(toRoundSummary(row, [])!.examDate).toBe("2026-08-29");
  });

  it("시행일이 없으면 null 이다 — 그럴듯한 날짜를 만들지 않는다", () => {
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

  /**
   * ⚠️ 예전에는 `inputExamIds` 개수를 근거 수로 냈다. 그 목록에는 **코호트(다른 학교)** 가
   * 함께 들어가서, 우리 학교 기출이 1편뿐이어도 "근거 5회차"로 보였다.
   * 근거 없는 확신을 막으려던 문턱이 그 수 때문에 무력해졌다 — 위 회귀 절 참조.
   */
  it("근거 회차 수는 inputExamIds 개수가 **아니다** — 청사진이 세는 값을 쓴다", () => {
    const summary = toRoundSummary(
      run({
        inputExamIds: ["a", "b", "c"],
        predictedBlueprint: { ...BLUEPRINT, evidenceCount: 2 },
      }),
      [],
    );
    expect(summary!.evidenceCount).toBe(2);
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
