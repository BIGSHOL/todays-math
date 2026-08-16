/**
 * 보정 계수 추정 — T7.11 (그리고 T7.10 이 저장 시점에 쓰는 잔차·구간 순수 함수).
 *
 * ⚠️ 이 파일에는 **IO 가 없다.** DB·네트워크·시각은 호출자가 넣어 준다.
 *    보정 로직이 순수해야 같은 표본으로 언제든 같은 계수가 재현되고,
 *    엔진을 고쳤을 때 과거 표본으로 다시 돌려 비교할 수 있다(11 §3 L5-c).
 *
 * 설계 근거 (docs/planning/11-score-predictor.md):
 * - §2.3 — 학교별 난이도 신호의 61%가 잡음이다. 그래서 학교 계수는 **반드시** 계층 축소를 거친다.
 * - §3 L1 — "복잡한 모델을 먼저 쓰지 않는다. backtest 지표가 개선을 증명할 때만 복잡도를 올린다."
 *   그래서 보정을 세 단계로 쪼개고 단계마다 홀드아웃 MAE 로 채택 여부를 따로 판정한다.
 * - §2.7-3 — 진짜 병목은 "난이도 지수를 점수로 바꾸는 환산 계수"다. 오프셋만으로는 못 고치는
 *   척도 오차가 있어 기울기(slope) 단계를 둔다.
 *
 * 트랙 E 지난 회차 교훈: **합산 목적함수 하나로 파라미터를 고르면 어떤 항목은 조용히 나빠진다.**
 * → 전체 단계도, 학교 단위도 각각 홀드아웃을 보고 좋아진 것만 채택한다.
 */
import type {
  BiasReport,
  CalibrationCoefficients,
  CalibrationOutcome,
  CalibrationSample,
  CalibrationStage,
  ResidualSummary,
  SchoolCoefficient,
} from "@/contracts/calibration.contract";

// ─────────────────────────────────────────────
// 상수 — 근거를 반드시 함께 적는다
// ─────────────────────────────────────────────

/**
 * 계수를 추정하기 위한 최소 표본 수.
 *
 * 근거: 이 추정의 안전장치는 "평균 잔차가 표준오차의 2배를 넘는가"라는 t 판정이고,
 * 그 판정은 **표본 표준편차 자체가 믿을 만해야** 성립한다. 정규 표본에서 표본 표준편차의
 * 상대 표준오차는 대략 1/√(2(n−1)) 이다 — n=20 에서 약 16%, n=10 이면 24% 로 벌어져
 * 게이트 자체가 흔들린다. 그래서 20 을 바닥으로 둔다.
 *
 * ⚠️ 20 은 "이 아래로는 아예 판단하지 않는다"는 **하한**이지, "20이면 믿어도 된다"는 뜻이
 *    아니다. 실제 채택 여부는 아래의 홀드아웃 MAE 비교가 결정한다.
 */
export const MIN_CALIBRATION_SAMPLES = 20;

/**
 * 기울기(척도)를 제안하기 위한 최소 표본 수.
 * 기울기는 오프셋에 이은 **두 번째 파라미터**라 같은 표본으로는 오차가 훨씬 크다.
 * 30 을 바닥으로 두되, 실제 방어선은 `|β−1| > 2·SE(β)` t 판정과 홀드아웃 비교다.
 */
export const MIN_SLOPE_SAMPLES = 30;

/**
 * 기울기를 추정하려면 예측값에 폭이 있어야 한다(점). 폭이 없으면 기울기는
 * 잡음을 외삽하는 것이라 아예 제안하지 않는다.
 */
export const MIN_PREDICTED_SPREAD = 1;

/** |t| 가 이 값을 넘으면 편향으로 본다(양측 약 95%). */
export const BIAS_T_THRESHOLD = 2;

/** SE 가 0 일 때 t 를 무한대로 두지 않기 위한 상한. */
const MAX_T_STATISTIC = 1e6;

// ─────────────────────────────────────────────
// T7.10 이 쓰는 순수 함수
// ─────────────────────────────────────────────

function round6(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return rounded === 0 ? 0 : rounded;
}

/** actual − predicted. 부호가 뒤집히면 보정 방향이 통째로 반대가 되므로 함수로 못 박는다. */
export function computeResidual(actual: number, predicted: number): number {
  return round6(actual - predicted);
}

/** 예측 구간이 실제를 담았는가. 경계값은 담은 것으로 본다. */
export function isIntervalHit(
  actual: number,
  interval: { lower: number; upper: number },
): boolean {
  return actual >= interval.lower && actual <= interval.upper;
}

