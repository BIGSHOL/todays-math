/**
 * 🔴 RED → 🟢 GREEN — T7.10(잔차 계산) · T7.11(환산 계수 추정)의 순수 함수.
 *
 * 왜 이 테스트가 있는가.
 * 이 프로젝트는 근거가 없을 때 값을 지어내는 실수를 이미 한 번 냈다(0문항 0점 청사진).
 * 보정 루프는 그 실수가 가장 비싸게 먹히는 자리다 — 표본 2명짜리 학교의 잔차 평균을
 * 그대로 "그 학교 보정 계수"라고 확정해 버리면, 잡음을 패턴으로 굳혀 다음 예측을
 * 더 나쁘게 만든다. 11-score-predictor.md §2.3 이 1,752편으로 실측한 결론이 정확히
 * 그것이다(회차 간 차이의 61%가 잡음, 학교 고유 신호는 사실상 없음).
 * 그래서 여기서 못 박는 것은 세 가지다.
 *   ① 표본이 부족하면 숫자 대신 `judgementUnavailable` 을 돌려준다.
 *   ② 학교별 계수는 반드시 계층 축소를 거친다. 학교 고유 신호가 없으면 축소 가중이 0이다.
 *   ③ 보정 전/후 MAE 를 **홀드아웃(LOO)** 으로 재고, 나빠지면 채택하지 않는다.
 *      합산 목적함수 하나로 고르면 어떤 항목이 조용히 나빠진다(트랙 E 지난 회차 교훈).
 */
import { describe, expect, it } from "vitest";

import {
  calibrationOutcomeSchema,
  calibrationSampleSchema,
  type CalibrationSample,
} from "@/contracts/calibration.contract";
import {
  MIN_CALIBRATION_SAMPLES,
  MIN_SLOPE_SAMPLES,
  applyCalibration,
  computeResidual,
  estimateCalibration,
  isIntervalHit,
  summarizeResiduals,
} from "@/lib/predictor/calibration";

const ENGINE = "predictor-v0.3.0";

