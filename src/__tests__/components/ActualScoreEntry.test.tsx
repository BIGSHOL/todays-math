/**
 * 🔴 RED — 실제 내신 점수 입력 (회차 상세 · 실측 기둥).
 *
 * ## 이 테스트가 있는 이유
 *
 * 보정 루프는 **여기서만** 시작된다. 실점수가 한 건도 안 들어오면 환산 계수는 영원히
 * "표본 부족 — 판단 불가"고, ±5점 목표는 판정조차 못 한다. 그래서 이 입력 경로는
 * 화면 장식이 아니라 **엔진의 유일한 입력구**다.
 *
 * 그만큼 **틀린 값이 들어가면 엔진이 그 틀린 값으로 보정된다.** 그래서 이 파일이
 * 지키는 것은 "예쁘게 입력되나"가 아니라 다음 넷이다.
 *
 *   1. 붙일 예측이 없는 학생(미응시)에게는 입력 자리를 주지 않는다 — 서버가 422 로
 *      거절할 요청을 화면이 만들어 내지 않는다.
 *   2. 저장 즉시 **잔차가 그 자리에 보인다.** 88 을 예측했는데 8 을 잘못 치면
 *      `−80 빗나감` 이 바로 눈에 띈다. 오타를 나중에 발견하면 이미 보정이 오염된다.
 *   3. 저장이 실패하면 **입력값을 잃지 않고 이유를 적는다.** 조용히 사라지면
 *      원장은 저장된 줄 안다.
 *   4. 잘못 넣은 점수를 **고칠 수 있다.** API 가 (run, student) 유일이라 재저장은
 *      갱신이다 — 화면도 그 사실을 쓸 수 있게 열어 둬야 한다.
 *
 * 확정 근거: 05-design-system.md §8.7 `[확정 — T7.0 Wire]` 의 회차 상세 —
 * 실측 기둥 안 학생 행에 `[입력]` 이 있다. 이 파일은 그 자리를 그대로 구현한다.
 */
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { server } from "@/mocks/server";
import { RoundDetail } from "@/components/exam/RoundDetail";
import { ROUND_JEONGHWA_ID } from "@/mocks/data/predictions";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 7, 15, 9, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
});

async function renderDetail() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<RoundDetail roundId={ROUND_JEONGHWA_ID} />);
  await screen.findByRole("rowheader", { name: "이서준" });
  return user;
}

/** 학생 이름으로 그 행을 집는다 — 표에서 원장이 실제로 찾는 방식과 같다. */
function rowOf(name: string): HTMLElement {
  const cell = screen.getByRole("rowheader", { name });
  return cell.closest("tr") as HTMLElement;
}

/** 저장 요청 본문을 받아 적는 핸들러. 응답은 호출부가 정한다. */
function captureSave(respond?: () => Response) {
  const seen: Array<{ runId: string; body: unknown }> = [];
  server.use(
    http.post("/api/predictions/:id/actual", async ({ request, params }) => {
      seen.push({ runId: String(params.id), body: await request.json() });
      return (
        respond?.() ??
        HttpResponse.json({ data: { scores: [], residual: null } })
      );
    }),
  );
  return seen;
}

describe("[T7.15] 실점수 입력 — 자리", () => {
  it("아직 점수가 없는 응시 학생 행에 입력 자리를 준다", async () => {
    await renderDetail();
    expect(
      within(rowOf("이서준")).getByRole("button", { name: "실점수 입력" }),
    ).toBeInTheDocument();
  });

  it("🔴 미응시 학생에게는 입력 자리를 주지 않는다 — 서버가 거절할 요청을 만들지 않는다", async () => {
    await renderDetail();
    // 박지호는 이 회차에 응시하지 않는다. 예측이 없으니 붙일 대상도 없다.
    expect(
      within(rowOf("박지호")).queryByRole("button", { name: "실점수 입력" }),
    ).not.toBeInTheDocument();
    // 사유는 예측 쪽에 한 번만 적힌다 — 실측 칸까지 "미응시"를 또 쓰면 잡음이다.
    expect(within(rowOf("박지호")).getAllByText("미응시")).toHaveLength(1);
  });

  it("예상 점수를 못 낸 학생도 실점수는 넣을 수 있다 — 실제 결과는 언제나 근거다", async () => {
    await renderDetail();
    // 최수아는 응답 표본이 부족해 예측을 못 냈지만 시험은 봤다.
    expect(
      within(rowOf("최수아")).getByRole("button", { name: "실점수 입력" }),
    ).toBeInTheDocument();
  });
});

