/**
 * 왜 이 테스트가 있는가 — 이건 가정이 아니라 **실제로 터지는 버그**다.
 *
 * `gradeAnswers` 는 문항 배점을 `Problem.score ?? (100 / 문항수)` 로 잡는다. 기출 문항은
 * `score` 가 있고 자작·AI 문항은 NULL 이라, 둘을 섞어 한 장을 만들면 만점이 100 이 아니게 된다
 * (11 §10.1 의 예: 5문항 중 2개가 3.5점, 3개가 NULL → 만점 67). 그런데 점수 예측기는 100점
 * 만점을 전제로 0~100 clamp 하므로 **조용히 왜곡된다.** 예측 문제지는 정의상 여러 출처를
 * 짜깁기하므로 반드시 이 경로를 탄다(원장님 지시 D-42).
 *
 * 그래서 아래 테스트는 두 가지를 동시에 붙든다.
 *  (1) 버그가 실재함을 `gradeAnswers` 로 직접 재현한다 — 산식을 바꾸면 이 테스트가 먼저 깨진다.
 *  (2) 보정기가 그 시험지의 만점을 **정확히 100.0** 으로 만든다. 0.1+0.2 류의 부동소수 잔차가
 *      남으면 안 되므로 보정기는 0.01점 단위 정수로 계산한다.
 *
 * 배점 값은 지어내지 않는다. 조정 배점은 **그 학교가 실제로 쓰는 눈금 집합**(청사진
 * `scoreHistogram`) 안에서만 고른다 — 배점 눈금은 학교 고유성 43.3% 로 강한 신호다(11 §2.2).
 * 눈금 이력이 없으면 값을 만들지 않고 `판단 불가` 를 돌려준다. 이 프로젝트는 근거 없이
 * 0문항 0점 청사진을 낸 적이 있다.
 *
 * 실측 눈금 픽스처는 합성이 아니라 **코퍼스 원본**이다 —
 * `handoff-a-index/scripts/qa/reports/final-batch/1639.json` (대구여고 고2 수2, 21문항 100점).
 * 합성 픽스처만 쓰다 이관 결함을 통과시킨 전례가 있어(tracks/README.md) 실데이터를 같이 건다.
 */
import { describe, expect, it } from "vitest";

import type { Blueprint } from "@/contracts/predictor.contract";
import {
  scoreNormalizationSchema,
  type NormalizerQuestion,
} from "@/contracts/scoreNormalizer.contract";
import {
  normalizeScores,
  sumScores,
  validateManualScores,
} from "@/lib/predictor/scoreNormalizer";
import {
  gradeAnswers,
  type AnswerInput,
  type GradingProblem,
} from "@/lib/testResults/gradeAnswers";

type Histogram = Blueprint["scoreHistogram"];

const UNIT = "11111111-1111-4111-8111-111111111111";

function hist(...rows: Array<[number, number]>): Histogram {
  return rows.map(([score, count]) => ({ score, count }));
}

/** 대구여고 고2 수2 실측 눈금 (exam_id 1639, 21문항 100점). */
function daeguGrid(): Histogram {
  return hist(
    [3.5, 3],
    [3.7, 4],
    [3.9, 7],
    [4.1, 2],
    [4.2, 1],
    [7, 1],
    [8, 1],
    [10, 2],
  );
}

function q(
  number: number,
  qtype: NormalizerQuestion["qtype"],
  difficultyLabel: NormalizerQuestion["difficultyLabel"],
  originalScore: number | null = null,
): NormalizerQuestion {
  return Object.freeze({ number, qtype, difficultyLabel, originalScore });
}

/** 객관식 n문항 + 서술형 m문항 — 실제 내신 지면 배치(서술형이 뒤). */
function mixedPaper(objective: number, essay: number): NormalizerQuestion[] {
  const out: NormalizerQuestion[] = [];
  for (let i = 1; i <= objective; i += 1) out.push(q(i, "객관식", null));
  for (let i = 1; i <= essay; i += 1) {
    out.push(q(objective + i, "서술형", null));
  }
  return out;
}

