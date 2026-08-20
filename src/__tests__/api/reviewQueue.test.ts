/**
 * 🔴 RED → 🟢 GREEN — 검수 대기열 API (검수 콘솔 4/n).
 *
 * 구현: src/app/api/review/queue/route.ts · src/lib/review/queues.ts
 *
 * 잠그는 제품 규칙:
 *  ⑴ **내가 판정한 문항은 다시 안 나온다.** 안 그러면 대기열이 영영 안 끝난다.
 *  ⑵ 「봤나」는 `review_log` 로 묻는다 — `reviewStatus` 로는 못 묻는다
 *     (이관 적재가 문항을 전부 approved 로 넣었다).
 *  ⑶ **남이 본 것은 안 사라진다** — 두 사람이 나눠 볼 수 있어야 한다.
 *  ⑷ 「남은 수」와 「실제로 오는 것」이 **같은 조건**을 쓴다.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION_USER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "10000000-0000-4000-8000-000000000002";

vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => ({
    id: SESSION_USER_ID,
    email: "teacher@todaysmath.test",
    name: "테스트 강사",
  })),
}));

import { GET as getQueue } from "@/app/api/review/queue/route";
import { errorResponseSchema } from "@/contracts/common.contract";
import { reviewQueueResponseSchema } from "@/contracts/review.contract";
import {
  prismaTestDouble,
  resetPrismaTestDouble,
} from "@/mocks/prismaTestDouble";

function get(qs: string) {
  return getQueue(
    new NextRequest(`http://localhost/api/review/queue?${qs}`, {
      method: "GET",
    }),
  );
}

async function body(res: Response) {
  return reviewQueueResponseSchema.parse(await res.json());
}

/** 「사람이 아직 안 봤다」 대기열에 확실히 들어가는 문항을 만든다. */
async function pendingIds(): Promise<string[]> {
  const rows = await prismaTestDouble.problem.findMany({
    where: { reviewStatus: "pending", pool: "shared" },
  });
  return (rows as { id: string }[]).map((r) => r.id);
}

beforeEach(() => {
  resetPrismaTestDouble();
});

describe("GET /api/review/queue — 검수 대기열", () => {
  it("대기열이 무엇이고 무엇을 봐야 하는지 같이 온다", async () => {
    const res = await get("key=pending");
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b.meta.queue.key).toBe("pending");
    expect(b.meta.queue.label.length).toBeGreaterThan(0);
    expect(b.meta.queue.why.length).toBeGreaterThan(0);
    expect(b.meta.queue.look.length).toBeGreaterThan(0);
  });

  it("모르는 대기열은 못 받는다", async () => {
    const res = await get("key=아무거나");
    expect(res.status).toBe(400);
    errorResponseSchema.parse(await res.json());
  });

  it("🔴 **내가 판정한 문항은 다시 안 나온다**", async () => {
    const before = await body(await get("key=pending&limit=50"));
    const target = before.data[0];
    expect(target).toBeDefined(); // 분모를 못 박는다
    expect(before.meta.queue.remaining).toBe(before.data.length);

    await prismaTestDouble.problemReviewLog.create({
      data: {
        problemId: target.id,
        reviewerId: SESSION_USER_ID,
        verdict: "unsure",
      },
    });

    const after = await body(await get("key=pending&limit=50"));
    expect(after.data.map((p) => p.id)).not.toContain(target.id);
    expect(after.meta.queue.remaining).toBe(before.meta.queue.remaining - 1);
  });

  it("🔴 **남이 본 것은 안 사라진다** — 둘이 나눠 볼 수 있어야 한다", async () => {
    const before = await body(await get("key=pending&limit=50"));
    const target = before.data[0];
    await prismaTestDouble.problemReviewLog.create({
      data: {
        problemId: target.id,
        reviewerId: OTHER_USER_ID,
        verdict: "pass",
      },
    });
    const after = await body(await get("key=pending&limit=50"));
    expect(after.data.map((p) => p.id)).toContain(target.id);
  });

  it("🔴 검수자 없는 기록은 아무도 건너뛰지 않는다", async () => {
    const before = await body(await get("key=pending&limit=50"));
    const target = before.data[0];
    await prismaTestDouble.problemReviewLog.create({
      data: { problemId: target.id, reviewerId: null, verdict: "pass" },
    });
    const after = await body(await get("key=pending&limit=50"));
    expect(after.data.map((p) => p.id)).toContain(target.id);
  });

  it("🔴 「봤나」를 reviewStatus 로 묻지 않는다 — 승인된 문항도 안 본 것일 수 있다", async () => {
    const ids = await pendingIds();
    expect(ids.length).toBeGreaterThan(0);
    // 이관 적재가 하는 일: 아무도 안 봤는데 approved 로 만든다.
    for (const id of ids) {
      await prismaTestDouble.problem.update({
        where: { id },
        data: { reviewStatus: "approved" },
      });
    }
    // 그래도 「해설이 없다」 대기열에는 그대로 있어야 한다 — 사람이 본 적이 없으니까.
    const b = await body(await get("key=nosolution&limit=50"));
    const seen = new Set(b.data.map((p) => p.id));
    expect(b.meta.queue.remaining).toBe(b.data.length);
    // 승인 여부와 무관하게 해설 없는 문항이 남아 있다
    for (const p of b.data) expect(p.solution ?? "").toBe("");
    expect(seen.size).toBe(b.data.length);
  });

  it("limit 을 넘겨 받지 않는다", async () => {
    const b = await body(await get("key=pending&limit=1"));
    expect(b.data.length).toBeLessThanOrEqual(1);
    expect((await get("key=pending&limit=0")).status).toBe(400);
    expect((await get("key=pending&limit=999")).status).toBe(400);
  });

  it("🔴 「남은 수」와 실제로 오는 것이 **같은 조건**을 쓴다", async () => {
    const b = await body(await get("key=pending&limit=50"));
    const all = await prismaTestDouble.problem.findMany({
      where: {
        reviewStatus: "pending",
        OR: [{ pool: "shared" }, { userId: SESSION_USER_ID }],
      },
    });
    expect(b.meta.queue.remaining).toBe((all as unknown[]).length);
  });
});
