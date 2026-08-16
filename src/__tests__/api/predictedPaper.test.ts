/**
 * 🔴 RED → 🟢 GREEN — T7.9 API Route.
 *
 * 왜 이 테스트가 있는가 — **엔진이 옳아도 경로가 새면 원장은 못 쓴다.**
 *
 * 배점 보정기와 적재 함수는 이미 순수 함수 단위로 고정돼 있다. 여기서 지키는 것은 HTTP 경계다.
 *
 *  1. **누출 차단이 서버에서 강제되는가.** 예측 대상 시점 **이후**의 기출이 근거에 섞이면
 *     backtest 숫자만 좋아 보이고 실전에서 무너진다(11 §3 L5). 클라이언트가 무엇을 보내든
 *     서버가 컷오프를 적용해야 한다 — 그래서 미래 회차를 일부러 심어 놓고 검증한다.
 *  2. **판단 불가가 422 로 나가는가.** 근거 없는 학교를 요청하면 0문항 0점 시험지를 만들지 않고
 *     사유와 함께 거절해야 한다.
 *  3. **수동 조정 합계가 100 이 아니면 저장이 거부되는가**(11 §10.4). 남은 점수 문구가
 *     그대로 응답에 실려야 화면이 그것만 띄우면 된다.
 *  4. **권한** — 남의 반·남의 시험지는 만지지 못한다.
 *
 * 대응 계약: src/contracts/scoreNormalizer.contract.ts
 */
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => ({
    id: "10000000-0000-4000-8000-000000000001",
    email: "teacher@todaysmath.test",
    name: "테스트 강사",
  })),
}));

import { PATCH as updateScores } from "@/app/api/tests/[id]/scores/route";
import { POST as createPredictedPaper } from "@/app/api/tests/predicted/route";
import { errorResponseSchema } from "@/contracts/common.contract";
import {
  predictedPaperCreateResponseSchema,
  testScoresUpdateResponseSchema,
} from "@/contracts/scoreNormalizer.contract";
import { db } from "@/lib/db";
import {
  CLASS_A_ID,
  CLASS_OTHER_ID,
  MOCK_UNITS,
  USER_TEACHER_ID,
} from "@/mocks/data";

const UNIT_A = MOCK_UNITS[0]!.id;
const UNIT_B = MOCK_UNITS[1]!.id;

const SERIES = {
  school: "대구여고",
  level: "고" as const,
  grade: 2,
  subject: "수2",
};
/** 예측 대상 — 이 시점 **이후** 자료는 근거에서 빠져야 한다. */
const TARGET = { year: 2025, semester: 2 as const, round: "기말" as const };

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** 객관식 8(하4·중4) + 서술형 2(상) · 단원 A 5 · B 5 · 총 100점 — 실측 배치를 본뜬 한 편. */
const PAPER_ROWS: Array<
  [number, number, "객관식" | "서술형", "하" | "중" | "상", string]
> = [
  [1, 8, "객관식", "하", UNIT_A],
  [2, 8, "객관식", "하", UNIT_A],
  [3, 8, "객관식", "하", UNIT_A],
  [4, 8, "객관식", "하", UNIT_A],
  [5, 10, "객관식", "중", UNIT_A],
  [6, 10, "객관식", "중", UNIT_B],
  [7, 10, "객관식", "중", UNIT_B],
  [8, 10, "객관식", "중", UNIT_B],
  [9, 12, "서술형", "상", UNIT_B],
  [10, 12, "서술형", "상", UNIT_B],
];

async function seedExam(
  externalExamId: string,
  period: { year: number; semester: number; round: string },
  overrides: { school?: string } = {},
) {
  const exam = await db.exam.upsert({
    where: { externalExamId },
    update: {},
    create: {
      externalExamId,
      school: overrides.school ?? SERIES.school,
      level: SERIES.level,
      grade: SERIES.grade,
      subject: SERIES.subject,
      subjectRaw: "수2",
      year: period.year,
      semester: period.semester,
      round: period.round,
      totalScore: 100,
      questionCount: PAPER_ROWS.length,
      sourceFile: null,
    },
  });
  await db.examQuestion.createMany({
    data: PAPER_ROWS.map(([number, score, qtype, difficultyLabel, unitId]) => ({
      examId: exam.id,
      number,
      score,
      qtype,
      difficultyLabel,
      topicRaw: null,
      unitId,
      answer: null,
      hasFigure: false,
      problemId: null,
    })),
  });
  return exam;
}

