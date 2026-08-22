/**
 * 🔴 RED → 🟢 — 검수 콘솔 신고 흐름 가속 (원장님 요청 2026-08-22).
 *
 * 「신고를 눌렀을 때도 하단에 숫자 입력으로 빠르게 넘어갈 수 있게.
 *  1행당 하나의 라벨로 빠르게. 모바일에서도 신고 기능 작동할 수 있게.」
 *
 * 잠그는 것:
 *  1. 신고 패널이 열리면 숫자 1~6 이 **사유**가 된다 — 누르는 즉시 신고하고 다음.
 *     (패널이 닫혀 있을 때의 1·2·3 판정 단축은 그대로.)
 *  2. 사유 줄을 **탭(클릭)해도 즉시** 신고하고 다음 — 모바일은 이 길 하나로 끝난다.
 *  3. 「그 밖의 것」만 예외 — 설명이 필수라 자동 제출하지 않는다.
 *  4. Escape 가 신고 패널을 닫는다 (예전엔 2가 토글이었지만 이제 2는 사유다).
 */
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import {
  ReviewConsole,
  type ConsoleProblem,
  type ConsoleQueue,
} from "@/components/review/ReviewConsole";
import { server } from "@/mocks/server";

const QUEUES: ConsoleQueue[] = [
  {
    key: "figure",
    label: "그림을 보라",
    why: "테스트",
    look: "그림",
    remaining: 5,
  },
];

const problem = (i: number): ConsoleProblem => ({
  id: `90000000-0000-4000-8000-00000000010${i}`,
  problemCode: `T-000${i}`,
  content: `문항 ${i} 본문 $x=${i}$`,
  answer: `${i}`,
  solution: null,
  questionType: "객관식",
  figureUrls: [],
  figureDims: [],
  figureSourceMm: [],
  directUseAllowed: true,
  unitName: "테스트 단원",
});

function arm() {
  const posts: Array<{ id: string; body: Record<string, unknown> }> = [];
  server.use(
    http.post("/api/problems/:id/review", async ({ params, request }) => {
      posts.push({
        id: String(params.id),
        body: (await request.json()) as Record<string, unknown>,
      });
      return HttpResponse.json({ data: { ok: true } });
    }),
    http.get("/api/review/queue", () =>
      HttpResponse.json({
        data: [],
        meta: {
          queue: { ...QUEUES[0]!, remaining: 0 },
          reviewedByMe: 0,
        },
      }),
    ),
  );
  return posts;
}

function renderConsole() {
  return render(
    <ReviewConsole
      queues={QUEUES}
      initialKey="figure"
      initialRows={[problem(1), problem(2), problem(3), problem(4), problem(5)]}
      reviewedByMe={0}
    />,
  );
}

describe("검수 콘솔 — 신고 가속 (2026-08-22)", () => {
  it("사유가 1행 1라벨 + 번호로 선다", async () => {
    arm();
    const user = userEvent.setup();
    renderConsole();
    await user.keyboard("2");
    const panel = screen.getByText("무엇이 이상한가").closest("div")!;
    const rows = within(panel).getAllByRole("button");
    // 6개 사유 각각이 제 줄(버튼)이고 번호를 단다
    expect(
      rows.filter((b) => /[1-6]/.test(b.textContent ?? "")).length,
    ).toBeGreaterThanOrEqual(6);
    expect(within(panel).getByText("그림이 이상하다")).toBeInTheDocument();
  });

  it("숫자키: 2(신고) → 1(그림) 이 곧바로 신고하고 다음이다", async () => {
    const posts = arm();
    const user = userEvent.setup();
    renderConsole();

    expect(screen.getByText(/문항 1 본문/)).toBeInTheDocument();
    await user.keyboard("2");
    await user.keyboard("1");

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({
      verdict: "defect",
      reason: "figure",
    });
    // 다음 문항으로 넘어갔고 패널은 닫혔다
    await screen.findByText(/문항 2 본문/);
    expect(screen.queryByText("무엇이 이상한가")).not.toBeInTheDocument();
  });

  it("사유 줄을 탭하면 즉시 신고하고 다음 — 모바일 동선", async () => {
    const posts = arm();
    const user = userEvent.setup();
    renderConsole();

    await user.click(screen.getByRole("button", { name: /신고/ }));
    await user.click(screen.getByRole("button", { name: /답이 틀렸다/ }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({
      verdict: "defect",
      reason: "answer",
    });
  });

  it("그 밖의 것(6)은 설명 없이 자동 제출하지 않는다", async () => {
    const posts = arm();
    const user = userEvent.setup();
    renderConsole();

    await user.keyboard("2");
    await user.keyboard("6");
    expect(posts).toHaveLength(0);

    await user.type(
      screen.getByPlaceholderText(/무엇이 이상한지 적는다/),
      "보기 순서가 섞였다",
    );
    await user.click(screen.getByRole("button", { name: "신고하고 다음" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({
      verdict: "defect",
      reason: "other",
      note: "보기 순서가 섞였다",
    });
  });

  it("Escape 가 신고 패널을 닫고, 닫힌 뒤 1은 다시 판정이다", async () => {
    const posts = arm();
    const user = userEvent.setup();
    renderConsole();

    await user.keyboard("2");
    expect(screen.getByText("무엇이 이상한가")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("무엇이 이상한가")).not.toBeInTheDocument();

    await user.keyboard("1");
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({ verdict: "pass" });
  });
});
