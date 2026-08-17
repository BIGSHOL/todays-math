/**
 * 적대적 재현 — '오늘의 시험' 화면 (아직 안 고친 결함).
 *
 * 원래 🟡 두 건이었다. 시행일(examDate 유실)은 main 에서 고쳐져 이 스위트에서
 * 초록이 됐으므로 지웠다(회귀는 examCompose.test.ts 가 잠근다). 남은 것은
 * **같은 시험의 run 여러 개를 계기판에서 구분할 수 없다** 한 건이다 —
 * 15-remaining-defects-review.md §D.2 (화면 결정 필요, D-07 절차 대상)로 보류 중.
 *
 * 실행: npm run test:adv
 */
import { describe, expect, it } from "vitest";

import {
  toRoundSummary,
  type PredictionRunRow,
} from "@/lib/exam/composeRounds";

const OWNER = "10000000-0000-4000-8000-000000000001";

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
  examDate: new Date("2026-04-28T00:00:00Z"),
} as unknown as PredictionRunRow;

describe("[적대적·미해결] 🟡 같은 시험의 run 이 여러 개 (15 §D.2)", () => {
  it("계기판에서 두 회차를 구분할 수 있다", () => {
    const older = {
      ...(realRun as object),
      id: "r-old",
    } as unknown as PredictionRunRow;
    const newer = {
      ...(realRun as object),
      id: "r-new",
      createdAt: new Date("2026-08-17T00:00:00Z"),
      engineVersion: "predictor-v0.6.0",
    } as unknown as PredictionRunRow;

    const a = toRoundSummary(older, [])!;
    const b = toRoundSummary(newer, [])!;
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
