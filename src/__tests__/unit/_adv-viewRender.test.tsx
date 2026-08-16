/**
 * 적대적 리뷰 ③ — 재현 전용. 파생 규칙과 실제 그려지는 글자를 찍는다.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { RoundDetail } from "@/components/exam/RoundDetail";
import { ROUND_JEONGHWA_ID } from "@/mocks/data/predictions";
import { toRoundSummary, type PredictionRunRow } from "@/lib/exam/composeRounds";
import {
  intervalGeometry,
  roundJudgement,
  sortRounds,
  stageViews,
  type ConfidenceBarColor,
} from "@/components/exam/viewModel";
import { confidenceBarColor } from "@/components/exam/viewModel";

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

function run(predictedScores: unknown[]): PredictionRunRow {
  return {
    id: "70000000-0000-4000-8000-0000000000d1",
    userId: "10000000-0000-4000-8000-000000000001",
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
    inputExamIds: ["e1", "e2", "e3", "e4"],
    predictedBlueprint: BLUEPRINT,
    predictedScores,
  };
}

function pred(studentId: string) {
  return {
    studentId,
    series: BLUEPRINT.series,
    period: BLUEPRINT.period,
    expectedScore: 80,
    interval: { lower: 72, upper: 88, coverage: 0.8 },
    byUnit: [],
    riskFlags: [],
  };
}

describe("[ADV-12] 4단계 띠의 '지금 할 일'", () => {
  it("문제지·채점이 영원히 미완이라 파란 점은 언제나 '문제지 만들기' 다", () => {
    const summary = toRoundSummary(
      run([
        pred("30000000-0000-4000-8000-000000000001"),
        pred("30000000-0000-4000-8000-000000000004"),
        pred("30000000-0000-4000-8000-000000000099"),
      ]),
      [
        {
          runId: "70000000-0000-4000-8000-0000000000d1",
          studentId: "30000000-0000-4000-8000-000000000001",
          actualScore: 91,
        },
        {
          runId: "70000000-0000-4000-8000-0000000000d1",
          studentId: "30000000-0000-4000-8000-000000000004",
          actualScore: 70,
        },
      ],
    )!;
    const judgement = roundJudgement(summary);
    const views = stageViews(summary.stages, judgement.available);

    console.log("[ADV-12] 원자료 =", JSON.stringify(summary.stages));
    console.log(
      "[ADV-12] 화면 표기 =",
      views.map((v) => `${v.state}:${v.label}`).join(" | "),
    );

    expect(views.find((v) => v.state === "current")!.key).toBe("paper");
    // composeRounds 가 계산한 실점수 진행률(2/3)은 어디에도 그려지지 않는다.
    expect(views.map((v) => v.label).join(" ")).not.toContain("2/3");
  });
});

describe("[ADV-13] 구간 막대는 60점 미만을 전부 한 점으로 뭉갠다", () => {
  it("30점 예측과 60점 예측의 기하가 완전히 같다", () => {
    const rows: Array<[string, unknown]> = [
      ["예상 40 · 구간 30~50", intervalGeometry({ lower: 30, upper: 50, coverage: 0.8 }, 40)],
      ["예상 55 · 구간 48~58", intervalGeometry({ lower: 48, upper: 58, coverage: 0.8 }, 55)],
      ["예상 60 · 구간 60~60", intervalGeometry({ lower: 60, upper: 60, coverage: 0.8 }, 60)],
      ["예상 88 · 구간 80~93", intervalGeometry({ lower: 80, upper: 93, coverage: 0.8 }, 88)],
    ];
    for (const [label, geo] of rows) {
      console.log("[ADV-13]", label, "→", JSON.stringify(geo));
    }
    expect(intervalGeometry({ lower: 30, upper: 50, coverage: 0.8 }, 40)).toEqual(
      intervalGeometry({ lower: 60, upper: 60, coverage: 0.8 }, 60),
    );
  });
});

describe("[ADV-14 · 해결됨] 시행일이 실리므로 정렬이 살아난다", () => {
  it("임박한 회차가 위로 온다 — 예전에는 전부 null 이라 입력 순서 그대로였다", () => {
    const base = toRoundSummary(run([]), [])!;
    const rounds = [
      { ...base, id: "먼것", examDate: "2026-10-02" },
      { ...base, id: "지난것", examDate: "2026-08-10" },
      { ...base, id: "임박", examDate: "2026-08-19" },
    ];
    const sorted = sortRounds(rounds, new Date("2026-08-16T00:00:00Z"));
    console.log("[ADV-14] 정렬 결과 =", sorted.map((r) => r.id).join(","));
    expect(sorted.map((r) => r.id)).toEqual(["임박", "먼것", "지난것"]);
  });
});

describe("[ADV-15] 신뢰도 미산출 회차의 인셋 바", () => {
  it("색 이름과 판정", () => {
    const cases: Array<[number | null, ConfidenceBarColor]> = [
      [null, confidenceBarColor(null)],
      [0.39, confidenceBarColor(0.39)],
      [0.4, confidenceBarColor(0.4)],
      [0.7, confidenceBarColor(0.7)],
    ];
    console.log("[ADV-15]", JSON.stringify(cases));
    expect(confidenceBarColor(null)).toBe("none");
  });
});

describe("[ADV-16] 표를 소리로 읽으면", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 15, 9, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("버튼 이름 · 미응시 행의 실측 칸 · 잔차 칸을 그대로 찍는다", async () => {
    render(<RoundDetail roundId={ROUND_JEONGHWA_ID} />);
    await screen.findByRole("rowheader", { name: "이서준" });

    const buttons = screen
      .getAllByRole("button")
      .map((b) => b.textContent ?? "");
    console.log("[ADV-16] 표의 버튼 접근이름 =", JSON.stringify(buttons));

    for (const name of ["이서준", "김하윤", "박지호", "최수아"]) {
      const row = screen
        .getByRole("rowheader", { name })
        .closest("tr") as HTMLElement;
      console.log(
        `[ADV-16] ${name} 행 =`,
        JSON.stringify(
          Array.from(row.querySelectorAll("td")).map((td) => td.textContent),
        ),
      );
    }

    const absent = screen
      .getByRole("rowheader", { name: "박지호" })
      .closest("tr") as HTMLElement;
    const cells = Array.from(absent.querySelectorAll("td"));
    console.log(
      "[ADV-16] 미응시 학생 실측 칸 =",
      JSON.stringify(cells[2]?.textContent),
    );
    expect(cells[2]?.textContent).toBe(""); // 빈칸이다
    expect(
      within(absent).queryByRole("button", { name: /실점수/ }),
    ).toBeNull();
  });
});
