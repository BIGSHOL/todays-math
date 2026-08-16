/**
 * T7.11 — 보정 계수 리포트 (읽기 전용).
 *
 * `ActualExamScore` 에 쌓인 실측 잔차를 읽어 `estimateCalibration` 을 돌리고, 단계별
 * 채택 판정·홀드아웃 MAE·편향·구간 적중률을 사람이 읽는 표로 찍는다.
 *
 * 🔴 **이 스크립트는 DB 에 쓰지 않는다.** `findMany` 하나만 쓴다. 그래서 `--apply` 도
 *    `ALLOW_SHARED_IMPORT` 도 없다 — 그 게이트는 *쓰기* 를 막는 장치이고 여기엔 쓰기가 없다.
 *    대신 어느 DB 를 읽었는지 항상 머리에 찍어 조작자가 알 수 있게 한다.
 *
 * 🔴 **실측이 0건이면 "판단 불가" 가 정상 출력이다.** 숫자를 만들어 내지 않는다.
 *    이 프로젝트는 근거 없이 값을 낸 적이 있다(0문항 0점 청사진). 표본이 없다는 사실을
 *    그대로 보고하는 것이 이 스크립트가 하는 일의 절반이다.
 *
 * 실행:
 *   npx tsx scripts/predictor/calibration-report.ts
 *   npx tsx scripts/predictor/calibration-report.ts --engine 0.2.0 --school 정화중 --out reports/calib.md
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  CalibrationOutcome,
  CalibrationSample,
} from "../../src/contracts/calibration.contract";
import {
  MIN_CALIBRATION_SAMPLES,
  estimateCalibration,
} from "../../src/lib/predictor/calibration";
import { isDirectScript } from "../import/isDirectScript";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";

/** DB 에서 읽어 오는 한 행. Prisma 타입에 직접 묶지 않아 테스트에서 그대로 만들 수 있다. */
export interface ActualScoreRowWithRun {
  runId: string;
  studentId: string;
  /** 예측이 없던 회차면 null — 잔차를 낼 수 없어 표본이 되지 못한다. */
  predictedScore: number | null;
  actualScore: number;
  residual: number | null;
  intervalHit: boolean;
  predictedLower: number | null;
  predictedUpper: number | null;
  predictedCoverage: number | null;
  run: { engineVersion: string; school: string };
}

export interface CalibrationReportMeta {
  /** 읽은 DB 호스트. 비밀값은 담지 않는다. */
  databaseHost: string | null;
  databaseReason: string;
  rowCount: number;
  /** 그 중 예측이 없어 표본이 되지 못한 행 수. 조용히 버리지 않는다. */
  withoutPrediction: number;
  engineFilter: string | null;
  schoolFilter: string | null;
  /** 표본들이 공통으로 선언한 구간 신뢰수준. 섞여 있으면 null(정직성 판정을 하지 않는다). */
  nominalCoverage: number | null;
  coverageMixed: boolean;
}

// ─────────────────────────────────────────────
// 순수 변환 — 테스트가 여기에 걸린다
// ─────────────────────────────────────────────

/**
 * 실측 행 → 보정 표본.
 *
 * 🔴 **예측 스냅샷이 없는 행은 표본이 될 수 없다.** 잔차가 없으니 계수를 추정할 근거가
 *    아니다. 0 으로 채워 넣으면 "정확히 맞혔다"로 세어져 MAE 가 거짓으로 내려간다.
 *    다만 **조용히 버리지 않는다** — 몇 건을 뺐는지 세어 리포트에 싣는다
 *    (`CalibrationReportMeta.withoutPrediction`).
 *
 *    학생 능력 엔진(11 §3 L3)이 없는 지금은 실측 행이 전부 여기 해당한다.
 *    그래도 실점수는 쌓아 둔다 — 11 §4 가 "환산 계수는 학생 데이터를 먼저 모아야
 *    구한다"고 정한 순서다.
 */
export function buildCalibrationSamples(
  rows: ActualScoreRowWithRun[],
): CalibrationSample[] {
  const samples: CalibrationSample[] = [];
  for (const row of rows) {
    if (row.predictedScore === null || row.residual === null) continue;
    samples.push({
      runId: row.runId,
      studentId: row.studentId,
      engineVersion: row.run.engineVersion,
      school: row.run.school,
      predicted: row.predictedScore,
      actual: row.actualScore,
      residual: row.residual,
      intervalHit: row.intervalHit,
      // 구간 스냅샷이 없으면 적중을 판정할 수 없다 — 분모에서 빠진다.
      hasInterval: row.predictedLower !== null && row.predictedUpper !== null,
    });
  }
  return samples;
}

