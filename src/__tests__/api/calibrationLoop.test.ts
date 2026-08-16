/**
 * 🔴 RED → 🟢 GREEN — 보정 루프가 실제로 닫히는가 (adv-보정루프.md 🔴1 회귀 가드).
 *
 * ## 왜 이 파일이 따로 있어야 하는가
 *
 * `actualScore.test.ts` 는 `PredictionRun.predictedScores` Json 을 **손으로 지어 넣은**
 * 픽스처로 저장 규칙을 검증한다. 그 픽스처가 코드 어디서도 만들어지지 않는 모양이라는 것을
 * 아무도 못 봤다 — 그 Json 을 실제로 쓰는 코드는 `runPrediction` 하나뿐이고, 그것은
 * 학생 능력 엔진(11 §3 L3)이 없어 **항상 빈 배열**을 저장한다.
 * 그 결과 실전에서는 모든 실점수 저장이 422 였는데 테스트 20건은 전부 초록이었다.
 * ("합성 픽스처가 이관 결함을 통과시켰다" — 이 저장소가 이미 낸 사고와 같은 종류다.)
 *
 * 그래서 여기서는 픽스처를 쓰지 않는다. **진짜 `POST /api/predictions` 로 run 을 만들고,
 * 그 run 에 실점수를 붙이고, 화면 조회까지 한 줄로 통과시킨다.** 엔진이 무엇을 저장하든
 * 이 경로가 열려 있어야 보정 루프에 표본이 쌓인다.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const STUDENT_A = "dddddddd-0000-4000-8000-00000000000d";
const STUDENT_FAR = "dddddddd-0000-4000-8000-00000000000e";

const sessionState = vi.hoisted(() => ({
  user: null as { id: string; email: string; name: string } | null,
}));

vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => sessionState.user),
}));

/**
 * `predictionRunTestDb`(T7.7 대역)에 실측 경로가 쓰는 델리게이트만 얹는다.
 * 대역이 실제 Prisma 보다 관대해지지 않도록 지원하지 않는 질의는 던진다(그 파일 정책).
 */
vi.mock("@/lib/db", async () => {
  const mod = await import("@/__tests__/helpers/predictionRunTestDb");

  const STUDENTS: Record<string, Record<string, unknown>> = {
    "dddddddd-0000-4000-8000-00000000000d": {
      id: "dddddddd-0000-4000-8000-00000000000d",
      classId: "cccccccc-0000-4000-8000-00000000000c",
      name: "김학생",
      // 재학 정보를 모르는 상태 — 실데이터의 기본값이다(채우는 화면이 아직 없다).
      schoolName: null,
      schoolLevel: null,
      schoolGrade: null,
    },
    "dddddddd-0000-4000-8000-00000000000e": {
      id: "dddddddd-0000-4000-8000-00000000000e",
      classId: "cccccccc-0000-4000-8000-00000000000c",
      name: "먼학생",
      // 내 학생이지만 다른 학교다 — 이 시험을 보지 않는다.
      schoolName: "머나먼중",
      schoolLevel: "중",
      schoolGrade: 3,
    },
  };
  const CLASSES: Record<string, Record<string, unknown>> = {
    "cccccccc-0000-4000-8000-00000000000c": {
      id: "cccccccc-0000-4000-8000-00000000000c",
      userId: "aaaaaaaa-0000-4000-8000-00000000000a",
    },
  };

  const actualRows: Array<Record<string, unknown>> = [];
  let seq = 0;

  const db = {
    ...mod.predictionTestDb,
    predictionRun: {
      ...mod.predictionTestDb.predictionRun,
      async update() {
        return null;
      },
    },
    student: {
      async findUnique({ where }: { where: { id: string } }) {
        return STUDENTS[where.id] ?? null;
      },
      async findMany() {
        return Object.values(STUDENTS);
      },
    },
    class: {
      async findUnique({ where }: { where: { id: string } }) {
        return CLASSES[where.id] ?? null;
      },
      async findMany() {
        return Object.values(CLASSES);
      },
    },
    actualExamScore: {
      async findMany() {
        return actualRows.map((r) => ({ ...r }));
      },
      async create({ data }: { data: Record<string, unknown> }) {
        seq += 1;
        const row = {
          id: `bbbbbbbb-0000-4000-8000-${String(seq).padStart(12, "0")}`,
          recordedAt: new Date("2026-08-16T00:00:00.000Z"),
          updatedAt: new Date("2026-08-16T00:00:00.000Z"),
          ...data,
        };
        actualRows.push(row);
        return row;
      },
      async update({
        where,
        data,
      }: {
        where: { runId_studentId: { runId: string; studentId: string } };
        data: Record<string, unknown>;
      }) {
        const row = actualRows.find(
          (r) =>
            r.runId === where.runId_studentId.runId &&
            r.studentId === where.runId_studentId.studentId,
        );
        if (!row) throw new Error("actual score not found");
        Object.assign(row, data);
        return row;
      },
    },
    async $transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      return work(db);
    },
    __reset() {
      actualRows.length = 0;
      seq = 0;
    },
  };
  return { db };
});

