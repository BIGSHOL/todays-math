/**
 * 🔴→🟢 T7.14 — GET /api/exam/rounds · /api/exam/rounds/{id} (화면 조회 전용).
 *
 * 이 테스트가 있는 이유:
 *
 * 1. **빈 목록이 정상 응답이다.** 실측이 아직 0건이라 이 API 는 당분간 대부분 빈 배열을
 *    낸다. 그 상태에서 500 이 나거나 숫자가 지어져 나오면 화면이 첫날부터 거짓말을 한다.
 * 2. **소유권은 `PredictionRun.userId` 다.** 회차 자체가 누구 것인지로 가른다.
 *    학생 유무는 소유권과 무관하다. 그래서 "남의 회차 404" 와 "남의 학생 이름 미노출"을
 *    따로 잠근다 — 앞은 회차 경계, 뒤는 학생 경계라 서로 다른 방어다.
 *
 *    ⚠️ 한때 이 자리가 `학생 → 반 → 반 소유자` 로 되짚는 우회로였다("userId 컬럼이
 *    아직 없다"는 전제). 전제가 틀렸고, 그 결과 **내 회차가 전부 사라졌다** —
 *    엔진이 학생별 예상 점수를 아직 안 내므로 되짚을 학생이 없기 때문이다.
 *    아래 "실 엔진이 저장하는 모양" 테스트가 그 회귀를 잠근다.
 * 3. **없는 것을 지어내지 않는다. 있는 것을 없는 척도 하지 않는다.**
 *    문제지·채점 단계는 스키마에 원천이 없어 미완으로 둔다. 반대로 `exam_date` 는
 *    실재하는 컬럼이라 그대로 실어야 한다 — null 로 뭉개면 D-day 와 정렬이 죽는다.
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
/** 다른 원장. 회차 소유권 경계를 확인하는 대조군이다. */
const OTHER_TEACHER_ID = "10000000-0000-4000-8000-0000000000ff";
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
 *
 * 🔴 나머지 열은 **`prediction_run` 테이블과 같아야 한다.** 한때 `userId`·`examDate`·
 *    `riskFlags` 가 이 타입에 없었고, 그래서 픽스처가 그 열을 만들 수조차 없었다.
 *    조회 코드가 두 열을 통째로 무시하는데도 이 파일은 전부 초록이었다(2026-08-16).
 *    열을 빼지 말 것 — 뺀 열의 버그는 여기서 검출되지 않는다.
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
  riskFlags: string[];
  examDate: Date | null;
  actualSchoolMean: number | null;
  actualSchoolStdev: number | null;
  actualRecordedAt: Date | null;
};

/**
 * 기본은 **이 강사 소유** 회차다. 남의 회차를 만들 때만 `userId` 를 넘긴다.
 * `predictedScores` 를 생략하면 `[]` — 실 엔진이 오늘 실제로 저장하는 값이다
 * (predictionRunService.ts: 학생별 예상 점수는 T7.11 전까지 못 낸다).
 */