/** 문제은행 후보 — 출제 자격(D-22·D-26·D-31)을 갖춘 문항만 심는다. */
async function seedCandidates(count: number) {
  const difficulties = ["easy", "mid", "hard"] as const;
  for (let i = 0; i < count; i += 1) {
    await db.problem.create({
      data: {
        userId: USER_TEACHER_ID,
        unitId: i % 2 === 0 ? UNIT_A : UNIT_B,
        source: "past_exam",
        difficulty: difficulties[i % 3]!,
        problemType: "개념",
        content: `후보 문항 ${i + 1}`,
        answer: "1",
        solution: null,
        reviewStatus: "approved",
        directUseAllowed: true,
        score: null,
      },
    });
  }
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    classId: CLASS_A_ID,
    testDate: "2026-09-01",
    rangeEndUnitId: UNIT_A,
    unitIds: [UNIT_A, UNIT_B],
    series: SERIES,
    target: TARGET,
    ...overrides,
  };
}

describe("[T7.9] POST /api/tests/predicted — 예측 문제지 생성 + 적재", () => {
  it("만점이 정확히 100 인 시험지를 만들고 TestProblem.score 에 싣는다", async () => {
    await seedExam("past-2025-1", { year: 2025, semester: 1, round: "기말" });
    await seedCandidates(20);

    const response = await createPredictedPaper(
      jsonRequest("http://localhost/api/tests/predicted", "POST", createBody()),
    );
    expect(response.status).toBe(201);

    const body = predictedPaperCreateResponseSchema.parse(
      await response.json(),
    );
    expect(body.data.totalScore).toBe(100);
    expect(body.data.questions.length).toBeGreaterThan(0);
    for (const q of body.data.questions) {
      expect(body.data.grid).toContain(q.score);
    }

    // 실제로 DB 에 실렸는가.
    const rows = await db.testProblem.findMany({
      where: { testId: body.data.testId },
      orderBy: { orderIndex: "asc" },
    });
    expect(rows).toHaveLength(body.data.questionCount);
    expect(rows.map((r) => r.score)).toEqual(
      body.data.questions.map((q) => q.score),
    );

    // Problem.score 원본은 건드리지 않는다.
    const problems = await db.problem.findMany({});
    expect(problems.every((p) => p.score === null || p.score > 0)).toBe(true);
  });

  it("대상 시점 이후의 기출은 근거에서 뺀다 — 누출 차단을 서버가 강제한다", async () => {
    // 미래 회차만 있고 과거 회차는 없다. 누출을 막으면 근거가 0 이므로 만들 수 없어야 한다.
    await seedExam("future-2026-1", { year: 2026, semester: 1, round: "중간" });
    await seedCandidates(20);

    const response = await createPredictedPaper(
      jsonRequest("http://localhost/api/tests/predicted", "POST", createBody()),
    );

    expect(response.status).toBe(422);
    const body = errorResponseSchema.parse(await response.json());
    expect(body.error.message).toContain("근거");
  });

  it("근거가 없는 학교는 0문항 시험지를 만들지 않고 422 로 거절한다", async () => {
    await seedCandidates(20);

    const response = await createPredictedPaper(
      jsonRequest(
        "http://localhost/api/tests/predicted",
        "POST",
        createBody({ series: { ...SERIES, school: "없는고등학교" } }),
      ),
    );

    expect(response.status).toBe(422);
    errorResponseSchema.parse(await response.json());
  });

  it("문제은행 후보가 없으면 판단 불가로 거절한다", async () => {
    await seedExam("past-2025-1", { year: 2025, semester: 1, round: "기말" });

    const response = await createPredictedPaper(
      jsonRequest(
        "http://localhost/api/tests/predicted",
        "POST",
        // 후보가 하나도 없는 단원만 지정한다.
        createBody({ unitIds: [MOCK_UNITS[MOCK_UNITS.length - 1]!.id] }),
      ),
    );

    expect(response.status).toBe(422);
    const body = errorResponseSchema.parse(await response.json());
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it("남의 반에는 만들지 못한다", async () => {
    await seedExam("past-2025-1", { year: 2025, semester: 1, round: "기말" });
    await seedCandidates(20);

    const response = await createPredictedPaper(
      jsonRequest(
        "http://localhost/api/tests/predicted",
        "POST",
        createBody({ classId: CLASS_OTHER_ID }),
      ),
    );
    expect(response.status).toBe(403);
  });

  it("요청 형식이 틀리면 400", async () => {
    const response = await createPredictedPaper(
      jsonRequest(
        "http://localhost/api/tests/predicted",
        "POST",
        createBody({ unitIds: [] }),
      ),
    );
    expect(response.status).toBe(400);
  });
});

describe("[T7.9] PATCH /api/tests/{id}/scores — 원장 수동 배점 조정", () => {
  async function seedPaper() {
    await seedExam("past-2025-1", { year: 2025, semester: 1, round: "기말" });
    await seedCandidates(20);
    const response = await createPredictedPaper(
      jsonRequest("http://localhost/api/tests/predicted", "POST", createBody()),
    );
    const body = predictedPaperCreateResponseSchema.parse(
      await response.json(),
    );
    return body.data;
  }

  function withId(id: string) {
    return { params: Promise.resolve({ id }) };
  }

  it("합계가 100 이면 저장한다", async () => {
    const paper = await seedPaper();
    const n = paper.questionCount;
    // 앞 문항에 1점씩, 마지막이 나머지를 갖는다.
    const scores = Array.from({ length: n }, (_, i) => ({
      orderIndex: i + 1,
      score: i === n - 1 ? 100 - (n - 1) : 1,
    }));

    const response = await updateScores(
      jsonRequest(
        `http://localhost/api/tests/${paper.testId}/scores`,
        "PATCH",
        { scores },
      ),
      withId(paper.testId),
    );

    expect(response.status).toBe(200);
    const body = testScoresUpdateResponseSchema.parse(await response.json());
    expect(body.data.totalScore).toBe(100);
    expect(body.data.problems[0].score).toBe(1);

    const rows = await db.testProblem.findMany({
      where: { testId: paper.testId },
      orderBy: { orderIndex: "asc" },
    });
    expect(rows[0]!.score).toBe(1);
  });

  it("합계가 100 이 아니면 422 로 거부하고 남은 점수를 알린다", async () => {
    const paper = await seedPaper();
    const before = await db.testProblem.findMany({
      where: { testId: paper.testId },
      orderBy: { orderIndex: "asc" },
    });

    const n = paper.questionCount;
    const scores = Array.from({ length: n }, (_, i) => ({
      orderIndex: i + 1,
      score: i === n - 1 ? 100 - (n - 1) - 1.5 : 1,
    }));

    const response = await updateScores(
      jsonRequest(
        `http://localhost/api/tests/${paper.testId}/scores`,
        "PATCH",
        { scores },
      ),
      withId(paper.testId),
    );

    expect(response.status).toBe(422);
    const body = errorResponseSchema.parse(await response.json());
    expect(body.error.message).toBe("합계 98.5 — 1.5점 남음");

    // 자동으로 다른 문항을 건드리지 않는다.
    const after = await db.testProblem.findMany({
      where: { testId: paper.testId },
      orderBy: { orderIndex: "asc" },
    });
    expect(after.map((r) => r.score)).toEqual(before.map((r) => r.score));
  });

  it("남의 시험지는 고치지 못한다 — 403", async () => {
    const paper = await seedPaper();
    const { getSessionUser } = await import("@/lib/session");
    vi.mocked(getSessionUser).mockResolvedValueOnce({
      id: "10000000-0000-4000-8000-000000000009",
      email: "other@todaysmath.test",
      name: "다른 강사",
    });

    const response = await updateScores(
      jsonRequest(
        `http://localhost/api/tests/${paper.testId}/scores`,
        "PATCH",
        { scores: [{ orderIndex: 1, score: 100 }] },
      ),
      withId(paper.testId),
    );
    expect(response.status).toBe(403);
  });

  it("없는 시험지는 404", async () => {
    const response = await updateScores(
      jsonRequest("http://localhost/api/tests/x/scores", "PATCH", {
        scores: [{ orderIndex: 1, score: 100 }],
      }),
      withId("99999999-9999-4999-8999-999999999999"),
    );
    expect(response.status).toBe(404);
  });
});
