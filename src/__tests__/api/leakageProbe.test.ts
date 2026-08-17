/**
 * 회귀 가드 — "컷오프 이후 자료는 어떤 경로로도 근거가 될 수 없다"를 경로별로 찔러 본다.
 *
 * 적대적 리뷰(adv-보정루프.md)의 누출 전수 조사에서 왔다. 다섯 경로 전부 통과가
 * 확인되어 재현 스위트(qa/adversarial)에서 이리로 옮겼다 — 앞으로도 초록이어야 한다.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const sessionState = vi.hoisted(() => ({
  user: null as { id: string; email: string; name: string } | null,
}));
vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => sessionState.user),
}));
vi.mock("@/lib/db", async () => {
  const mod = await import("@/__tests__/helpers/predictionRunTestDb");
  return { db: mod.predictionTestDb };
});

import { POST as createPrediction } from "@/app/api/predictions/route";
import {
  allPredictionRuns,
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

function post(body: unknown) {
  return createPrediction(
    new NextRequest("http://localhost/api/predictions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  resetPredictionTestDb();
  sessionState.user = { id: USER_A, email: "w@t.test", name: "원장" };
});

describe("[적대적] 누출 경로 전수", () => {
  it("① 학기 경계 — 2025-2-기말 은 2026-1-중간 예측의 근거로 쓸 수 있어야 한다(막히면 과잉차단)", async () => {
    seedExam({
      externalExamId: "가람-2025-2-기말",
      school: SCHOOL,
      year: 2025,
      semester: 2,
      round: "기말",
      questions: standardQuestions(),
    });
    const res = await post({
      series: SERIES,
      targetPeriod: { year: 2026, semester: 1, round: "중간" },
    });
    expect(res.status).toBe(201);
    const run = (await res.json()).data;
    console.log("  ① inputExamIds =", JSON.stringify(run.inputExamIds));
    expect(run.inputExamIds).toContain("가람-2025-2-기말");
  });

  it("② 컷오프==대상 — 대상 회차 시험지 자체가 DB 에 있어도 근거로 안 잡힌다", async () => {
    seedExam({
      externalExamId: "가람-2025-2-기말",
      school: SCHOOL,
      year: 2025,
      semester: 2,
      round: "기말",
      questions: standardQuestions(),
    });
    seedExam({
      externalExamId: "가람-2026-1-중간(정답지)",
      school: SCHOOL,
      year: 2026,
      semester: 1,
      round: "중간",
      questions: standardQuestions(),
    });
    const res = await post({
      series: SERIES,
      targetPeriod: { year: 2026, semester: 1, round: "중간" },
    });
    const run = (await res.json()).data;
    console.log("  ② inputExamIds =", JSON.stringify(run.inputExamIds));
    expect(run.inputExamIds).not.toContain("가람-2026-1-중간(정답지)");
  });

  it("③ 핀 경로 — 대상 회차 자체를 inputExamIds 로 지정하면 422 이고 행이 안 생긴다", async () => {
    seedExam({
      externalExamId: "가람-2026-1-중간(정답지)",
      school: SCHOOL,
      year: 2026,
      semester: 1,
      round: "중간",
      questions: standardQuestions(),
    });
    const res = await post({
      series: SERIES,
      targetPeriod: { year: 2026, semester: 1, round: "중간" },
      inputExamIds: ["가람-2026-1-중간(정답지)"],
    });
    console.log("  ③ status =", res.status);
    expect(res.status).toBe(422);
    expect(allPredictionRuns()).toHaveLength(0);
  });

  it("④ 코호트 경로 — 다른 학교의 대상시점 시험지도 안 잡힌다", async () => {
    seedExam({
      externalExamId: "가람-2025-2-기말",
      school: SCHOOL,
      year: 2025,
      semester: 2,
      round: "기말",
      questions: standardQuestions(),
    });
    seedExam({
      externalExamId: "나래-2026-1-중간",
      school: "나래중",
      year: 2026,
      semester: 1,
      round: "중간",
      questions: standardQuestions({ count: 25 }),
    });
    const res = await post({
      series: SERIES,
      targetPeriod: { year: 2026, semester: 1, round: "중간" },
    });
    const run = (await res.json()).data;
    console.log("  ④ inputExamIds =", JSON.stringify(run.inputExamIds));
    expect(run.inputExamIds).not.toContain("나래-2026-1-중간");
  });

  it("⑤ 핀 경로 — 학년·과목이 전혀 다른 시험지를 근거로 지정하면 거부되어야 한다", async () => {
    // 중3 예측인데 같은 학교의 중1 시험지를 근거로 못 박는다. 시점은 과거라 누출은 아니다.
    seedExam({
      externalExamId: "가람-중1-2025-1-중간",
      school: SCHOOL,
      level: "중",
      grade: 1,
      subject: "중1",
      year: 2025,
      semester: 1,
      round: "중간",
      questions: standardQuestions({ count: 30 }),
    });
    const res = await post({
      series: SERIES,
      targetPeriod: { year: 2026, semester: 1, round: "중간" },
      inputExamIds: ["가람-중1-2025-1-중간"],
    });
    const body = await res.json();
    console.log("  ⑤ status =", res.status, JSON.stringify(body).slice(0, 200));
    if (res.status === 201) {
      const stored = allPredictionRuns()[0]!;
      const params = stored.params as { evidence?: unknown };
      const bp = stored.predictedBlueprint as { questionCount?: number } | null;
      console.log("     저장된 evidence =", JSON.stringify(params.evidence));
      console.log("     청사진 문항수 =", bp?.questionCount);
    }
    expect(res.status).not.toBe(201);
  });
});