/** 예측이 없어 표본이 되지 못한 실측 행 수. 조용히 버리지 않으려고 따로 센다. */
export function countWithoutPrediction(rows: ActualScoreRowWithRun[]): number {
  return rows.filter((r) => r.predictedScore === null || r.residual === null)
    .length;
}

/**
 * 표본들이 공통으로 선언한 구간 신뢰수준을 찾는다.
 * 값이 섞여 있으면 하나로 단정하지 않고 null 을 돌려준다 — 구간 정직성 판정을 하지 않는다.
 */
export function resolveNominalCoverage(rows: ActualScoreRowWithRun[]): {
  coverage: number | null;
  mixed: boolean;
} {
  const values = [
    ...new Set(
      rows
        .map((row) => row.predictedCoverage)
        .filter((value): value is number => value !== null),
    ),
  ];
  if (values.length === 0) return { coverage: null, mixed: false };
  if (values.length > 1) return { coverage: null, mixed: true };
  return { coverage: values[0]!, mixed: false };
}

function num(value: number, digits = 3): string {
  return value.toFixed(digits);
}

function row(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

/** 리포트 본문(마크다운). 순수 함수라 DB 없이도 검증할 수 있다. */
export function renderCalibrationReport(
  outcome: CalibrationOutcome,
  meta: CalibrationReportMeta,
): string {
  const lines: string[] = [];
  lines.push("# 보정 계수 리포트 (T7.11)");
  lines.push("");
  lines.push(
    `- 읽은 DB: ${meta.databaseHost ?? "(없음)"} — ${meta.databaseReason}`,
  );
  lines.push(`- 실측 행 수: ${meta.rowCount}`);
  if (meta.withoutPrediction > 0) {
    lines.push(
      `- 그 중 **예측이 없어 표본에서 뺀 행: ${meta.withoutPrediction}건** ` +
        "(잔차를 낼 수 없다 — 0 으로 세지 않는다). " +
        "학생 능력 엔진(11 §3 L3)이 붙으면 이 수가 줄어든다.",
    );
  }
  lines.push(`- 엔진 필터: ${meta.engineFilter ?? "(전체)"}`);
  lines.push(`- 학교 필터: ${meta.schoolFilter ?? "(전체)"}`);
  if (meta.coverageMixed) {
    lines.push(
      "- 구간 신뢰수준: 표본마다 다르다 — 하나로 단정하지 않고 정직성 판정을 하지 않는다.",
    );
  } else {
    lines.push(
      `- 구간 신뢰수준: ${meta.nominalCoverage === null ? "(구간 스냅샷 없음)" : num(meta.nominalCoverage, 2)}`,
    );
  }
  lines.push("- 이 스크립트는 DB 에 쓰지 않는다(읽기 전용).");
  lines.push("");

  if (outcome.judgementUnavailable) {
    lines.push("## 판단 불가");
    lines.push("");
    lines.push(`- 사유: ${outcome.reason}`);
    lines.push(
      `- 표본: ${outcome.sampleCount}건 / 필요: ${outcome.requiredSampleCount}건`,
    );
    lines.push(`- ${outcome.message}`);
    lines.push("");
    lines.push(
      outcome.sampleCount === 0
        ? "실측이 아직 한 건도 없다. **이것이 정상 출력이다** — 표본이 없으면 계수를 지어내지 않는다."
        : `표본이 ${MIN_CALIBRATION_SAMPLES}건에 못 미친다. 더 쌓일 때까지 보정을 적용하지 않는다.`,
    );
    return lines.join("\n") + "\n";
  }

  lines.push("## 요약");
  lines.push("");
  lines.push(`- 엔진 버전: ${outcome.engineVersion}`);
  lines.push(
    `- 표본: ${outcome.sampleCount}건 / 학교 ${outcome.schoolCount}곳`,
  );
  lines.push(
    `- MAE: 보정 전 ${num(outcome.maeBefore)} → 홀드아웃 ${num(outcome.maeAfter)} ` +
      `(${outcome.improved ? "개선" : "개선 없음 — 보정을 적용하지 않는 쪽이 옳다"})`,
  );
  lines.push(
    `- 계수: slope=${num(outcome.coefficients.slope)} offset=${num(outcome.coefficients.offset)} ` +
      `학교별 ${Object.keys(outcome.coefficients.schoolOffsets).length}곳`,
  );
  lines.push("");

  lines.push("## 단계별 채택 (합산하지 않고 하나씩 홀드아웃으로 판정)");
  lines.push("");
  lines.push(row(["단계", "채택", "MAE 전", "MAE 후", "메모"]));
  lines.push(row(["---", "---", "---:", "---:", "---"]));
  for (const stage of outcome.stages) {
    lines.push(
      row([
        stage.name,
        stage.apply ? "채택" : "미채택",
        num(stage.maeBefore),
        num(stage.maeAfter),
        stage.note,
      ]),
    );
  }
  lines.push("");

  lines.push("## 학교별 계수 (계층 축소)");
  lines.push("");
  lines.push(
    row([
      "학교",
      "표본",
      "축소 전",
      "축소 후",
      "축소 가중",
      "MAE 전",
      "MAE 후",
      "채택",
    ]),
  );
  lines.push(
    row(["---", "---:", "---:", "---:", "---:", "---:", "---:", "---"]),
  );
  for (const school of outcome.schools) {
    lines.push(
      row([
        school.school,
        String(school.sampleCount),
        num(school.rawOffset),
        num(school.shrunkOffset),
        num(school.shrinkageWeight),
        num(school.maeBefore),
        num(school.maeAfter),
        school.apply ? "채택" : "미채택",
      ]),
    );
  }
  lines.push("");
  lines.push(
    "축소 가중이 0 이면 학교 고유 신호가 잡음에 묻혔다는 뜻이다 — 그 학교 계수를 만들지 않는다.",
  );
  lines.push("");

  lines.push("## 편향");
  lines.push("");
  lines.push(
    `- 평균 잔차: ${num(outcome.bias.meanResidual)} (표준오차 ${num(outcome.bias.standardError)})`,
  );
  lines.push(`- t: ${num(outcome.bias.tStatistic, 2)}`);
  lines.push(
    outcome.bias.detected
      ? `- **편향 있음 — ${outcome.bias.direction}**`
      : "- 편향 없음(t 가 임계값 안이다)",
  );
  lines.push("");

  lines.push("## 구간 (점 예측과 별개 지표)");
  lines.push("");
  lines.push(
    `- 판정 가능한 표본: ${outcome.intervalSampleCount}건 / 전체 ${outcome.sampleCount}건`,
  );
  lines.push(
    `- 적중률: ${outcome.intervalHitRate === null ? "판단 불가(구간 스냅샷 없음)" : num(outcome.intervalHitRate)}`,
  );
  if (outcome.intervalHonest === null) {
    lines.push("- 정직성: 판정하지 않음(선언된 신뢰수준을 모른다)");
  } else {
    lines.push(
      `- 정직성: ${outcome.intervalHonest ? "선언한 신뢰수준과 어긋나지 않는다" : "**선언한 신뢰수준과 어긋난다**"}`,
    );
  }

  return lines.join("\n") + "\n";
}

// ─────────────────────────────────────────────
// IO
// ─────────────────────────────────────────────

export interface CalibrationReportOptions {
  engine?: string | null;
  school?: string | null;
  out?: string | null;
}

export async function runCalibrationReport(
  options: CalibrationReportOptions = {},
): Promise<{ body: string; outcome: CalibrationOutcome }> {
  const inspection = await inspectDatabaseTargets();

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    // ⚠️ 읽기 전용. 이 스크립트에는 create/update/delete 가 하나도 없다.
    const rows = (await prisma.actualExamScore.findMany({
      where: {
        run: {
          ...(options.engine ? { engineVersion: options.engine } : {}),
          ...(options.school ? { school: options.school } : {}),
        },
      },
      select: {
        runId: true,
        studentId: true,
        predictedScore: true,
        actualScore: true,
        residual: true,
        intervalHit: true,
        predictedLower: true,
        predictedUpper: true,
        predictedCoverage: true,
        run: { select: { engineVersion: true, school: true } },
      },
      orderBy: { recordedAt: "asc" },
    })) as ActualScoreRowWithRun[];

    const { coverage, mixed } = resolveNominalCoverage(rows);
    const outcome = estimateCalibration(
      buildCalibrationSamples(rows),
      coverage === null ? {} : { nominalCoverage: coverage },
    );
    const body = renderCalibrationReport(outcome, {
      databaseHost: inspection.selected.host,
      databaseReason: inspection.selected.reason,
      rowCount: rows.length,
      withoutPrediction: countWithoutPrediction(rows),
      engineFilter: options.engine ?? null,
      schoolFilter: options.school ?? null,
      nominalCoverage: coverage,
      coverageMixed: mixed,
    });
    return { body, outcome };
  } finally {
    await prisma.$disconnect();
  }
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

if (isDirectScript(import.meta.url)) {
  runCalibrationReport({
    engine: readArg("engine"),
    school: readArg("school"),
  })
    .then(({ body }) => {
      process.stdout.write(body);
      const out = readArg("out");
      if (out) {
        const target = resolve(process.cwd(), out);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, body, "utf8");
        process.stdout.write(`\n리포트를 ${target} 에 썼다.\n`);
      }
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
