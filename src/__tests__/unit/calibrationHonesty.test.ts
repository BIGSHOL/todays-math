/**
 * 🔴 보정 리포트가 **없는 개선을 주장하지 않는가** — 적대적 리뷰 회귀.
 *
 * 단계별 오차는 leave-one-out 이라 정직하다. 그런데 **어느 단계를 채택할지도 같은
 * 표본으로 정한다.** 진짜 신호가 없어도 어떤 단계는 우연히 나아 보이고, 그게 채택되어
 * "개선"으로 보고된다. 원장님은 좋아졌다는 보고를 받고 **나빠진 계수를 쓰게 된다.**
 *
 * 실측(신호가 전혀 없는 합성 표본 40건 × 10회): 예전 규칙은 10회 중 **3회** 개선을
 * 주장했다. 짝지은 부트스트랩 95% 구간이 전부 0보다 클 때만 개선으로 보게 고친 뒤
 * **0회**가 됐고, 진짜 편향이 있는 자료에서는 10회 중 8회를 그대로 잡아낸다.
 *
 * ⚠️ 이 파일이 지키는 것은 "MAE 가 낮아졌나"가 아니라 **"그 낮아짐을 믿어도 되나"** 다.
 *    가드가 과해져 진짜 신호까지 막으면 그것도 결함이므로 양쪽을 함께 잠근다.
 */
import { describe, expect, it } from "vitest";

import {
  estimateCalibration,
  MIN_CALIBRATION_SAMPLES,
} from "@/lib/predictor/calibration";
import type { CalibrationSample } from "@/contracts/calibration.contract";

/** 결정적 난수 — 테스트가 회차마다 흔들리면 안 된다. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}
function gauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
}

function samples(seed: number, bias = 0, n = 40): CalibrationSample[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const predicted = 60 + gauss(r) * 12;
    const residual = bias + gauss(r) * 8;
    return {
      runId: `run-${i}`,
      studentId: `student-${i}`,
      engineVersion: "0.6.0",
      school: `학교${String(i % 5).padStart(2, "0")}`,
      predicted,
      actual: predicted + residual,
      residual,
      intervalHit: false,
      hasInterval: false,
    };
  });
}

const SEEDS = [1, 7, 13, 29, 42, 77, 101, 233, 512, 999];

function improvedCount(bias: number): number {
  let count = 0;
  for (const seed of SEEDS) {
    const out = estimateCalibration(samples(seed, bias));
    if ("judgementUnavailable" in out && out.judgementUnavailable) continue;
    if (out.improved) count += 1;
  }
  return count;
}

describe("[T7.20] 보정 리포트의 정직성", () => {
  it("🔴 보정할 것이 없는 자료에서 '개선'을 주장하지 않는다", () => {
    // 예전 규칙은 여기서 10회 중 3회 개선을 주장했다.
    expect(improvedCount(0)).toBe(0);
  });

  it("진짜 편향이 있으면 그대로 잡아낸다 — 가드가 과하면 그것도 결함이다", () => {
    expect(improvedCount(8)).toBeGreaterThanOrEqual(7);
  });

  it("같은 입력이면 같은 판정이다 — 부트스트랩 난수를 고정했다", () => {
    const a = estimateCalibration(samples(42, 8));
    const b = estimateCalibration(samples(42, 8));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("표본이 모자라면 여전히 판단하지 않는다", () => {
    const out = estimateCalibration(samples(1, 8, MIN_CALIBRATION_SAMPLES - 1));
    expect("judgementUnavailable" in out && out.judgementUnavailable).toBe(
      true,
    );
  });
});
