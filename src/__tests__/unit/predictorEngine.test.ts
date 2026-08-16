// T2 — 학교 패턴 엔진 + backtest 하네스.
//
// 설계 근거는 docs/planning/11-score-predictor.md §2.2·§2.7.
// 예측 대상은 실측으로 근거가 확인된 항목뿐이다 — 문항 수·유형 배분·배점 눈금·단원 배분.
// 난이도는 학교별로 예측하지 않고 코호트(학교급×학년×과목) 평균을 쓴다(§2.3, §2.7).
//
// 가장 중요한 테스트는 **시간 분리(leakage 금지)** 다. 이게 뚫리면 backtest 숫자가
// 좋아 보이지만 실전에서 무너진다.
import { describe, expect, it } from "vitest";

import {
  blueprintSchema,
  type Blueprint,
  type ExamPaper,
} from "@/contracts/predictor.contract";
import { observeBlueprint } from "@/lib/predictor/blueprint";
import {
  blueprintDistances,
  normalizeMix,
  totalVariationDistance,
} from "@/lib/predictor/distance";
import { predictBlueprint } from "@/lib/predictor/predictBlueprint";
import {
  historyBefore,
  rangeSeriesKey,
  sortByPeriod,
  styleSeriesKey,
} from "@/lib/predictor/series";

const UNIT_A = "11111111-1111-4111-8111-111111111111";
const UNIT_B = "22222222-2222-4222-8222-222222222222";

function paper(
  overrides: Partial<ExamPaper> & { externalExamId: string },
): ExamPaper {
  return {
    series: { school: "정화중", level: "중", grade: 3, subject: "중3" },
    period: { year: 2025, semester: 1 as const, round: "중간" as const },
    subjectRaw: "수학",
    totalScore: 100,
    sourceFile: null,
    questions: [],
    ...overrides,
  };
}

function q(
  number: number,
  score: number,
  qtype: "객관식" | "단답형" | "서술형",
  difficultyLabel: "하" | "중" | "상" | null,
  unitId: string | null = UNIT_A,
) {
  return {
    number,
    score,
    qtype,
    difficultyLabel,
    topicRaw: null,
    unitId,
    answer: null,
    hasFigure: false,
    problemId: null,
  };
}

/** 객관식 16 + 서술형 4, 배점 눈금 4.0/5.0 인 전형적 시험지. */
function typicalPaper(id: string, year: number, round: "중간" | "기말") {
  const questions = [
    ...Array.from({ length: 16 }, (_, i) =>
      q(i + 1, 4, "객관식", i < 8 ? "하" : "중", i % 2 === 0 ? UNIT_A : UNIT_B),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      q(17 + i, 9, "서술형", "상", UNIT_B),
    ),
  ];
  return paper({
    externalExamId: id,
    period: { year, semester: 1 as const, round },
    totalScore: questions.reduce((s, x) => s + x.score, 0),
    questions,
  });
}

describe("[T2] 거리 함수", () => {
  it("normalizeMix — 합이 1이 되게 정규화한다", () => {
    expect(normalizeMix({ a: 3, b: 1 })).toEqual({ a: 0.75, b: 0.25 });
  });

  it("normalizeMix — 전부 0이면 빈 분포를 준다", () => {
    expect(normalizeMix({ a: 0, b: 0 })).toEqual({});
  });

  it("totalVariationDistance — 같은 분포는 0", () => {
    expect(totalVariationDistance({ a: 0.5, b: 0.5 }, { a: 0.5, b: 0.5 })).toBe(
      0,
    );
  });

  it("totalVariationDistance — 겹치지 않는 분포는 1", () => {
    expect(totalVariationDistance({ a: 1 }, { b: 1 })).toBe(1);
  });

  it("totalVariationDistance — 한쪽에만 있는 키도 센다", () => {
    expect(totalVariationDistance({ a: 1 }, { a: 0.5, b: 0.5 })).toBeCloseTo(
      0.5,
      10,
    );
  });
});

