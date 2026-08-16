/**
 * 🔴 RED → 🟢 GREEN — T7.7 `PredictionRun` 저장 + 예측 API (트랙 E).
 *
 * ## 왜 이 테스트가 있는가
 *
 * '오늘의 시험'은 **예측을 기록으로 남기지 않으면 보정 자체가 불가능하다**(11 §3 L5-c).
 * 나중에 실제 내신 점수가 들어와도 무엇과 비교할지 알 수 없기 때문이다. 그래서 이 API 가
 * 지켜야 할 것은 "예측이 그럴듯한가"가 아니라 **기록이 감사 가능한가**다. 아래 네 가지를
 * 테스트로 못 박는다.
 *
 * 1. **누출 차단.** 컷오프 이후 자료가 근거에 하나라도 섞이면 저장을 거부한다(422).
 *    시간 분리를 어기면 backtest 숫자만 좋아 보이고 실전에서 무너진다(11 §3 L5-a).
 *    컷오프가 대상 시점보다 **뒤로** 설정되는 것도 같은 사고라서 함께 막는다.
 * 2. **근거가 없으면 청사진을 지어내지 않는다.** `PredictorUnavailableError` 가 나면
 *    `predictedBlueprint` 를 NULL 로 저장하고 riskFlag `적은_과거회차` 를 남긴다.
 *    예전에 0문항 0점짜리 청사진을 화면에 낸 적이 있다(2026-08-16 재현) — 그 재발을 막는다.
 * 3. **감사 가능성.** `inputExamIds` 에 실제로 쓴 시험지가 전부 들어가고,
 *    `params` 스냅샷과 `engineVersion` 이 함께 저장된다. 같은 시험을 두 번 예측하면
 *    행이 **2개** 생긴다(갱신 아님) — 엔진 버전별 비교가 목적이기 때문이다.
 * 4. **소유권.** 남의 run 은 못 본다(404/403). 판정 근거는 `PredictionRun.userId`
 *    **컬럼** 하나뿐이고, 목록 필터도 DB where 가 한다.
 *
 * 대응 계약: src/contracts/predictionRun.contract.ts
 * 구현: src/lib/predictor/predictionRunService.ts · src/app/api/predictions/**
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const USER_B = "bbbbbbbb-0000-4000-8000-00000000000b";

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

import {
  GET as listPredictions,
  POST as createPrediction,
} from "@/app/api/predictions/route";
import { GET as getPrediction } from "@/app/api/predictions/[id]/route";

import { errorResponseSchema } from "@/contracts/common.contract";
import {
  predictionLeakageErrorResponseSchema,
  predictionRunDetailResponseSchema,
  predictionRunListResponseSchema,
  predictionRunParamsSchema,
  predictorParamsSchema,
} from "@/contracts/predictionRun.contract";
import {
  DEFAULT_PARAMS,
  PREDICTOR_ENGINE_VERSION,
} from "@/lib/predictor/predictBlueprint";
import {
  allPredictionRuns,
  resetPredictionTestDb,
  seedExam,
  seedExamScope,
  standardQuestions,
} from "@/__tests__/helpers/predictionRunTestDb";

const SCHOOL = "가람중";
const OTHER_SCHOOL = "나래중";
const SERIES = { school: SCHOOL, level: "중" as const, grade: 3, subject: "중3" };
const TARGET = { year: 2026, semester: 1 as const, round: "중간" as const };

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/predictions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function listRequest(query: Record<string, string>) {
  const qs = new URLSearchParams(query).toString();
  return new NextRequest(`http://localhost/api/predictions?${qs}`, {
    method: "GET",
  });
}

function withId(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** 자기 학교 과거 3회차 + 다른 학교 코호트 2편. 전부 대상 시점 이전이다. */
function seedHealthyCorpus() {
  seedExam({
    externalExamId: "가람-2025-1-중간",
    school: SCHOOL,
    year: 2025,
    semester: 1,
    round: "중간",
    questions: standardQuestions(),
  });
  seedExam({
    externalExamId: "가람-2025-2-중간",
    school: SCHOOL,
    year: 2025,
    semester: 2,
    round: "중간",
    questions: standardQuestions(),
  });
  seedExam({
    externalExamId: "가람-2025-2-기말",
    school: SCHOOL,
    year: 2025,
    semester: 2,
    round: "기말",
    questions: standardQuestions(),
  });
  seedExam({
    externalExamId: "나래-2025-1-중간",
    school: OTHER_SCHOOL,
    year: 2025,
    semester: 1,
    round: "중간",
    questions: standardQuestions({ count: 25 }),
  });
  seedExam({
    externalExamId: "나래-2025-2-기말",
    school: OTHER_SCHOOL,
    year: 2025,
    semester: 2,
    round: "기말",
    questions: standardQuestions({ count: 25 }),
  });
}

