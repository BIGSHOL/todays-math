/**
 * 적대적 재현 (읽기 전용, 삭제 가능) — 엔진이 파라미터를 하나 늘리거나 줄이면
 * **이미 저장된 과거 run 의 상세 조회**가 어떻게 되는가.
 *
 * predictionRun.contract.ts 는 "정의가 하나뿐이라 표류 자체가 불가능하다"고 적는다.
 * 계약 **복제**는 사라졌지만, 저장된 행과 현재 스키마 사이의 표류는 그대로 남는다.
 * `predictorParamsSchema` 는 z.strictObject 라 양방향으로 깨진다.
 */
import { describe, expect, it } from "vitest";

import { serializePredictionRunDetail } from "@/lib/predictor/predictionRunService";
import { DEFAULT_PARAMS } from "@/lib/predictor/predictBlueprint";

function runRow(predictorParams: Record<string, unknown>) {
  return {
    id: "aaaaaaaa-0000-4000-8000-00000000000a",
    userId: "11111111-0000-4000-8000-000000000001",
    createdAt: new Date("2026-08-16T00:00:00Z"),
    engineVersion: "0.4.0",
    riskFlags: [],
    examDate: null,
    school: "가람중",
    level: "중",
    grade: 3,
    subject: "중3",
    targetYear: 2026,
    targetSemester: 1,
    targetRound: "중간",
    cutoffYear: 2026,
    cutoffSemester: 1,
    cutoffRound: "중간",
    inputExamIds: ["가람-2025-2-기말"],
    params: {
      predictor: predictorParams,
      evidence: {
        history: 1,
        cohort: 0,
        rangeHistory: 0,
        rangeCohort: 0,
        excludedByTrust: 0,
        excludedBySource: 0,
        pinned: false,
      },
      unavailableReason: null,
    },
    predictedBlueprint: null,
    predictedScores: [],
    actualSchoolMean: null,
    actualSchoolStdev: null,
    actualRecordedAt: null,
  } as never;
}

describe("[적대적] 저장된 run 과 현재 파라미터 스키마의 표류", () => {
  it("현재 엔진이 저장한 run 은 당연히 읽힌다 (대조군)", () => {
    expect(() =>
      serializePredictionRunDetail(runRow({ ...DEFAULT_PARAMS })),
    ).not.toThrow();
  });

  it("엔진이 파라미터를 하나 늘리기 **전에** 저장된 run 도 계속 읽혀야 한다", () => {
    // 옛 엔진에는 stylePriorWeight 가 없었다(주석에 실제로 그 사건이 적혀 있다).
    const old = { ...DEFAULT_PARAMS } as Record<string, unknown>;
    delete old.stylePriorWeight;
    let err: unknown = null;
    try {
      serializePredictionRunDetail(runRow(old));
    } catch (e) {
      err = e;
    }
    console.log(
      "  결과:",
      err ? `throw → ${(err as Error).message}` : "정상 조회",
    );
    expect(err).toBeNull();
  });

  it("엔진이 파라미터를 **줄인 뒤** 옛 run 을 읽어도 계속 읽혀야 한다", () => {
    const old = { ...DEFAULT_PARAMS, retiredKnob: 0.3 } as Record<
      string,
      unknown
    >;
    let err: unknown = null;
    try {
      serializePredictionRunDetail(runRow(old));
    } catch (e) {
      err = e;
    }
    console.log(
      "  결과:",
      err ? `throw → ${(err as Error).message}` : "정상 조회",
    );
    expect(err).toBeNull();
  });
});
