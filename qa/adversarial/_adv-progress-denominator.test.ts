/**
 * 적대적 재현 (아직 안 고친 결함) — 적대적 리뷰 ③ ADV-5.
 *
 * 실점수 진행률의 분모가 **run 의 predictedScores 행 수**라서, 반을 옮겼거나 삭제된
 * 학생이 Json 에 남아 있으면 분모에 계속 들어간다. 화면 표에는 내 학생만 실리므로
 * 원장은 남은 한 명을 **넣을 방법이 없다** — 진행률이 'N/N+1' 에서 영원히 멈춘다.
 *
 * 이 테스트는 **원하는 동작**(분모 = 화면이 실제로 받을 수 있는 학생 수)을 단언한다.
 * 고치기 전에는 빨갛다. 고치면 초록이 되고, 그때 이 파일은 지우고 회귀 가드를
 * `src/__tests__/**` 로 옮긴다.
 *
 * 실행: npm run test:adv
 */
import { describe, expect, it, vi } from "vitest";

const TEACHER_ID = "10000000-0000-4000-8000-000000000001";

vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => ({
    id: TEACHER_ID,
    email: "teacher@todaysmath.test",
    name: "테스트 강사",
  })),
}));

import { GET as getRound } from "@/app/api/exam/rounds/[id]/route";
import { GET as listRounds } from "@/app/api/exam/rounds/route";
import {
  examRoundDetailResponseSchema,
  examRoundListResponseSchema,
} from "@/components/exam/examScreen.contract";
import { MOCK_STUDENT_1, MOCK_STUDENT_2 } from "@/mocks/data";
import {
  seedActualExamScores,
  seedPredictionRuns,
} from "@/mocks/prismaTestDouble";

const RUN_ID = "70000000-0000-4000-8000-0000000000b1";
const FOREIGN_STUDENT_ID = "30000000-0000-4000-8000-000000000099";

const BLUEPRINT = {
  kind: "predicted",
  series: { school: "정화중", level: "중", grade: 3, subject: "중3" },
  period: { year: 2025, semester: 2, round: "중간" },
  questionCount: 24,
  totalScore: 100,
  typeMix: {
    객관식: { count: 18, score: 66 },
    단답형: { count: 2, score: 8 },
    서술형: { count: 4, score: 26 },
  },
  difficultyMix: {
    하: { count: 9, score: 30 },
    중: { count: 11, score: 44 },
    상: { count: 4, score: 26 },
    미표기: { count: 0, score: 0 },
  },
  scoreHistogram: [],
  positionCurve: [],
  unitMix: [{ unitId: null, topicRaw: "이차방정식", count: 24, score: 100 }],
  expectedMean: 68.4,
  expectedMeanInterval: { lower: 61, upper: 76, coverage: 0.8 },
  evidenceCount: 4,
  confidence: 0.62,
};

function scorePrediction(studentId: string, expectedScore: number) {
  return {
    studentId,
    series: BLUEPRINT.series,
    period: BLUEPRINT.period,
    expectedScore,
    interval: {
      lower: expectedScore - 8,
      upper: expectedScore + 5,
      coverage: 0.8,
    },
    byUnit: [],
    riskFlags: [],
  };
}

/** `db.predictionRun.create({ data })` 가 실제로 쓰는 모양 그대로. */
function realRunRow(predictedScores: unknown[]) {
  return {
    id: RUN_ID,
    userId: TEACHER_ID,
    createdAt: new Date("2026-08-16T00:00:00.000Z"),
    engineVersion: "0.5.0",
    school: "정화중",
    level: "중",
    grade: 3,
    subject: "중3",
    targetYear: 2025,
    targetSemester: 2,
    targetRound: "중간",
    cutoffYear: 2025,
    cutoffSemester: 1,
    cutoffRound: "기말",
    inputExamIds: ["e1", "e2", "e3", "e4"],
    params: {},
    predictedBlueprint: BLUEPRINT,
    predictedScores,
    riskFlags: ["학생응답_부족"],
    examDate: null,
    actualSchoolMean: null,
    actualSchoolStdev: null,
    actualRecordedAt: null,
  };
}

describe("[적대적·미해결] 실점수 진행률 분모가 내 것이 아닌 학생까지 센다 (ADV-5)", () => {
  it("내 학생 2명을 다 넣으면 진행률이 끝난다 — 화면에 없는 학생을 분모에 두지 않는다", async () => {
    seedPredictionRuns([
      realRunRow([
        scorePrediction(MOCK_STUDENT_1.id, 88),
        scorePrediction(MOCK_STUDENT_2.id, 74),
        // 반을 옮겼거나 삭제된 학생 — run 의 Json 에는 그대로 남는다.
        scorePrediction(FOREIGN_STUDENT_ID, 71),
      ]),
    ] as never);
    seedActualExamScores([
      {
        id: "80000000-0000-4000-8000-0000000000f1",
        runId: RUN_ID,
        studentId: MOCK_STUDENT_1.id,
        actualScore: 91,
        predictedScore: 88,
        residual: 3,
        intervalHit: true,
        recordedAt: new Date("2026-08-16T01:00:00.000Z"),
        updatedAt: new Date("2026-08-16T01:00:00.000Z"),
      },
      {
        id: "80000000-0000-4000-8000-0000000000f2",
        runId: RUN_ID,
        studentId: MOCK_STUDENT_2.id,
        actualScore: 70,
        predictedScore: 74,
        residual: -4,
        intervalHit: true,
        recordedAt: new Date("2026-08-16T01:00:00.000Z"),
        updatedAt: new Date("2026-08-16T01:00:00.000Z"),
      },
    ]);

    const list = examRoundListResponseSchema.parse(
      await (await listRounds()).json(),
    );
    const actualStage = list.data[0]!.stages.find((s) => s.key === "actual")!;
    console.log("[ADV-5] actual stage =", JSON.stringify(actualStage));

    const res = await getRound(undefined as never, {
      params: Promise.resolve({ id: RUN_ID }),
    });
    const detail = examRoundDetailResponseSchema.parse(await res.json());

    // 표에는 내 학생 둘만 실린다 — 여기까지는 지금도 맞다.
    expect(detail.data.students).toHaveLength(2);

    // 그 둘을 다 넣었으면 끝난 것이어야 한다. 지금은 분모가 3(남의 학생 포함)이라
    // 'N/N+1' 에서 영원히 멈춘다.
    expect(actualStage.progress).toEqual({ current: 2, total: 2 });
    expect(actualStage.done).toBe(true);
  });
});
