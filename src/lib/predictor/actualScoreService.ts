/**
 * 실측 점수 저장 — T7.10.
 *
 * 보정 루프의 입력을 만드는 자리다(11 §3 L5-b). 여기서 지키는 규칙은 넷이다.
 *
 * 1. **같은 run · 같은 학생은 갱신한다.** `@@unique([runId, studentId])` 가 이미 걸려 있고,
 *    원장이 점수를 잘못 입력했을 때 고칠 수 있어야 한다. 행이 늘면 같은 학생이 두 번 세어져
 *    잔차 통계가 통째로 오염된다.
 * 2. **예측값은 저장 시점에 스냅샷으로 복사한다.** 집계할 때 run 의 Json 을 다시 파싱하지
 *    않는다 — Json 모양이 바뀌어도 과거 보정 근거가 흔들리면 안 된다.
 *    그래서 **재저장할 때도 스냅샷(`predictedScore`)은 덮어쓰지 않는다.** 갱신되는 것은
 *    실측 점수와 그로부터 다시 계산한 잔차뿐이다.
 * 3. **구간 적중을 따로 남긴다.** 점 예측 MAE 와 별개 지표다 — ±5점 목표는 구간으로 판정한다.
 * 4. **그 회차가 예측하지 않은 학생은 받지 않는다.** 잔차가 아니라 잡음이 쌓인다.
 *
 * ⚠️ 이 파일만 IO 를 한다. 계산은 전부 `calibration.ts`(순수 함수)에 있다.
 */
import type {
  ActualScoreEntry,
  ActualScoreRecord,
  PredictedScoreSnapshot,
  ResidualSummary,
} from "@/contracts/calibration.contract";
import { predictedScoreSnapshotSchema } from "@/contracts/calibration.contract";
import { db } from "@/lib/db";
import {
  computeResidual,
  isIntervalHit,
  summarizeResiduals,
} from "@/lib/predictor/calibration";

/** run 의 예측 Json 을 학생별로 색인한 것. Json 파싱은 **여기 한 번뿐**이다. */
export type RunPredictionIndex = {
  runId: string;
  /** 이 회차를 만든 원장. 소유권 경계를 회차 자체에 건다(T7.10 후속). */
  ownerUserId: string;
  byStudent: Map<string, PredictedScoreSnapshot>;
  /**
   * 예측 목록이 비어 있지 않은데 한 건도 읽히지 않았다 = Json 모양이 어긋났다.
   * "이 학생은 예측 대상이 아니다"와 원인이 다르므로 따로 구분해 알린다.
   */
  unreadable: boolean;
};

export type AttachActualScoresInput = {
  scores: ActualScoreEntry[];
  schoolMean?: number | null;
  schoolStdev?: number | null;
};

export type ActualScorePayload = {
  runId: string;
  scores: ActualScoreRecord[];
  summary: ResidualSummary;
};

export type AttachActualScoresResult =
  | { ok: true; payload: ActualScorePayload }
  | { ok: false; kind: "학생_회차없음"; studentIds: string[] }
  | { ok: false; kind: "예측값_읽기실패" };

type ActualScoreRow = {
  id: string;
  runId: string;
  studentId: string;
  actualScore: number;
  predictedScore: number;
  residual: number;
  intervalHit: boolean;
  predictedLower: number | null;
  predictedUpper: number | null;
  predictedCoverage: number | null;
  recordedAt: Date;
  updatedAt: Date;
};

/**
 * 구간 스냅샷이 있어 적중을 **판정할 수 있는** 행인가.
 * `interval_hit` 은 NOT NULL 이라 값이 늘 들어 있지만, 구간이 없으면 그 값은 의미가 없다.
 */
function hasInterval(row: ActualScoreRow): boolean {
  return row.predictedLower !== null && row.predictedUpper !== null;
}