function fakeUuid(n: number): string {
  return `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

/**
 * 결정적 표본 생성기.
 * `predicted` 를 고정값으로 두면 기울기 단계가 근거 부족으로 건너뛰어져
 * 오프셋·축소 단계만 따로 검증할 수 있다(테스트를 한 축씩 갈라 보기 위함).
 */
function buildSamples(
  groups: Array<{ school: string; residuals: number[] }>,
  opts: {
    engineVersion?: string;
    predicted?: number;
    predictedCycle?: number[];
    missEvery?: number;
    /** 이 주기마다 구간 스냅샷이 없는 표본을 만든다(판정 불가 표본). */
    noIntervalEvery?: number;
  } = {},
): CalibrationSample[] {
  const out: CalibrationSample[] = [];
  let i = 0;
  for (const group of groups) {
    for (const residual of group.residuals) {
      const predicted =
        opts.predicted ??
        opts.predictedCycle?.[i % opts.predictedCycle.length] ??
        70;
      out.push({
        runId: fakeUuid(1),
        studentId: fakeUuid(i + 10),
        engineVersion: opts.engineVersion ?? ENGINE,
        school: group.school,
        predicted,
        actual: predicted + residual,
        residual,
        intervalHit: opts.missEvery ? i % opts.missEvery !== 0 : true,
        hasInterval: opts.noIntervalEvery
          ? i % opts.noIntervalEvery !== 0
          : true,
      });
      i += 1;
    }
  }
  return out;
}

function repeat(pattern: number[], times: number): number[] {
  return Array.from(
    { length: pattern.length * times },
    (_, i) => pattern[i % pattern.length]!,
  );
}

function assertAvailable(outcome: ReturnType<typeof estimateCalibration>) {
  if (outcome.judgementUnavailable) {
    throw new Error(
      `판단 불가로 나왔다: ${outcome.reason} / ${outcome.message}`,
    );
  }
  return outcome;
}

// ─────────────────────────────────────────────
// T7.10 — 잔차·구간 판정 (저장 시점 계산의 근거)
// ─────────────────────────────────────────────

describe("[T7.10] 잔차와 구간 적중", () => {
  it("residual = actual − predicted 다", () => {
    expect(computeResidual(84, 76)).toBe(8);
    expect(computeResidual(61, 70)).toBe(-9);
  });

  it("구간 적중은 경계값을 포함한다", () => {
    const interval = { lower: 65, upper: 79, coverage: 0.8 };
    expect(isIntervalHit(72, interval)).toBe(true);
    expect(isIntervalHit(65, interval)).toBe(true);
    expect(isIntervalHit(79, interval)).toBe(true);
    expect(isIntervalHit(64.9, interval)).toBe(false);
    expect(isIntervalHit(79.1, interval)).toBe(false);
  });

  it("구간 적중은 점 예측 MAE 와 별개 지표다 — 둘 다 요약에 나온다", () => {
    const summary = summarizeResiduals([
      { residual: 4, intervalHit: true, hasInterval: true },
      { residual: -6, intervalHit: false, hasInterval: true },
      { residual: 2, intervalHit: true, hasInterval: true },
      { residual: 0, intervalHit: true, hasInterval: true },
    ]);
    expect(summary.count).toBe(4);
    expect(summary.mae).toBe(3);
    expect(summary.meanResidual).toBe(0);
    expect(summary.intervalCount).toBe(4);
    expect(summary.intervalHitRate).toBe(0.75);
  });

  it("구간 스냅샷이 없는 표본은 적중률 분모에서 뺀다 — 모르는 것을 빗나감으로 세지 않는다", () => {
    const summary = summarizeResiduals([
      { residual: 4, intervalHit: true, hasInterval: true },
      { residual: -6, intervalHit: false, hasInterval: true },
      // 예측 시점에 구간이 없었던 표본. intervalHit 값은 의미가 없다.
      { residual: 2, intervalHit: false, hasInterval: false },
      { residual: 0, intervalHit: false, hasInterval: false },
    ]);
    expect(summary.count).toBe(4);
    expect(summary.mae).toBe(3);
    expect(summary.intervalCount).toBe(2);
    expect(summary.intervalHitRate).toBe(0.5);
  });

  it("구간을 아무도 판정할 수 없으면 적중률은 null 이다", () => {
    const summary = summarizeResiduals([
      { residual: 4, intervalHit: false, hasInterval: false },
      { residual: -6, intervalHit: false, hasInterval: false },
    ]);
    expect(summary.count).toBe(2);
    expect(summary.intervalCount).toBe(0);
    expect(summary.intervalHitRate).toBeNull();
  });

  it("표본이 0이면 숫자를 지어내지 않고 null 이다", () => {
    const summary = summarizeResiduals([]);
    expect(summary).toEqual({
      count: 0,
      mae: null,
      meanResidual: null,
      intervalCount: 0,
      intervalHitRate: null,
    });
  });
});

// ─────────────────────────────────────────────
// T7.11 — 판단 불가 (이 태스크에서 가장 중요한 것)
// ─────────────────────────────────────────────

describe("[T7.11] 표본이 부족하면 점수를 지어내지 않는다", () => {
  it("표본이 하나도 없으면 judgementUnavailable 이다", () => {
    const outcome = estimateCalibration([]);
    expect(outcome.judgementUnavailable).toBe(true);
    if (!outcome.judgementUnavailable) return;
    expect(outcome.reason).toBe("표본_부족");
    expect(outcome.sampleCount).toBe(0);
    expect(outcome.requiredSampleCount).toBe(MIN_CALIBRATION_SAMPLES);
  });

  it("최소 표본 수 바로 아래면 여전히 judgementUnavailable 이다", () => {
    const samples = buildSamples([
      {
        school: "정화중",
        residuals: repeat([5, -5], (MIN_CALIBRATION_SAMPLES - 1) / 2),
      },
    ]).slice(0, MIN_CALIBRATION_SAMPLES - 1);
    expect(samples).toHaveLength(MIN_CALIBRATION_SAMPLES - 1);

    const outcome = estimateCalibration(samples);
    expect(outcome.judgementUnavailable).toBe(true);
    if (!outcome.judgementUnavailable) return;
    expect(outcome.reason).toBe("표본_부족");
  });

  it("최소 표본 수를 채우면 판단한다 (경계)", () => {
    // 학교 하한(MIN_CALIBRATION_SCHOOLS)도 함께 만족해야 한다 — 표본 수만의 경계를 재려고
    // 학교를 셋으로 펼친다(합계는 그대로 MIN_CALIBRATION_SAMPLES).
    const samples = buildSamples([
      { school: "정화중", residuals: repeat([5, -5], 4) },
      { school: "경명여중", residuals: repeat([5, -5], 3) },
      { school: "대륜중", residuals: repeat([5, -5], 3) },
    ]);
    expect(samples).toHaveLength(MIN_CALIBRATION_SAMPLES);
    expect(estimateCalibration(samples).judgementUnavailable).toBe(false);
  });

  it("엔진 버전이 섞이면 표본이 충분해도 판단하지 않는다 — 지표를 섞어 비교하지 않는다", () => {
    const a = buildSamples([
      { school: "정화중", residuals: repeat([5, -5], 5) },
      { school: "경명여중", residuals: repeat([5, -5], 5) },
    ]);
    const b = buildSamples(
      [{ school: "대륜중", residuals: repeat([5, -5], 10) }],
      {
        engineVersion: "predictor-v0.4.0",
      },
    );
    const outcome = estimateCalibration([...a, ...b]);
    expect(outcome.judgementUnavailable).toBe(true);
    if (!outcome.judgementUnavailable) return;
    expect(outcome.reason).toBe("엔진버전_혼재");
  });

  it("반환값은 계약 스키마를 통과한다", () => {
    const samples = buildSamples([
      { school: "정화중", residuals: repeat([5, -5], 15) },
    ]);
    expect(() => calibrationSampleSchema.parse(samples[0])).not.toThrow();
    expect(() =>
      calibrationOutcomeSchema.parse(estimateCalibration(samples)),
    ).not.toThrow();
    expect(() =>
      calibrationOutcomeSchema.parse(estimateCalibration([])),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────
// T7.11 — 계층 축소
// ─────────────────────────────────────────────

describe("[T7.11] 학교별 계수는 계층적으로 축소한다", () => {
  /**
   * 학교 10곳이 전부 잔차 평균 0인데 한 곳만 2명 응시해 +12 가 나온 상황.
   * 학교 간 진짜 분산(τ²)이 학교 안 잡음(σ²)에 묻히므로 τ̂² = 0 이 되고,
   * **그 학교 계수는 확정되지 않는다.** 11 §2.3 이 실측한 상황이 이것이다.
   */
  it("학교 고유 신호가 없으면 2명짜리 학교 계수를 확정하지 않는다", () => {
    const groups = Array.from({ length: 10 }, (_, i) => ({
      school: `표본많은중${i}`,
      residuals: [6, -6, 6, -6],
    }));
    groups.push({ school: "표본둘중", residuals: [12, 12] });

    const outcome = assertAvailable(estimateCalibration(buildSamples(groups)));
    const small = outcome.schools.find((s) => s.school === "표본둘중");
    expect(small).toBeDefined();
    expect(small!.sampleCount).toBe(2);
    expect(small!.rawOffset).toBeCloseTo(12, 6);
    expect(small!.shrinkageWeight).toBe(0);
    expect(small!.shrunkOffset).toBe(0);
    expect(small!.apply).toBe(false);
    expect(outcome.coefficients.schoolOffsets).not.toHaveProperty("표본둘중");
  });

  /**
   * 이번에는 학교 간 진짜 차이가 있는 자료. 그래도 2명짜리 학교는
   * 10명짜리 학교보다 훨씬 약하게만 자기 값을 쓴다.
   */
  it("진짜 학교 차이가 있어도 표본이 적을수록 축소 가중이 낮다", () => {
    const means = [-4, -2.4, -0.8, 0.8, 2.4, 4];
    const groups = means.map((m, i) => ({
      school: `표본열중${i}`,
      residuals: repeat([m + 5, m - 5], 5),
    }));
    groups.push({ school: "표본둘고", residuals: [9, -1] });

    const outcome = assertAvailable(estimateCalibration(buildSamples(groups)));
    const small = outcome.schools.find((s) => s.school === "표본둘고")!;
    const large = outcome.schools.find((s) => s.school === "표본열중5")!;

    expect(small.sampleCount).toBe(2);
    expect(large.sampleCount).toBe(10);
    expect(small.shrinkageWeight).toBeGreaterThan(0);
    expect(small.shrinkageWeight).toBeLessThan(0.5);
    expect(small.shrinkageWeight).toBeLessThan(large.shrinkageWeight);
    // 축소는 반드시 값을 줄이는 방향이다.
    expect(Math.abs(small.shrunkOffset)).toBeLessThan(
      Math.abs(small.rawOffset),
    );
  });
});

// ─────────────────────────────────────────────
// T7.11 — 개선 여부·편향
// ─────────────────────────────────────────────

describe("[T7.11] 보정 전/후 MAE 와 편향", () => {
  it("잔차가 순수 잡음이면 보정을 채택하지 않는다", () => {
    const outcome = assertAvailable(
      estimateCalibration(
        buildSamples([
          { school: "가중", residuals: repeat([5, -5], 5) },
          { school: "나중", residuals: repeat([5, -5], 5) },
          { school: "다중", residuals: repeat([5, -5], 5) },
        ]),
      ),
    );

    expect(outcome.improved).toBe(false);
    expect(outcome.maeAfter).toBe(outcome.maeBefore);
    expect(outcome.coefficients.offset).toBe(0);
    expect(outcome.coefficients.slope).toBe(1);
    expect(Object.keys(outcome.coefficients.schoolOffsets)).toHaveLength(0);
    expect(outcome.stages.every((stage) => !stage.apply)).toBe(true);
  });

  it("한쪽으로 쏠린 잔차는 편향으로 표시하고 오프셋을 채택한다", () => {
    const outcome = assertAvailable(
      estimateCalibration(
        buildSamples([
          { school: "가중", residuals: repeat([10, 6], 5) },
          { school: "나중", residuals: repeat([10, 6], 5) },
          { school: "다중", residuals: repeat([10, 6], 5) },
        ]),
      ),
    );

    expect(outcome.bias.detected).toBe(true);
    expect(outcome.bias.meanResidual).toBeCloseTo(8, 6);
    expect(outcome.bias.direction).toBe("과소예측");
    expect(Math.abs(outcome.bias.tStatistic)).toBeGreaterThan(2);

    const offsetStage = outcome.stages.find((s) => s.name === "전체_오프셋")!;
    expect(offsetStage.apply).toBe(true);
    expect(outcome.improved).toBe(true);
    expect(outcome.maeAfter).toBeLessThan(outcome.maeBefore);
    expect(outcome.maeBefore).toBeCloseTo(8, 6);

    // 실제로 쓰는 값이 보정돼 있어야 한다.
    expect(
      applyCalibration(outcome.coefficients, { school: "가중", predicted: 70 }),
    ).toBeCloseTo(78, 0);
  });

  it("편향이 없으면 direction 은 null 이다", () => {
    const outcome = assertAvailable(
      estimateCalibration(
        buildSamples([
          { school: "가중", residuals: repeat([5, -5], 5) },
          { school: "나중", residuals: repeat([5, -5], 5) },
          { school: "다중", residuals: repeat([5, -5], 5) },
        ]),
      ),
    );
    expect(outcome.bias.detected).toBe(false);
    expect(outcome.bias.direction).toBeNull();
  });

  /**
   * 이 태스크의 이름이 "환산 계수"인 이유 — 11 §2.7-3.
   * 예측이 위로 갈수록 과대, 아래로 갈수록 과소인 경우는 오프셋으로 못 고친다.
   * 기울기(척도)를 따로 두고, **따로 채택 판정**한다.
   */
  it("척도가 어긋나 있으면 기울기 단계를 따로 채택한다", () => {
    const trueSlope = 0.8;
    const trueIntercept = 12;
    const predictedCycle = [50, 60, 70, 80, 90];
    const noise = repeat([0.5, -0.5], 20);
    const samples: CalibrationSample[] = noise.map((n, i) => {
      const predicted = predictedCycle[i % predictedCycle.length]!;
      const actual = trueIntercept + trueSlope * predicted + n;
      return {
        runId: fakeUuid(1),
        studentId: fakeUuid(i + 10),
        engineVersion: ENGINE,
        // 학교는 잡음의 부호와 무관하게 앞뒤로 가른다 — 이 테스트가 보려는 것은
        // 학교 효과가 아니라 척도(기울기)뿐이다.
        school: ["가중", "나중", "다중"][i % 3]!,
        predicted,
        actual,
        residual: actual - predicted,
        intervalHit: true,
        hasInterval: true,
      };
    });
    expect(samples.length).toBeGreaterThanOrEqual(MIN_SLOPE_SAMPLES);

    const outcome = assertAvailable(estimateCalibration(samples));
    const slopeStage = outcome.stages.find((s) => s.name === "전체_기울기")!;
    expect(slopeStage.apply).toBe(true);
    expect(outcome.coefficients.slope).toBeCloseTo(trueSlope, 1);
    expect(outcome.improved).toBe(true);
    expect(
      applyCalibration(outcome.coefficients, { school: "가중", predicted: 90 }),
    ).toBeCloseTo(84, 0);
  });

  it("기울기는 예측값에 폭이 없으면 아예 제안하지 않는다", () => {
    const outcome = assertAvailable(
      estimateCalibration(
        buildSamples(
          [
            { school: "가중", residuals: repeat([10, 6], 5) },
            { school: "나중", residuals: repeat([10, 6], 5) },
            { school: "다중", residuals: repeat([10, 6], 5) },
          ],
          { predicted: 70 },
        ),
      ),
    );
    const slopeStage = outcome.stages.find((s) => s.name === "전체_기울기")!;
    expect(slopeStage.apply).toBe(false);
    expect(outcome.coefficients.slope).toBe(1);
    expect(slopeStage.note).toMatch(/폭|표본/);
  });
});

// ─────────────────────────────────────────────
// T7.11 — 구간 적중률
// ─────────────────────────────────────────────

describe("[T7.11] 구간 적중률은 점 예측과 별개로 본다", () => {
  const samples = buildSamples(
    [
      { school: "가중", residuals: repeat([5, -5], 5) },
      { school: "나중", residuals: repeat([5, -5], 5) },
      { school: "다중", residuals: repeat([5, -5], 5) },
    ],
    { missEvery: 5 },
  );

  it("적중률을 세고, 선언한 신뢰수준을 모르면 정직성 판정은 하지 않는다", () => {
    const outcome = assertAvailable(estimateCalibration(samples));
    expect(outcome.intervalSampleCount).toBe(30);
    expect(outcome.intervalHitRate).toBeCloseTo(0.8, 6);
    expect(outcome.nominalCoverage).toBeNull();
    expect(outcome.intervalHonest).toBeNull();
  });

  it("선언한 신뢰수준을 주면 그것과 대조한다", () => {
    const honest = assertAvailable(
      estimateCalibration(samples, { nominalCoverage: 0.8 }),
    );
    expect(honest.intervalHonest).toBe(true);

    const dishonest = assertAvailable(
      estimateCalibration(samples, { nominalCoverage: 0.95 }),
    );
    expect(dishonest.intervalHonest).toBe(false);
  });

  /**
   * 구간 스냅샷이 없는 표본은 적중률을 **판정할 수 없다.** 그걸 빗나감으로 세면
   * 구간이 실제보다 부정직해 보이고, 적중으로 세면 반대로 부풀려진다. 분모에서 뺀다.
   */
  it("구간을 판정할 수 없는 표본은 분모에서 뺀다", () => {
    const mixed = buildSamples(
      [
        { school: "가중", residuals: repeat([5, -5], 5) },
        { school: "나중", residuals: repeat([5, -5], 5) },
        { school: "다중", residuals: repeat([5, -5], 5) },
      ],
      // 구간이 없는 표본은 intervalHit 를 false 로 두지만 분모에 들어가면 안 된다.
      { noIntervalEvery: 3 },
    );
    const outcome = assertAvailable(estimateCalibration(mixed));
    expect(outcome.sampleCount).toBe(30);
    expect(outcome.intervalSampleCount).toBe(20);
    expect(outcome.intervalHitRate).toBe(1);
  });

  it("구간을 아무도 판정할 수 없으면 적중률과 정직성 판정이 모두 null 이다", () => {
    const none = buildSamples(
      [
        { school: "가중", residuals: repeat([5, -5], 5) },
        { school: "나중", residuals: repeat([5, -5], 5) },
        { school: "다중", residuals: repeat([5, -5], 5) },
      ],
      { noIntervalEvery: 1 },
    );
    const outcome = assertAvailable(
      estimateCalibration(none, { nominalCoverage: 0.8 }),
    );
    expect(outcome.intervalSampleCount).toBe(0);
    expect(outcome.intervalHitRate).toBeNull();
    expect(outcome.intervalHonest).toBeNull();
  });
});

// ─────────────────────────────────────────────
// applyCalibration
// ─────────────────────────────────────────────

describe("[T7.11] applyCalibration", () => {
  const coefficients = {
    engineVersion: ENGINE,
    offset: 3,
    slope: 0.9,
    schoolOffsets: { 정화중: -2 },
  };

  it("기울기·오프셋·학교 오프셋을 함께 적용한다", () => {
    expect(
      applyCalibration(coefficients, { school: "정화중", predicted: 80 }),
    ).toBeCloseTo(73, 6);
  });

  it("계수가 없는 학교는 전체 계수만 적용한다", () => {
    expect(
      applyCalibration(coefficients, { school: "무명중", predicted: 80 }),
    ).toBeCloseTo(75, 6);
  });

  it("0~100 범위를 벗어나지 않는다", () => {
    expect(
      applyCalibration(
        { ...coefficients, offset: 50 },
        { school: "무명중", predicted: 95 },
      ),
    ).toBe(100);
    expect(
      applyCalibration(
        { ...coefficients, offset: -200 },
        { school: "무명중", predicted: 40 },
      ),
    ).toBe(0);
  });
});
