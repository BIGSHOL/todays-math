/**
 * 🔴 RED → 🟢 GREEN — T7.10 실측 점수 저장 (`POST|GET /api/predictions/{id}/actual`).
 *
 * 왜 이 테스트가 있는가.
 * 보정 루프는 "예측을 저장해 두었다가 나중에 실측을 붙여 잔차를 본다"가 전부다. 그 붙이는
 * 순간에 틀어질 수 있는 것이 넷이고, 넷 다 조용히 틀어진다 —
 *   ① 원장이 점수를 잘못 입력해 다시 넣었을 때 **행이 하나 더 생기면** 같은 학생이 두 번
 *      세어져 잔차 통계가 통째로 오염된다. 그래서 갱신이어야 한다(@@unique[runId,studentId]).
 *   ② 예측값을 run 의 Json 에서 매번 다시 읽으면, Json 모양이 바뀌는 날 과거 보정 근거가
 *      흔들린다. 그래서 저장 시점에 **스냅샷을 복사**하고, 재저장해도 그 스냅샷은 덮지 않는다.
 *   ③ 점 예측 MAE 만 보면 구간이 정직한지는 영영 모른다. `intervalHit` 을 따로 남긴다.
 *   ④ 그 회차가 예측하지도 않은 학생의 점수를 받아 두면 잔차가 아니라 잡음이 쌓인다 → 422.
 *
 * 이 파일은 `@/lib/db` 를 파일 단위로 모킹한다(auth.test.ts 와 같은 방식). 전역
 * prismaTestDouble 에 새 모델을 얹으면 병렬 트랙(T7.7)과 같은 파일을 건드리게 되기 때문이다.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => {
  const RUN_ID = "aaaaaaaa-0000-4000-8000-000000000001";
  const RUN_OTHER_ID = "aaaaaaaa-0000-4000-8000-000000000002";
  const MISSING_RUN_ID = "aaaaaaaa-0000-4000-8000-0000000000ff";
  const TEACHER_ID = "10000000-0000-4000-8000-000000000001";
  const OTHER_TEACHER_ID = "10000000-0000-4000-8000-000000000002";
  const CLASS_MINE = "20000000-0000-4000-8000-000000000001";
  const CLASS_OTHER = "20000000-0000-4000-8000-000000000002";
  const STUDENT_A = "30000000-0000-4000-8000-000000000001";
  const STUDENT_B = "30000000-0000-4000-8000-000000000002";
  const STUDENT_OTHER = "30000000-0000-4000-8000-000000000003";
  const STUDENT_NOT_IN_RUN = "30000000-0000-4000-8000-000000000004";
  const STUDENT_NO_INTERVAL = "30000000-0000-4000-8000-000000000005";
  const STUDENT_MISSING = "30000000-0000-4000-8000-0000000000ff";

  type RunRow = {
    id: string;
    userId: string;
    engineVersion: string;
    predictedScores: unknown;
    actualSchoolMean: number | null;
    actualSchoolStdev: number | null;
    actualRecordedAt: Date | null;
  };
  type ActualRow = {
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

  const state = {
    sessionUser: null as { id: string; email: string; name: string } | null,
    runs: [] as RunRow[],
    actualScores: [] as ActualRow[],
    seq: 0,
  };

  return {
    RUN_ID,
    RUN_OTHER_ID,
    MISSING_RUN_ID,
    TEACHER_ID,
    OTHER_TEACHER_ID,
    CLASS_MINE,
    CLASS_OTHER,
    STUDENT_A,
    STUDENT_B,
    STUDENT_OTHER,
    STUDENT_NOT_IN_RUN,
    STUDENT_NO_INTERVAL,
    STUDENT_MISSING,
    state,
  };
});

vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => f.state.sessionUser),
}));

vi.mock("@/lib/db", () => {
  const students: Record<string, { id: string; classId: string }> = {
    [f.STUDENT_A]: { id: f.STUDENT_A, classId: f.CLASS_MINE },
    [f.STUDENT_B]: { id: f.STUDENT_B, classId: f.CLASS_MINE },
    [f.STUDENT_NOT_IN_RUN]: { id: f.STUDENT_NOT_IN_RUN, classId: f.CLASS_MINE },
    [f.STUDENT_NO_INTERVAL]: {
      id: f.STUDENT_NO_INTERVAL,
      classId: f.CLASS_MINE,
    },
    [f.STUDENT_OTHER]: { id: f.STUDENT_OTHER, classId: f.CLASS_OTHER },
  };
  const classes: Record<string, { id: string; userId: string }> = {
    [f.CLASS_MINE]: { id: f.CLASS_MINE, userId: f.TEACHER_ID },
    [f.CLASS_OTHER]: { id: f.CLASS_OTHER, userId: f.OTHER_TEACHER_ID },
  };

  const db = {
    student: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        students[where.id] ?? null,
    },
    class: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        classes[where.id] ?? null,
    },
    predictionRun: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        f.state.runs.find((r) => r.id === where.id) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = f.state.runs.find((r) => r.id === where.id);
        if (!row) throw new Error("run not found");
        Object.assign(row, data);
        return row;
      },
    },
    actualExamScore: {
      findMany: async ({ where }: { where: { runId: string } }) =>
        f.state.actualScores
          .filter((r) => r.runId === where.runId)
          .sort((a, b) => a.studentId.localeCompare(b.studentId))
          .map((r) => ({ ...r })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        f.state.seq += 1;
        const row = {
          id: `bbbbbbbb-0000-4000-8000-${String(f.state.seq).padStart(12, "0")}`,
          recordedAt: new Date("2026-08-16T00:00:00.000Z"),
          updatedAt: new Date("2026-08-16T00:00:00.000Z"),
          ...data,
        } as never;
        f.state.actualScores.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { runId_studentId: { runId: string; studentId: string } };
        data: Record<string, unknown>;
      }) => {
        const row = f.state.actualScores.find(
          (r) =>
            r.runId === where.runId_studentId.runId &&
            r.studentId === where.runId_studentId.studentId,
        );
        if (!row) throw new Error("actual score not found");
        Object.assign(row, data, {
          updatedAt: new Date("2026-08-16T01:00:00.000Z"),
        });
        return row;
      },
    },
    async $transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      return work(db);
    },
  };

  return { db };
});

import { GET, POST } from "@/app/api/predictions/[id]/actual/route";
import { actualScoreResponseSchema } from "@/contracts/calibration.contract";
import { errorResponseSchema } from "@/contracts/common.contract";

function jsonRequest(method: string, body?: unknown, runId: string = f.RUN_ID) {
  return new NextRequest(`http://localhost/api/predictions/${runId}/actual`, {
    method,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function routeContext(id: string = f.RUN_ID) {
  return { params: Promise.resolve({ id }) };
}

function buildPredictedScores() {
  return [
    {
      studentId: f.STUDENT_A,
      series: { school: "정화중", level: "중", grade: 3, subject: "중3" },
      period: { year: 2026, semester: 2, round: "중간" },
      expectedScore: 72,
      interval: { lower: 65, upper: 79, coverage: 0.8 },
      byUnit: [],
      riskFlags: [],
    },
    {
      studentId: f.STUDENT_B,
      series: { school: "정화중", level: "중", grade: 3, subject: "중3" },
      period: { year: 2026, semester: 2, round: "중간" },
      expectedScore: 88,
      interval: { lower: 82, upper: 94, coverage: 0.8 },
      byUnit: [],
      riskFlags: [],
    },
    {
      // 엔진이 구간을 못 낸 학생. 적중 여부를 지어내지 않는다.
      studentId: f.STUDENT_NO_INTERVAL,
      series: { school: "정화중", level: "중", grade: 3, subject: "중3" },
      period: { year: 2026, semester: 2, round: "중간" },
      expectedScore: 55,
      interval: null,
      byUnit: [],
      riskFlags: [],
    },
    {
      // 학생 개인이 아니라 시험지 평균 예측 — 실측 대조 대상이 아니다.
      studentId: null,
      series: { school: "정화중", level: "중", grade: 3, subject: "중3" },
      period: { year: 2026, semester: 2, round: "중간" },
      expectedScore: 64,
      interval: { lower: 58, upper: 70, coverage: 0.8 },
      byUnit: [],
      riskFlags: [],
    },
  ];
}

beforeEach(() => {
  f.state.sessionUser = {
    id: f.TEACHER_ID,
    email: "teacher@todaysmath.test",
    name: "테스트 원장",
  };
  f.state.runs = [
    {
      id: f.RUN_ID,
      userId: f.TEACHER_ID,
      engineVersion: "predictor-v0.3.0",
      predictedScores: buildPredictedScores(),
      actualSchoolMean: null,
      actualSchoolStdev: null,
      actualRecordedAt: null,
    },
    {
      // 다른 원장이 만든 회차. 내 학생이더라도 여기엔 실측을 붙일 수 없다.
      id: f.RUN_OTHER_ID,
      userId: f.OTHER_TEACHER_ID,
      engineVersion: "predictor-v0.3.0",
      predictedScores: buildPredictedScores(),
      actualSchoolMean: null,
      actualSchoolStdev: null,
      actualRecordedAt: null,
    },
  ];
  f.state.actualScores = [];
  f.state.seq = 0;
});

describe("[T7.10] POST /api/predictions/{id}/actual — 실측 저장", () => {
  it("잔차와 구간 적중을 계산해 저장한다", async () => {
    const res = await POST(
      jsonRequest("POST", {
        scores: [
          { studentId: f.STUDENT_A, actualScore: 78 },
          { studentId: f.STUDENT_B, actualScore: 70 },
        ],
      }),
      routeContext(),
    );
    expect(res.status).toBe(200);

    const body = actualScoreResponseSchema.parse(await res.json());
    expect(body.data.runId).toBe(f.RUN_ID);
    expect(body.data.scores).toHaveLength(2);

    const a = body.data.scores.find((s) => s.studentId === f.STUDENT_A)!;
    expect(a.predictedScore).toBe(72);
    expect(a.actualScore).toBe(78);
    expect(a.residual).toBe(6);
    expect(a.intervalHit).toBe(true);

    const b = body.data.scores.find((s) => s.studentId === f.STUDENT_B)!;
    expect(b.predictedScore).toBe(88);
    expect(b.residual).toBe(-18);
    expect(b.intervalHit).toBe(false);

    expect(body.data.summary).toEqual({
      count: 2,
      mae: 12,
      meanResidual: -6,
      intervalCount: 2,
      intervalHitRate: 0.5,
    });
  });

  it("같은 학생을 두 번 붙이면 행이 늘지 않고 갱신된다", async () => {
    await POST(
      jsonRequest("POST", {
        scores: [{ studentId: f.STUDENT_A, actualScore: 78 }],
      }),
      routeContext(),
    );
    const res = await POST(
      jsonRequest("POST", {
        scores: [{ studentId: f.STUDENT_A, actualScore: 81 }],
      }),
      routeContext(),
    );
    expect(res.status).toBe(200);

    expect(f.state.actualScores).toHaveLength(1);
    const body = actualScoreResponseSchema.parse(await res.json());
    expect(body.data.scores).toHaveLength(1);
    expect(body.data.scores[0]!.actualScore).toBe(81);
    expect(body.data.scores[0]!.residual).toBe(9);
  });

  it("재저장해도 예측값 스냅샷은 run 의 Json 을 따라가지 않는다", async () => {
    await POST(
      jsonRequest("POST", {
        scores: [{ studentId: f.STUDENT_A, actualScore: 78 }],
      }),
      routeContext(),
    );

    // 엔진을 고쳐 run 의 Json 이 바뀐 상황을 흉내 낸다.
    const mutated = buildPredictedScores();
    mutated[0]!.expectedScore = 50;
    mutated[0]!.interval = { lower: 40, upper: 60, coverage: 0.8 };
    f.state.runs[0]!.predictedScores = mutated;

    const res = await POST(
      jsonRequest("POST", {
        scores: [{ studentId: f.STUDENT_A, actualScore: 78 }],
      }),
      routeContext(),
    );
    const body = actualScoreResponseSchema.parse(await res.json());
    expect(body.data.scores[0]!.predictedScore).toBe(72);
    expect(body.data.scores[0]!.residual).toBe(6);
    // 구간도 같은 규칙이다 — run 의 Json 이 40~60 으로 바뀌어도 스냅샷은 65~79 다.
    expect(body.data.scores[0]!.predictedLower).toBe(65);
    expect(body.data.scores[0]!.predictedUpper).toBe(79);
    expect(body.data.scores[0]!.predictedCoverage).toBe(0.8);
    // 적중 판정도 **저장된** 구간으로 센다 — 78 은 65~79 안이라 여전히 적중이다.
    // (run 의 새 구간 40~60 을 봤다면 빗나감으로 뒤집혔을 것이다.)
    expect(body.data.scores[0]!.intervalHit).toBe(true);
  });

  it("저장할 때 예측 구간을 함께 스냅샷으로 복사한다", async () => {
    const res = await POST(
      jsonRequest("POST", {
        scores: [{ studentId: f.STUDENT_B, actualScore: 70 }],
      }),
      routeContext(),
    );
    const body = actualScoreResponseSchema.parse(await res.json());
    const b = body.data.scores[0]!;
    expect(b.predictedLower).toBe(82);
    expect(b.predictedUpper).toBe(94);
    expect(b.predictedCoverage).toBe(0.8);
    expect(b.intervalHit).toBe(false);
  });

  /**
   * 점수 정정은 **실제값**이 움직인 것이다. 구간은 그대로이므로 적중 여부는
   * 저장된 구간 스냅샷 기준으로 **다시** 세야 한다(얼려 두면 안 된다).
   */
  it("점수를 정정하면 적중 여부는 저장된 구간으로 다시 센다", async () => {
    await POST(
      jsonRequest("POST", {
        scores: [{ studentId: f.STUDENT_A, actualScore: 78 }],
      }),
      routeContext(),
    );
    const res = await POST(
      jsonRequest("POST", {
        scores: [{ studentId: f.STUDENT_A, actualScore: 95 }],
      }),
      routeContext(),
    );
    const body = actualScoreResponseSchema.parse(await res.json());
    expect(body.data.scores[0]!.intervalHit).toBe(false);
    expect(body.data.scores[0]!.predictedLower).toBe(65);
    expect(body.data.scores[0]!.residual).toBe(23);
  });

  it("예측 시점에 구간이 없었으면 null 로 두고 적중률 분모에서 뺀다", async () => {
    const res = await POST(
      jsonRequest("POST", {
        scores: [
          { studentId: f.STUDENT_A, actualScore: 78 },
          { studentId: f.STUDENT_NO_INTERVAL, actualScore: 60 },
        ],
      }),
      routeContext(),
    );
    expect(res.status).toBe(200);
    const body = actualScoreResponseSchema.parse(await res.json());

    const noInterval = body.data.scores.find(
      (s) => s.studentId === f.STUDENT_NO_INTERVAL,
    )!;
    expect(noInterval.predictedScore).toBe(55);
    expect(noInterval.residual).toBe(5);
    expect(noInterval.predictedLower).toBeNull();
    expect(noInterval.predictedUpper).toBeNull();
    expect(noInterval.predictedCoverage).toBeNull();

    // 표본은 2건이지만 적중을 판정할 수 있는 것은 1건뿐이다.
    expect(body.data.summary.count).toBe(2);
    expect(body.data.summary.intervalCount).toBe(1);
    expect(body.data.summary.intervalHitRate).toBe(1);
  });

  it("남의 회차에는 실측을 붙일 수 없다 — 403", async () => {
    const res = await POST(
      jsonRequest(
        "POST",
        { scores: [{ studentId: f.STUDENT_A, actualScore: 78 }] },
        f.RUN_OTHER_ID,
      ),
      routeContext(f.RUN_OTHER_ID),
    );
    expect(res.status).toBe(403);
    expect(f.state.actualScores).toHaveLength(0);
  });

  it("run 에 없는 학생을 붙이면 422다", async () => {
    const res = await POST(
      jsonRequest("POST", {
        scores: [
          { studentId: f.STUDENT_A, actualScore: 78 },
          { studentId: f.STUDENT_NOT_IN_RUN, actualScore: 90 },
        ],
      }),
      routeContext(),
    );
    expect(res.status).toBe(422);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(body.error.details)).toContain(f.STUDENT_NOT_IN_RUN);
    // 한 명이라도 어긋나면 아무것도 저장하지 않는다.
    expect(f.state.actualScores).toHaveLength(0);
  });

  it("학교 평균을 함께 보내면 회차에 기록한다", async () => {
    const res = await POST(
      jsonRequest("POST", {
        scores: [{ studentId: f.STUDENT_A, actualScore: 78 }],
        schoolMean: 62.5,
        schoolStdev: 12,
      }),
      routeContext(),
    );
    expect(res.status).toBe(200);
    expect(f.state.runs[0]!.actualSchoolMean).toBe(62.5);
    expect(f.state.runs[0]!.actualSchoolStdev).toBe(12);
    expect(f.state.runs[0]!.actualRecordedAt).toBeInstanceOf(Date);
  });

  it("없는 회차면 404다", async () => {
    const res = await POST(
      jsonRequest("POST", {
        scores: [{ studentId: f.STUDENT_A, actualScore: 78 }],
      }),
      routeContext(f.MISSING_RUN_ID),
    );
    expect(res.status).toBe(404);
  });

  it("없는 학생이면 404다", async () => {
    const res = await POST(
      jsonRequest("POST", {
        scores: [{ studentId: f.STUDENT_MISSING, actualScore: 78 }],
      }),
      routeContext(),
    );
    expect(res.status).toBe(404);
  });

  it("다른 원장의 학생이면 403이다", async () => {
    const res = await POST(
      jsonRequest("POST", {
        scores: [{ studentId: f.STUDENT_OTHER, actualScore: 78 }],
      }),
      routeContext(),
    );
    expect(res.status).toBe(403);
  });

  it("로그인하지 않으면 401이다", async () => {
    f.state.sessionUser = null;
    const res = await POST(
      jsonRequest("POST", {
        scores: [{ studentId: f.STUDENT_A, actualScore: 78 }],
      }),
      routeContext(),
    );
    expect(res.status).toBe(401);
  });

  it("빈 목록이나 범위를 벗어난 점수는 400이다", async () => {
    const empty = await POST(
      jsonRequest("POST", { scores: [] }),
      routeContext(),
    );
    expect(empty.status).toBe(400);

    const outOfRange = await POST(
      jsonRequest("POST", {
        scores: [{ studentId: f.STUDENT_A, actualScore: 140 }],
      }),
      routeContext(),
    );
    expect(outOfRange.status).toBe(400);
  });

  it("한 요청에 같은 학생이 두 번 들어오면 400이다 — 조용히 덮지 않는다", async () => {
    const res = await POST(
      jsonRequest("POST", {
        scores: [
          { studentId: f.STUDENT_A, actualScore: 78 },
          { studentId: f.STUDENT_A, actualScore: 81 },
        ],
      }),
      routeContext(),
    );
    expect(res.status).toBe(400);
    expect(f.state.actualScores).toHaveLength(0);
  });
});

