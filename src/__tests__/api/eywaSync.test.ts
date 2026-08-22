/**
 * 🔴 RED → 🟢 — POST /api/eywa-sync (「지금 가져오기」, 계획 §8-1).
 *
 * 구현: src/app/api/eywa-sync/route.ts
 * 본체(runEywaSync)는 여기서 모킹한다 — eywa API 를 실호출하면 테스트가 밖에
 * 매달린다. 본체 자체의 검증은 CLI 실행(그림자 diff·검산)이 해 왔다.
 *
 * 여기서 보는 것은 **배선**이다: 세션 없으면 401, 요약이 계약 모양으로 나가는가,
 * 그리고 **원장 sink** — 라우트가 넘긴 writeLedger 가 정말 DB 원장에 쓰고
 * 최근 14회만 남기는가(원장은 «추가만», 줄면 멈춘다 — 2026-08-20 교훈).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => ({
    id: "10000000-0000-4000-8000-000000000001",
    email: "teacher@todaysmath.test",
    name: "테스트 강사",
  })),
}));

const runEywaSyncMock = vi.fn();
vi.mock("@/lib/eywa/runSync", () => ({
  runEywaSync: (opts: unknown) => runEywaSyncMock(opts),
}));

import { POST as eywaSync } from "@/app/api/eywa-sync/route";
import { eywaSyncResponseSchema } from "@/contracts/test.contract";
import { getSessionUser } from "@/lib/session";
import { prismaTestDouble } from "@/mocks/prismaTestDouble";

type SyncOpts = {
  apply: boolean;
  writeLedger: (runId: string, payload: unknown) => Promise<void> | void;
};

const SUMMARY = {
  runId: "eywa-sync-test",
  applied: true,
  transport: "api",
  rosterTotal: 193,
  studentsWithReports: 180,
  studentsWithRows: 170,
  classes: 62,
  reports: 12293,
  plannedRows: 13571,
  ambiguous: 97,
  examOnly: 1803,
  unresolvedLines: 3999,
  unresolvedKinds: 1364,
  outOfRosterReports: 353,
  outOfRosterStudents: 12,
  appliedCounts: {
    classes: 62,
    students: 193,
    withdrawn: 0,
    deleted: 13571,
    created: 13571,
    linkedAfter: 193,
  },
};

describe("[2단계] POST /api/eywa-sync — 지금 가져오기", () => {
  it("세션이 없으면 401 — 본체를 부르지도 않는다", async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce(null);
    runEywaSyncMock.mockClear();
    const res = await eywaSync();
    expect(res.status).toBe(401);
    expect(runEywaSyncMock).not.toHaveBeenCalled();
  });

  it("실쓰기로 부르고, 요약이 계약 모양으로 나간다", async () => {
    runEywaSyncMock.mockResolvedValueOnce(SUMMARY);
    const res = await eywaSync();
    expect(res.status).toBe(200);
    const body = eywaSyncResponseSchema.parse(await res.json());
    expect(body.data).toEqual({
      runId: "eywa-sync-test",
      students: 193,
      classes: 62,
      progressRows: 13571,
      unresolvedLines: 3999,
      ambiguous: 97,
    });
    const opts = runEywaSyncMock.mock.calls.at(-1)![0] as SyncOpts;
    expect(opts.apply).toBe(true);
  });

  /** 🔴 원장 sink 배선 — 진짜 DB 원장에 쓰고, 최근 14회만 남긴다. */
  it("writeLedger 가 EywaSyncLedger 에 쓰고 14회를 넘으면 오래된 것만 지운다", async () => {
    runEywaSyncMock.mockResolvedValueOnce(SUMMARY);
    await eywaSync();
    const opts = runEywaSyncMock.mock.calls.at(-1)![0] as SyncOpts;

    for (let i = 0; i < 16; i += 1)
      await opts.writeLedger(`run-${String(i).padStart(2, "0")}`, { i });
    const rows = (await prismaTestDouble.eywaSyncLedger.findMany({
      orderBy: [{ createdAt: "asc" }, { runId: "asc" }],
    })) as Array<{ runId: string }>;
    expect(rows.length).toBe(14);
    // 지워진 것은 **가장 오래된** 두 회차다 — 최신을 지우면 원장이 거꾸로 준다.
    expect(rows[0]!.runId).toBe("run-02");
    expect(rows.at(-1)!.runId).toBe("run-15");
  });

  it("본체가 던지면 502 + 사유 — 침묵하지 않는다", async () => {
    runEywaSyncMock.mockRejectedValueOnce(
      new Error("eywa API /roster → HTTP 503"),
    );
    const res = await eywaSync();
    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("EYWA_SYNC_FAILED");
    expect(body.error.message).toContain("503");
  });
});