function serialize(row: ActualScoreRow): ActualScoreRecord {
  return {
    id: row.id,
    runId: row.runId,
    studentId: row.studentId,
    actualScore: row.actualScore,
    predictedScore: row.predictedScore,
    residual: row.residual,
    intervalHit: row.intervalHit,
    predictedLower: row.predictedLower,
    predictedUpper: row.predictedUpper,
    predictedCoverage: row.predictedCoverage,
    recordedAt: row.recordedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 예측 회차를 읽어 학생별 예측 스냅샷 색인을 만든다. 회차가 없으면 null.
 *
 * `studentId` 가 null 인 항목은 학생 개인이 아니라 **시험지 예상 평균** 예측이라
 * 실측 대조 대상이 아니다(predictor.contract.ts `scorePredictionSchema`).
 */
export async function loadRunPredictions(
  runId: string,
): Promise<RunPredictionIndex | null> {
  const run = await db.predictionRun.findUnique({ where: { id: runId } });
  if (!run) return null;

  const raw = run.predictedScores;
  const entries = Array.isArray(raw) ? raw : [];
  const byStudent = new Map<string, PredictedScoreSnapshot>();
  let readable = 0;
  for (const entry of entries) {
    const parsed = predictedScoreSnapshotSchema.safeParse(entry);
    if (!parsed.success) continue;
    readable += 1;
    if (parsed.data.studentId === null) continue;
    byStudent.set(parsed.data.studentId, parsed.data);
  }

  return {
    runId,
    ownerUserId: run.userId,
    byStudent,
    unreadable: entries.length > 0 && readable === 0,
  };
}

/** 이 회차의 실측 목록과 잔차 요약. 로그인 원장이 소유한 학생 것만 돌려준다. */
export async function listActualScores(
  runId: string,
  userId: string,
): Promise<ActualScorePayload> {
  const rows = (await db.actualExamScore.findMany({
    where: { runId, student: { class: { userId } } },
    orderBy: { studentId: "asc" },
  })) as ActualScoreRow[];

  return {
    runId,
    scores: rows.map(serialize),
    summary: summarizeResiduals(
      rows.map((row) => ({
        residual: row.residual,
        intervalHit: row.intervalHit,
        hasInterval: hasInterval(row),
      })),
    ),
  };
}

/**
 * 실측 점수를 회차에 붙인다.
 *
 * 한 명이라도 그 회차의 예측 대상이 아니면 **아무것도 저장하지 않는다** — 일부만 저장되면
 * 원장이 무엇이 들어갔는지 알 수 없고, 잔차 표본이 조용히 반쪽이 된다.
 */
export async function attachActualScores(
  index: RunPredictionIndex,
  input: AttachActualScoresInput,
  userId: string,
): Promise<AttachActualScoresResult> {
  if (index.unreadable) {
    return { ok: false, kind: "예측값_읽기실패" };
  }

  const missing = input.scores
    .filter((entry) => !index.byStudent.has(entry.studentId))
    .map((entry) => entry.studentId);
  if (missing.length > 0) {
    return { ok: false, kind: "학생_회차없음", studentIds: missing };
  }

  const existingRows = (await db.actualExamScore.findMany({
    where: { runId: index.runId },
  })) as ActualScoreRow[];
  const existingByStudent = new Map(
    existingRows.map((row) => [row.studentId, row]),
  );

  await db.$transaction(async (tx) => {
    for (const entry of input.scores) {
      const snapshot = index.byStudent.get(entry.studentId)!;
      const existing = existingByStudent.get(entry.studentId);

      if (existing) {
        // 스냅샷(predictedScore·구간)은 덮지 않는다.
        // 잔차와 적중 여부는 **저장된 스냅샷** 기준으로 다시 센다 — run 의 Json 을 보지 않는다.
        // 점수 정정은 실제값이 움직인 것이므로 적중 여부도 다시 세는 것이 맞다(얼리지 않는다).
        //
        // 구간 스냅샷이 없는 행(예측 시점에 구간이 없었거나 이 컬럼 이전에 저장된 행)은
        // 적중을 판정할 근거가 없다. 지어내지 않고 false 로 두되, 집계에서는
        // `hasInterval` 이 false 라 **분모에서 빠진다**(summarizeResiduals 주석 참조).
        await tx.actualExamScore.update({
          where: {
            runId_studentId: {
              runId: index.runId,
              studentId: entry.studentId,
            },
          },
          data: {
            actualScore: entry.actualScore,
            residual: computeResidual(
              entry.actualScore,
              existing.predictedScore,
            ),
            intervalHit: hasInterval(existing)
              ? isIntervalHit(entry.actualScore, {
                  lower: existing.predictedLower!,
                  upper: existing.predictedUpper!,
                })
              : false,
          },
        });
        continue;
      }

      const interval = snapshot.interval ?? null;
      await tx.actualExamScore.create({
        data: {
          runId: index.runId,
          studentId: entry.studentId,
          actualScore: entry.actualScore,
          predictedScore: snapshot.expectedScore,
          residual: computeResidual(entry.actualScore, snapshot.expectedScore),
          intervalHit:
            interval === null
              ? false
              : isIntervalHit(entry.actualScore, interval),
          predictedLower: interval?.lower ?? null,
          predictedUpper: interval?.upper ?? null,
          predictedCoverage: interval?.coverage ?? null,
        },
      });
    }

    if (input.schoolMean !== undefined || input.schoolStdev !== undefined) {
      await tx.predictionRun.update({
        where: { id: index.runId },
        data: {
          actualSchoolMean: input.schoolMean ?? null,
          actualSchoolStdev: input.schoolStdev ?? null,
          actualRecordedAt: new Date(),
        },
      });
    }
  });

  return { ok: true, payload: await listActualScores(index.runId, userId) };
}
