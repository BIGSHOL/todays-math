/**
 * 🔴 RED → 🟢 GREEN — 검수 판정 API (검수 콘솔 4/n).
 *
 * 구현: src/app/api/problems/[id]/review/route.ts
 * 대응 계약: src/contracts/review.contract.ts
 *
 * 잠그는 제품 규칙:
 *  ⑴ `pass` 만 문항을 승인한다. `unsure`·`defect` 는 **문항을 안 바꾼다.**
 *  ⑵ 기록은 **덧붙이기만** 한다 — 다시 봐도 앞 기록이 남는다.
 *  ⑶ 신고가 아닌 판정에 사유를 붙여 오면 거절한다(화면이 상태를 안 지운 것이다).
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

import { POST as submitReview } from "@/app/api/problems/[id]/review/route";
import { errorResponseSchema } from "@/contracts/common.contract";
import { reviewSubmitResponseSchema } from "@/contracts/review.contract";
import {
  PROBLEM_OTHER_ID,
  PROBLEM_OTHER_SHARED_ID,
  problemId,
} from "@/mocks/data";
import {
  prismaTestDouble,
  resetPrismaTestDouble,
} from "@/mocks/prismaTestDouble";

const OWN_PROBLEM_ID = problemId(1);
const NOT_FOUND_ID = "50000000-0000-4000-8000-000000000404";

function post(id: string, body: unknown) {
  return submitReview(
    new NextRequest(`http://localhost/api/problems/${id}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

/** 값을 **그 자리에서** 떠 온다 — 더블은 행 객체를 그대로 돌려준다. */
async function snapshot(id: string) {
  const row = await prismaTestDouble.problem.findUnique({ where: { id } });
  return {
    reviewStatus: row?.reviewStatus,
    directUseAllowed: row?.directUseAllowed,
  };
}

beforeEach(() => {
  resetPrismaTestDouble();
});

describe("POST /api/problems/{id}/review — 검수 판정", () => {
  it("통과는 문항을 승인한다", async () => {
    await prismaTestDouble.problem.update({
      where: { id: OWN_PROBLEM_ID },
      data: { reviewStatus: "pending" },
    });
    const res = await post(OWN_PROBLEM_ID, { verdict: "pass" });
    expect(res.status).toBe(201);
    const body = reviewSubmitResponseSchema.parse(await res.json());
    expect(body.data.log.verdict).toBe("pass");
    expect(body.data.reviewStatus).toBe("approved");
    expect(body.data.reportId).toBeNull();
    expect((await snapshot(OWN_PROBLEM_ID)).reviewStatus).toBe("approved");
  });

  it("🔴 「판단 못 하겠다」는 **문항을 안 바꾼다**", async () => {
    await prismaTestDouble.problem.update({
      where: { id: OWN_PROBLEM_ID },
      data: { reviewStatus: "pending" },
    });
    const before = await snapshot(OWN_PROBLEM_ID);
    expect(before.reviewStatus).toBe("pending"); // 분모를 못 박는다

    const res = await post(OWN_PROBLEM_ID, { verdict: "unsure" });
    expect(res.status).toBe(201);
    const after = await snapshot(OWN_PROBLEM_ID);
    expect(after.reviewStatus).toBe(before.reviewStatus);
    expect(after.directUseAllowed).toBe(before.directUseAllowed);
    expect(await prismaTestDouble.problemReport.count({})).toBe(0);
  });

  it("🔴 신고도 **문항을 안 바꾼다** — 오신고가 지면에서 문항을 지우면 안 된다", async () => {
    await prismaTestDouble.problem.update({
      where: { id: OWN_PROBLEM_ID },
      data: { reviewStatus: "pending" },
    });
    const before = await snapshot(OWN_PROBLEM_ID);
    const res = await post(OWN_PROBLEM_ID, {
      verdict: "defect",
      reason: "figure",
    });
    expect(res.status).toBe(201);
    const body = reviewSubmitResponseSchema.parse(await res.json());
    expect(body.data.reportId).not.toBeNull();

    const after = await snapshot(OWN_PROBLEM_ID);
    expect(after.reviewStatus).toBe(before.reviewStatus);
    expect(after.directUseAllowed).toBe(before.directUseAllowed);
  });

  it("신고 판정은 신고 한 건을 남긴다", async () => {
    await post(OWN_PROBLEM_ID, {
      verdict: "defect",
      reason: "answer",
      note: "정답이 ③인데 풀면 ⑤가 나온다",
    });
    const reports = await prismaTestDouble.problemReport.findMany({
      where: { problemId: OWN_PROBLEM_ID },
    });
    expect(reports).toHaveLength(1);
    expect(reports[0].reason).toBe("answer");
  });

  it("🔴 기록은 **덧붙이기만** 한다 — 같은 문항을 두 번 보면 두 줄", async () => {
    await post(OWN_PROBLEM_ID, { verdict: "unsure" });
    await post(OWN_PROBLEM_ID, { verdict: "pass" });
    const logs = await prismaTestDouble.problemReviewLog.findMany({
      where: { problemId: OWN_PROBLEM_ID },
    });
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => l.verdict)).toEqual(["unsure", "pass"]);
  });

  it("같은 사유로 두 번 신고해도 신고는 한 건 — 기록은 두 줄", async () => {
    await post(OWN_PROBLEM_ID, { verdict: "defect", reason: "figure" });
    await post(OWN_PROBLEM_ID, { verdict: "defect", reason: "figure" });
    expect(
      await prismaTestDouble.problemReport.count({
        where: { problemId: OWN_PROBLEM_ID },
      }),
    ).toBe(1);
    expect(
      await prismaTestDouble.problemReviewLog.count({
        where: { problemId: OWN_PROBLEM_ID },
      }),
    ).toBe(2);
  });

  it("🔴 신고인데 사유가 없으면 못 받는다", async () => {
    const res = await post(OWN_PROBLEM_ID, { verdict: "defect" });
    expect(res.status).toBe(400);
    errorResponseSchema.parse(await res.json());
  });

  it("🔴 신고가 아닌데 사유가 붙어 오면 못 받는다", async () => {
    const res = await post(OWN_PROBLEM_ID, {
      verdict: "pass",
      reason: "figure",
    });
    expect(res.status).toBe(400);
  });

  it("「기타」 신고는 설명이 없으면 못 받는다", async () => {
    expect(
      (await post(OWN_PROBLEM_ID, { verdict: "defect", reason: "other" }))
        .status,
    ).toBe(400);
    expect(
      (
        await post(OWN_PROBLEM_ID, {
          verdict: "defect",
          reason: "other",
          note: "보기 ②와 ④가 같다",
        })
      ).status,
    ).toBe(201);
  });

  it("모르는 판정은 못 받는다", async () => {
    expect((await post(OWN_PROBLEM_ID, { verdict: "통과" })).status).toBe(400);
  });

  it("남의 공용 문항도 검수한다 · 비공개는 못 한다 · 없으면 404", async () => {
    expect(
      (await post(PROBLEM_OTHER_SHARED_ID, { verdict: "pass" })).status,
    ).toBe(201);
    expect((await post(PROBLEM_OTHER_ID, { verdict: "pass" })).status).toBe(
      403,
    );
    expect((await post(NOT_FOUND_ID, { verdict: "pass" })).status).toBe(404);
  });
});
