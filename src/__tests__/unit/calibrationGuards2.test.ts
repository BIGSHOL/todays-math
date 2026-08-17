/**
 * 🔴 D.1 — 첫 실측이 들어오기 전에 닫아야 할 보정 가드 (15 §D.1).
 *
 * adv1 리뷰가 재현한 것들 중 소규모 두 건:
 *
 * 1) 한 학교 20건이 **전역 오프셋을 독점**한다. 학교가 1곳이면 그 학교의 편향과
 *    엔진 자체의 편향을 구분할 수 없는데, 전역 오프셋은 학교를 가리지 않고 더해져
 *    실측이 0건인 학교의 예상 점수가 8점 움직였다.
 *
 * 2) 엔진 파라미터를 바꿔도 버전 문자열이 안 올라간다 — 부탁하는 주석만 있고
 *    강제하는 장치가 없다. 버전이 같으면 보정은 서로 다른 엔진의 잔차를 한 통에 넣는다.
 */
import { describe, expect, it } from "vitest";

import type { CalibrationSample } from "@/contracts/calibration.contract";
import {
  estimateCalibration,
  MIN_CALIBRATION_SCHOOLS,
} from "@/lib/predictor/calibration";
import {
  DEFAULT_PARAMS,
  PREDICTOR_ENGINE_VERSION,
} from "@/lib/predictor/predictBlueprint";

function sample(
  i: number,
  school: string,
  residual: number,
): CalibrationSample {
  const predicted = 60 + (i % 7);
  return {
    runId: `run-${i}`,
    studentId: `student-${i}`,
    engineVersion: "0.6.0",
    school,
    predicted,
    actual: predicted + residual,
    residual,
    intervalHit: false,
    hasInterval: false,
  };
}

describe("[T7.22] 학교 수 하한 — 한 학교가 전국 계수를 정하지 못한다", () => {
  it("🔴 학교가 1곳뿐이면 표본이 충분해도 판단하지 않는다", () => {
    const samples = Array.from({ length: 25 }, (_, i) =>
      sample(i, "가중", 8 + (i % 3)),
    );
    const out = estimateCalibration(samples);
    expect("judgementUnavailable" in out && out.judgementUnavailable).toBe(
      true,
    );
    if ("judgementUnavailable" in out && out.judgementUnavailable) {
      expect(out.reason).toBe("학교_부족");
      // 왜 안 되는지 사람 말로 적는다 — 원장이 다음에 뭘 해야 할지 알아야 한다.
      expect(out.message).toContain(String(MIN_CALIBRATION_SCHOOLS));
    }
  });

  it("학교가 하한 이상이면 정상 추정한다", () => {
    const samples = Array.from({ length: 30 }, (_, i) =>
      sample(i, `학교${i % MIN_CALIBRATION_SCHOOLS}`, 8),
    );
    const out = estimateCalibration(samples);
    expect("judgementUnavailable" in out && out.judgementUnavailable).toBe(
      false,
    );
  });
});

describe("[T7.22] 엔진 버전 ↔ 파라미터 스냅샷", () => {
  /**
   * 이 스냅샷이 깨졌다면 **파라미터를 바꾸고 버전을 안 올린 것**이다.
   * `PREDICTOR_ENGINE_VERSION` 을 올리고 이 스냅샷을 갱신하라. 버전을 안 올리면
   * 서로 다른 엔진의 잔차가 같은 보정 통에 들어가 계수가 오염된다(adv1 재현:
   * 두 무리가 각각 +9/−9점 틀렸는데 리포트는 "편향 없음"이라고 적었다).
   */
  it("🔴 DEFAULT_PARAMS 값과 버전 문자열이 함께 잠긴다", () => {
    expect({
      version: PREDICTOR_ENGINE_VERSION,
      params: DEFAULT_PARAMS,
    }).toEqual({
      version: "0.6.0",
      params: {
        decay: 0.85,
        sameRoundBoost: 4,
        priorWeight: 2,
        stylePriorWeight: 0,
        gridPriorWeight: 0,
        gridDecay: 0.4,
        unitOwnWeight: 0.25,
      },
    });
  });
});