import { POST as createPrediction } from "@/app/api/predictions/route";
import {
  GET as getActual,
  POST as postActual,
} from "@/app/api/predictions/[id]/actual/route";
import { GET as listRounds } from "@/app/api/exam/rounds/route";
import { GET as getRound } from "@/app/api/exam/rounds/[id]/route";
import { actualScoreResponseSchema } from "@/contracts/calibration.contract";
import { examRoundDetailResponseSchema } from "@/components/exam/examScreen.contract";
import { db } from "@/lib/db";
import {
  resetPredictionTestDb,
  seedExam,
  standardQuestions,
} from "@/__tests__/helpers/predictionRunTestDb";

const SCHOOL = "가람중";
const SERIES = {
  school: SCHOOL,
  level: "중" as const,
  grade: 3,
  subject: "중3",
};
const TARGET = { year: 2026, semester: 1 as const, round: "중간" as const };

function withId(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function makeRun(): Promise<string> {
  const res = await createPrediction(
    new NextRequest("http://localhost/api/predictions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ series: SERIES, targetPeriod: TARGET }),
    }),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: { id: string } }).data.id;
}

function actualRequest(runId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/predictions/${runId}/actual`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetPredictionTestDb();
  (db as unknown as { __reset: () => void }).__reset();
  sessionState.user = { id: USER_A, email: "w@t.test", name: "원장" };
  for (const [y, s, r] of [
    [2025, 1, "중간"],
    [2025, 2, "중간"],
    [2025, 2, "기말"],
  ] as const) {
    seedExam({
      externalExamId: `가람-${y}-${s}-${r}`,
      school: SCHOOL,
      year: y,
      semester: s,
      round: r,
      questions: standardQuestions(),
    });
  }
});

describe("[보정 루프] 실제 엔진이 만든 회차에 실점수를 붙일 수 있다", () => {
  it("예측이 비어 있어도 실점수가 저장된다 — 루프의 입력이 쌓인다", async () => {
    const runId = await makeRun();

    const res = await postActual(
      actualRequest(runId, {
        scores: [{ studentId: STUDENT_A, actualScore: 78 }],
      }),
      withId(runId),
    );
    expect(res.status).toBe(200);

    const body = actualScoreResponseSchema.parse(await res.json());
    expect(body.data.scores).toHaveLength(1);
    const row = body.data.scores[0]!;
    expect(row.actualScore).toBe(78);
    // 예측이 없으니 잔차를 지어내지 않는다.
    expect(row.predictedScore).toBeNull();
    expect(row.residual).toBeNull();
    // 잔차가 없으므로 MAE 도 없다. 0 이 아니다.
    expect(body.data.summary.count).toBe(1);
    expect(body.data.summary.residualCount).toBe(0);
    expect(body.data.summary.mae).toBeNull();
  });

  it("저장한 점수를 다시 조회할 수 있다", async () => {
    const runId = await makeRun();
    await postActual(
      actualRequest(runId, {
        scores: [{ studentId: STUDENT_A, actualScore: 78 }],
      }),
      withId(runId),
    );

    const res = await getActual(
      new NextRequest(`http://localhost/api/predictions/${runId}/actual`),
      withId(runId),
    );
    expect(res.status).toBe(200);
    const body = actualScoreResponseSchema.parse(await res.json());
    expect(body.data.scores[0]!.actualScore).toBe(78);
  });

  it("점수를 고치면 갱신된다 — 행이 늘지 않는다", async () => {
    const runId = await makeRun();
    await postActual(
      actualRequest(runId, {
        scores: [{ studentId: STUDENT_A, actualScore: 78 }],
      }),
      withId(runId),
    );
    const res = await postActual(
      actualRequest(runId, {
        scores: [{ studentId: STUDENT_A, actualScore: 81 }],
      }),
      withId(runId),
    );
    expect(res.status).toBe(200);
    const body = actualScoreResponseSchema.parse(await res.json());
    expect(body.data.scores).toHaveLength(1);
    expect(body.data.scores[0]!.actualScore).toBe(81);
    // 예측이 없으니 정정해도 잔차는 여전히 없다. 0 으로 채우지 않는다.
    expect(body.data.scores[0]!.residual).toBeNull();
  });

  it("이 시험을 보지 않는 학생은 422 — 아무것도 저장하지 않는다", async () => {
    const runId = await makeRun();
    const res = await postActual(
      actualRequest(runId, {
        scores: [
          { studentId: STUDENT_A, actualScore: 78 },
          { studentId: STUDENT_FAR, actualScore: 90 },
        ],
      }),
      withId(runId),
    );
    expect(res.status).toBe(422);

    const after = await getActual(
      new NextRequest(`http://localhost/api/predictions/${runId}/actual`),
      withId(runId),
    );
    const body = actualScoreResponseSchema.parse(await after.json());
    expect(body.data.scores).toHaveLength(0);
  });
});

