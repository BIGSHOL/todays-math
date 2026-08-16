/**
 * 🔴 RED — T7.14 '오늘의 시험' 화면 파생 규칙 (순수 함수).
 *
 * 이 테스트가 있는 이유:
 * 이 화면의 가장 큰 위험은 "근거 없는 확신"이다. 예측기는 과거 회차가 적으면 못 맞히는데
 * (11 §8: 근거 1편 문항수 MAE 1.362 → 4편+ 1.079), 화면이 그 사실을 숨기고 숫자만 크게
 * 띄우면 원장님이 틀린 숫자를 믿고 학생에게 말한다. 그래서 "언제 숫자를 내지 않는가"를
 * 컴포넌트가 아니라 **순수 함수로 못박고** 여기서 먼저 검증한다.
 *
 * 화면 색·라벨은 렌더 코드에 흩어지기 쉬우므로 파생 규칙(신뢰도 단계·단계 라벨·잔차·구간
 * 막대 좌표)도 전부 여기로 모았다. 05 §8.7 Hi-fi(D-42)의 좌표값을 그대로 회귀 기준으로 쓴다.
 */
import { describe, expect, it } from "vitest";

import type {
  ExamRoundSummary,
  ExamStageState,
  ExamStudentRow,
} from "@/components/exam/examScreen.contract";
import {
  CONFIDENCE_HIGH,
  CONFIDENCE_MID,
  INTERVAL_SCALE_MAX,
  INTERVAL_SCALE_MIN,
  MIN_EVIDENCE_ROUNDS,
  confidenceText,
  confidenceTier,
  ddayLabel,
  difficultyMixText,
  intervalGeometry,
  residualView,
  roundJudgement,
  sortRounds,
  stageViews,
  studentJudgement,
  typeMixText,
  unitMixText,
} from "@/components/exam/viewModel";
import type { Blueprint } from "@/contracts/predictor.contract";

const SERIES = {
  school: "정화중",
  level: "중" as const,
  grade: 3,
  subject: "중3",
};
const PERIOD = { year: 2025, semester: 2 as const, round: "중간" as const };

function stages(done: [boolean, boolean, boolean, boolean]): ExamStageState[] {
  return [
    { key: "blueprint", done: done[0], progress: null },
    { key: "paper", done: done[1], progress: null },
    { key: "grading", done: done[2], progress: null },
    { key: "actual", done: done[3], progress: null },
  ];
}

function summary(over: Partial<ExamRoundSummary> = {}): ExamRoundSummary {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    series: SERIES,
    period: PERIOD,
    examDate: "2026-08-29",
    stages: stages([true, true, false, false]),
    evidenceCount: 4,
    confidence: 0.62,
    ...over,
  };
}

function blueprint(over: Partial<Blueprint> = {}): Blueprint {
  return {
    kind: "predicted",
    series: SERIES,
    period: PERIOD,
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
    unitMix: [
      { unitId: null, topicRaw: "이차방정식", count: 8, score: 34 },
      { unitId: null, topicRaw: "이차함수의 그래프", count: 5, score: 22 },
      { unitId: null, topicRaw: "제곱근과 실수", count: 4, score: 16 },
    ],
    expectedMean: 68.4,
    expectedMeanInterval: { lower: 61, upper: 76, coverage: 0.8 },
    evidenceCount: 4,
    confidence: 0.62,
    ...over,
  };
}

// ── D-day ────────────────────────────────────────────────
describe("ddayLabel", () => {
  const today = new Date(2026, 7, 15); // 2026-08-15 (로컬)

  it("남은 날짜를 D-N 으로 적는다", () => {
    expect(ddayLabel("2026-08-29", today)).toBe("D-14");
    expect(ddayLabel("2026-09-05", today)).toBe("D-21");
  });

  it("당일은 D-DAY, 지난 날짜는 D+N", () => {
    expect(ddayLabel("2026-08-15", today)).toBe("D-DAY");
    expect(ddayLabel("2026-08-10", today)).toBe("D+5");
  });

  it("시험일이 없으면 D-day 를 지어내지 않고 null 을 낸다", () => {
    expect(ddayLabel(null, today)).toBeNull();
  });
});

// ── 신뢰도 ───────────────────────────────────────────────
describe("confidenceTier", () => {
  it("Hi-fi 시안의 세 회차가 각각 높음/보통/낮음으로 갈린다", () => {
    expect(confidenceTier(0.81)).toBe("high");
    expect(confidenceTier(0.62)).toBe("mid");
    expect(confidenceTier(0.18)).toBe("low");
  });

  it("경계값은 포함 쪽으로 붙는다", () => {
    expect(confidenceTier(CONFIDENCE_HIGH)).toBe("high");
    expect(confidenceTier(CONFIDENCE_MID)).toBe("mid");
    expect(confidenceTier(CONFIDENCE_MID - 0.001)).toBe("low");
  });

  it("신뢰도가 없으면 0 이 아니라 unknown 이다", () => {
    expect(confidenceTier(null)).toBe("unknown");
  });
});

