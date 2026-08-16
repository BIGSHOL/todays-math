/**
 * 적대적 재현 — PATCH /api/tests/{id}/scores 경계값. **읽기 전용 조사용.**
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
import { validateManualScores } from "@/lib/predictor/scoreNormalizer";
import { db } from "@/lib/db";
import { TEST_RESULT_FIXTURE_TEST_ID } from "@/mocks/data";

function jsonRequest(url: string, method: string, raw: string) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: raw,
  });
}
const withId = (id: string) => ({ params: Promise.resolve({ id }) });
const URL_ = `http://localhost/api/tests/${TEST_RESULT_FIXTURE_TEST_ID}/scores`;

describe("[적대] 이상값", () => {
  it("validateManualScores 단독 — NaN·Infinity·음수·문자열", () => {
    const rows: Array<[string, unknown]> = [
      ["NaN", NaN],
      ["Infinity", Infinity],
      ["-Infinity", -Infinity],
      ["음수", -50],
      ["0", 0],
      ["문자열 '50'", "50"],
    ];
    for (const [name, v] of rows) {
      const check = validateManualScores([
        { number: 1, score: v as number },
        { number: 2, score: 50 },
      ]);
      console.log(
        `  ${name.padEnd(12)} → ok=${check.ok}` +
          (check.ok ? "" : ` issue=${check.issue} total=${check.total} msg=${check.message}`),
      );
    }
    expect(true).toBe(true);
  });

  it("라우트 — 배점에 JSON 숫자 아닌 값을 넣으면 어떻게 되나", async () => {
    for (const raw of [
      '{"scores":[{"orderIndex":1,"score":1e999},{"orderIndex":2,"score":50},{"orderIndex":3,"score":50}]}',
      '{"scores":[{"orderIndex":1,"score":-50},{"orderIndex":2,"score":100},{"orderIndex":3,"score":50}]}',
      '{"scores":[{"orderIndex":1,"score":"50"},{"orderIndex":2,"score":25},{"orderIndex":3,"score":25}]}',
    ]) {
      const res = await updateScores(jsonRequest(URL_, "PATCH", raw), withId(TEST_RESULT_FIXTURE_TEST_ID));
      console.log(`  ${raw.slice(20, 55)}… → ${res.status}`);
    }
    expect(true).toBe(true);
  });
});

describe("[적대] 배점을 표기하지 않는 일일/확인테스트(D-28·D-40)에 배점을 심는다", () => {
  it("testType·status 검사 없이 옛 시험지의 TestProblem.score 를 덮어쓴다", async () => {
    const beforeRows = await db.testProblem.findMany({
      where: { testId: TEST_RESULT_FIXTURE_TEST_ID },
      orderBy: { orderIndex: "asc" },
    });
    const before = beforeRows.map((r) => ({ orderIndex: r.orderIndex, score: r.score }));
    const test = await db.test.findUnique({ where: { id: TEST_RESULT_FIXTURE_TEST_ID } });
    console.log("대상 시험지 testType/status:", test?.testType, test?.status);
    console.log("변경 전 TestProblem.score:", before.map((r) => r.score));

    const res = await updateScores(
      jsonRequest(
        URL_,
        "PATCH",
        JSON.stringify({
          scores: before.map((r, i) => ({ orderIndex: r.orderIndex, score: i === 0 ? 98 : 1 })),
        }),
      ),
      withId(TEST_RESULT_FIXTURE_TEST_ID),
    );
    console.log("PATCH status:", res.status);
    const after = await db.testProblem.findMany({
      where: { testId: TEST_RESULT_FIXTURE_TEST_ID },
      orderBy: { orderIndex: "asc" },
    });
    console.log("변경 후 TestProblem.score:", after.map((r) => r.score));
    expect(res.status).toBe(200);
    expect(after.map((r) => r.score)).not.toEqual(before.map((r) => r.score));
  });

  it("같은 orderIndex 중복 + 배점 없는 시험지 — 400 으로 막힌다 (2026-08-16 수리)", async () => {
    const rows = await db.testProblem.findMany({
      where: { testId: TEST_RESULT_FIXTURE_TEST_ID },
      orderBy: { orderIndex: "asc" },
    });
    const n = rows.length;
    const scores = [
      ...Array.from({ length: n - 1 }, () => ({ orderIndex: rows[0]!.orderIndex, score: 1 })),
      { orderIndex: rows[1]!.orderIndex, score: 100 - (n - 1) },
    ];
    let thrown: unknown = null;
    let status = 0;
    try {
      const res = await updateScores(
        jsonRequest(URL_, "PATCH", JSON.stringify({ scores })),
        withId(TEST_RESULT_FIXTURE_TEST_ID),
      );
      status = res.status;
    } catch (error) {
      thrown = error;
    }
    console.log("status:", status, "· 던진 예외:", thrown instanceof Error ? thrown.message.slice(0, 160) : thrown);

    // 수리 전: 중복 때문에 갱신 안 된 행이 남아 응답 계약(score positive)에 걸려
    //          ZodError 가 Route Handler 밖으로 나갔다(=500).
    //          이제 중복을 먼저 거부하므로 그 경로 자체가 닫힌다.
    expect(thrown).toBeNull();
    expect(status).toBe(400);
  });
});