/**
 * 잔차 요약. 표본이 0이면 숫자를 지어내지 않고 null 을 돌려준다.
 * 구간 적중률은 MAE 와 **별개 지표**다 — 점 예측이 좋아도 구간이 정직하지 않을 수 있다.
 */
export function summarizeResiduals(
  rows: Array<{ residual: number; intervalHit: boolean }>,
): ResidualSummary {
  if (rows.length === 0) {
    return { count: 0, mae: null, meanResidual: null, intervalHitRate: null };
  }
  const n = rows.length;
  const mae = rows.reduce((sum, r) => sum + Math.abs(r.residual), 0) / n;
  const meanResidual = rows.reduce((sum, r) => sum + r.residual, 0) / n;
  const hits = rows.filter((r) => r.intervalHit).length;
  return {
    count: n,
    mae: round6(mae),
    meanResidual: round6(meanResidual),
    intervalHitRate: round6(hits / n),
  };
}

// ─────────────────────────────────────────────
// 계수 적용
// ─────────────────────────────────────────────

/** 보정 계수를 실제 예측값에 적용한다. 점수는 0~100 을 벗어날 수 없다. */
export function applyCalibration(
  coefficients: CalibrationCoefficients,
  input: { school: string; predicted: number },
): number {
  const schoolOffset = coefficients.schoolOffsets[input.school] ?? 0;
  const corrected =
    coefficients.slope * input.predicted + coefficients.offset + schoolOffset;
  return round6(Math.max(0, Math.min(100, corrected)));
}

// ─────────────────────────────────────────────
// 내부 — 적합/평가
// ─────────────────────────────────────────────

type StageConfig = { offset: boolean; slope: boolean; school: boolean };

type SchoolStats = {
  school: string;
  count: number;
  mean: number;
  weight: number;
  shrunk: number;
};

type Fitted = {
  offset: number;
  slope: number;
  schoolOffsets: Map<string, number>;
  schoolStats: SchoolStats[];
  /** 기울기를 제안조차 못 한 이유(있으면). 보고에 그대로 싣는다. */
  slopeSkipReason: string | null;
};

/**
 * 표본 하나를 `predicted` 와 `residual` 로만 다룬다.
 * `actual` 대신 `predicted + residual` 을 쓰는 이유: `residual` 이 저장된 **스냅샷**이고,
 * 보정의 입력으로 삼기로 계약이 정한 값이기 때문이다(둘은 정상 경로에서 항상 일치한다).
 */
function actualOf(sample: CalibrationSample): number {
  return sample.predicted + sample.residual;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function sampleStdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const ss = values.reduce((sum, v) => sum + (v - m) ** 2, 0);
  return Math.sqrt(ss / (values.length - 1));
}

function populationStdev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length,
  );
}

/**
 * 학교별 오프셋을 **경험적 베이즈(계층 축소)** 로 구한다.
 *
 * w_s = n_s·τ̂² / (n_s·τ̂² + σ̂²_within)
 *
 * τ̂²(학교 간 진짜 분산)는 학교 평균의 흩어짐에서 학교 안 잡음을 뺀 나머지로 추정한다.
 * **학교 고유 신호가 잡음에 묻히면 τ̂² 이 0 이 되고, 모든 가중이 0 이 된다** — 즉
 * "학교 하나에 2명 응시한 걸로 그 학교 계수를 확정"하는 일이 구조적으로 불가능하다.
 * 이게 11 §2.3 이 1,752편으로 실측한 상황(학교 고유성 1.8%)에서 나와야 하는 동작이다.
 */