describe("[T7.10] GET /api/predictions/{id}/actual — 잔차 조회", () => {
  it("저장된 실측과 요약을 돌려준다", async () => {
    await POST(
      jsonRequest("POST", {
        scores: [
          { studentId: f.STUDENT_A, actualScore: 78 },
          { studentId: f.STUDENT_B, actualScore: 70 },
        ],
      }),
      routeContext(),
    );

    const res = await GET(jsonRequest("GET"), routeContext());
    expect(res.status).toBe(200);
    const body = actualScoreResponseSchema.parse(await res.json());
    expect(body.data.scores).toHaveLength(2);
    expect(body.data.summary.count).toBe(2);
    expect(body.data.summary.mae).toBe(12);
    expect(body.data.summary.intervalHitRate).toBe(0.5);
  });

  it("실측이 아직 없으면 숫자를 지어내지 않고 null 이다", async () => {
    const res = await GET(jsonRequest("GET"), routeContext());
    expect(res.status).toBe(200);
    const body = actualScoreResponseSchema.parse(await res.json());
    expect(body.data.summary).toEqual({
      count: 0,
      mae: null,
      meanResidual: null,
      intervalCount: 0,
      intervalHitRate: null,
    });
  });

  it("없는 회차면 404다", async () => {
    const res = await GET(jsonRequest("GET"), routeContext(f.MISSING_RUN_ID));
    expect(res.status).toBe(404);
  });

  it("남의 회차는 조회할 수 없다 — 403", async () => {
    const res = await GET(
      jsonRequest("GET", undefined, f.RUN_OTHER_ID),
      routeContext(f.RUN_OTHER_ID),
    );
    expect(res.status).toBe(403);
  });

  it("로그인하지 않으면 401이다", async () => {
    f.state.sessionUser = null;
    const res = await GET(jsonRequest("GET"), routeContext());
    expect(res.status).toBe(401);
  });
});
