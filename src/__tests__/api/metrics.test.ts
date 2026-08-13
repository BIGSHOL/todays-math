/**
 * 🟢 GREEN — Phase 5, T5.3 (사용 지표 기록 API)
 *
 * 구현: src/app/api/tests/[id]/print/route.ts, src/app/api/metrics/route.ts
 * 대응 계약: src/contracts/test.contract.ts (print), src/contracts/metrics.contract.ts
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

import { POST as printTest } from "@/app/api/tests/[id]/print/route";
import { GET as getMetrics } from "@/app/api/metrics/route";

import { errorResponseSchema } from "@/contracts/common.contract";
import { metricsResponseSchema } from "@/contracts/metrics.contract";
import { testPrintResponseSchema } from "@/contracts/test.contract";
import {
  TEST_CONFIRMED_ID,
  TEST_DRAFT_ID,
  TEST_NOT_FOUND_ID,
  TEST_PRINTED_ID,
} from "@/mocks/data";

function jsonRequest(url: string, method: string) {
  return new NextRequest(url, { method });
}

function withId(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("[T5.3] POST /api/tests/{id}/print — printedAt 기록", () => {
  it("confirmed 테스트를 인쇄하면 printed 상태와 printedAt을 기록한다", async () => {
    const res = await printTest(
      jsonRequest(`http://localhost/api/tests/${TEST_CONFIRMED_ID}/print`, "POST"),
      withId(TEST_CONFIRMED_ID),
    );
    expect(res.status).toBe(200);
    const body = testPrintResponseSchema.parse(await res.json());
    expect(body.data.status).toBe("printed");
    expect(body.data.printedAt).not.toBeNull();
  });

  it("이미 인쇄된 테스트는 기존 printedAt을 유지한 채 200을 반환한다", async () => {
    const res = await printTest(
      jsonRequest(`http://localhost/api/tests/${TEST_PRINTED_ID}/print`, "POST"),
      withId(TEST_PRINTED_ID),
    );
    expect(res.status).toBe(200);
    const body = testPrintResponseSchema.parse(await res.json());
    expect(body.data.status).toBe("printed");
    expect(body.data.printedAt).not.toBeNull();
  });

  it("draft 테스트는 인쇄할 수 없다(CONFLICT 409)", async () => {
    const res = await printTest(
      jsonRequest(`http://localhost/api/tests/${TEST_DRAFT_ID}/print`, "POST"),
      withId(TEST_DRAFT_ID),
    );
    expect(res.status).toBe(409);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("CONFLICT");
  });

  it("존재하지 않는 테스트는 NOT_FOUND(404)를 반환한다", async () => {
    const res = await printTest(
      jsonRequest(
        `http://localhost/api/tests/${TEST_NOT_FOUND_ID}/print`,
        "POST",
      ),
      withId(TEST_NOT_FOUND_ID),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("[T5.3] GET /api/metrics — 주간 요약", () => {
  it("인쇄 후 주간 요약에 실사용 일수와 무수정 비율이 포함된다", async () => {
    await printTest(
      jsonRequest(`http://localhost/api/tests/${TEST_CONFIRMED_ID}/print`, "POST"),
      withId(TEST_CONFIRMED_ID),
    );

    const res = await getMetrics(
      jsonRequest("http://localhost/api/metrics", "GET"),
    );
    expect(res.status).toBe(200);
    const body = metricsResponseSchema.parse(await res.json());
    expect(body.data.printedDays).toBeGreaterThanOrEqual(1);
    expect(body.data.printedCount).toBeGreaterThanOrEqual(1);
    expect(body.data.unmodifiedRate).toBeGreaterThanOrEqual(0);
    expect(body.data.unmodifiedRate).toBeLessThanOrEqual(1);
  });

  it("weekStart가 잘못된 형식이면 VALIDATION_ERROR(400)를 반환한다", async () => {
    const res = await getMetrics(
      jsonRequest("http://localhost/api/metrics?weekStart=2026/08/01", "GET"),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