function fitSchoolOffsets(
  residualsBySchool: Map<string, number[]>,
): SchoolStats[] {
  const entries = [...residualsBySchool.entries()].map(([school, values]) => ({
    school,
    count: values.length,
    mean: mean(values),
    values,
  }));

  const total = entries.reduce((sum, e) => sum + e.count, 0);
  const schoolCount = entries.length;
  const grandMean =
    entries.reduce((sum, e) => sum + e.mean * e.count, 0) / total;

  // 학교가 하나뿐이거나 자유도가 없으면 학교 간 분산을 식별할 수 없다 → 전면 축소.
  const identifiable = schoolCount >= 2 && total > schoolCount;

  let tauSquared = 0;
  let withinVariance = 0;
  if (identifiable) {
    const withinSs = entries.reduce(
      (sum, e) => sum + e.values.reduce((s, v) => s + (v - e.mean) ** 2, 0),
      0,
    );
    withinVariance = withinSs / (total - schoolCount);

    const betweenMs =
      entries.reduce((sum, e) => sum + e.count * (e.mean - grandMean) ** 2, 0) /
      (schoolCount - 1);
    const sumSquaredCounts = entries.reduce((sum, e) => sum + e.count ** 2, 0);
    const effectiveN = (total - sumSquaredCounts / total) / (schoolCount - 1);
    tauSquared =
      effectiveN > 0
        ? Math.max(0, (betweenMs - withinVariance) / effectiveN)
        : 0;
  }

  return entries.map((e) => {
    let weight: number;
    if (!identifiable || tauSquared === 0) {
      weight = 0;
    } else if (withinVariance === 0) {
      weight = 1;
    } else {
      weight = (e.count * tauSquared) / (e.count * tauSquared + withinVariance);
    }
    return {
      school: e.school,
      count: e.count,
      mean: e.mean,
      weight,
      shrunk: weight * (e.mean - grandMean),
    };
  });
}

function fit(samples: CalibrationSample[], config: StageConfig): Fitted {
  let slope = 1;
  let offset = 0;
  let slopeSkipReason: string | null = null;

  const residuals = samples.map((s) => s.residual);

  if (config.slope) {
    const predicted = samples.map((s) => s.predicted);
    const spread = populationStdev(predicted);
    if (samples.length < MIN_SLOPE_SAMPLES) {
      slopeSkipReason = `표본 ${samples.length}건 — 기울기 제안 하한 ${MIN_SLOPE_SAMPLES}건에 못 미친다.`;
    } else if (spread < MIN_PREDICTED_SPREAD) {
      slopeSkipReason = `예측값의 폭이 ${round6(spread)}점뿐이다 — 기울기는 잡음의 외삽이 된다.`;
    } else {
      const actual = samples.map(actualOf);
      const mx = mean(predicted);
      const my = mean(actual);
      const sxx = predicted.reduce((sum, x) => sum + (x - mx) ** 2, 0);
      const sxy = predicted.reduce(
        (sum, x, i) => sum + (x - mx) * (actual[i]! - my),
        0,
      );
      const beta = sxy / sxx;
      const alpha = my - beta * mx;
      const sse = actual.reduce(
        (sum, y, i) => sum + (y - (alpha + beta * predicted[i]!)) ** 2,
        0,
      );
      const sigmaSquared = sse / Math.max(1, samples.length - 2);
      const seBeta = Math.sqrt(sigmaSquared / sxx);
      if (Math.abs(beta - 1) <= BIAS_T_THRESHOLD * seBeta) {
        slopeSkipReason = "기울기가 1과 통계적으로 구별되지 않는다.";
      } else {
        slope = beta;
        offset = alpha;
      }
    }
  }

  if (slope === 1 && config.offset) {
    offset = mean(residuals);
  }

  let schoolStats: SchoolStats[] = [];
  const schoolOffsets = new Map<string, number>();
  if (config.school) {
    const bySchool = new Map<string, number[]>();
    for (const sample of samples) {
      const corrected = slope * sample.predicted + offset;
      const list = bySchool.get(sample.school);
      const value = actualOf(sample) - corrected;
      if (list) list.push(value);
      else bySchool.set(sample.school, [value]);
    }
    schoolStats = fitSchoolOffsets(bySchool);
    for (const stat of schoolStats) {
      if (stat.weight > 0) schoolOffsets.set(stat.school, stat.shrunk);
    }
  }

  return { offset, slope, schoolOffsets, schoolStats, slopeSkipReason };
}

function predictWith(fitted: Fitted, sample: CalibrationSample): number {
  const schoolOffset = fitted.schoolOffsets.get(sample.school) ?? 0;
  return fitted.slope * sample.predicted + fitted.offset + schoolOffset;
}

/**
 * 홀드아웃(leave-one-out) 오차. 표본 하나를 빼고 계수를 다시 적합해 그 하나를 맞춰 본다.
 * **같은 표본으로 계수를 고르고 같은 표본으로 좋아졌다고 말하지 않기 위한 장치**다.
 */
function holdoutErrors(
  samples: CalibrationSample[],
  config: StageConfig,
): number[] {
  if (!config.offset && !config.slope && !config.school) {
    return samples.map((s) => Math.abs(s.residual));
  }
  return samples.map((sample, i) => {
    const train = samples.filter((_, j) => j !== i);
    const fitted = fit(train, config);
    return Math.abs(actualOf(sample) - predictWith(fitted, sample));
  });
}

