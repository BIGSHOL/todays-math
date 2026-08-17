/**
 * 적대적 재현 (읽기 전용, 삭제 가능)
 *  ① 엔진 파라미터가 달라도 engineVersion 은 같게 찍힌다 → 보정이 섞인 표본을 못 거른다.
 *  ② 학교 평균만 다시 보내면 이전에 저장한 학교 표준편차가 조용히 지워진다.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_A = "aaaaaaaa-0000-4000-8000-00000000000a";

const sessionState = vi.hoisted(() => ({
  user: null as { id: string; email: string; name: string } | null,
}));
vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => sessionState.user),
}));
vi.mock("@/lib/db", async () => {
  const mod = await import("@/__tests__/helpers/predictionRunTestDb");
  return { db: mod.predictionTestDb };
});

import { POST as createPrediction } from "@/app/api/predictions/route";
import {
  allPredictionRuns,
  resetPredictionTestDb,
  seedExam,
  standardQuestions,
} from "@/__tests__/helpers/predictionRunTestDb";
import { estimateCalibration } from "@/lib/predictor/calibration";
import type { CalibrationSample } from "@/contracts/calibration.contract";

const SCHOOL = "가람중";
const SERIES = {
  school: SCHOOL,
  level: "중" as const,
  grade: 3,
  subject: "중3",
};
const TARGET = { year: 2026, semester: 1 as const, round: "중간" as const };

function post(body: unknown) {
  return createPrediction(
    new NextRequest("http://localhost/api/predictions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  resetPredictionTestDb();
  sessionState.user = { id: USER_A, email: "w@t.test", name: "원장" };
  for (const [y, s, r] of [
    [2025, 1, "중간"],
    [2025, 2, "중간"],
    [2025, 2, "기말"],
  ] as const) {
    seedExam({
      externalExamId: `가람-${y}-${s}-${r}`,
      school: SCHOOL,
      year: y,
      semester: s,
      round: r,
      questions: standardQuestions({ count: y === 2025 && s === 1 ? 20 : 25 }),
    });
  }
});

describe("[적대적] engineVersion 이 '같은 엔진' 을 실제로 보증하는가", () => {
  it("파라미터를 바꿔 실행하면 engineVersion 이 달라진다", async () => {
    await post({ series: SERIES, targetPeriod: TARGET });
    await post({
      series: SERIES,
      targetPeriod: TARGET,
      // 코호트 축소·감쇠를 통째로 뒤집는다 — 사실상 다른 엔진이다.
      params: {
        decay: 0.2,
        sameRoundBoost: 20,
        stylePriorWeight: 100,
        unitOwnWeight: 1,
      },
    });

    const runs = allPredictionRuns();
    expect(runs).toHaveLength(2);
    type StoredRun = {
      engineVersion: string;
      params: { predictor: Record<string, number> };
      predictedBlueprint: { questionCount?: number } | null;
    };
    const [a, b] = runs as unknown as [StoredRun, StoredRun];

    // 파라미터 스냅샷은 확실히 다르다.
    expect(a.params.predictor).not.toEqual(b.params.predictor);
    // 청사진도 다르게 나왔다(= 서로 다른 예측을 낸다).
    console.log("  run A 파라미터:", JSON.stringify(a.params.predictor));
    console.log("  run B 파라미터:", JSON.stringify(b.params.predictor));
    console.log("  run A 청사진 문항수:", a.predictedBlueprint?.questionCount);
    console.log("  run B 청사진 문항수:", b.predictedBlueprint?.questionCount);
    console.log("  engineVersion A/B:", a.engineVersion, "/", b.engineVersion);

    // 보정이 표본을 가르는 근거는 engineVersion 하나뿐이다.
    expect(a.engineVersion).not.toBe(b.engineVersion);
  });

  it("engineVersion 이 같으면 보정은 두 엔진의 잔차를 그냥 합친다", () => {
    const mk = (
      school: string,
      residual: number,
      i: number,
    ): CalibrationSample => ({
      runId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      studentId: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      engineVersion: "0.5.0",
      school,
      predicted: 60 + (i % 7),
      actual: 60 + (i % 7) + residual,
      residual,
      intervalHit: true,
      hasInterval: true,
    });
    // 파라미터 A 로 낸 표본은 +9점 과소예측, 파라미터 B 로 낸 표본은 −9점 과대예측.
    // 학교는 3곳 — MIN_CALIBRATION_SCHOOLS(학교_부족) 가드에 걸리지 않게 해서
    // "엔진 혼합을 감지하는가"만 남긴다(2026-08-17, 가드 추가 후 픽스처 갱신).
    const pooled = [
      ...Array.from({ length: 10 }, (_, i) => mk(`가중`, 9, i)),
      ...Array.from({ length: 10 }, (_, i) => mk(`나중`, -9, i + 100)),
      ...Array.from({ length: 10 }, (_, i) =>
        mk(`다중`, i % 2 === 0 ? 9 : -9, i + 200),
      ),
    ];
    const out = estimateCalibration(pooled);
    if (out.judgementUnavailable) {
      console.log("  판단 불가:", out.reason);
    } else {
      console.log(
        "  bias.detected =",
        out.bias.detected,
        " meanResidual =",
        out.bias.meanResidual,
      );
      console.log(
        "  전역 offset =",
        out.coefficients.offset,
        " improved =",
        out.improved,
      );
    }
    // 두 엔진이 각각 9점씩 반대로 틀렸는데 "섞여 있어 판단할 수 없다"는 신호가 나와야 한다.
    // 지금 엔진은 engineVersion 이 같으면 그냥 합쳐 계산한다 — 그래서 이 테스트는 빨갛다.
    expect(out.judgementUnavailable).toBe(true);
  });
});