describe("confidenceText — 색만으로 전달하지 않는다 (D-42)", () => {
  it("단계를 말로 병기하고 숫자를 함께 적는다", () => {
    expect(confidenceText(0.81)).toBe("신뢰도 높음 0.81");
    expect(confidenceText(0.62)).toBe("신뢰도 보통 0.62");
  });

  it("미산출은 숫자를 지어내지 않는다", () => {
    expect(confidenceText(null)).toBe("신뢰도 미산출");
  });
});

// ── 판정 가능 여부 — 이 화면의 핵심 계약 ────────────────
describe("roundJudgement", () => {
  it("근거 회차와 신뢰도가 모두 충분하면 숫자를 낸다", () => {
    expect(roundJudgement(summary())).toEqual({
      available: true,
      reason: null,
    });
  });

  it("근거 회차가 부족하면 예측 불가다 (Hi-fi 03행: 1회차)", () => {
    expect(
      roundJudgement(summary({ evidenceCount: 1, confidence: 0.18 })),
    ).toEqual({ available: false, reason: "근거 부족" });
  });

  it("근거가 넉넉해도 신뢰도가 낮으면 숫자를 내지 않는다", () => {
    expect(
      roundJudgement(summary({ evidenceCount: 8, confidence: 0.2 })),
    ).toEqual({ available: false, reason: "신뢰도 낮음" });
  });

  it("신뢰도가 아직 없으면 예측 불가다 — 0 으로 갈음하지 않는다", () => {
    expect(
      roundJudgement(summary({ evidenceCount: 5, confidence: null })),
    ).toEqual({ available: false, reason: "신뢰도 미산출" });
  });

  it("최소 근거 회차 상수는 2회차다", () => {
    expect(MIN_EVIDENCE_ROUNDS).toBe(2);
    expect(
      roundJudgement(summary({ evidenceCount: MIN_EVIDENCE_ROUNDS })).available,
    ).toBe(true);
  });
});

// ── 4단계 파이프라인 ─────────────────────────────────────
describe("stageViews", () => {
  it("끝난 단계 뒤 첫 미완 단계가 '지금 할 일'이 된다", () => {
    const views = stageViews(stages([true, true, false, false]), true);
    expect(views.map((v) => v.state)).toEqual([
      "done",
      "done",
      "current",
      "waiting",
    ]);
    expect(views.map((v) => v.label)).toEqual([
      "청사진",
      "문제지",
      "채점 시작",
      "실점수 대기",
    ]);
  });

  it("채점은 진행 수를 라벨에 싣는다 (Hi-fi '채점 3/12')", () => {
    const withProgress = stages([true, true, false, false]);
    withProgress[2] = {
      key: "grading",
      done: false,
      progress: { current: 3, total: 12 },
    };
    expect(stageViews(withProgress, true)[2]).toEqual({
      key: "grading",
      label: "채점 3/12",
      state: "current",
    });
  });

  it("예측 불가 회차는 '지금 할 일'을 지정하지 않는다 — 권장하지 않기 때문", () => {
    const views = stageViews(stages([false, false, false, false]), false);
    expect(views.every((v) => v.state === "waiting")).toBe(true);
    // 아무것도 시작하지 않았으면 '대기'를 덧붙이지 않고 이름만 적는다 (Hi-fi 03행).
    expect(views.map((v) => v.label)).toEqual([
      "청사진",
      "문제지",
      "채점",
      "실점수",
    ]);
  });

  it("전부 끝나면 현재 단계가 없다", () => {
    const views = stageViews(stages([true, true, true, true]), true);
    expect(views.every((v) => v.state === "done")).toBe(true);
  });
});

// ── 예측 구간 막대 (D-40 구간 표기 · D-42 연속 막대) ─────
describe("intervalGeometry", () => {
  it("Hi-fi 시안의 좌표를 그대로 낸다 (60~100 눈금)", () => {
    expect(INTERVAL_SCALE_MIN).toBe(60);
    expect(INTERVAL_SCALE_MAX).toBe(100);
    expect(
      intervalGeometry({ lower: 80, upper: 93, coverage: 0.8 }, 88),
    ).toEqual({ leftPct: 50, widthPct: 32.5, pointPct: 70 });
    expect(
      intervalGeometry({ lower: 66, upper: 82, coverage: 0.8 }, 74),
    ).toEqual({ leftPct: 15, widthPct: 40, pointPct: 35 });
  });

  it("눈금 아래로 내려가는 구간은 잘라서 그린다", () => {
    const geo = intervalGeometry({ lower: 40, upper: 70, coverage: 0.8 }, 55);
    expect(geo.leftPct).toBe(0);
    expect(geo.widthPct).toBe(25);
    expect(geo.pointPct).toBe(0);
  });
});

