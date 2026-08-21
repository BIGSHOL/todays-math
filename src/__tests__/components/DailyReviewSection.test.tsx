/**
 * 🔴 RED → 🟢 — 메인 상단 「오늘의 확인테스트」 계기판 (2단계 화면, D-63·D-64).
 *
 * 구현: src/components/main/DailyReviewSection.tsx (+ MainScreen 배선)
 * 데이터: MSW — 기본 핸들러는 «연계 없음», 여기서 server.use 로 풍부한 픽스처를 얹는다.
 *
 * 무엇을 잠그나
 * 1. 숫자 줄 — 자동 N명·M종 / 문항 부족 / 시험기간이 실데이터 모양으로 선다.
 * 2. 「모두 출제」 — 자동 묶음 학생별로 POST /api/tests/generate 를 부르되,
 *    **오늘 시험이 이미 있는 학생은 건너뛴다**(중복 초안 금지). 성공하면 검수 링크.
 * 3. 시험기간 학생은 원문 줄과 함께 «표시만» — 출제 요청이 안 나간다.
 * 4. 동기화가 48시간 넘으면 「오래됨」 경고.
 */
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MainPage from "@/app/(main)/page";
import { dailyReviewResponseSchema } from "@/contracts/test.contract";
import { CLASS_A_ID, MOCK_UNITS, STUDENT_IDS } from "@/mocks/data";
import { server } from "@/mocks/server";

const DAY = "2026-08-21";
const UNIT_A = MOCK_UNITS[0]!; // 중2 1. 수와 식 첫 차시
const UNIT_B = MOCK_UNITS[1]!;
const EXISTING_TEST_ID = "90000000-0000-4000-8000-000000000777";

const st = (i: number, name: string) => ({
  id: STUDENT_IDS[i]!,
  name,
  classId: CLASS_A_ID,
  grade: "중2",
  className: "테스트반",
});

/** 자동 1묶음(2명, 그중 1명은 이미 오늘 시험 있음) + 부족 1묶음 + 시험기간 1명. */
function richDaily(syncRanAt: string) {
  return dailyReviewResponseSchema.parse({
    data: {
      day: DAY,
      sync: {
        ranAt: syncRanAt,
        students: 193,
        progressRows: 13571,
        unresolvedLines: 3999,
        ambiguous: 97,
      },
      attended: 4,
      auto: [
        {
          key: `${UNIT_A.id}~${UNIT_B.id}`,
          rangeStartUnitId: UNIT_A.id,
          rangeEndUnitId: UNIT_B.id,
          startedFrom: "chapter-start",
          unitCount: 2,
          neededCount: 8,
          poolTotal: 24,
          students: [st(0, "김민준"), st(1, "이서연")],
        },
      ],
      lacking: [
        {
          key: `${UNIT_B.id}~${UNIT_B.id}`,
          rangeStartUnitId: UNIT_B.id,
          rangeEndUnitId: UNIT_B.id,
          startedFrom: "progress-start",
          unitCount: 1,
          neededCount: 8,
          poolTotal: 2,
          students: [st(2, "박도윤")],
        },
      ],
      examOrUnread: [{ ...st(3, "최하은"), lines: ["수학 내신대비"] }],
      noRange: [],
      todayTests: [
        {
          studentId: STUDENT_IDS[1]!,
          testId: EXISTING_TEST_ID,
          status: "draft",
        },
      ],
    },
  });
}

function useRichHandlers(opts?: { syncRanAt?: string }) {
  const generated: Array<Record<string, unknown>> = [];
  server.use(
    http.get("/api/tests/daily-review", () =>
      HttpResponse.json(richDaily(opts?.syncRanAt ?? new Date().toISOString())),
    ),
    http.post("/api/tests/generate", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      generated.push(body);
      return HttpResponse.json(
        {
          data: {
            test: {
              id: `90000000-0000-4000-8000-00000000090${generated.length}`,
            },
          },
        },
        { status: 201 },
      );
    }),
  );
  return generated;
}

async function findSection() {
  return await screen.findByRole("region", { name: "오늘의 확인테스트" });
}

