/**
 * 적대적 재현 — 예측 문제지 생성/적재/인쇄. **읽기 전용 조사용.**
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

import { POST as confirmTest } from "@/app/api/tests/[id]/confirm/route";
import { POST as printTest } from "@/app/api/tests/[id]/print/route";
import { GET as getTest } from "@/app/api/tests/[id]/route";
import { PATCH as updateScores } from "@/app/api/tests/[id]/scores/route";
import { POST as createPredictedPaper } from "@/app/api/tests/predicted/route";
import { db } from "@/lib/db";
import { CLASS_A_ID, MOCK_UNITS, USER_TEACHER_ID } from "@/mocks/data";

// 기본 시드 문항이 하나도 없는 단원만 쓴다 — 후보 수를 정확히 통제하려고.
const UNIT_A = MOCK_UNITS[14]!.id;
const UNIT_B = MOCK_UNITS[14]!.id;
const SERIES = { school: "대구여고", level: "고" as const, grade: 2, subject: "수2" };
const TARGET = { year: 2025, semester: 2 as const, round: "기말" as const };

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const withId = (id: string) => ({ params: Promise.resolve({ id }) });

/** 25문항 · 눈금 {3,4,5} · 합계 100 인 실측형 시험지 한 편. */
const ROWS: Array<[number, number, "객관식" | "서술형", "하" | "중" | "상", string]> = [];
{
  let n = 1;
  for (let i = 0; i < 5; i += 1) ROWS.push([n++, 3, "객관식", "하", UNIT_A]);
  for (let i = 0; i < 15; i += 1) ROWS.push([n++, 4, "객관식", "중", i % 2 ? UNIT_A : UNIT_B]);
  for (let i = 0; i < 5; i += 1) ROWS.push([n++, 5, "서술형", "상", UNIT_B]);
}

