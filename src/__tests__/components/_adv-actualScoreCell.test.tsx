/**
 * 적대적 리뷰 ③ — 재현 전용. 실점수 입력 칸(ActualScoreCell)이 실제로 어떻게 구는지 찍는다.
 * 제품 코드는 한 줄도 고치지 않았다.
 */
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function rowOf(name: string): HTMLElement {
  return screen.getByRole("rowheader", { name }).closest("tr") as HTMLElement;
}

/** 저장 요청을 세는 핸들러. `hold` 를 주면 그 promise 가 풀릴 때까지 응답을 미룬다. */
function captureSave(hold?: Promise<void>) {
  const seen: unknown[] = [];
  server.use(
    http.post("/api/predictions/:id/actual", async ({ request }) => {
      seen.push(await request.json());
      if (hold) await hold;
      return HttpResponse.json({ data: { scores: [], residual: null } });
    }),
  );
  return seen;
}

async function openEditor(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(
    within(rowOf(name)).getByRole("button", { name: "실점수 입력" }),
  );
  return within(rowOf(name)).getByRole("spinbutton", {
    name: new RegExp(name),
  }) as HTMLInputElement;
}

describe("[ADV-6] 브라우저가 못 읽는 입력 — Enter 를 쳐도 아무 일도 안 일어난다", () => {
  it("전각숫자 '９１' 를 넣고 Enter — 요청도 없고 오류 문구도 없다", async () => {
    const seen = captureSave();
    const user = await renderDetail();
    const input = await openEditor(user, "이서준");

    // <input type=number> 의 value sanitization: 유효한 부동소수점 수가 아니면 "".
    fireEvent.change(input, { target: { value: "９１" } });
    console.log("[ADV-6] onChange 후 input.value =", JSON.stringify(input.value));

    fireEvent.keyDown(input, { key: "Enter" });
    await Promise.resolve();

    const row = rowOf("이서준");
    console.log("[ADV-6] 요청 수 =", seen.length);
    console.log("[ADV-6] alert =", within(row).queryByRole("alert")?.textContent ?? "(없음)");
    console.log("[ADV-6] 행 문구 =", JSON.stringify(row.textContent));

    expect(seen).toHaveLength(0); // 저장 안 됨
    expect(within(row).queryByRole("alert")).toBeNull(); // 이유도 안 알려줌
  });

  it("'--5' 도 마찬가지 — 조용히 무반응", async () => {
    const seen = captureSave();
    const user = await renderDetail();
    const input = await openEditor(user, "이서준");

    fireEvent.change(input, { target: { value: "--5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await Promise.resolve();

    console.log("[ADV-6b] 요청 수 =", seen.length, "· value =", JSON.stringify(input.value));
    expect(seen).toHaveLength(0);
    expect(within(rowOf("이서준")).queryByRole("alert")).toBeNull();
  });

  it("사람처럼 '8,5' 를 치면 85 가 저장된다 (8.5 를 치려던 것이다)", async () => {
    const seen = captureSave();
    const user = await renderDetail();
    const input = await openEditor(user, "이서준");

    await user.type(input, "8,5{Enter}");
    await waitFor(() => expect(seen).toHaveLength(1));
    console.log("[ADV-6c] 보낸 본문 =", JSON.stringify(seen[0]));
  });
});

describe("[ADV-7] 저장이 끝나면 포커스가 사라진다", () => {
  it("Enter 저장 후 활성 요소가 document.body 로 떨어진다", async () => {
    captureSave();
    const user = await renderDetail();
    const input = await openEditor(user, "이서준");
    expect(document.activeElement).toBe(input);

    await user.type(input, "91{Enter}");
    await screen.findByText("+3 적중");

    console.log(
      "[ADV-7] 저장 후 activeElement =",
      document.activeElement?.tagName,
      JSON.stringify(document.activeElement?.textContent?.slice(0, 30)),
    );
    expect(document.activeElement).toBe(document.body);
  });
});

describe("[ADV-8] 저장 중 Enter 를 또 치면", () => {
  it("요청이 몇 번 나가나", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const seen = captureSave(hold);
    const user = await renderDetail();
    const input = await openEditor(user, "이서준");

    await user.type(input, "91");
    fireEvent.keyDown(input, { key: "Enter" });
    // 실제 브라우저에서 두 번째 Enter 가 이 input 에 닿는지를 가르는 것은 `disabled` 다.
    console.log("[ADV-8] 1회 후 input.disabled =", input.disabled);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));

    console.log("[ADV-8] 연속 Enter 3회 → 요청 수 =", seen.length);
    console.log("[ADV-8] 저장 중 activeElement =", document.activeElement?.tagName);
    release();
    await screen.findByText("+3 적중");
  });

  it("userEvent 로 사람처럼 연타하면 (focus 를 따라간다)", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const seen = captureSave(hold);
    const user = await renderDetail();
    const input = await openEditor(user, "이서준");

    await user.type(input, "91");
    await user.keyboard("{Enter}{Enter}{Enter}");
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    console.log(
      "[ADV-8b] userEvent 연타 → 요청 수 =",
      seen.length,
      "· disabled =",
      input.disabled,
      "· activeElement =",
      document.activeElement?.tagName,
    );
    release();
    await screen.findByText("+3 적중");
  });
});

describe("[ADV-9] 여러 행을 동시에 열면", () => {
  it("앞 행의 입력은 저장되지 않은 채 그대로 남는다", async () => {
    const seen = captureSave();
    const user = await renderDetail();

    const a = await openEditor(user, "이서준");
    fireEvent.change(a, { target: { value: "91" } });

    const b = await openEditor(user, "최수아");
    fireEvent.change(b, { target: { value: "70" } });
    fireEvent.keyDown(b, { key: "Enter" });
    await waitFor(() => expect(seen).toHaveLength(1));

    const stillOpen = within(rowOf("이서준")).queryByRole("spinbutton", {
      name: /이서준/,
    }) as HTMLInputElement | null;
    console.log(
      "[ADV-9] 앞 행 편집칸 =",
      stillOpen ? `열려 있음(value=${stillOpen.value})` : "닫힘",
      "· 저장 요청 수 =",
      seen.length,
      "· 보낸 것 =",
      JSON.stringify(seen[0]),
    );
  });
});

describe("[ADV-10] 소수 점수", () => {
  it("87.5 는 그대로 저장된다", async () => {
    const seen = captureSave();
    const user = await renderDetail();
    const input = await openEditor(user, "이서준");

    await user.type(input, "87.5{Enter}");
    await waitFor(() => expect(seen).toHaveLength(1));
    console.log("[ADV-10] 본문 =", JSON.stringify(seen[0]));
    console.log(
      "[ADV-10] 잔차 칸 =",
      JSON.stringify(
        Array.from(rowOf("이서준").querySelectorAll("td")).map((td) => td.textContent),
      ),
    );
  });
});