// ── 잔차 (D-42) ──────────────────────────────────────────
describe("residualView", () => {
  const interval = { lower: 80, upper: 93, coverage: 0.8 };

  it("구간 안이면 적중이라고 말로 적는다", () => {
    expect(residualView(88, interval, 91)).toEqual({
      hit: true,
      text: "+3 적중",
    });
  });

  it("구간 밖이면 빗나감이라고 말로 적는다", () => {
    expect(
      residualView(74, { lower: 66, upper: 82, coverage: 0.8 }, 61),
    ).toEqual({ hit: false, text: "−13 빗나감" });
  });

  it("경계값은 적중으로 센다 — 구간 적중률의 정의와 맞춘다", () => {
    expect(residualView(88, interval, 80)?.hit).toBe(true);
    expect(residualView(88, interval, 93)?.hit).toBe(true);
  });

  it("실점수가 없으면 잔차를 만들지 않는다", () => {
    expect(residualView(88, interval, null)).toBeNull();
  });
});

// ── 학생 단위 판정 ───────────────────────────────────────
describe("studentJudgement", () => {
  const base: ExamStudentRow = {
    studentId: "30000000-0000-4000-8000-000000000001",
    studentName: "이서준",
    prediction: {
      studentId: "30000000-0000-4000-8000-000000000001",
      series: SERIES,
      period: PERIOD,
      expectedScore: 88,
      interval: { lower: 80, upper: 93, coverage: 0.8 },
      byUnit: [],
      riskFlags: [],
    },
    actualScore: null,
    absent: false,
  };

  it("회차 판정이 되고 위험 신호가 없으면 숫자를 낸다", () => {
    expect(studentJudgement(base, true)).toEqual({
      available: true,
      reason: null,
    });
  });

  it("미응시 학생은 예측을 내지 않는다", () => {
    expect(studentJudgement({ ...base, absent: true }, true)).toEqual({
      available: false,
      reason: "미응시",
    });
  });

  it("응답 표본이 부족한 학생은 숫자를 내지 않는다 (riskFlags)", () => {
    const row: ExamStudentRow = {
      ...base,
      prediction: { ...base.prediction!, riskFlags: ["학생응답_부족"] },
    };
    expect(studentJudgement(row, true)).toEqual({
      available: false,
      reason: "응답 부족",
    });
  });

  it("회차 자체가 예측 불가면 학생 숫자도 내지 않는다", () => {
    expect(studentJudgement(base, false)).toEqual({
      available: false,
      reason: "근거 부족",
    });
  });

  it("예측이 아예 없으면 예측 없음이다", () => {
    expect(studentJudgement({ ...base, prediction: null }, true)).toEqual({
      available: false,
      reason: "예측 없음",
    });
  });
});

// ── 청사진 요약 문장 ─────────────────────────────────────
describe("청사진 배분 요약", () => {
  it("유형 배분을 Hi-fi 표기로 줄여 적는다", () => {
    expect(typeMixText(blueprint())).toBe("객18 단2 서4");
  });

  it("난이도 배분을 적고, 미표기 문항이 있으면 숨기지 않는다", () => {
    expect(difficultyMixText(blueprint())).toBe("하9 중11 상4");
    const withUnlabeled = blueprint({
      difficultyMix: {
        하: { count: 7, score: 24 },
        중: { count: 12, score: 45 },
        상: { count: 4, score: 21 },
        미표기: { count: 2, score: 10 },
      },
    });
    expect(difficultyMixText(withUnlabeled)).toBe("하7 중12 상4 미표기2");
  });

  it("단원 배분은 문항 수가 많은 순으로 상위만 적는다", () => {
    expect(unitMixText(blueprint(), 2)).toBe("이차방정식8 이차함수의 그래프5");
  });

  it("단원 표기가 없으면 '단원 미상'으로 적는다 — 빈칸으로 두지 않는다", () => {
    const bp = blueprint({
      unitMix: [{ unitId: null, topicRaw: null, count: 3, score: 12 }],
    });
    expect(unitMixText(bp, 2)).toBe("단원 미상3");
  });
});

// ── 정렬 — 다가오는 시험이 먼저 ──────────────────────────
describe("sortRounds", () => {
  const today = new Date(2026, 7, 15);

  it("다가오는 회차를 가까운 순으로, 지난 회차를 그 뒤에 최근 순으로 세운다", () => {
    const rows = [
      summary({
        id: "70000000-0000-4000-8000-00000000000a",
        examDate: "2026-08-10",
      }),
      summary({
        id: "70000000-0000-4000-8000-00000000000b",
        examDate: "2026-09-05",
      }),
      summary({
        id: "70000000-0000-4000-8000-00000000000c",
        examDate: "2026-08-29",
      }),
      summary({
        id: "70000000-0000-4000-8000-00000000000d",
        examDate: null,
      }),
    ];
    expect(sortRounds(rows, today).map((r) => r.examDate)).toEqual([
      "2026-08-29",
      "2026-09-05",
      "2026-08-10",
      null,
    ]);
  });
});
