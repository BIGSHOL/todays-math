/**
 * 적대적 재현 — '오늘의 시험' 화면 (아직 안 고친 결함).
 *
 * 🔴1(회차 비가시 · 학생 행 없음)은 고쳤다. 그 회귀 가드는
 * `src/__tests__/unit/examCompose.test.ts` 와 `src/__tests__/api/calibrationLoop.test.ts`
 * 로 옮겼다. 여기 남은 것은 보고서의 **🟡 두 건**이다.
 *
 * 실행: npm run test:adv
 */
import { describe, expect, it } from "vitest";

import {
  toRoundSummary,
  type OwnedStudent,
  type PredictionRunRow,
} from "@/lib/exam/composeRounds";

const OWNER = "10000000-0000-4000-8000-000000000001";
const STUDENT_A = "dddddddd-0000-4000-8000-00000000000d";

const owned: OwnedStudent[] = [
  {
    id: STUDENT_A,
    name: "김학생",
    schoolName: null,
    schoolLevel: null,
    schoolGrade: null,
  },
];

/** `runPrediction` 이 실제로 저장하는 모양 그대로. */
const realRun = {
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
  userId: OWNER,
  createdAt: new Date("2026-08-16T00:00:00Z"),
  engineVersion: "predictor-v0.3.0",
  school: "가람중",
  level: "중",
  grade: 3,
  subject: "중3",
  targetYear: 2026,
  targetSemester: 1,
  targetRound: "중간",
  inputExamIds: ["가람-2025-2-기말"],
  predictedBlueprint: null,
  predictedScores: [],
  // 컬럼은 존재한다(prisma/schema.prisma PredictionRun.examDate, migration
  // 20260816160000_prediction_run_owner_and_interval).
  examDate: new Date("2026-04-28T00:00:00Z"),
} as unknown as PredictionRunRow;

describe("[적대적·미해결] 🟡 시행일", () => {
  it("원장이 넣은 시행일이 화면에 나온다", () => {
    const summary = toRoundSummary(realRun, [], owned)!;
    expect(summary.examDate).toBe("2026-04-28");
  });
});

describe("[적대적·미해결] 🟡 같은 시험의 run 이 여러 개", () => {
  it("계기판에서 두 회차를 구분할 수 있다", () => {
    const older = { ...(realRun as object), id: "r-old" } as unknown as PredictionRunRow;
    const newer = {
      ...(realRun as object),
      id: "r-new",
      createdAt: new Date("2026-08-17T00:00:00Z"),
      engineVersion: "predictor-v0.6.0",
    } as unknown as PredictionRunRow;

    const a = toRoundSummary(older, [], owned)!;
    const b = toRoundSummary(newer, [], owned)!;
    // 화면(RoundRow)이 그리는 값 전부 — id 를 빼면 무엇이 다른가?
    const shown = (x: typeof a) =>
      JSON.stringify({
        series: x.series,
        period: x.period,
        examDate: x.examDate,
        evidenceCount: x.evidenceCount,
        confidence: x.confidence,
        stages: x.stages,
      });
    console.log("  옛 run 이 화면에 그리는 값:", shown(a));
    console.log("  새 run 이 화면에 그리는 값:", shown(b));
    expect(shown(a)).not.toBe(shown(b));
  });
});
