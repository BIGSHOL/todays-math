/**
 * 🔴 RED → 🟢 GREEN — 문항 신고 API (검수 콘솔 17).
 *
 * 구현: src/app/api/problems/[id]/reports/route.ts
 * 대응 계약: src/contracts/problemReport.contract.ts
 *
 * 여기서 잠그는 것은 **제품 규칙**이다:
 *  ⑴ 신고해도 **문항은 바뀌지 않는다.** directUseAllowed 를 신고가 건드리면
 *     오신고 한 건이 멀쩡한 문항을 지면에서 지운다.
 *  ⑵ **남의 공용 문항도 신고할 수 있다.** 검수 계정은 자기 문항이 없다 —
 *     못 하면 검수 콘솔이 통째로 무의미하다.
 *  ⑶ 「기타」는 설명이 없으면 못 받는다.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION_USER_ID = "10000000-0000-4000-8000-000000000001";

vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => ({
    id: SESSION_USER_ID,
    email: "teacher@todaysmath.test",
    name: "테스트 강사",
  })),
}));

import { POST as createReport } from "@/app/api/problems/[id]/reports/route";
import { errorResponseSchema } from "@/contracts/common.contract";
import { problemReportResponseSchema } from "@/contracts/problemReport.contract";
import {
  PROBLEM_OTHER_ID,
  PROBLEM_OTHER_SHARED_ID,
  problemId,
} from "@/mocks/data";
import {
  prismaTestDouble,
  resetPrismaTestDouble,
} from "@/mocks/prismaTestDouble";

/** 세션 사용자 소유 · 공용 풀. 더블이 실제로 싣는 문항이다. */
const OWN_PROBLEM_ID = problemId(1);
const NOT_FOUND_ID = "50000000-0000-4000-8000-000000000404";

function post(id: string, body: unknown) {
  return createReport(
    new NextRequest(`http://localhost/api/problems/${id}/reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  resetPrismaTestDouble();
});

describe("POST /api/problems/{id}/reports — 문항 신고", () => {
  it("사유만으로 신고할 수 있다", async () => {
    const res = await post(OWN_PROBLEM_ID, { reason: "figure" });
    expect(res.status).toBe(201);
    const body = problemReportResponseSchema.parse(await res.json());
    expect(body.data.reason).toBe("figure");
    expect(body.data.status).toBe("open");
    expect(body.data.problemId).toBe(OWN_PROBLEM_ID);
    expect(body.data.reporterId).toBe(SESSION_USER_ID);
    expect(body.data.note).toBeNull();
  });

  it("설명을 덧붙일 수 있다", async () => {
    const res = await post(OWN_PROBLEM_ID, {
      reason: "answer",
      note: "정답이 ③인데 풀면 ⑤가 나온다",
    });
    expect(res.status).toBe(201);
    const body = problemReportResponseSchema.parse(await res.json());
    expect(body.data.note).toBe("정답이 ③인데 풀면 ⑤가 나온다");
  });

  it("🔴 신고해도 **문항은 안 바뀐다** — 오신고가 지면에서 문항을 지우면 안 된다", async () => {
    // 🔴 **값을 그 자리에서 떠 온다.** 더블의 findUnique 는 행 객체를 그대로
    //    돌려주므로, 객체를 붙들고 나중에 비교하면 before/after 가 **같은 객체**라
    //    무엇을 바꿔도 통과한다. 실제로 변이 시험에서 초록이었다(2026-08-20).
    const beforeRow = await prismaTestDouble.problem.findUnique({
      where: { id: OWN_PROBLEM_ID },
    });
    const before = {
      directUseAllowed: beforeRow?.directUseAllowed,
      reviewStatus: beforeRow?.reviewStatus,
    };
    expect(before.directUseAllowed).toBe(true); // 분모를 못 박는다

    await post(OWN_PROBLEM_ID, { reason: "content" });

    const after = await prismaTestDouble.problem.findUnique({
      where: { id: OWN_PROBLEM_ID },
    });
    expect(after?.directUseAllowed).toBe(before.directUseAllowed);
    expect(after?.reviewStatus).toBe(before.reviewStatus);
  });

  it("🔴 **남의 공용 문항도 신고할 수 있다** — 검수 계정은 자기 문항이 없다", async () => {
    const res = await post(PROBLEM_OTHER_SHARED_ID, { reason: "unit" });
    expect(res.status).toBe(201);
  });

  it("남의 **비공개** 문항은 신고할 수 없다", async () => {
    const res = await post(PROBLEM_OTHER_ID, { reason: "content" });
    expect(res.status).toBe(403);
    errorResponseSchema.parse(await res.json());
  });

  it("없는 문항이면 404", async () => {
    const res = await post(NOT_FOUND_ID, { reason: "content" });
    expect(res.status).toBe(404);
  });

  it("🔴 「기타」는 설명이 없으면 못 받는다", async () => {
    const res = await post(OWN_PROBLEM_ID, { reason: "other" });
    expect(res.status).toBe(400);
    errorResponseSchema.parse(await res.json());
  });

  it("「기타」도 설명이 있으면 받는다", async () => {
    const res = await post(OWN_PROBLEM_ID, {
      reason: "other",
      note: "보기 ②와 ④가 같은 값이다",
    });
    expect(res.status).toBe(201);
  });

  it("모르는 사유는 못 받는다", async () => {
    const res = await post(OWN_PROBLEM_ID, { reason: "그림이 이상하다" });
    expect(res.status).toBe(400);
  });

  it("같은 사람이 같은 사유로 두 번 누르면 한 건으로 본다", async () => {
    const first = await post(OWN_PROBLEM_ID, { reason: "figure" });
    expect(first.status).toBe(201);
    const second = await post(OWN_PROBLEM_ID, { reason: "figure" });
    expect(second.status).toBe(200);

    const rows = await prismaTestDouble.problemReport.findMany({
      where: { problemId: OWN_PROBLEM_ID, status: "open" },
    });
    expect(rows.filter((r) => r.reason === "figure")).toHaveLength(1);
  });

  it("사유가 다르면 따로 쌓인다", async () => {
    await post(OWN_PROBLEM_ID, { reason: "figure" });
    await post(OWN_PROBLEM_ID, { reason: "answer" });
    const rows = await prismaTestDouble.problemReport.findMany({
      where: { problemId: OWN_PROBLEM_ID },
    });
    expect(rows).toHaveLength(2);
  });
});
