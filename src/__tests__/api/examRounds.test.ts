/**
 * 🔴→🟢 T7.14 — GET /api/exam/rounds · /api/exam/rounds/{id} (화면 조회 전용).
 *
 * 이 테스트가 있는 이유:
 *
 * 1. **빈 목록이 정상 응답이다.** 실측이 아직 0건이라 이 API 는 당분간 대부분 빈 배열을
 *    낸다. 그 상태에서 500 이 나거나 숫자가 지어져 나오면 화면이 첫날부터 거짓말을 한다.
 * 2. **소유권.** 판정 근거는 `PredictionRun.userId` **컬럼 하나**다. 학생 이름은 별개
 *    경계라 한 번 더 거른다 — 같은 회차에 남의 학생이 섞여 있어도 이름이 새면 안 된다.
 *    그래서 "남의 회차 404" 와 "남의 학생 이름 미노출"을 따로 잠근다.
 *    (예전에는 `userId` 컬럼이 없어 `학생 → 반 → 반 소유자` 로 되짚었는데, 그 경로가
 *     `predictedScores` 를 거쳐서 그 Json 이 빈 지금은 내 회차조차 사라졌다 — 🔴1.)
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
import {
  MOCK_STUDENT_1,
  MOCK_STUDENT_2,
  MOCK_STUDENT_3,
  MOCK_STUDENTS,
  STUDENT_IDS,
} from "@/mocks/data";
import {
  seedActualExamScores,
  seedPredictionRuns,
} from "@/mocks/prismaTestDouble";
import { getSessionUser } from "@/lib/session";

const OTHER_TEACHER_ID = "10000000-0000-4000-8000-000000000002";
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
  userId: string;
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

function runRow(
  id: string,
  predictedScores: unknown[],
  userId: string = TEACHER_ID,
): SeedRun {
  return {
    id,
    userId,
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
      runRow(RUN_OTHER, [scorePrediction(FOREIGN_STUDENT_ID, 71)], OTHER_TEACHER_ID),
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
      runRow(RUN_OTHER, [scorePrediction(FOREIGN_STUDENT_ID, 71)], OTHER_TEACHER_ID),
    ]);

    const res = await getRound(undefined as never, detailParams(RUN_OTHER));
    expect(res.status).toBe(404);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe(
      "NOT_FOUND",
    );
  });

  /**
   * 명단은 **응시 명단**(내 학생 중 이 시험을 보는 학생)이지 예측 목록이 아니다.
   * 재학 정보가 비어 있는 학생은 "모른다"라서 명단에 든다 — 예측이 없어도 점수를
   * 넣을 자리를 줘야 하기 때문이다(adv-보정루프.md 🔴1).
   */
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
    // 내 학생 전원이 명단에 있다(재학 정보가 없어 아무도 못 뺀다).
    expect(body.data.students.map((s) => s.studentName).sort()).toEqual(
      MOCK_STUDENTS.map((s) => s.name).sort(),
    );
    // 예측이 있는 학생만 예측값이 실린다.
    const byId = Object.fromEntries(
      body.data.students.map((s) => [s.studentId, s]),
    );
    expect(byId[MOCK_STUDENT_1.id]!.prediction!.expectedScore).toBe(88);
    expect(byId[MOCK_STUDENT_2.id]!.prediction!.expectedScore).toBe(74);
    expect(byId[MOCK_STUDENT_3.id]!.prediction).toBeNull();
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

    const ids = body.data.students.map((s) => s.studentId);
    expect(ids).not.toContain(FOREIGN_STUDENT_ID);
    expect(ids.every((id) => STUDENT_IDS.includes(id))).toBe(true);
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

    const row = body.data.students.find(
      (s) => s.studentId === MOCK_STUDENT_1.id,
    )!;
    expect(row.actualScore).toBe(91);
    // 분모는 응시 명단(내 학생 5명)이라 1명만으로는 아직 완료가 아니다.
    const actual = body.data.summary.stages.find((s) => s.key === "actual")!;
    expect(actual.progress).toEqual({ current: 1, total: MOCK_STUDENTS.length });
    expect(actual.done).toBe(false);
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

  it("남이 만든 회차는 목록에 없다", async () => {
    seedPredictionRuns([runRow(RUN_OTHER, [], OTHER_TEACHER_ID)]);

    const body = examRoundListResponseSchema.parse(
      await (await listRounds()).json(),
    );
    expect(body.data).toEqual([]);
  });

  /**
   * 반을 만들기 전에 예측부터 돌리는 순서도 정상이다. 그때 회차를 숨기면 원장은
   * 예측이 실패한 줄 안다 — 소유 근거(`PredictionRun.userId`)가 있으면 보여 준다.
   */
  it("학생이 아직 없어도 내 회차는 목록에 보인다", async () => {
    seedPredictionRuns([runRow(RUN_MINE, [])]);
    vi.mocked(getSessionUser).mockResolvedValueOnce({
      id: OTHER_TEACHER_ID,
      email: "other@todaysmath.test",
      name: "학생 없는 원장",
    });
    seedPredictionRuns([runRow(RUN_OTHER, [], OTHER_TEACHER_ID)]);

    const body = examRoundListResponseSchema.parse(
      await (await listRounds()).json(),
    );
    expect(body.data.map((r) => r.id)).toEqual([RUN_OTHER]);
    expect(body.data[0]!.stages.find((s) => s.key === "actual")!.progress).toBeNull();
  });
});