beforeEach(() => {
  resetPredictionTestDb();
  sessionState.user = {
    id: USER_A,
    email: "wonjang@todaysmath.test",
    name: "원장",
  };
});

describe("[T7.7] POST /api/predictions — 예측 실행 + 저장", () => {
  it("과거 회차가 있으면 청사진을 예측해 run 한 행으로 저장한다(201)", async () => {
    seedHealthyCorpus();

    const res = await createPrediction(
      postRequest({ series: SERIES, targetPeriod: TARGET }),
    );

    expect(res.status).toBe(201);
    const body = predictionRunDetailResponseSchema.parse(await res.json());
    expect(body.data.predictedBlueprint).not.toBeNull();
    expect(body.data.predictedBlueprint?.kind).toBe("predicted");
    expect(body.data.predictedBlueprint?.questionCount).toBeGreaterThan(0);
    expect(body.data.targetPeriod).toEqual(TARGET);
    // 컷오프를 생략하면 대상 시점과 같다.
    expect(body.data.cutoffPeriod).toEqual(TARGET);
    expect(allPredictionRuns()).toHaveLength(1);
  });

  it("근거로 쓴 시험지가 inputExamIds 에 전부 들어간다(감사 가능)", async () => {
    seedHealthyCorpus();

    const res = await createPrediction(
      postRequest({ series: SERIES, targetPeriod: TARGET }),
    );
    const body = predictionRunDetailResponseSchema.parse(await res.json());

    expect([...body.data.inputExamIds].sort()).toEqual(
      [
        "가람-2025-1-중간",
        "가람-2025-2-기말",
        "가람-2025-2-중간",
        "나래-2025-1-중간",
        "나래-2025-2-기말",
      ].sort(),
    );
    // 저장된 행에도 같은 목록이 들어간다.
    expect([...allPredictionRuns()[0].inputExamIds].sort()).toEqual(
      [...body.data.inputExamIds].sort(),
    );
  });

  it("params 스냅샷과 engineVersion 을 저장한다", async () => {
    seedHealthyCorpus();

    const res = await createPrediction(
      postRequest({
        series: SERIES,
        targetPeriod: TARGET,
        params: { decay: 0.5 },
      }),
    );
    const body = predictionRunDetailResponseSchema.parse(await res.json());

    expect(body.data.engineVersion).toBe(PREDICTOR_ENGINE_VERSION);
    expect(body.data.params.predictor).toEqual({
      ...DEFAULT_PARAMS,
      decay: 0.5,
    });
    expect(body.data.params.evidence.history).toBe(3);
    expect(body.data.params.evidence.cohort).toBe(2);
    expect(body.data.params.evidence.pinned).toBe(false);

    // DB 에 저장된 raw params 도 계약 형태 그대로여야 한다(T7.10/T7.11 이 읽는다).
    const rawParams = allPredictionRuns()[0].params as Record<string, unknown>;
    expect(() => predictionRunParamsSchema.parse(rawParams)).not.toThrow();
    // 소유자·위험표시는 **컬럼**이다. params 로 되돌아오면 목록 필터가 다시
    // 메모리로 내려가 페이지네이션이 틀어진다 — 그래서 여기서 막는다.
    expect(rawParams).not.toHaveProperty("ownerUserId");
    expect(rawParams).not.toHaveProperty("riskFlags");
  });

  it("소유자·위험표시·시행일을 params 가 아니라 컬럼에 쓴다", async () => {
    seedHealthyCorpus();

    const res = await createPrediction(
      postRequest({
        series: SERIES,
        targetPeriod: TARGET,
        examDate: "2026-05-04",
      }),
    );
    expect(res.status).toBe(201);
    const body = predictionRunDetailResponseSchema.parse(await res.json());

    const row = allPredictionRuns()[0];
    expect(row.userId).toBe(USER_A);
    expect(row.riskFlags).toEqual(body.data.riskFlags);
    expect(row.riskFlags.length).toBeGreaterThan(0);
    expect(row.examDate?.toISOString().slice(0, 10)).toBe("2026-05-04");
    expect(body.data.examDate).toBe("2026-05-04");
  });

  it("시행일을 모르면 NULL 로 둔다 — 대상 시점으로 지어내지 않는다", async () => {
    seedHealthyCorpus();

    const res = await createPrediction(
      postRequest({ series: SERIES, targetPeriod: TARGET }),
    );
    const body = predictionRunDetailResponseSchema.parse(await res.json());

    expect(body.data.examDate).toBeNull();
    expect(allPredictionRuns()[0].examDate).toBeNull();
  });

  it("시행일 형식이 틀리면 400", async () => {
    seedHealthyCorpus();
    const res = await createPrediction(
      postRequest({
        series: SERIES,
        targetPeriod: TARGET,
        examDate: "2026/05/04",
      }),
    );
    expect(res.status).toBe(400);
    expect(allPredictionRuns()).toHaveLength(0);
  });

  it("같은 시험을 두 번 예측하면 행이 2개 생긴다(갱신이 아니다)", async () => {
    seedHealthyCorpus();
    const body = { series: SERIES, targetPeriod: TARGET };

    const first = await createPrediction(postRequest(body));
    const second = await createPrediction(postRequest(body));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const rows = allPredictionRuns();
    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);
  });

  it("만점 미달(잘린) 시험지는 자동 근거에서 빠지고 제외 편수를 남긴다", async () => {
    seedHealthyCorpus();
    // 총점 60 · 문항 12 — 면이 잘린 편. 학습에 넣으면 그 학교가 "12문항만 낸다"고 배운다.
    seedExam({
      externalExamId: "가람-2024-2-기말-잘림",
      school: SCHOOL,
      year: 2024,
      semester: 2,
      round: "기말",
      questions: standardQuestions({ count: 12 }).map((q) => ({
        ...q,
        score: 5,
      })),
      totalScore: 60,
    });

    const res = await createPrediction(
      postRequest({ series: SERIES, targetPeriod: TARGET }),
    );
    const body = predictionRunDetailResponseSchema.parse(await res.json());

    expect(body.data.inputExamIds).not.toContain("가람-2024-2-기말-잘림");
    expect(body.data.params.evidence.excludedByTrust).toBe(1);
  });

  it("로그인하지 않으면 401", async () => {
    sessionState.user = null;
    const res = await createPrediction(
      postRequest({ series: SERIES, targetPeriod: TARGET }),
    );
    expect(res.status).toBe(401);
  });

  it("요청 형태가 틀리면 400", async () => {
    const res = await createPrediction(
      postRequest({ series: SERIES, targetPeriod: { year: 2026 } }),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("[T7.7] 🔴 누출 차단 — 컷오프 이후 자료는 어떤 경로로도 근거가 될 수 없다", () => {
  it("컷오프 이후 시험지를 근거로 지정하면 422 이고 run 이 저장되지 않는다", async () => {
    seedHealthyCorpus();
    // 대상 시점 그 자체의 시험지 = 정답지. 근거로 들어오면 안 된다.
    seedExam({
      externalExamId: "가람-2026-1-중간",
      school: SCHOOL,
      year: 2026,
      semester: 1,
      round: "중간",
      questions: standardQuestions(),
    });

    const res = await createPrediction(
      postRequest({
        series: SERIES,
        targetPeriod: TARGET,
        inputExamIds: ["가람-2025-2-기말", "가람-2026-1-중간"],
      }),
    );

    expect(res.status).toBe(422);
    const body = predictionLeakageErrorResponseSchema.parse(await res.json());
    expect(body.error.details.reason).toBe("근거_컷오프_이후");
    expect(body.error.details.offending.map((o) => o.externalExamId)).toEqual([
      "가람-2026-1-중간",
    ]);
    expect(allPredictionRuns()).toHaveLength(0);
  });

  it("컷오프가 대상 시점보다 뒤면 422 이고 run 이 저장되지 않는다", async () => {
    seedHealthyCorpus();

    const res = await createPrediction(
      postRequest({
        series: SERIES,
        targetPeriod: TARGET,
        cutoffPeriod: { year: 2026, semester: 2, round: "기말" },
      }),
    );

    expect(res.status).toBe(422);
    const body = predictionLeakageErrorResponseSchema.parse(await res.json());
    expect(body.error.details.reason).toBe("컷오프_대상시점_역전");
    expect(allPredictionRuns()).toHaveLength(0);
  });

  it("컷오프를 앞당기면 그 이후 회차는 자동 근거에서도 빠진다", async () => {
    seedHealthyCorpus();

    const res = await createPrediction(
      postRequest({
        series: SERIES,
        targetPeriod: TARGET,
        cutoffPeriod: { year: 2025, semester: 2, round: "중간" },
      }),
    );

    expect(res.status).toBe(201);
    const body = predictionRunDetailResponseSchema.parse(await res.json());
    expect(body.data.inputExamIds).toContain("가람-2025-1-중간");
    expect(body.data.inputExamIds).not.toContain("가람-2025-2-중간");
    expect(body.data.inputExamIds).not.toContain("가람-2025-2-기말");
  });

  it("근거로 지정한 시험지가 DB 에 없으면 404 이고 run 이 저장되지 않는다", async () => {
    seedHealthyCorpus();

    const res = await createPrediction(
      postRequest({
        series: SERIES,
        targetPeriod: TARGET,
        inputExamIds: ["없는시험지-0001"],
      }),
    );

    expect(res.status).toBe(404);
    expect(allPredictionRuns()).toHaveLength(0);
  });
});

describe("[T7.7] 🔴 근거가 없으면 청사진을 지어내지 않는다", () => {
  it("과거도 코호트도 없으면 predictedBlueprint 를 NULL 로 저장하고 적은_과거회차 를 남긴다", async () => {
    // 아무 시험지도 시드하지 않는다.
    const res = await createPrediction(
      postRequest({ series: SERIES, targetPeriod: TARGET }),
    );

    expect(res.status).toBe(201);
    const body = predictionRunDetailResponseSchema.parse(await res.json());
    expect(body.data.predictedBlueprint).toBeNull();
    expect(body.data.riskFlags).toContain("적은_과거회차");
    expect(body.data.unavailableReason).toBeTruthy();

    // 0문항 0점짜리 청사진이 DB 에 들어가지 않았는지 원시 행으로 확인한다.
    const row = allPredictionRuns()[0];
    expect(row.predictedBlueprint).toBeNull();
    expect(row.inputExamIds).toEqual([]);
  });

  it("코호트만 있고 자기 학교 과거가 없어도 적은_과거회차 를 남긴다", async () => {
    seedExam({
      externalExamId: "나래-2025-1-중간",
      school: OTHER_SCHOOL,
      year: 2025,
      semester: 1,
      round: "중간",
      questions: standardQuestions(),
    });

    const res = await createPrediction(
      postRequest({ series: SERIES, targetPeriod: TARGET }),
    );
    const body = predictionRunDetailResponseSchema.parse(await res.json());

    expect(body.data.predictedBlueprint).not.toBeNull();
    expect(body.data.riskFlags).toContain("적은_과거회차");
  });

  it("난이도 라벨이 하나도 없으면 난이도라벨_결손 을 남긴다", async () => {
    seedExam({
      externalExamId: "가람-2025-1-중간",
      school: SCHOOL,
      year: 2025,
      semester: 1,
      round: "중간",
      questions: standardQuestions({ difficultyLabel: null }),
    });

    const res = await createPrediction(
      postRequest({ series: SERIES, targetPeriod: TARGET }),
    );
    const body = predictionRunDetailResponseSchema.parse(await res.json());

    expect(body.data.riskFlags).toContain("난이도라벨_결손");
  });

  it("시험범위가 확정돼 있으면 시험범위_미확정 을 붙이지 않는다", async () => {
    seedHealthyCorpus();
    seedExamScope({
      school: SCHOOL,
      year: TARGET.year,
      semester: TARGET.semester,
      round: TARGET.round,
      unitIds: ["11111111-1111-4111-8111-111111111111"],
      confirmedAt: new Date("2026-03-01T00:00:00.000Z"),
    });

    const res = await createPrediction(
      postRequest({ series: SERIES, targetPeriod: TARGET }),
    );
    const body = predictionRunDetailResponseSchema.parse(await res.json());

    expect(body.data.riskFlags).not.toContain("시험범위_미확정");
  });

  it("시험범위가 없으면 시험범위_미확정 을 남긴다", async () => {
    seedHealthyCorpus();

    const res = await createPrediction(
      postRequest({ series: SERIES, targetPeriod: TARGET }),
    );
    const body = predictionRunDetailResponseSchema.parse(await res.json());

    expect(body.data.riskFlags).toContain("시험범위_미확정");
  });

  it("학생 응답이 없으므로 predictedScores 는 비어 있고 학생응답_부족 을 남긴다", async () => {
    seedHealthyCorpus();

    const res = await createPrediction(
      postRequest({ series: SERIES, targetPeriod: TARGET }),
    );
    const body = predictionRunDetailResponseSchema.parse(await res.json());

    expect(body.data.predictedScores).toEqual([]);
    expect(body.data.riskFlags).toContain("학생응답_부족");
  });
});

describe("[T7.7] GET /api/predictions/{id} — 회차 상세", () => {
  async function createRun() {
    seedHealthyCorpus();
    const res = await createPrediction(
      postRequest({ series: SERIES, targetPeriod: TARGET }),
    );
    const body = predictionRunDetailResponseSchema.parse(await res.json());
    return body.data.id;
  }

  it("소유자는 상세를 조회할 수 있다", async () => {
    const id = await createRun();

    const res = await getPrediction(
      new NextRequest(`http://localhost/api/predictions/${id}`),
      withId(id),
    );

    expect(res.status).toBe(200);
    const body = predictionRunDetailResponseSchema.parse(await res.json());
    expect(body.data.id).toBe(id);
    expect(body.data.series).toEqual(SERIES);
  });

  it("소유자가 아니면 403", async () => {
    const id = await createRun();
    sessionState.user = { id: USER_B, email: "b@t.test", name: "다른 원장" };

    const res = await getPrediction(
      new NextRequest(`http://localhost/api/predictions/${id}`),
      withId(id),
    );

    expect(res.status).toBe(403);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("없는 run 은 404", async () => {
    const missing = "99999999-9999-4999-8999-999999999999";
    const res = await getPrediction(
      new NextRequest(`http://localhost/api/predictions/${missing}`),
      withId(missing),
    );
    expect(res.status).toBe(404);
  });

  it("id 형식이 틀리면 400", async () => {
    const res = await getPrediction(
      new NextRequest("http://localhost/api/predictions/not-a-uuid"),
      withId("not-a-uuid"),
    );
    expect(res.status).toBe(400);
  });

  it("로그인하지 않으면 401", async () => {
    const id = await createRun();
    sessionState.user = null;
    const res = await getPrediction(
      new NextRequest(`http://localhost/api/predictions/${id}`),
      withId(id),
    );
    expect(res.status).toBe(401);
  });
});

describe("[T7.7] GET /api/predictions — 회차 목록(계기판)", () => {
  it("학교·학년으로 조회하면 최신순 요약을 돌려준다", async () => {
    seedHealthyCorpus();
    await createPrediction(postRequest({ series: SERIES, targetPeriod: TARGET }));
    await createPrediction(
      postRequest({
        series: SERIES,
        targetPeriod: { year: 2026, semester: 2, round: "기말" },
      }),
    );

    const res = await listPredictions(
      listRequest({ school: SCHOOL, grade: "3" }),
    );

    expect(res.status).toBe(200);
    const body = predictionRunListResponseSchema.parse(await res.json());
    expect(body.data).toHaveLength(2);
    // 최신이 먼저.
    expect(body.data[0].targetPeriod.round).toBe("기말");
    expect(body.data[0].evidenceCount).toBeGreaterThan(0);
    expect(body.data[0].blueprint).not.toBeNull();
    // 소유자 필터가 DB where 로 내려가서 total 이 정확하다.
    expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 2 });
  });

  it("페이지네이션이 소유자 기준으로 정확하다", async () => {
    seedHealthyCorpus();
    for (const round of ["중간", "기말"] as const) {
      for (const year of [2026, 2027]) {
        await createPrediction(
          postRequest({
            series: SERIES,
            targetPeriod: { year, semester: 2, round },
          }),
        );
      }
    }
    // 남의 run 은 total 에 섞이면 안 된다.
    sessionState.user = { id: USER_B, email: "b@t.test", name: "다른 원장" };
    await createPrediction(postRequest({ series: SERIES, targetPeriod: TARGET }));
    sessionState.user = { id: USER_A, email: "a@t.test", name: "원장" };

    const first = predictionRunListResponseSchema.parse(
      await (
        await listPredictions(
          listRequest({ school: SCHOOL, grade: "3", page: "1", pageSize: "3" }),
        )
      ).json(),
    );
    const second = predictionRunListResponseSchema.parse(
      await (
        await listPredictions(
          listRequest({ school: SCHOOL, grade: "3", page: "2", pageSize: "3" }),
        )
      ).json(),
    );

    expect(first.meta).toEqual({ page: 1, pageSize: 3, total: 4 });
    expect(first.data).toHaveLength(3);
    expect(second.data).toHaveLength(1);
    // 페이지가 겹치지 않는다.
    const ids = [...first.data, ...second.data].map((r) => r.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("다른 사용자의 run 은 목록에 나오지 않는다", async () => {
    seedHealthyCorpus();
    await createPrediction(postRequest({ series: SERIES, targetPeriod: TARGET }));

    sessionState.user = { id: USER_B, email: "b@t.test", name: "다른 원장" };
    const res = await listPredictions(
      listRequest({ school: SCHOOL, grade: "3" }),
    );

    expect(res.status).toBe(200);
    const body = predictionRunListResponseSchema.parse(await res.json());
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  it("과목으로 더 좁힐 수 있다", async () => {
    seedHealthyCorpus();
    await createPrediction(postRequest({ series: SERIES, targetPeriod: TARGET }));

    const hit = await listPredictions(
      listRequest({ school: SCHOOL, grade: "3", subject: "중3" }),
    );
    const miss = await listPredictions(
      listRequest({ school: SCHOOL, grade: "3", subject: "공통수학1" }),
    );

    expect(
      predictionRunListResponseSchema.parse(await hit.json()).data,
    ).toHaveLength(1);
    expect(
      predictionRunListResponseSchema.parse(await miss.json()).data,
    ).toHaveLength(0);
  });

  it("school 이 없으면 400", async () => {
    const res = await listPredictions(listRequest({ grade: "3" }));
    expect(res.status).toBe(400);
  });

  it("로그인하지 않으면 401", async () => {
    sessionState.user = null;
    const res = await listPredictions(
      listRequest({ school: SCHOOL, grade: "3" }),
    );
    expect(res.status).toBe(401);
  });
});

describe("[T7.7] 계약 표류 방지", () => {
  it("DEFAULT_PARAMS 가 predictorParamsSchema 를 그대로 통과한다", () => {
    expect(() => predictorParamsSchema.parse(DEFAULT_PARAMS)).not.toThrow();
    // 필드가 늘거나 줄면 여기서 깨진다(strictObject).
    expect(Object.keys(DEFAULT_PARAMS).sort()).toEqual(
      Object.keys(predictorParamsSchema.shape).sort(),
    );
  });
});
