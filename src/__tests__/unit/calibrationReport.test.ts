/**
 * 🟢 T7.11 — 보정 계수 리포트(`scripts/predictor/calibration-report.ts`)의 순수 부분.
 *
 * 왜 이 테스트가 있는가.
 * 이 리포트가 실제로 처음 돌 때의 상태는 **실측 0건**이다. 그때 나와야 하는 것은
 * 빈 표나 0.000 이 늘어선 그럴듯한 표가 아니라 **"판단 불가"** 한 줄이다.
 * 이 프로젝트는 근거 없이 값을 낸 적이 있고(0문항 0점 청사진), 리포트는 그 실수가
 * 가장 쉽게 되살아나는 자리다 — 표 틀이 이미 있으니 채우고 싶어진다.
 * 그래서 "0건 → 판단 불가, 숫자 없음"을 테스트로 못 박는다.
 *
 * DB 없이 검증한다. 스크립트의 IO(`runCalibrationReport`)는 얇고, 판단과 표현은
 * 전부 여기 걸린 순수 함수에 있다.
 */
import { describe, expect, it } from "vitest";

import type { CalibrationSample } from "@/contracts/calibration.contract";
import { estimateCalibration } from "@/lib/predictor/calibration";
import {
  buildCalibrationSamples,
  renderCalibrationReport,
  resolveNominalCoverage,
  type ActualScoreRowWithRun,
} from "../../../scripts/predictor/calibration-report";

const META = {
  databaseHost: "db.example.supabase.co",
  databaseReason: "Supabase 공유 DB",
  rowCount: 0,
  engineFilter: null,
  schoolFilter: null,
  nominalCoverage: null,
  coverageMixed: false,
};

function dbRow(
  overrides: Partial<ActualScoreRowWithRun> = {},
): ActualScoreRowWithRun {
  return {
    runId: "aaaaaaaa-0000-4000-8000-000000000001",
    studentId: "30000000-0000-4000-8000-000000000001",
    predictedScore: 72,
    actualScore: 78,
    residual: 6,
    intervalHit: true,
    predictedLower: 65,
    predictedUpper: 79,
    predictedCoverage: 0.8,
    run: { engineVersion: "0.2.0", school: "정화중" },
    ...overrides,
  };
}

describe("[T7.11] 실측이 없을 때의 리포트", () => {
  it("0건이면 판단 불가를 찍고 계수 표를 만들지 않는다", () => {
    const outcome = estimateCalibration(buildCalibrationSamples([]));
    const body = renderCalibrationReport(outcome, META);

    expect(body).toContain("## 판단 불가");
    expect(body).toContain("표본_부족");
    expect(body).toContain("실측이 아직 한 건도 없다");
    expect(body).toContain("이것이 정상 출력이다");

    // 근거가 없는데 표를 그리지 않는다.
    expect(body).not.toContain("## 요약");
    expect(body).not.toContain("## 단계별 채택");
    expect(body).not.toContain("## 학교별 계수");
    expect(body).not.toContain("0.000");
  });

  it("어느 DB 를 읽었는지 항상 머리에 남긴다", () => {
    const body = renderCalibrationReport(estimateCalibration([]), {
      ...META,
      databaseHost: "db.example.supabase.co",
    });
    expect(body).toContain("db.example.supabase.co");
    expect(body).toContain("읽기 전용");
  });
});

describe("[T7.11] DB 행 → 표본 변환", () => {
  it("구간 스냅샷이 없는 행은 hasInterval=false 로 표시한다", () => {
    const samples = buildCalibrationSamples([
      dbRow(),
      dbRow({
        studentId: "30000000-0000-4000-8000-000000000002",
        predictedLower: null,
        predictedUpper: null,
        predictedCoverage: null,
        intervalHit: false,
      }),
    ]);
    expect(samples[0]!.hasInterval).toBe(true);
    expect(samples[1]!.hasInterval).toBe(false);
    expect(samples[0]!.school).toBe("정화중");
    expect(samples[0]!.engineVersion).toBe("0.2.0");
  });

  it("선언된 신뢰수준이 하나면 그것을 쓰고, 섞여 있으면 단정하지 않는다", () => {
    expect(resolveNominalCoverage([dbRow()])).toEqual({
      coverage: 0.8,
      mixed: false,
    });
    expect(
      resolveNominalCoverage([dbRow(), dbRow({ predictedCoverage: 0.95 })]),
    ).toEqual({ coverage: null, mixed: true });
    expect(
      resolveNominalCoverage([dbRow({ predictedCoverage: null })]),
    ).toEqual({ coverage: null, mixed: false });
  });
});

describe("[T7.11] 표본이 쌓였을 때의 리포트", () => {
  const samples: CalibrationSample[] = Array.from({ length: 30 }, (_, i) => {
    const residual = i % 2 === 0 ? 10 : 6;
    return {
      runId: "aaaaaaaa-0000-4000-8000-000000000001",
      studentId: `30000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      engineVersion: "0.2.0",
      school: ["정화중", "경명여중", "대륜중"][i % 3]!,
      predicted: 70,
      actual: 70 + residual,
      residual,
      intervalHit: i % 5 !== 0,
      hasInterval: true,
    };
  });

  it("단계 표·학교 표·편향·구간을 모두 찍는다", () => {
    const outcome = estimateCalibration(samples, { nominalCoverage: 0.8 });
    const body = renderCalibrationReport(outcome, {
      ...META,
      rowCount: samples.length,
      nominalCoverage: 0.8,
    });

    expect(body).toContain("## 요약");
    expect(body).toContain("## 단계별 채택");
    expect(body).toContain("전체_오프셋");
    expect(body).toContain("## 학교별 계수");
    expect(body).toContain("정화중");
    expect(body).toContain("경명여중");
    expect(body).toContain("편향 있음 — 과소예측");
    expect(body).toContain("## 구간");
    expect(body).not.toContain("## 판단 불가");
  });
});
