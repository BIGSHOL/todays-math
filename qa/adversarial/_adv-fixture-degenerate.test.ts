/**
 * 적대적 재현 (읽기 전용, 삭제 가능) — τ̂²=0 보호막이 언제 성립하고 언제 무너지는가.
 *
 * calibration.ts fitSchoolOffsets 주석의 주장:
 *   "학교 고유 신호가 잡음에 묻히면 τ̂² 이 0 이 되고 … 학교 하나에 2명 응시한 걸로
 *    그 학교 계수를 확정하는 일이 **구조적으로 불가능하다**"
 *
 * 기존 calibration.test.ts 는 잔차가 ±5 / ±6 **두 값만** 갖는 픽스처로 이를 확인한다.
 * 여기서는 (a) 그 픽스처에서는 실제로 성립하고, (b) 잔차가 연속값이면 무너진다는 것을
 * 같은 파일에서 나란히 보인다. 학교 효과는 두 경우 모두 **정확히 0** 이다.
 */
import { describe, expect, it } from "vitest";

import { estimateCalibration } from "@/lib/predictor/calibration";
import type { CalibrationSample } from "@/contracts/calibration.contract";

let seq = 0;
function s(school: string, residual: number, predicted = 70): CalibrationSample {
  seq += 1;
  return {
    runId: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    studentId: `10000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    engineVersion: "predictor-v0.3.0",
    school,
    predicted,
    actual: predicted + residual,
    residual,
    intervalHit: true,
    hasInterval: true,
  };
}

/**
 * 학교 효과 0, 전역 편향 0 인 연속 잡음(N(0,8²)) 30건 / 학교 10곳.
 * scripts/qa/_adv-calibration-probe.ts 의 A 절과 같은 씨앗(20260816)에서 뽑은 값을
 * 그대로 박아 결정적으로 만들었다.
 */
const CONTINUOUS: Array<[string, number, number]> = [
  ["학교00", 87, -3.85], ["학교01", 66, 1.11], ["학교02", 68, 4.61], ["학교03", 90, -13.6],
  ["학교04", 73, 5.53], ["학교05", 66, 8.2], ["학교06", 90, -1.51], ["학교07", 62, -6.03],
  ["학교08", 68, 8.9], ["학교09", 79, -1.94], ["학교00", 63, 4.44], ["학교01", 76, -9.02],
  ["학교02", 88, 2.7], ["학교03", 62, -6.75], ["학교04", 84, 3.99], ["학교05", 63, 15.42],
  ["학교06", 76, -0.62], ["학교07", 71, -6.63], ["학교08", 61, -3.99], ["학교09", 66, -3.51],
  ["학교00", 82, 4.37], ["학교01", 71, 4.99], ["학교02", 64, 3.31], ["학교03", 84, -6.17],
  ["학교04", 76, 2.42], ["학교05", 78, 11.3], ["학교06", 61, 3.61], ["학교07", 90, 1.65],
  ["학교08", 88, 4.37], ["학교09", 82, -4.34],
];

describe("[적대적] τ̂²=0 보호막은 어떤 표본에서 성립하나", () => {
  it("(a) 잔차가 ±5 두 값뿐인 기존 픽스처에서는 성립한다", () => {
    const samples = ["가중", "나중", "다중"].flatMap((school) =>
      Array.from({ length: 10 }, (_, i) => s(school, i % 2 === 0 ? 5 : -5)),
    );
    const out = estimateCalibration(samples);
    if (out.judgementUnavailable) throw new Error(out.reason);
    expect(out.schools.every((x) => x.shrinkageWeight === 0)).toBe(true);
    expect(Object.keys(out.coefficients.schoolOffsets)).toHaveLength(0);
    expect(out.improved).toBe(false);
  });

  it("(b) 같은 '효과 0' 인데 잔차가 연속값이면 없는 학교 계수를 만든다", () => {
    const samples = CONTINUOUS.map(([school, predicted, residual]) =>
      s(school, residual, predicted),
    );
    const out = estimateCalibration(samples);
    if (out.judgementUnavailable) throw new Error(out.reason);

    console.log(`  maeBefore=${out.maeBefore} -> maeAfter=${out.maeAfter} improved=${out.improved}`);
    console.log(`  만들어 낸 학교 계수: ${JSON.stringify(out.coefficients.schoolOffsets)}`);
    for (const x of out.schools) {
      console.log(
        `   ${x.school} n=${x.sampleCount} raw=${x.rawOffset} shrunk=${x.shrunkOffset} w=${x.shrinkageWeight} apply=${x.apply}`,
      );
    }

    // 진짜 학교 효과가 0 이므로 축소 가중은 0 이어야 하고 계수도 없어야 한다.
    expect(out.schools.every((x) => x.shrinkageWeight === 0)).toBe(true);
    expect(Object.keys(out.coefficients.schoolOffsets)).toHaveLength(0);
  });

  it("(c) 학교 안 잔차가 서로 같으면 축소가 아예 걸리지 않는다(가중 1.0)", () => {
    const samples: CalibrationSample[] = [];
    for (let i = 0; i < 10; i += 1) {
      const bias = i - 4.5;
      samples.push(s(`학교${i}`, bias, 60));
      samples.push(s(`학교${i}`, bias, 67));
    }
    const out = estimateCalibration(samples);
    if (out.judgementUnavailable) throw new Error(out.reason);
    const worst = out.schools[0]!;
    console.log(
      `  ${worst.school} n=${worst.sampleCount} raw=${worst.rawOffset} shrunk=${worst.shrunkOffset} w=${worst.shrinkageWeight}`,
    );
    // 2명짜리 학교를 100% 신뢰하는 일은 "구조적으로 불가능" 하다고 적혀 있다.
    expect(out.schools.every((x) => x.shrinkageWeight < 1)).toBe(true);
  });
});