function runRow(
  id: string,
  predictedScores: unknown[] = [],
  over: Partial<SeedRun> = {},
): SeedRun {
  return {
    id,
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
    riskFlags: [],
    examDate: null,
    actualSchoolMean: null,
    actualSchoolStdev: null,
    actualRecordedAt: null,
    ...over,
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

  it("내 회차만 낸다 — 남의 회차는 목록에서 빠진다", async () => {
    seedPredictionRuns([
      runRow(RUN_MINE, [scorePrediction(MOCK_STUDENT_1.id, 88)]),
      runRow(RUN_OTHER, [scorePrediction(FOREIGN_STUDENT_ID, 71)], {
        userId: OTHER_TEACHER_ID,
      }),
    ]);

    const res = await listRounds();
    const body = examRoundListResponseSchema.parse(await res.json());

    expect(body.data.map((r) => r.id)).toEqual([RUN_MINE]);
  });

  it("🔴 남의 회차에 내 학생이 섞여 있어도 그 회차는 내 것이 아니다", async () => {
    // 소유권을 학생으로 되짚던 시절에는 이 회차가 내 계기판에 떴고, 남의 청사진·
    // 신뢰도·엔진 버전이 그대로 보였다. 소유자는 회차의 userId 하나로 정한다.
    seedPredictionRuns([
      runRow(RUN_OTHER, [scorePrediction(MOCK_STUDENT_1.id, 88)], {
        userId: OTHER_TEACHER_ID,
      }),
    ]);

    const body = examRoundListResponseSchema.parse(
      await (await listRounds()).json(),
    );
    expect(body.data).toEqual([]);

    const res = await getRound(undefined as never, detailParams(RUN_OTHER));
    expect(res.status).toBe(404);
  });

  it("🔴 실 엔진이 저장하는 모양(predictedScores: [])이어도 내 회차는 보인다", async () => {
    // runPrediction() 은 학생별 예상 점수를 아직 못 내서 항상 빈 배열을 저장한다.
    // 소유권을 학생으로 되짚으면 이 회차는 영원히 안 보인다 — 계기판이 통째로 빈다.
    seedPredictionRuns([runRow(RUN_MINE)]);

    const body = examRoundListResponseSchema.parse(
      await (await listRounds()).json(),
    );
    expect(body.data.map((r) => r.id)).toEqual([RUN_MINE]);

    const res = await getRound(undefined as never, detailParams(RUN_MINE));
    expect(res.status).toBe(200);
    const detail = examRoundDetailResponseSchema.parse(await res.json());
    // 학생 표는 비지만, **왜** 비는지 화면이 가릴 수 있게 인원 수를 함께 낸다.
    expect(detail.data.students).toEqual([]);
    expect(detail.data.predictedStudentCount).toBe(0);
    expect(detail.data.predictedBlueprint).not.toBeNull();
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

  it("🔴 시행일이 있으면 그대로 낸다 — 없는 척하면 D-day 와 정렬이 죽는다", async () => {
    seedPredictionRuns([
      runRow(RUN_MINE, [scorePrediction(MOCK_STUDENT_1.id, 88)], {
        examDate: new Date("2026-08-29T00:00:00.000Z"),
      }),
    ]);

    const body = examRoundListResponseSchema.parse(
      await (await listRounds()).json(),
    );
    expect(body.data[0]!.examDate).toBe("2026-08-29");
  });

  it("🔴 시행일이 NULL 이면 null 이다 — 대상 시점에서 날짜를 만들지 않는다", async () => {
    seedPredictionRuns([
      runRow(RUN_MINE, [scorePrediction(MOCK_STUDENT_1.id, 88)], {
        examDate: null,
      }),
    ]);

    const body = examRoundListResponseSchema.parse(
      await (await listRounds()).json(),
    );
    // 대상 시점은 2025-2 중간인데, 거기서 그럴듯한 날짜를 지어내면 안 된다.
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
      runRow(RUN_OTHER, [scorePrediction(FOREIGN_STUDENT_ID, 71)], {
        userId: OTHER_TEACHER_ID,
      }),
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

  it("🔴 예측 대상이 전부 남의 학생이어도 내 회차면 보인다 — 학생 행만 빈다", async () => {
    // 소유권은 회차의 userId 다. 학생은 **이름을 붙이고 남의 이름을 막는** 데만 쓴다.
    expect(STUDENT_IDS).toContain(MOCK_STUDENT_1.id);
    seedPredictionRuns([
      runRow(RUN_MINE, [scorePrediction(FOREIGN_STUDENT_ID, 71)]),
    ]);

    const body = examRoundListResponseSchema.parse(
      await (await listRounds()).json(),
    );
    expect(body.data.map((r) => r.id)).toEqual([RUN_MINE]);

    const res = await getRound(undefined as never, detailParams(RUN_MINE));
    const detail = examRoundDetailResponseSchema.parse(await res.json());
    expect(detail.data.students).toEqual([]);
    // 0 이 아니다 — 예측은 냈는데 그 학생이 내 학생이 아닌 것이다.
    // 화면은 이 값으로 "학생별 예측 없음" 과 "내 학생 없음" 을 갈라 적는다.
    expect(detail.data.predictedStudentCount).toBe(1);
  });
});