// ─────────────────────────────────────────────
// 본체
// ─────────────────────────────────────────────

export type EstimateCalibrationOptions = {
  /** 엔진이 선언한 구간 신뢰수준(예: 0.8). 모르면 넘기지 않는다 — 정직성 판정을 하지 않는다. */
  nominalCoverage?: number;
};

/**
 * 실측 잔차로 다음 예측을 보정할 계수를 추정한다.
 *
 * **표본이 부족하면 계수를 지어내지 않고 `judgementUnavailable` 을 돌려준다.**
 * 이 함수에서 가장 중요한 성질이다.
 */
export function estimateCalibration(
  samples: CalibrationSample[],
  options: EstimateCalibrationOptions = {},
): CalibrationOutcome {
  if (samples.length < MIN_CALIBRATION_SAMPLES) {
    return {
      judgementUnavailable: true,
      reason: "표본_부족",
      sampleCount: samples.length,
      requiredSampleCount: MIN_CALIBRATION_SAMPLES,
      message: `실측 표본이 ${samples.length}건이다. ${MIN_CALIBRATION_SAMPLES}건 미만에서는 계수를 추정하지 않는다.`,
    };
  }

  const engineVersions = [...new Set(samples.map((s) => s.engineVersion))];
  if (engineVersions.length > 1) {
    return {
      judgementUnavailable: true,
      reason: "엔진버전_혼재",
      sampleCount: samples.length,
      requiredSampleCount: MIN_CALIBRATION_SAMPLES,
      message: `엔진 버전이 ${engineVersions.length}종 섞여 있다(${engineVersions.join(", ")}). 버전이 다르면 지표를 섞어서 비교하지 않는다.`,
    };
  }

  const engineVersion = engineVersions[0]!;
  const n = samples.length;
  const residuals = samples.map((s) => s.residual);

  // ── 기준선
  const baseErrors = holdoutErrors(samples, {
    offset: false,
    slope: false,
    school: false,
  });
  const maeBefore = mean(baseErrors);

  const stages: CalibrationStage[] = [];
  let adopted: StageConfig = { offset: false, slope: false, school: false };
  let adoptedErrors = baseErrors;
  let adoptedMae = maeBefore;

  // ── 1단계: 전체 오프셋
  const offsetErrors = holdoutErrors(samples, { ...adopted, offset: true });
  const offsetMae = mean(offsetErrors);
  const offsetApply = offsetMae < adoptedMae;
  stages.push({
    name: "전체_오프셋",
    apply: offsetApply,
    maeBefore: round6(adoptedMae),
    maeAfter: round6(offsetMae),
    note: offsetApply
      ? "홀드아웃 MAE 가 개선돼 채택한다."
      : "홀드아웃 MAE 가 개선되지 않아 채택하지 않는다.",
  });
  if (offsetApply) {
    adopted = { ...adopted, offset: true };
    adoptedErrors = offsetErrors;
    adoptedMae = offsetMae;
  }

  // ── 2단계: 전체 기울기(환산 계수)
  const slopeProbe = fit(samples, { ...adopted, slope: true });
  if (slopeProbe.slopeSkipReason !== null) {
    stages.push({
      name: "전체_기울기",
      apply: false,
      maeBefore: round6(adoptedMae),
      maeAfter: round6(adoptedMae),
      note: slopeProbe.slopeSkipReason,
    });
  } else {
    const slopeErrors = holdoutErrors(samples, { ...adopted, slope: true });
    const slopeMae = mean(slopeErrors);
    const slopeApply = slopeMae < adoptedMae;
    stages.push({
      name: "전체_기울기",
      apply: slopeApply,
      maeBefore: round6(adoptedMae),
      maeAfter: round6(slopeMae),
      note: slopeApply
        ? `기울기 ${round6(slopeProbe.slope)} — 홀드아웃 MAE 가 개선돼 채택한다.`
        : `기울기 ${round6(slopeProbe.slope)} 를 시도했으나 홀드아웃 MAE 가 개선되지 않았다.`,
    });
    if (slopeApply) {
      adopted = { ...adopted, slope: true };
      adoptedErrors = slopeErrors;
      adoptedMae = slopeMae;
    }
  }

  // ── 3단계: 학교 오프셋(계층 축소) — **학교 단위로 쪼개서 채택한다**
  const schoolConfig: StageConfig = { ...adopted, school: true };
  const schoolErrors = holdoutErrors(samples, schoolConfig);
  const fittedWithSchool = fit(samples, schoolConfig);

  const perSchool = new Map<string, { before: number[]; after: number[] }>();
  samples.forEach((sample, i) => {
    const bucket = perSchool.get(sample.school) ?? { before: [], after: [] };
    bucket.before.push(adoptedErrors[i]!);
    bucket.after.push(schoolErrors[i]!);
    perSchool.set(sample.school, bucket);
  });

  const statsBySchool = new Map(
    fittedWithSchool.schoolStats.map((s) => [s.school, s]),
  );
  const schools: SchoolCoefficient[] = [...perSchool.entries()]
    .map(([school, bucket]) => {
      const stat = statsBySchool.get(school);
      const before = mean(bucket.before);
      const after = mean(bucket.after);
      const weight = stat?.weight ?? 0;
      const shrunk = weight > 0 ? (stat?.shrunk ?? 0) : 0;
      return {
        school,
        sampleCount: bucket.before.length,
        rawOffset: round6(stat?.mean ?? 0),
        shrunkOffset: round6(shrunk),
        shrinkageWeight: round6(weight),
        maeBefore: round6(before),
        maeAfter: round6(after),
        apply: weight > 0 && after < before,
      };
    })
    .sort(
      (a, b) =>
        b.sampleCount - a.sampleCount || a.school.localeCompare(b.school),
    );

  const adoptedSchools = schools.filter((s) => s.apply);
  const schoolOffsets: Record<string, number> = {};
  for (const school of adoptedSchools) {
    schoolOffsets[school.school] = school.shrunkOffset;
  }

  // 학교 단위로 갈라 채택했으므로 최종 오차도 학교별로 갈라 모은다.
  const adoptedSchoolNames = new Set(adoptedSchools.map((s) => s.school));
  const finalErrors = samples.map((sample, i) =>
    adoptedSchoolNames.has(sample.school)
      ? schoolErrors[i]!
      : adoptedErrors[i]!,
  );
  const finalMae = mean(finalErrors);

  stages.push({
    name: "학교_오프셋",
    apply: adoptedSchools.length > 0,
    maeBefore: round6(adoptedMae),
    maeAfter: round6(finalMae),
    note:
      adoptedSchools.length > 0
        ? `학교 ${schools.length}곳 중 ${adoptedSchools.length}곳만 채택했다(홀드아웃이 나빠진 학교는 뺀다).`
        : "학교 고유 신호가 잡음에 묻혀(축소 가중 0) 학교 계수를 만들지 않는다.",
  });

  const finalFit = fit(samples, adopted);
  const coefficients: CalibrationCoefficients = {
    engineVersion,
    offset: round6(finalFit.offset),
    slope: round6(finalFit.slope),
    schoolOffsets,
  };

  // ── 편향
  const meanResidual = mean(residuals);
  const stdev = sampleStdev(residuals);
  const standardError = stdev / Math.sqrt(n);
  let tStatistic: number;
  if (standardError === 0) {
    tStatistic =
      meanResidual === 0 ? 0 : Math.sign(meanResidual) * MAX_T_STATISTIC;
  } else {
    tStatistic = meanResidual / standardError;
  }
  const detected = Math.abs(tStatistic) > BIAS_T_THRESHOLD;
  const bias: BiasReport = {
    detected,
    meanResidual: round6(meanResidual),
    standardError: round6(standardError),
    tStatistic: round6(tStatistic),
    direction: detected ? (meanResidual > 0 ? "과소예측" : "과대예측") : null,
  };

  // ── 구간 적중률 (점 예측 MAE 와 별개 지표)
  const hitRate = samples.filter((s) => s.intervalHit).length / n;
  const nominalCoverage = options.nominalCoverage ?? null;
  let intervalHonest: boolean | null = null;
  if (nominalCoverage !== null) {
    const se = Math.sqrt((nominalCoverage * (1 - nominalCoverage)) / n);
    intervalHonest = Math.abs(hitRate - nominalCoverage) <= 2 * se;
  }

  return {
    judgementUnavailable: false,
    engineVersion,
    sampleCount: n,
    schoolCount: schools.length,
    coefficients,
    stages,
    schools,
    bias,
    maeBefore: round6(maeBefore),
    maeAfter: round6(finalMae),
    improved: round6(finalMae) < round6(maeBefore),
    intervalHitRate: round6(hitRate),
    nominalCoverage,
    intervalHonest,
  };
}