async function seedExam(externalExamId: string, period: { year: number; semester: number; round: string }) {
  const exam = await db.exam.upsert({
    where: { externalExamId },
    update: {},
    create: {
      externalExamId,
      school: SERIES.school,
      level: SERIES.level,
      grade: SERIES.grade,
      subject: SERIES.subject,
      subjectRaw: "수2",
      year: period.year,
      semester: period.semester,
      round: period.round,
      totalScore: 100,
      questionCount: ROWS.length,
      sourceFile: null,
    },
  });
  await db.examQuestion.createMany({
    data: ROWS.map(([number, score, qtype, difficultyLabel, unitId]) => ({
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
}

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
    unitIds: [UNIT_A],
    series: SERIES,
    target: TARGET,
    ...overrides,
  };
}

describe("[적대] 청사진 칸을 다 못 채운 반쪽 시험지", () => {
  it("201 로 저장되고 확정·인쇄까지 간다 — 저장 뒤에는 결손 흔적이 남지 않는다", async () => {
    await seedExam("past-2025-1", { year: 2025, semester: 1, round: "기말" });
    // 청사진은 25문항을 요구하는데 문제은행에는 21개뿐이다.
    await seedCandidates(21);

    const res = await createPredictedPaper(
      jsonRequest("http://localhost/api/tests/predicted", "POST", createBody()),
    );
    const body = (await res.json()) as {
      data: { testId: string; questionCount: number; totalScore: number; unfilled: unknown[] };
    };
    console.log(
      "status",
      res.status,
      "· 문항수",
      body.data?.questionCount,
      "· 만점",
      body.data?.totalScore,
      "· 못채운칸",
      body.data?.unfilled?.length,
    );
    expect(res.status).toBe(201);
    expect(body.data.unfilled.length).toBeGreaterThan(0);

    const testId = body.data.testId;

    // 저장된 시험지에서 "결손" 을 알 길이 있는가.
    const detail = await getTest(jsonRequest(`http://localhost/api/tests/${testId}`, "GET"), withId(testId));
    const detailBody = (await detail.json()) as Record<string, unknown>;
    console.log("GET /api/tests/{id} 응답 키:", JSON.stringify(detailBody).slice(0, 400));

    // 확정 → 인쇄
    const confirmed = await confirmTest(
      jsonRequest(`http://localhost/api/tests/${testId}/confirm`, "POST"),
      withId(testId),
    );
    console.log("confirm status", confirmed.status);
    const printed = await printTest(
      jsonRequest(`http://localhost/api/tests/${testId}/print`, "POST"),
      withId(testId),
    );
    console.log("print status", printed.status);
    expect(printed.status).toBe(200);
  });
});

describe("[적대] PATCH /scores — 같은 orderIndex 를 두 번 보낸다", () => {
  it("400 으로 거부하고 DB 만점이 그대로 100 이다 (2026-08-16 수리)", async () => {
    await seedExam("past-2025-1", { year: 2025, semester: 1, round: "기말" });
    await seedCandidates(30);
    const res = await createPredictedPaper(
      jsonRequest("http://localhost/api/tests/predicted", "POST", createBody()),
    );
    const created = (await res.json()) as { data: { testId: string; questionCount: number } };
    const testId = created.data.testId;
    const n = created.data.questionCount;

    // n 개를 보내되 1번을 여러 번 반복하고 뒤쪽 문항은 뺀다. 합계는 정확히 100.
    const scores = [
      ...Array.from({ length: n - 1 }, () => ({ orderIndex: 1, score: 2 })),
      { orderIndex: 2, score: 100 - 2 * (n - 1) },
    ];
    const patched = await updateScores(
      jsonRequest(`http://localhost/api/tests/${testId}/scores`, "PATCH", { scores }),
      withId(testId),
    );
    const patchBody = (await patched.json()) as {
      data?: { totalScore: number; problems: Array<{ orderIndex: number; score: number }> };
      error?: unknown;
    };
    console.log("PATCH status", patched.status, "· 응답 totalScore", patchBody.data?.totalScore);

    const rows = await db.testProblem.findMany({ where: { testId }, orderBy: { orderIndex: "asc" } });
    const real = rows.reduce((a, r) => a + (r.score ?? 0), 0);
    console.log("DB 실제 만점:", Math.round(real * 100) / 100, "· 배점:", rows.map((r) => r.score));

    // 수리 전: 200 · 응답 totalScore 100 · DB 실제 만점 148
    expect(patched.status).toBe(400);
    expect(Math.round(real * 100) / 100).toBe(100);
  });
});

describe("[적대] 근거 편수 경계", () => {
  it("그 학교 근거가 0편이어도 코호트(남의 학교)만으로 시험지를 만든다", async () => {
    // 다른 학교의 과거 회차만 심는다 — 우리 학교(SERIES.school) 근거는 0편.
    const exam = await db.exam.upsert({
      where: { externalExamId: "cohort-only" },
      update: {},
      create: {
        externalExamId: "cohort-only",
        school: "남의고등학교",
        level: SERIES.level,
        grade: SERIES.grade,
        subject: SERIES.subject,
        subjectRaw: "수2",
        year: 2025,
        semester: 1,
        round: "기말",
        totalScore: 100,
        questionCount: ROWS.length,
        sourceFile: null,
      },
    });
    await db.examQuestion.createMany({
      data: ROWS.map(([number, score, qtype, difficultyLabel, unitId]) => ({
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
    await seedCandidates(30);

    const res = await createPredictedPaper(
      jsonRequest("http://localhost/api/tests/predicted", "POST", createBody()),
    );
    const body = (await res.json()) as {
      data?: { evidenceCount: number; confidence: number; questionCount: number; totalScore: number };
    };
    console.log(
      "status",
      res.status,
      "· evidenceCount",
      body.data?.evidenceCount,
      "· confidence",
      body.data?.confidence,
      "· 문항수",
      body.data?.questionCount,
    );
    expect(res.status).toBe(201);
    expect(body.data?.evidenceCount).toBe(0);
  });
});
