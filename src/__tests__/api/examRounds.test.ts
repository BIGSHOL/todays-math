/**
 * 🔴→🟢 T7.14 — GET /api/exam/rounds · /api/exam/rounds/{id} (화면 조회 전용).
 *
 * 이 테스트가 있는 이유:
 *
 * 1. **빈 목록이 정상 응답이다.** 실측이 아직 0건이라 이 API 는 당분간 대부분 빈 배열을
 *    낸다. 그 상태에서 500 이 나거나 숫자가 지어져 나오면 화면이 첫날부터 거짓말을 한다.
 * 2. **소유권.** `PredictionRun` 에 `userId` 컬럼이 아직 없어(2026-08-16 확인) 소유권을
 *    `학생 → 반 → 반 소유자` 로 되짚는다. 이 우회 경로가 새면 남의 학생 이름과 점수가
 *    그대로 노출된다. 그래서 "남의 회차 404" 와 "남의 학생 이름 미노출"을 따로 잠근다.
 * 3. **없는 것을 지어내지 않는다.** `examDate`(D-day 기준)와 문제지·채점 단계는 스키마에
 *    원천이 없다. 나중에 누가 "그럴듯한 기본값"을 채워 넣지 못하게 여기서 못박는다.
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
import { examRoundDetailResponseSchema } from "@/components/exam/examScreen.contract";
import { examRoundListResponseSchema } from "@/components/exam/examScreen.contract";
import { errorResponseSchema } from "@/contracts/common.contract";
import { MOCK_STUDENT_1, MOCK_STUDENT_2, STUDENT_IDS } from "@/mocks/data";
import {
  seedActualExamScores,
  seedPredictionRuns,
} from "@/mocks/prismaTestDouble";
import { getSessionUser } from "@/lib/session";

const RUN_MINE = "70000000-0000-4000-8000-0000000000a1";
const RUN_OTHER = "70000000-0000-4000-8000-0000000000a2";
/** 다른 사용자 소유 반의 학생 — MOCK 픽스처에 없는 id 로 둔다. */
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

/**
 * Json 컬럼 두 개는 `unknown` 으로 열어 둔다 — 깨진 Json 을 넣는 테스트가 있고,
 * 그게 이 라우트가 실제로 만나는 상황(엔진 버전이 올라가면 과거 행은 옛 모양)이다.
 */
type SeedRun = {
  id: string;
  createdAt: Date;
  engineVersion: string;
  school: string;
  level: string;
  grade: number;
  subject: string;
  targetYear: number;
  targetSemester: number;
  targetRound: string;
  cutoffYear: number;
  cutoffSemester: number;
  cutoffRound: string;
  inputExamIds: string[];
  params: unknown;
  predictedBlueprint: unknown;
  predictedScores: unknown;
  actualSchoolMean: number | null;
  actualSchoolStdev: number | null;
  actualRecordedAt: Date | null;
};

function runRow(id: string, predictedScores: unknown[]): SeedRun {
  return {
    id,
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
    actualSchoolMean: null,
    actualSchoolStdev: null,
    actualRecordedAt: null,
  };
}

function detailParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/exam/rounds", () => {
  it("세션이 없으면 401", async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce(null);

    const res = await listRounds();
    expect(res.status).toBe(401);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe(
      "UNAUTHORIZED",
    );
  });

  it("회차가 하나도 없으면 빈 목록이 정상 응답이다", async () => {
    const res = await listRounds();
    expect(res.status).toBe(200);
    // 계약 parse 를 통과해야 한다 — 빈 배열도 정식 응답이다.
    expect(examRoundListResponseSchema.parse(await res.json()).data).toEqual(
      [],
    );
  });

  it("내 학생이 든 회차만 낸다 — 남의 회차는 목록에서 빠진다", async () => {
    seedPredictionRuns([
      runRow(RUN_MINE, [scorePrediction(MOCK_STUDENT_1.id, 88)]),
      runRow(RUN_OTHER, [scorePrediction(FOREIGN_STUDENT_ID, 71)]),
    ]);

    const res = await listRounds();
    const body = examRoundListResponseSchema.parse(await res.json());

    expect(body.data.map((r) => r.id)).toEqual([RUN_MINE]);
  });

  it("근거 회차 수는 inputExamIds 개수이고 신뢰도는 청사진에서 온다", async () => {
    seedPredictionRuns([
      runRow(RUN_MINE, [scorePrediction(MOCK_STUDENT_1.id, 88)]),
    ]);

    const body = examRoundListResponseSchema.parse(
      await (await listRounds()).json(),
    );
    expect(body.data[0]!.evidenceCount).toBe(4);
    expect(body.data[0]!.confidence).toBe(0.62);
  });

  it("🔴 examDate 컬럼이 없으므로 시행일을 지어내지 않는다", async () => {
    seedPredictionRuns([
      runRow(RUN_MINE, [scorePrediction(MOCK_STUDENT_1.id, 88)]),
    ]);

    const body = examRoundListResponseSchema.parse(
      await (await listRounds()).json(),
    );
    expect(body.data[0]!.examDate).toBeNull();
  });

  it("🔴 데이터 원천이 없는 문제지·채점 단계를 진행한 것으로 칠하지 않는다", async () => {
    seedPredictionRuns([
      runRow(RUN_MINE, [scorePrediction(MOCK_STUDENT_1.id, 88)]),
    ]);

    const body = examRoundListResponseSchema.parse(
      await (await listRounds()).json(),
    );
    const stages = Object.fromEntries(
      body.data[0]!.stages.map((s) => [s.key, s.done]),
    );
    expect(stages).toEqual({
      blueprint: true, // 청사진 Json 이 있으니 완료
      paper: false, // T7.9 미구현 — 원천 없음
      grading: false, // T7.10 미구현 — 원천 없음
      actual: false, // 실점수 0건
    });
  });

  it("청사진 Json 이 계약을 통과하지 못하면 신뢰도를 내지 않는다", async () => {
    const broken = runRow(RUN_MINE, [scorePrediction(MOCK_STUDENT_1.id, 88)]);
    broken.predictedBlueprint = { kind: "predicted", questionCount: "스물넷" };
    seedPredictionRuns([broken]);

    const body = examRoundListResponseSchema.parse(
      await (await listRounds()).json(),
    );
    expect(body.data[0]!.confidence).toBeNull();
    expect(body.data[0]!.stages[0]!.done).toBe(false);
  });
});