describe("[T2] 시리즈 묶기", () => {
  it("styleSeriesKey — 출제 스타일 단위는 과목을 뺀다", () => {
    // 고1은 1학기 공통수학1 / 2학기 공통수학2로 과목이 바뀌지만
    // 출제 관행은 이어진다(11 §2.1).
    const a = paper({
      externalExamId: "1",
      series: { school: "대륜고", level: "고", grade: 1, subject: "공통수학1" },
    });
    const b = paper({
      externalExamId: "2",
      series: { school: "대륜고", level: "고", grade: 1, subject: "공통수학2" },
    });
    expect(styleSeriesKey(a.series)).toBe(styleSeriesKey(b.series));
    expect(rangeSeriesKey(a.series)).not.toBe(rangeSeriesKey(b.series));
  });

  it("sortByPeriod — 연도 → 학기 → 중간<기말 순으로 세운다", () => {
    const papers = [
      typicalPaper("d", 2025, "기말"),
      typicalPaper("b", 2024, "기말"),
      typicalPaper("c", 2025, "중간"),
      typicalPaper("a", 2024, "중간"),
    ];
    expect(sortByPeriod(papers).map((p) => p.externalExamId)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("historyBefore — 대상 시점과 그 이후는 절대 포함하지 않는다", () => {
    const papers = [
      typicalPaper("a", 2024, "중간"),
      typicalPaper("b", 2024, "기말"),
      typicalPaper("c", 2025, "중간"),
      typicalPaper("d", 2025, "기말"),
    ];
    const got = historyBefore(papers, {
      year: 2025,
      semester: 1,
      round: "중간",
    });
    expect(got.map((p) => p.externalExamId)).toEqual(["a", "b"]);
  });
});

describe("[T2] 청사진 관측", () => {
  it("observeBlueprint — 문항 수·총점·유형 배분을 집계한다", () => {
    const bp = observeBlueprint(typicalPaper("a", 2025, "중간"));
    expect(bp.kind).toBe("observed");
    expect(bp.questionCount).toBe(20);
    expect(bp.totalScore).toBe(100);
    expect(bp.typeMix["객관식"]).toEqual({ count: 16, score: 64 });
    expect(bp.typeMix["서술형"]).toEqual({ count: 4, score: 36 });
    expect(bp.typeMix["단답형"]).toEqual({ count: 0, score: 0 });
  });

  it("observeBlueprint — 배점 눈금을 빈도로 남긴다", () => {
    const bp = observeBlueprint(typicalPaper("a", 2025, "중간"));
    expect(bp.scoreHistogram).toEqual([
      { score: 4, count: 16 },
      { score: 9, count: 4 },
    ]);
  });

  it("observeBlueprint — 난이도 라벨이 없는 문항은 미표기로 모은다", () => {
    const p = paper({
      externalExamId: "x",
      questions: [q(1, 5, "객관식", null), q(2, 5, "객관식", "하")],
      totalScore: 10,
    });
    const bp = observeBlueprint(p);
    expect(bp.difficultyMix["미표기"]).toEqual({ count: 1, score: 5 });
    expect(bp.difficultyMix["하"]).toEqual({ count: 1, score: 5 });
  });

  it("observeBlueprint — 실측 청사진은 evidenceCount 1, confidence 1", () => {
    const bp = observeBlueprint(typicalPaper("a", 2025, "중간"));
    expect(bp.evidenceCount).toBe(1);
    expect(bp.confidence).toBe(1);
  });
});

describe("[T2] 청사진 예측", () => {
  const target = { year: 2025, semester: 1 as const, round: "중간" as const };
  const series = {
    school: "정화중",
    level: "중" as const,
    grade: 3,
    subject: "중3",
  };

  it("과거가 없으면 코호트(전국) 평균을 그대로 낸다", () => {
    const cohort = [typicalPaper("c1", 2024, "중간")].map(observeBlueprint);
    const bp = predictBlueprint({ series, target, history: [], cohort });
    expect(bp.kind).toBe("predicted");
    expect(bp.evidenceCount).toBe(0);
    expect(bp.questionCount).toBeCloseTo(20, 6);
    // 근거가 없으면 신뢰도를 낮게 낸다 — 리포트가 경고를 띄울 수 있어야 한다.
    expect(bp.confidence).toBeLessThan(0.3);
  });

  /**
   * 🔴 여기서 규칙이 **항목마다 다르다.** 예전에는 문항 수도 코호트로 당겼는데
   * (`stylePriorWeight` 2), 학원 '대비' 자료 130편을 이력에서 걷어내고 다시 재니
   * **당기지 않는 쪽(0)이 두 분할 모두에서 나았다**(11 §14). 그래서 갈랐다.
   *
   *   - 문항 수·유형 : 학교 고유성이 확인된 항목 → 코호트로 **안 당긴다**
   *   - 총점        : 전국이 사실상 100점 → 코호트가 진짜 정보라 **당긴다**
   *
   * "몇 학기 돌리면 정확해진다"는 요구는 축소가 아니라 **표본이 쌓여 평균이 안정되는 것**
   * 으로 충족된다(backtest 실측: 1편 0.818 → 2편 0.638 → 3편 0.624).
   */
  it("문항 수는 코호트로 당기지 않는다 — 학교 고유값을 그대로 쓴다", () => {
    // 코호트는 30문항, 이 학교는 20문항.
    const big = paper({
      externalExamId: "c1",
      questions: Array.from({ length: 30 }, (_, i) =>
        q(i + 1, 10 / 3, "객관식", "중"),
      ),
      totalScore: 100,
      period: { year: 2024, semester: 1 as const, round: "중간" as const },
    });
    const cohort = [observeBlueprint(big)];

    const one = predictBlueprint({
      series,
      target,
      history: [observeBlueprint(typicalPaper("a", 2024, "중간"))],
      cohort,
    });

    expect(one.questionCount).toBeCloseTo(20, 6);
  });

  it("🔴 그 학교 과거가 하나도 없으면 코호트로 떨어진다 — 근거 없이 20을 지어내지 않는다", () => {
    const big = paper({
      externalExamId: "c1",
      questions: Array.from({ length: 30 }, (_, i) =>
        q(i + 1, 10 / 3, "객관식", "중"),
      ),
      totalScore: 100,
      period: { year: 2024, semester: 1 as const, round: "중간" as const },
    });

    const none = predictBlueprint({
      series,
      target,
      history: [],
      cohort: [observeBlueprint(big)],
    });

    expect(none.questionCount).toBeCloseTo(30, 6);
    expect(none.confidence).toBe(0);
  });

  it("총점은 코호트로 당긴다 — 전국이 사실상 100점이라 그게 진짜 정보다", () => {
    // 이 학교 과거만 60점이고 코호트는 100점이면, 예측은 그 사이로 당겨져야 한다.
    const low = paper({
      externalExamId: "low",
      questions: Array.from({ length: 20 }, (_, i) =>
        q(i + 1, 3, "객관식", "중"),
      ),
      totalScore: 60,
      period: { year: 2024, semester: 1 as const, round: "중간" as const },
    });
    const normal = paper({
      externalExamId: "c2",
      questions: Array.from({ length: 20 }, (_, i) =>
        q(i + 1, 5, "객관식", "중"),
      ),
      totalScore: 100,
      period: { year: 2024, semester: 1 as const, round: "중간" as const },
    });

    const out = predictBlueprint({
      series,
      target,
      history: [observeBlueprint(low)],
      cohort: [observeBlueprint(normal)],
    });

    expect(out.totalScore).toBeGreaterThan(60);
    expect(out.totalScore).toBeLessThan(100);
  });

  it("근거가 쌓이면 신뢰도가 올라간다", () => {
    const three = predictBlueprint({
      series,
      target,
      history: [
        observeBlueprint(typicalPaper("a", 2023, "중간")),
        observeBlueprint(typicalPaper("b", 2024, "중간")),
        observeBlueprint(typicalPaper("c", 2024, "기말")),
      ],
      cohort: [],
    });
    const one = predictBlueprint({
      series,
      target,
      history: [observeBlueprint(typicalPaper("a", 2024, "중간"))],
      cohort: [],
    });

    expect(three.confidence).toBeGreaterThan(one.confidence);
  });

  it("난이도는 학교별로 학습하지 않고 코호트 값을 쓴다", () => {
    // 이 학교 과거는 전부 '상'이지만 코호트는 전부 '하'다.
    // §2.3·§2.7 결론대로 학교 고유 난이도를 따라가면 안 된다.
    const allHard = paper({
      externalExamId: "h",
      questions: Array.from({ length: 20 }, (_, i) =>
        q(i + 1, 5, "객관식", "상"),
      ),
      totalScore: 100,
      period: { year: 2024, semester: 1 as const, round: "중간" as const },
    });
    const allEasy = paper({
      externalExamId: "e",
      questions: Array.from({ length: 20 }, (_, i) =>
        q(i + 1, 5, "객관식", "하"),
      ),
      totalScore: 100,
      period: { year: 2024, semester: 1 as const, round: "중간" as const },
    });
    const bp = predictBlueprint({
      series,
      target,
      history: [observeBlueprint(allHard)],
      cohort: [observeBlueprint(allEasy)],
    });
    const mix = normalizeMix({
      하: bp.difficultyMix["하"].count,
      중: bp.difficultyMix["중"].count,
      상: bp.difficultyMix["상"].count,
      미표기: bp.difficultyMix["미표기"].count,
    });
    expect(mix["하"] ?? 0).toBeGreaterThan(0.9);
  });

  it("⚠️ 대상 시점 이후 자료가 섞이면 즉시 던진다 (leakage 금지)", () => {
    const future = observeBlueprint(typicalPaper("f", 2026, "중간"));
    expect(() =>
      predictBlueprint({ series, target, history: [future], cohort: [] }),
    ).toThrow(/시간 분리/);
  });

  it("⚠️ 대상과 같은 시점의 자료도 던진다", () => {
    const same = observeBlueprint(typicalPaper("s", 2025, "중간"));
    expect(() =>
      predictBlueprint({ series, target, history: [same], cohort: [] }),
    ).toThrow(/시간 분리/);
  });

  it("작년 같은 회차를 직전 회차보다 무겁게 본다", () => {
    // 작년 1학기 중간(=대상과 같은 회차)은 20문항, 직전 회차(작년 2학기 기말)는 30문항.
    const sameRoundLastYear = observeBlueprint(
      typicalPaper("sr", 2024, "중간"),
    );
    const recent = observeBlueprint(
      paper({
        externalExamId: "rc",
        questions: Array.from({ length: 30 }, (_, i) =>
          q(i + 1, 10 / 3, "객관식", "중"),
        ),
        totalScore: 100,
        period: { year: 2024, semester: 2 as const, round: "기말" as const },
      }),
    );
    const bp = predictBlueprint({
      series,
      target,
      history: [sameRoundLastYear, recent],
      cohort: [],
    });
    // 같은 회차(20) 쪽으로 기울어야 한다 — 두 값의 중간(25)보다 작아야 한다.
    expect(bp.questionCount).toBeLessThan(25);
  });
});

describe("[T2] backtest 지표", () => {
  it("blueprintDistances — 같은 청사진이면 모든 거리가 0", () => {
    const bp = observeBlueprint(typicalPaper("a", 2025, "중간"));
    const d = blueprintDistances(bp, bp);
    expect(d.questionCountAbsError).toBe(0);
    expect(d.typeMixDistance).toBe(0);
    expect(d.difficultyMixDistance).toBe(0);
    expect(d.unitMixDistance).toBe(0);
    expect(d.scoreGridDistance).toBe(0);
  });

  it("blueprintDistances — 문항 수 차이를 절대오차로 낸다", () => {
    const a = observeBlueprint(typicalPaper("a", 2025, "중간"));
    const b = observeBlueprint(
      paper({
        externalExamId: "b",
        questions: Array.from({ length: 24 }, (_, i) =>
          q(i + 1, 4, "객관식", "중"),
        ),
        totalScore: 96,
      }),
    );
    expect(blueprintDistances(a, b).questionCountAbsError).toBe(4);
  });
});

// ── 적대적 리뷰에서 재현된 두 버그 (2026-08-16) ────────────────────────
describe("[T2] 적대적 리뷰 회귀", () => {
  const target = { year: 2025, semester: 1 as const, round: "중간" as const };
  const series = {
    school: "X중",
    level: "중" as const,
    grade: 3,
    subject: "중3",
  };

  it("🔴 근거가 하나도 없으면 청사진을 지어내지 않는다", () => {
    // 이전에는 questionCount=0 · totalScore=0 인 **계약 위반** 청사진을 조용히 냈다.
    // 원장 화면에 "0문항 0점짜리 시험이 예상됩니다" 로 나온다.
    expect(() =>
      predictBlueprint({ series, target, history: [], cohort: [] }),
    ).toThrow(/근거/);
  });

  it("🔴 내놓는 청사진은 항상 계약을 만족한다", () => {
    const cohort = [observeBlueprint(typicalPaper("c1", 2024, "중간"))];
    const bp = predictBlueprint({ series, target, history: [], cohort });
    // 엔진이 자기 출력을 검증하지 않으면 계약 위반이 하류로 샌다.
    expect(blueprintSchema.safeParse(bp).success).toBe(true);
  });

  it("🔴 빈 예측은 '틀린 예측'보다 좋은 점수를 받지 못한다", () => {
    // 총변동거리 특성상 빈 분포는 최대 0.5 까지만 벌어진다.
    // 그대로 두면 엔진이 망가져 빈 청사진을 낼수록 backtest 점수가 좋아진다.
    const observed = observeBlueprint(typicalPaper("o", 2025, "중간"));
    const empty: Blueprint = {
      ...observed,
      kind: "predicted",
      typeMix: {
        객관식: { count: 0, score: 0 },
        단답형: { count: 0, score: 0 },
        서술형: { count: 0, score: 0 },
      },
      unitMix: [],
      scoreHistogram: [],
    };
    const d = blueprintDistances(empty, observed);
    expect(d.typeMixDistance).toBe(1);
    expect(d.unitMixDistance).toBe(1);
    expect(d.scoreGridDistance).toBe(1);
  });
});
