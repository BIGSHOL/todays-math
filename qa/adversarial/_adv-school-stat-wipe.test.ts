/**
 * 적대적 재현 (읽기 전용, 삭제 가능) — 학교 평균만 다시 보내면
 * 이전에 저장한 학교 표준편차가 조용히 지워지는가.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const STUDENT_A = "30000000-0000-4000-8000-000000000001";
const RUN_ID = "aaaaaaaa-0000-4000-8000-000000000001";

const state = vi.hoisted(() => ({
  run: {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    actualSchoolMean: null as number | null,
    actualSchoolStdev: null as number | null,
    actualRecordedAt: null as Date | null,
  },
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/db", () => {
  const db = {
    actualExamScore: {
      async findMany() {
        return state.rows;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = {
          id: `r${state.rows.length}`,
          recordedAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        state.rows.push(row);
        return row;
      },
      async update({ where, data }: { where: { runId_studentId: { studentId: string } }; data: Record<string, unknown> }) {
        const row = state.rows.find((r) => r.studentId === where.runId_studentId.studentId)!;
        Object.assign(row, data);
        return row;
      },
    },
    predictionRun: {
      async update({ data }: { data: Record<string, unknown> }) {
        Object.assign(state.run, data);
        return state.run;
      },
    },
    async $transaction(fn: (tx: unknown) => Promise<unknown>) {
      return fn(db);
    },
  };
  return { db };
});

import { attachActualScores } from "@/lib/predictor/actualScoreService";
import type { RunPredictionIndex } from "@/lib/predictor/actualScoreService";

/** 라우터가 소유권을 확인해 넘겨 주는 학생 행. */
const ROSTER = [
  { id: STUDENT_A, schoolName: null, schoolLevel: null, schoolGrade: null },
];

const index: RunPredictionIndex = {
  runId: RUN_ID,
  ownerUserId: "user",
  series: { school: "정화중", level: "중", grade: 3 },
  byStudent: new Map([
    [STUDENT_A, { studentId: STUDENT_A, expectedScore: 72, interval: null }],
  ]),
  unreadable: false,
};

beforeEach(() => {
  state.run = { id: RUN_ID, actualSchoolMean: null, actualSchoolStdev: null, actualRecordedAt: null };
  state.rows = [];
});

describe("[적대적] 학교 통계 재입력", () => {
  it("평균만 고쳐 보내도 표준편차는 남는다", async () => {
    // 원장이 학교가 공개한 평균·표준편차를 함께 넣었다.
    await attachActualScores(
      index,
      { scores: [{ studentId: STUDENT_A, actualScore: 78 }], schoolMean: 62.5, schoolStdev: 12 },
      "user",
      ROSTER,
    );
    expect(state.run.actualSchoolMean).toBe(62.5);
    expect(state.run.actualSchoolStdev).toBe(12);

    // 나중에 평균만 정정한다(표준편차는 그대로 두려는 의도 — 필드를 안 보낸다).
    await attachActualScores(
      index,
      { scores: [{ studentId: STUDENT_A, actualScore: 78 }], schoolMean: 63.1 },
      "user",
      ROSTER,
    );
    console.log("  정정 후 mean =", state.run.actualSchoolMean, " stdev =", state.run.actualSchoolStdev);

    expect(state.run.actualSchoolMean).toBe(63.1);
    expect(state.run.actualSchoolStdev).toBe(12); // 지워지면 안 된다
  });

  it("점수만 고쳐 보내면 학교 통계는 건드리지 않는다", async () => {
    await attachActualScores(
      index,
      { scores: [{ studentId: STUDENT_A, actualScore: 78 }], schoolMean: 62.5, schoolStdev: 12 },
      "user",
      ROSTER,
    );
    const beforeStamp = state.run.actualRecordedAt;
    await attachActualScores(
      index,
      { scores: [{ studentId: STUDENT_A, actualScore: 81 }] },
      "user",
      ROSTER,
    );
    console.log("  점수만 정정 후 mean/stdev/recordedAt =", state.run.actualSchoolMean, state.run.actualSchoolStdev, String(state.run.actualRecordedAt) === String(beforeStamp) ? "(그대로)" : "(움직임)");
    expect(state.run.actualSchoolStdev).toBe(12);
  });
});