describe("[보정 루프] 화면이 그 회차와 학생을 보여준다", () => {
  it("방금 만든 회차가 계기판에 뜬다", async () => {
    const runId = await makeRun();
    const res = await listRounds();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.map((r) => r.id)).toContain(runId);
  });

  it("상세에 점수를 넣을 학생 행이 있다 — 예측이 없어도", async () => {
    const runId = await makeRun();
    const res = await getRound(
      new NextRequest(`http://localhost/api/exam/rounds/${runId}`),
      withId(runId),
    );
    expect(res.status).toBe(200);

    const body = examRoundDetailResponseSchema.parse(await res.json());
    const names = body.data.students.map((s) => s.studentName);
    // 재학 정보를 모르는 학생은 명단에 든다. 다른 학교로 확인된 학생은 빠진다.
    expect(names).toContain("김학생");
    expect(names).not.toContain("먼학생");

    const row = body.data.students.find((s) => s.studentName === "김학생")!;
    expect(row.prediction).toBeNull();
    expect(row.actualScore).toBeNull();
    // 미응시로 단정하지 않는다 — 그래야 화면이 입력칸을 그린다(StudentScoreTable).
    expect(row.absent).toBe(false);
  });

  it("넣은 점수가 상세에 반영된다", async () => {
    const runId = await makeRun();
    await postActual(
      actualRequest(runId, {
        scores: [{ studentId: STUDENT_A, actualScore: 78 }],
      }),
      withId(runId),
    );

    const res = await getRound(
      new NextRequest(`http://localhost/api/exam/rounds/${runId}`),
      withId(runId),
    );
    const body = examRoundDetailResponseSchema.parse(await res.json());
    const row = body.data.students.find((s) => s.studentName === "김학생")!;
    expect(row.actualScore).toBe(78);

    // 실점수 단계 진행도의 분모는 응시 명단(1명)이다.
    expect(body.data.summary.stages[3]).toEqual({
      key: "actual",
      done: true,
      progress: { current: 1, total: 1 },
    });
  });
});
