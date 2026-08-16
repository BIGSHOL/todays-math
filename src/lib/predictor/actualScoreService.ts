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
 * 4. **예측이 없어도 실점수는 받는다. 대신 잔차를 지어내지 않는다.**
 *
 * ## 4번은 원래 정반대였다 (적대적 리뷰 🔴1)
 *
 * 예전 규칙은 "그 회차가 예측하지 않은 학생은 받지 않는다"였다. 그런데
 * `PredictionRun.predictedScores` 를 채우는 학생 능력 엔진(11 §3 L3)은 산식조차 없는
 * 상태고, `predictionRunService` 는 **항상 빈 배열**을 저장한다. 그래서 그 가드가
 * 모든 학생을 거절했고 — **보정 루프의 입력이 한 건도 쌓일 수 없었다.**
 * `ActualExamScore` 가 영영 0행이면 보정 계수도 영영 나오지 않는다.
 *
 * 설계 SSOT 의 순서는 반대다.
 *   - 11 §3 L5-b — "실제 시험이 끝나면 시험지와 학생 점수를 **입력** → 잔차를 저장"
 *   - 11 §4     — "환산 계수를 학생 데이터로 구하기 **전에는** 이 질문에 답할 수 없다"
 * 실점수가 예측보다 먼저다. 그래서 예측이 없으면 `predictedScore`·`residual` 을
 * **NULL 로 두고** 실점수만 저장한다. 예측을 지어내서 루프를 여는 것은 이 저장소가 이미
 * 낸 사고(0문항 0점짜리 청사진)와 같은 종류라 하지 않는다.
 *
 * 대신 "이 학생이 이 시험을 보는가"는 여전히 막는다 — 판정은 `examRoster.takesExam`
 * 하나뿐이고 화면(`composeRounds`)이 같은 함수를 쓴다. 두 벌로 나뉘면 화면은 입력칸을
 * 내주는데 서버가 거절하는 어긋남이 조용히 생긴다.
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
import { takesExam, type RosterSeries } from "@/lib/predictor/examRoster";

/** run 의 예측 Json 을 학생별로 색인한 것. Json 파싱은 **여기 한 번뿐**이다. */
export type RunPredictionIndex = {
  runId: string;
  /** 이 회차를 만든 원장. 소유권 경계를 회차 자체에 건다(T7.10 후속). */
  ownerUserId: string;
  /** 이 회차가 겨냥한 시험 — 응시 명단 판정의 기준이다. */
  series: RosterSeries;
  byStudent: Map<string, PredictedScoreSnapshot>;
  /**
   * 예측 목록이 비어 있지 않은데 한 건도 읽히지 않았다 = Json 모양이 어긋났다.
   * "이 학생은 예측 대상이 아니다"와 원인이 다르므로 따로 구분해 알린다.
   */
  unreadable: boolean;
};

/** 실측을 붙일 학생 — 소유권 확인을 통과한 행을 라우터가 그대로 넘긴다. */
export type RosterCandidate = {
  id: string;
  schoolName: string | null;
  schoolLevel: string | null;
  schoolGrade: number | null;
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
  | { ok: false; kind: "학생_시험대상아님"; studentIds: string[] }
  | { ok: false; kind: "예측값_읽기실패" };

type ActualScoreRow = {
  id: string;
  runId: string;
  studentId: string;
  actualScore: number;
  /** 예측이 없던 회차면 null — 지어내지 않는다. */
  predictedScore: number | null;
  residual: number | null;
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
    series: { school: run.school, level: run.level, grade: run.grade },
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
 * 한 명이라도 그 회차의 시험 대상이 아니면 **아무것도 저장하지 않는다** — 일부만 저장되면
 * 원장이 무엇이 들어갔는지 알 수 없고, 잔차 표본이 조용히 반쪽이 된다.
 *
 * `roster` 는 라우터가 소유권을 확인한 학생 행이다. 대상 판정은 `examRoster.takesExam`
 * 하나로만 한다 — 화면이 쓰는 것과 같은 함수다.
 */
export async function attachActualScores(
  index: RunPredictionIndex,
  input: AttachActualScoresInput,
  userId: string,
  roster: RosterCandidate[],
): Promise<AttachActualScoresResult> {
  if (index.unreadable) {
    return { ok: false, kind: "예측값_읽기실패" };
  }

  const byId = new Map(roster.map((s) => [s.id, s]));
  const notInExam = input.scores
    .filter((entry) => {
      const student = byId.get(entry.studentId);
      // 라우터가 소유권을 확인한 학생만 넘어온다. 없으면 판단 근거가 없으니 막는다.
      return student === undefined || !takesExam(index.series, student);
    })
    .map((entry) => entry.studentId);
  if (notInExam.length > 0) {
    return { ok: false, kind: "학생_시험대상아님", studentIds: notInExam };
  }

  const existingRows = (await db.actualExamScore.findMany({
    where: { runId: index.runId },
  })) as ActualScoreRow[];
  const existingByStudent = new Map(
    existingRows.map((row) => [row.studentId, row]),
  );

  await db.$transaction(async (tx) => {
    for (const entry of input.scores) {
      // 예측이 없을 수 있다 — 지금은 그게 정상이다(학생 능력 엔진 11 §3 L3 미구현).
      const snapshot = index.byStudent.get(entry.studentId) ?? null;
      const existing = existingByStudent.get(entry.studentId);

      if (existing) {
        // 스냅샷(predictedScore·구간)은 덮지 않는다.
        // 잔차와 적중 여부는 **저장된 스냅샷** 기준으로 다시 센다 — run 의 Json 을 보지 않는다.
        // 점수 정정은 실제값이 움직인 것이므로 적중 여부도 다시 세는 것이 맞다(얼리지 않는다).
        //
        // 예측 스냅샷이 없는 행은 정정해도 잔차를 낼 수 없다. 0 으로 채우지 않고 null 을
        // 유지한다 — 0 은 "정확히 맞혔다"는 뜻이라 MAE 를 거짓으로 끌어내린다.
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
            residual:
              existing.predictedScore === null
                ? null
                : computeResidual(entry.actualScore, existing.predictedScore),
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

      const interval = snapshot?.interval ?? null;
      await tx.actualExamScore.create({
        data: {
          runId: index.runId,
          studentId: entry.studentId,
          actualScore: entry.actualScore,
          // 예측이 없으면 NULL. 실점수만 남기고 잔차는 지어내지 않는다.
          predictedScore: snapshot === null ? null : snapshot.expectedScore,
          residual:
            snapshot === null
              ? null
              : computeResidual(entry.actualScore, snapshot.expectedScore),
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