describe("[T7.9] 배점 보정기 — 짜깁기 시험지의 만점 100 (D-42, 11 §10)", () => {
  it("기출+자작을 섞으면 gradeAnswers 만점이 100 이 아니다 — 11 §10.1 의 실제 버그", () => {
    // 11 §10.1 의 예 그대로: 5문항 중 2개가 3.5점(기출), 3개가 NULL(자작).
    const problems: GradingProblem[] = [
      { id: "p1", unitId: UNIT, difficulty: "mid", answer: "1", score: 3.5 },
      { id: "p2", unitId: UNIT, difficulty: "mid", answer: "1", score: 3.5 },
      { id: "p3", unitId: UNIT, difficulty: "mid", answer: "1", score: null },
      { id: "p4", unitId: UNIT, difficulty: "mid", answer: "1", score: null },
      { id: "p5", unitId: UNIT, difficulty: "mid", answer: "1", score: null },
    ];
    const answers: AnswerInput[] = problems.map((p, i) => ({
      problemId: p.id,
      selectedChoice: 1,
      essayScore: null,
      sequence: i + 1,
    }));

    const { graded } = gradeAnswers(answers, problems);
    const fullMark = graded.reduce((sum, g) => sum + g.maxPoints, 0);

    expect(fullMark).toBeCloseTo(67, 10);
    expect(fullMark).not.toBe(100);
  });

  it("보정하면 만점이 정확히 100.0 이고 부동소수 잔차가 남지 않는다", () => {
    // 21문항 중 8문항만 기출 배점(3.9)을 갖고 나머지는 자작(NULL).
    const questions = mixedPaper(17, 4).map((item, i) =>
      i < 8 ? { ...item, originalScore: 3.9 } : item,
    );

    const result = normalizeScores({ questions, histogram: daeguGrid() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.totalScore).toBe(100);
    // 0.01점 단위 정수로 더한 합 — 잔차가 0 이어야 한다.
    expect(sumScores(result.questions.map((r) => r.score))).toBe(100);
    // 소박하게 더해도(0.1+0.2 문제) 100 에서 눈에 띄게 벗어나지 않는다.
    const naive = result.questions.reduce((s, r) => s + r.score, 0);
    expect(Math.abs(naive - 100)).toBeLessThan(1e-9);
  });

  it("조정 후 배점이 전부 그 학교 눈금 집합에 속한다 — 3.7점을 지어내지 않는다", () => {
    const histogram = hist([8, 4], [10, 4], [12, 2]);
    const result = normalizeScores({ questions: mixedPaper(8, 2), histogram });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const grid = new Set(histogram.map((h) => h.score));
    for (const item of result.questions) {
      expect(grid.has(item.score)).toBe(true);
    }
    expect(result.grid).toEqual([8, 10, 12]);
  });

  it("원본 `Problem.score` 를 건드리지 않는다 — 학습 코퍼스 오염 금지", () => {
    const questions = [
      q(1, "객관식", "하", 3.5),
      q(2, "객관식", "중", 3.5),
      q(3, "객관식", "중", null),
      q(4, "단답형", "중", null),
      q(5, "서술형", "상", null),
      q(6, "서술형", "상", 8),
    ];
    const snapshot = questions.map((item) => item.originalScore);

    const result = normalizeScores({
      questions,
      histogram: hist([15, 4], [20, 2]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 입력 객체는 Object.freeze 되어 있다 — 보정기가 쓰려 했다면 여기서 이미 터졌다.
    expect(questions.map((item) => item.originalScore)).toEqual(snapshot);
    // 결과는 원본을 사본으로 보존하고, 조정값은 별도 필드에 싣는다.
    expect(result.questions.map((r) => r.originalScore)).toEqual(snapshot);
    expect(result.questions[0].score).not.toBe(
      result.questions[0].originalScore,
    );
  });

  it("서술형·상 난이도에 높은 눈금을 먼저 배정한다 (11 §10.2-3)", () => {
    // 눈금 합이 곧 100 이라 잉여 분배가 끼어들지 않는다 — 배정 규칙만 드러난다.
    const questions = [
      ...Array.from({ length: 6 }, (_, i) => q(i + 1, "객관식", "하")),
      q(7, "단답형", "중"),
      q(8, "단답형", "중"),
      q(9, "단답형", "중"),
      q(10, "서술형", "상"),
    ];
    const result = normalizeScores({
      questions,
      histogram: hist([8, 6], [12, 3], [16, 1]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.questions.map((r) => r.score)).toEqual([
      8, 8, 8, 8, 8, 8, 12, 12, 12, 16,
    ]);
  });

  it("동점이면 문항 번호가 큰 쪽에 먼저 준다 (뒤로 갈수록 어렵다)", () => {
    // 4문항 모두 같은 유형·난이도. 눈금 30 을 한 자리만 더 줄 수 있다.
    const questions = Array.from({ length: 4 }, (_, i) =>
      q(i + 1, "객관식", "중"),
    );
    const result = normalizeScores({
      questions,
      histogram: hist([20, 3], [30, 1]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.questions.map((r) => r.score)).toEqual([20, 20, 30, 30]);
    expect(result.totalScore).toBe(100);
  });

  it("잔차를 마지막 문항에 몰아넣지 않고 최대잉여법으로 분배한다 (11 §10.3-5)", () => {
    const result = normalizeScores({
      questions: [
        ...Array.from({ length: 6 }, (_, i) => q(i + 1, "객관식", "하")),
        q(7, "단답형", "중"),
        q(8, "단답형", "중"),
        q(9, "서술형", "상"),
        q(10, "서술형", "상"),
      ],
      histogram: hist([8, 4], [10, 4], [12, 2]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 1차 배정 합은 96. 남은 4점을 마지막 문항에 몰면 #10 이 16점(눈금 밖)이 된다.
    // 최대잉여법은 잔여가 큰 #8·#7 을 한 눈금씩 올려 채운다.
    expect(result.questions.map((r) => r.score)).toEqual([
      8, 8, 8, 8, 10, 10, 12, 12, 12, 12,
    ]);
    expect(Math.max(...result.questions.map((r) => r.score))).toBe(12);
  });

  it("실측 눈금(대구여고 고2 수2, exam_id 1639)으로도 정확히 100 이 된다", () => {
    // 원본 시험지도 객관식 17(3.5~4.2) + 서술형 4(7·8·10·10) 배치였다.
    const result = normalizeScores({
      questions: mixedPaper(17, 4),
      histogram: daeguGrid(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.totalScore).toBe(100);
    expect(sumScores(result.questions.map((r) => r.score))).toBe(100);

    const essay = result.questions
      .filter((r) => r.qtype === "서술형")
      .map((r) => r.score)
      .sort((a, b) => a - b);
    expect(essay).toEqual([7, 8, 10, 10]);
  });

  it("1차 배정 합이 100 을 넘으면 잔여가 작은 문항부터 한 눈금씩 내린다", () => {
    // §10.3 은 올리는 방향만 적어 놨지만, 그 학교 눈금 평균 × 문항 수가 100 을 넘으면
    // 스냅 결과가 101 이 되는 경우가 실제로 생긴다. 그때는 대칭으로 내린다.
    // (눈금 1100 짜리 한 문항만 1000 으로 내려가 정확히 100 이 된다.)
    const result = normalizeScores({
      questions: mixedPaper(9, 1),
      histogram: hist([10, 1], [11, 8], [90, 1]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.totalScore).toBe(100);
    expect(sumScores(result.questions.map((r) => r.score))).toBe(100);
    expect(result.questions.map((r) => r.score)).toEqual([
      10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
    ]);
  });

  it("최대잉여법이 100 에 못 닿는 눈금에서도 정확히 100 으로 닫는다", () => {
    // 최대잉여법만으로는 98.8 에서 멈추는 조합이다(눈금 간격이 성겨 한 눈금 상승이
    // 남은 1.2점에 안 맞는다). 도달 가능성 DP 가 §10.3 우선순위를 지키며 100 으로 닫는다.
    const histogram = hist([4.3, 5], [10, 4], [11.4, 2], [14.4, 3]);
    const result = normalizeScores({
      questions: mixedPaper(9, 2),
      histogram,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.questions).toHaveLength(11);
    expect(result.totalScore).toBe(100);
    expect(sumScores(result.questions.map((r) => r.score))).toBe(100);
    const grid = new Set(histogram.map((h) => h.score));
    for (const item of result.questions) expect(grid.has(item.score)).toBe(true);
  });

  it("눈금 집합이 비면 지어내지 않고 판단 불가를 돌려준다", () => {
    const result = normalizeScores({
      questions: mixedPaper(8, 2),
      histogram: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.judgement).toBe("판단 불가");
    expect(result.reason).toBe("눈금_없음");
  });

  it("그 눈금 집합으로 100 을 만들 수 없으면 판단 불가", () => {
    // 10문항 × 3점 눈금 하나 = 최대 30점. 100 은 어떤 배정으로도 불가능하다.
    const result = normalizeScores({
      questions: mixedPaper(10, 0),
      histogram: hist([3, 1]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("합계_100_불가");
  });

  it("0.01 단위로 떨어지지 않는 눈금은 판단 불가", () => {
    const result = normalizeScores({
      questions: mixedPaper(10, 0),
      histogram: hist([3.333, 1]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("눈금_해상도_초과");
  });

  it("문항이 없으면 판단 불가 — 0문항 0점 청사진을 다시 내지 않는다", () => {
    const result = normalizeScores({
      questions: [],
      histogram: hist([4, 20]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("문항_없음");
  });

  it("계약(scoreNormalizationSchema)을 통과한다", () => {
    const result = normalizeScores({
      questions: mixedPaper(17, 4),
      histogram: daeguGrid(),
    });
    expect(() => scoreNormalizationSchema.parse(result)).not.toThrow();
  });
});

describe("[T7.9] 원장 수동 조정 (11 §10.4)", () => {
  const grid = [3.5, 3.9, 4.5, 50];

  it("합계가 100 이면 저장을 허용한다", () => {
    const check = validateManualScores(
      [
        { number: 1, score: 50 },
        { number: 2, score: 50 },
      ],
      grid,
    );
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.total).toBe(100);
  });

  it("합계가 100 이 아니면 저장을 거부하고 남은 점수를 알린다", () => {
    const check = validateManualScores([
      { number: 1, score: 50 },
      { number: 2, score: 48.5 },
    ]);

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.issue).toBe("합계_불일치");
    expect(check.total).toBe(98.5);
    expect(check.remaining).toBe(1.5);
    expect(check.message).toBe("합계 98.5 — 1.5점 남음");
  });

  it("합계가 100 을 넘으면 초과분을 알린다", () => {
    const check = validateManualScores([
      { number: 1, score: 50 },
      { number: 2, score: 51.5 },
    ]);

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.remaining).toBe(-1.5);
    expect(check.message).toBe("합계 101.5 — 1.5점 초과");
  });

  it("0.1+0.2 류 부동소수 합도 100 으로 인정한다", () => {
    // 실수로 그냥 더하면 99.99999999999999 라 소박한 구현은 이 배점을 거부한다.
    expect([28.4, 35.8, 35.8].reduce((a, b) => a + b, 0)).not.toBe(100);

    const check = validateManualScores([
      { number: 1, score: 28.4 },
      { number: 2, score: 35.8 },
      { number: 3, score: 35.8 },
    ]);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.total).toBe(100);
  });

  it("자동으로 다른 문항을 건드리지 않는다", () => {
    const input = [
      Object.freeze({ number: 1, score: 50 }),
      Object.freeze({ number: 2, score: 48.5 }),
    ];
    const check = validateManualScores(input);
    expect(check.ok).toBe(false);
    expect(input.map((item) => item.score)).toEqual([50, 48.5]);
  });

  it("눈금 밖 배점은 막지 않고 알리기만 한다", () => {
    const check = validateManualScores(
      [
        { number: 1, score: 50 },
        { number: 2, score: 37 },
        { number: 3, score: 13 },
      ],
      grid,
    );
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.offGrid).toEqual([2, 3]);
  });

  it("배점이 0 이하이거나 0.01 단위가 아니면 형식 오류", () => {
    const zero = validateManualScores([
      { number: 1, score: 0 },
      { number: 2, score: 100 },
    ]);
    expect(zero.ok).toBe(false);
    if (zero.ok) return;
    expect(zero.issue).toBe("배점_형식오류");

    const tooFine = validateManualScores([
      { number: 1, score: 3.333 },
      { number: 2, score: 96.667 },
    ]);
    expect(tooFine.ok).toBe(false);
    if (tooFine.ok) return;
    expect(tooFine.issue).toBe("배점_형식오류");
  });
});
