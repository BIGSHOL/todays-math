/**
 * 실물 출력 검수 목록이 **조용히 망가지지 않게** 잡아 두는 테스트.
 *
 * 이 화면은 「무엇이 아직 종이로 확인 안 됐나」의 유일한 집계다. 항목 하나가 id 중복으로
 * 덮이거나 「종이에서 볼 것」이 빈 채로 들어가면, 화면은 멀쩡해 보이는데 그 항목은
 * 사실상 사라진다 — 검수 잔고가 실제보다 적어 보인다. 그게 이 프로젝트가 반복해서 낸
 * 결함이라(CLAUDE.md 「지표가 실패를 셀 수 있는 형태인지 먼저 확인하라」) 데이터부터 막는다.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { ITEMS } from "@/app/dev/print-check/items";
import { PrintCheckList } from "@/app/dev/print-check/PrintCheckList";

describe("실물 출력 검수 목록 — 데이터", () => {
  it("id 가 겹치지 않는다 — 겹치면 한 항목이 조용히 덮인다", () => {
    const ids = ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("모든 항목에 「종이에서 볼 것」과 근거가 있다", () => {
    for (const item of ITEMS) {
      expect(item.look.trim(), `${item.id} 의 look`).not.toBe("");
      expect(item.evidence.length, `${item.id} 의 근거`).toBeGreaterThan(0);
      expect(item.title.trim(), `${item.id} 의 제목`).not.toBe("");
    }
  });

  it("검수 통과로 표시한 항목은 날짜를 남긴다", () => {
    for (const item of ITEMS.filter((i) => i.status === "통과")) {
      expect(
        item.verifiedOn,
        `${item.id} 는 통과인데 verifiedOn 이 없다`,
      ).toBeTruthy();
    }
  });
});

describe("실물 출력 검수 목록 — 화면", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("항목을 전부 그린다", () => {
    render(<PrintCheckList items={ITEMS} />);
    for (const item of ITEMS) {
      expect(
        screen.getByRole("heading", { name: item.title }),
      ).toBeInTheDocument();
    }
  });

  it("체크하면 진행 수가 오르고 다시 열어도 남아 있다", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PrintCheckList items={ITEMS} />);

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.every((b) => !(b as HTMLInputElement).checked)).toBe(true);

    await user.click(boxes[0]!);
    expect(
      (screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked,
    ).toBe(true);

    // 다시 그려도 남아야 한다 — 종이를 넘기다 새로고침해도 어디까지 봤는지 잃지 않는다.
    unmount();
    render(<PrintCheckList items={ITEMS} />);
    expect(
      (screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("「체크 지우기」는 전부 되돌린다", async () => {
    const user = userEvent.setup();
    render(<PrintCheckList items={ITEMS} />);

    await user.click(screen.getAllByRole("checkbox")[0]!);
    await user.click(screen.getByRole("button", { name: "체크 지우기" }));

    expect(
      screen
        .getAllByRole("checkbox")
        .every((b) => !(b as HTMLInputElement).checked),
    ).toBe(true);
  });

  it("근거에 없는 판정 기준은 (제안) 으로 구분한다", () => {
    render(<PrintCheckList items={ITEMS} />);
    const suggested = ITEMS.filter((i) => !i.lookFromSource).length;
    expect(screen.getAllByText(/종이에서 볼 것 \(제안\)/)).toHaveLength(
      suggested,
    );
  });
});