describe("[T7.15] 실점수 입력 — 저장", () => {
  it("친 점수를 그 학생 것으로 보낸다", async () => {
    const seen = captureSave();
    const user = await renderDetail();

    await user.click(
      within(rowOf("이서준")).getByRole("button", { name: "실점수 입력" }),
    );
    await user.type(
      within(rowOf("이서준")).getByRole("spinbutton", { name: /이서준/ }),
      "91{Enter}",
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].runId).toBe(ROUND_JEONGHWA_ID);
    expect(seen[0].body).toMatchObject({
      scores: [{ actualScore: 91 }],
    });
  });

  it("소수 점수 87.5 도 반올림하지 않고 그대로 보낸다", async () => {
    // 수행·서술형 부분점수가 있으면 내신 점수는 소수가 된다. 잘라 보내면
    // 그 오차만큼 잔차가 오염된다 (적대적 리뷰 ③ ADV-10 에서 확인한 경로).
    const seen = captureSave();
    const user = await renderDetail();

    await user.click(
      within(rowOf("이서준")).getByRole("button", { name: "실점수 입력" }),
    );
    await user.type(
      within(rowOf("이서준")).getByRole("spinbutton", { name: /이서준/ }),
      "87.5{Enter}",
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].body).toMatchObject({
      scores: [{ actualScore: 87.5 }],
    });
  });

  it("🔴 저장되면 그 자리에서 잔차가 보인다 — 오타를 나중에 발견하면 늦다", async () => {
    captureSave();
    const user = await renderDetail();

    await user.click(
      within(rowOf("이서준")).getByRole("button", { name: "실점수 입력" }),
    );
    await user.type(
      within(rowOf("이서준")).getByRole("spinbutton", { name: /이서준/ }),
      "91{Enter}",
    );

    // 예측 88 · 구간 80~93 → 실제 91 은 구간 안이다.
    const row = await screen.findByRole("row", { name: /이서준/ });
    expect(row).toHaveTextContent("91");
    expect(row).toHaveTextContent("적중");
  });

  it("🔴 크게 빗나가면 빗나갔다고 적는다 — 8 과 88 을 눈으로 가를 수 있어야 한다", async () => {
    captureSave();
    const user = await renderDetail();

    await user.click(
      within(rowOf("이서준")).getByRole("button", { name: "실점수 입력" }),
    );
    await user.type(
      within(rowOf("이서준")).getByRole("spinbutton", { name: /이서준/ }),
      "8{Enter}",
    );

    const row = await screen.findByRole("row", { name: /이서준/ });
    expect(row).toHaveTextContent("빗나감");
  });

  it("🔴 저장이 실패하면 이유를 적고 입력값을 잃지 않는다", async () => {
    captureSave(() =>
      HttpResponse.json(
        { error: { code: "CONFLICT", message: "이미 마감된 회차입니다." } },
        { status: 409 },
      ),
    );
    const user = await renderDetail();

    await user.click(
      within(rowOf("이서준")).getByRole("button", { name: "실점수 입력" }),
    );
    const input = within(rowOf("이서준")).getByRole("spinbutton", {
      name: /이서준/,
    });
    await user.type(input, "91{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "이미 마감된 회차입니다.",
    );
    expect(
      within(rowOf("이서준")).getByRole("spinbutton", { name: /이서준/ }),
    ).toHaveValue(91);
  });

  it("0~100 밖은 보내지 않는다", async () => {
    const seen = captureSave();
    const user = await renderDetail();

    await user.click(
      within(rowOf("이서준")).getByRole("button", { name: "실점수 입력" }),
    );
    await user.type(
      within(rowOf("이서준")).getByRole("spinbutton", { name: /이서준/ }),
      "150{Enter}",
    );

    expect(seen).toHaveLength(0);
    expect(await screen.findByRole("alert")).toHaveTextContent("0");
  });

  it("빈 값으로 저장하지 않는다", async () => {
    const seen = captureSave();
    const user = await renderDetail();

    await user.click(
      within(rowOf("이서준")).getByRole("button", { name: "실점수 입력" }),
    );
    await user.keyboard("{Enter}");

    expect(seen).toHaveLength(0);
  });
});

describe("[T7.15] 실점수 입력 — 고치기", () => {
  it("🔴 이미 넣은 점수를 고칠 수 있다 — 재저장은 갱신이다", async () => {
    const seen = captureSave();
    const user = await renderDetail();

    await user.click(
      within(rowOf("이서준")).getByRole("button", { name: "실점수 입력" }),
    );
    await user.type(
      within(rowOf("이서준")).getByRole("spinbutton", { name: /이서준/ }),
      "91{Enter}",
    );

    const fix = await within(rowOf("이서준")).findByRole("button", {
      name: "실점수 고치기",
    });
    await user.click(fix);
    const input = within(rowOf("이서준")).getByRole("spinbutton", {
      name: /이서준/,
    });
    await user.clear(input);
    await user.type(input, "84{Enter}");

    expect(seen).toHaveLength(2);
    expect(seen[1].body).toMatchObject({ scores: [{ actualScore: 84 }] });
  });

  it("Esc 로 물리면 저장하지 않는다", async () => {
    const seen = captureSave();
    const user = await renderDetail();

    await user.click(
      within(rowOf("이서준")).getByRole("button", { name: "실점수 입력" }),
    );
    await user.type(
      within(rowOf("이서준")).getByRole("spinbutton", { name: /이서준/ }),
      "91",
    );
    await user.keyboard("{Escape}");

    expect(seen).toHaveLength(0);
    expect(
      within(rowOf("이서준")).getByRole("button", { name: "실점수 입력" }),
    ).toBeInTheDocument();
  });
});

describe("[T7.15] 어포던스 (D-30)", () => {
  it("행 자체는 눌리지 않는다 — 누르는 것은 버튼뿐이다", async () => {
    await renderDetail();
    const row = rowOf("이서준");
    expect(row.className).not.toMatch(/cursor-pointer/);
    expect(row.className).not.toMatch(/hover:bg-/);
    expect(row.getAttribute("onclick")).toBeNull();
  });
});