describe("GET /api/exam/rounds/{id}", () => {
  it("세션이 없으면 401", async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce(null);

    const res = await getRound(undefined as never, detailParams(RUN_MINE));
    expect(res.status).toBe(401);
  });

  it("없는 회차는 404", async () => {
    const res = await getRound(undefined as never, detailParams(RUN_MINE));
    expect(res.status).toBe(404);
  });

  it("🔴 남의 회차는 403 이 아니라 404 — 존재 여부를 알리지 않는다", async () => {
    seedPredictionRuns([
      runRow(RUN_OTHER, [scorePrediction(FOREIGN_STUDENT_ID, 71)]),
    ]);

    const res = await getRound(undefined as never, detailParams(RUN_OTHER));
    expect(res.status).toBe(404);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe(
      "NOT_FOUND",
    );
  });

  it("내 회차는 학생 이름과 예측을 함께 낸다", async () => {
    seedPredictionRuns([
      runRow(RUN_MINE, [
        scorePrediction(MOCK_STUDENT_1.id, 88),
        scorePrediction(MOCK_STUDENT_2.id, 74),
      ]),
    ]);

    const res = await getRound(undefined as never, detailParams(RUN_MINE));
    const body = examRoundDetailResponseSchema.parse(await res.json());

    expect(res.status).toBe(200);
    expect(body.data.students.map((s) => s.studentName).sort()).toEqual(
      [MOCK_STUDENT_1.name, MOCK_STUDENT_2.name].sort(),
    );
    expect(body.data.engineVersion).toBe("0.5.0");
  });

  it("🔴 같은 회차에 남의 학생이 섞여 있어도 그 이름은 새지 않는다", async () => {
    seedPredictionRuns([
      runRow(RUN_MINE, [
        scorePrediction(MOCK_STUDENT_1.id, 88),
        scorePrediction(FOREIGN_STUDENT_ID, 71),
      ]),
    ]);

    const res = await getRound(undefined as never, detailParams(RUN_MINE));
    const body = examRoundDetailResponseSchema.parse(await res.json());

    expect(body.data.students).toHaveLength(1);
    expect(body.data.students[0]!.studentId).toBe(MOCK_STUDENT_1.id);
  });

  it("실점수가 들어오면 학생 행에 실린다", async () => {
    seedPredictionRuns([
      runRow(RUN_MINE, [scorePrediction(MOCK_STUDENT_1.id, 88)]),
    ]);
    seedActualExamScores([
      {
        id: "80000000-0000-4000-8000-000000000001",
        runId: RUN_MINE,
        studentId: MOCK_STUDENT_1.id,
        actualScore: 91,
        predictedScore: 88,
        residual: 3,
        intervalHit: true,
        recordedAt: new Date("2026-08-16T01:00:00.000Z"),
        updatedAt: new Date("2026-08-16T01:00:00.000Z"),
      },
    ]);

    const res = await getRound(undefined as never, detailParams(RUN_MINE));
    const body = examRoundDetailResponseSchema.parse(await res.json());

    expect(body.data.students[0]!.actualScore).toBe(91);
    // 예측 학생 전원의 실점수가 들어왔으므로 실점수 단계가 완료된다.
    expect(body.data.summary.stages.find((s) => s.key === "actual")!.done).toBe(
      true,
    );
  });

  it("🔴 실측 청사진을 담는 컬럼이 없다 — 예측값을 실측인 척 복사하지 않는다", async () => {
    seedPredictionRuns([
      runRow(RUN_MINE, [scorePrediction(MOCK_STUDENT_1.id, 88)]),
    ]);

    const res = await getRound(undefined as never, detailParams(RUN_MINE));
    const body = examRoundDetailResponseSchema.parse(await res.json());

    expect(body.data.observedBlueprint).toBeNull();
    expect(body.data.predictedBlueprint).not.toBeNull();
  });

  it("학생이 한 명도 없는 사용자에게는 아무 회차도 보이지 않는다", async () => {
    // STUDENT_IDS 는 전부 이 강사 소유 반에 속한다 — 대조군으로 남의 학생만 둔 회차를 쓴다.
    expect(STUDENT_IDS).toContain(MOCK_STUDENT_1.id);
    seedPredictionRuns([runRow(RUN_OTHER, [])]);

    const body = examRoundListResponseSchema.parse(
      await (await listRounds()).json(),
    );
    expect(body.data).toEqual([]);
  });
});
