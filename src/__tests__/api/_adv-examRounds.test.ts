/**
 * 적대적 리뷰 ③ — **아직 안 고친** 소견의 재현. 제품 코드는 고치지 않는다.
 *
 * 🟢 여기 있던 ADV-1(내 회차가 안 보임) · ADV-3(시행일 유실) · ADV-4(남의 회차 노출)는
 *    고쳤다. 회귀 테스트는 재현물이 아니라 정식 테스트에 있다:
 *      - `src/__tests__/api/examRounds.test.ts`
 *        · "🔴 실 엔진이 저장하는 모양(predictedScores: [])이어도 내 회차는 보인다"
 *        · "🔴 시행일이 있으면 그대로 낸다 — 없는 척하면 D-day 와 정렬이 죽는다"
 *        · "🔴 남의 회차에 내 학생이 섞여 있어도 그 회차는 내 것이 아니다"
 *      - `src/__tests__/unit/examCompose.test.ts` — `isRunOwnedBy` · `toRoundSummary — 시행일`
 *
 * 🔴 아래 둘은 그대로 살아 있다.
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
import { POST as postActual } from "@/app/api/predictions/[id]/actual/route";
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

describe("[ADV-2 · 미해결] 실점수 저장이 422 — 보정 루프의 입력구가 아직 막혀 있다", () => {
  it("predictedScores: [] 이면 어떤 학생도 '예측 대상'이 아니다", async () => {
    // 소유권을 고쳐 회차 자체는 보이게 됐지만, 저장은 여전히 막힌다.
    // 원인은 조회가 아니라 엔진이다 — 학생별 예상 점수가 없으면 붙일 예측이 없고,
    // `ActualExamScore.predicted_score` 는 NOT NULL 이라 지어내지 않고는 저장할 수 없다.
    // 화면은 이제 이 요청을 만들지 않는다(학생 행이 아예 없다).
    seedPredictionRuns([realRunRow([])] as never);

    const req = new Request("http://t/api/predictions/x/actual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scores: [{ studentId: MOCK_STUDENT_1.id, actualScore: 91 }],
      }),
    });
    const res = await postActual(req as never, {
      params: Promise.resolve({ id: RUN_ID }),
    });
    const body = await res.json();
    console.log("[ADV-2]", res.status, JSON.stringify(body));
    expect(res.status).toBe(422);
  });
});

describe("[ADV-5 · 미해결] 실점수 진행률 분모가 내 것이 아닌 학생까지 센다", () => {
  it("내 학생 2명을 다 넣어도 '실점수 2/3' 에서 멈춘다", async () => {
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
    console.log(
      "[ADV-5] 표에 실린 학생 =",
      detail.data.students.map((s) => s.studentName),
    );

    expect(actualStage.progress).toEqual({ current: 2, total: 3 });
    expect(actualStage.done).toBe(false); // ← 더 넣을 학생이 화면에 없다
    expect(detail.data.students).toHaveLength(2);
  });
});