describe("[2단계] 메인 상단 계기판 — 오늘의 확인테스트", () => {
  it("숫자 줄 — 자동·부족·시험기간이 갈라져 선다", async () => {
    useRichHandlers();
    render(<MainPage />);
    const section = await findSection();
    await waitFor(() => {
      expect(within(section).getByText("명 자동 · 1종")).toBeInTheDocument();
    });
    expect(within(section).getByText("명 문항 부족")).toBeInTheDocument();
    expect(within(section).getByText("명 시험기간")).toBeInTheDocument();
    // 부족 묶음에는 사유(문항 수/필요 수)와 직접 출제 동선이 있다
    expect(within(section).getByText("문항 2/8")).toBeInTheDocument();
  });

  /** 🔴 핵심 배선 — 이미 시험이 있는 이서연은 건너뛰고 김민준만 출제한다. */
  it("모두 출제 — 오늘 시험이 없는 학생만 학생별로 POST 한다", async () => {
    const generated = useRichHandlers();
    const user = userEvent.setup();
    render(<MainPage />);
    const section = await findSection();
    const button = await within(section).findByRole("button", {
      name: "모두 출제 (1명)",
    });
    await user.click(button);
    await waitFor(() => {
      expect(generated).toHaveLength(1);
    });
    expect(generated[0]).toMatchObject({
      classId: CLASS_A_ID,
      studentId: STUDENT_IDS[0],
      testType: "review",
      testDate: DAY,
      rangeStartUnitId: UNIT_A.id,
      rangeEndUnitId: UNIT_B.id,
    });
    // 끝나면 두 학생 다 검수 링크가 있고, 버튼은 「모두 출제됨」으로 잠긴다
    await within(section).findByRole("button", { name: "모두 출제됨" });
    expect(
      within(section).getByRole("link", { name: "김민준" }),
    ).toHaveAttribute("href", expect.stringContaining("/tests/"));
    expect(
      within(section).getByRole("link", { name: "이서연" }),
    ).toHaveAttribute("href", `/tests/${EXISTING_TEST_ID}`);
  });

  it("시험기간 학생은 원문 줄과 함께 표시만 — 펼치면 사유가 보인다", async () => {
    useRichHandlers();
    const user = userEvent.setup();
    render(<MainPage />);
    const section = await findSection();
    await user.click(
      await within(section).findByText(
        "시험기간·진도 못 읽음 1명 — 자동 출제 제외",
      ),
    );
    expect(within(section).getByText("수학 내신대비")).toBeInTheDocument();
    expect(within(section).getByText("최하은")).toBeInTheDocument();
  });

  /** 🔴 지금 가져오기 — POST /api/eywa-sync 후 섹션을 새로 읽는다. */
  it("지금 가져오기 — 동기화를 부르고 끝나면 다시 읽는다", async () => {
    useRichHandlers();
    let syncCalls = 0;
    let reviewCalls = 0;
    server.use(
      http.get("/api/tests/daily-review", () => {
        reviewCalls += 1;
        return HttpResponse.json(richDaily(new Date().toISOString()));
      }),
      http.post("/api/eywa-sync", () => {
        syncCalls += 1;
        return HttpResponse.json({
          data: {
            runId: "r1",
            students: 193,
            classes: 62,
            progressRows: 13571,
            unresolvedLines: 3999,
            ambiguous: 97,
          },
        });
      }),
    );
    const user = userEvent.setup();
    render(<MainPage />);
    const section = await findSection();
    const before = reviewCalls;
    await user.click(
      await within(section).findByRole("button", { name: "지금 가져오기" }),
    );
    await waitFor(() => {
      expect(syncCalls).toBe(1);
      expect(reviewCalls).toBeGreaterThan(before);
    });
  });

  it("동기화가 48시간을 넘으면 「오래됨」 경고가 선다", async () => {
    useRichHandlers({
      syncRanAt: new Date(Date.now() - 72 * 3_600_000).toISOString(),
    });
    render(<MainPage />);
    const section = await findSection();
    await within(section).findByText("오래됨 — 48시간 넘음");
  });
});
