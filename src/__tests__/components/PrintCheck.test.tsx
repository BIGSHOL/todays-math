/**
 * 실물 출력 검수 목록이 **조용히 망가지지 않게** 잡아 두는 테스트.
 *
 * 이 화면은 「무엇이 아직 종이로 확인 안 됐나」의 유일한 집계다. 항목 하나가 id 중복으로
 * 덮이거나 「종이에서 볼 것」이 빈 채로 들어가면, 화면은 멀쩡해 보이는데 그 항목은
 * 사실상 사라진다 — 검수 잔고가 실제보다 적어 보인다. 그게 이 프로젝트가 반복해서 낸
 * 결함이라(CLAUDE.md 「지표가 실패를 셀 수 있는 형태인지 먼저 확인하라」) 데이터부터 막는다.
 */
import { existsSync } from "node:fs";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { ITEMS } from "@/app/dev/print-check/items";
import { PrintCheckList } from "@/app/dev/print-check/PrintCheckList";

describe("실물 출력 검수 목록 — 데이터", () => {
  /**
   * 적대적 리뷰가 실증했다 — 항목을 **통째로 지워도** 모든 시험이 초록이었다.
   * 「덮이는」 경로만 막고 「사라지는」 경로를 열어 뒀던 것이다. 검수 잔고가 조용히 줄면
   * 아무도 모른다. 항목을 늘리거나 줄이면 이 숫자도 같이 고쳐야 한다 — 그게 의도다.
   */
  it("항목 수가 바뀌면 알아차린다", () => {
    // 23: figure-fallback-mm 추가 (2026-08-21 — mm 를 **모르는** 그림 1,765자리가
    //     상한(70mm)=최대로 그려지던 것을 픽셀 환산으로 바꿨다. 1,565문항의 그림이
    //     실제로 작아진다. 「작아져서 안 읽히는가」는 종이에서만 확인된다).
    // 21: figure-raster-300dpi 추가 (2026-08-20 — 그림 1,344장을 300dpi 재크롭본으로
    //     바꿨다. **지면 크기는 안 바뀌고** 또렷함만 바뀐다. 종이에서만 확인된다).
    // 20: figure-blend-multiply 추가 (2026-08-20 — 그림의 흰 배경(#FFFFFF)이
    //     지면 종이색(#FCFCF8)과 달라 밝은 사각형으로 떠 보였다. 곱셈 혼합으로
    //     녹인다. 화면은 배경이 흰색이라 변화가 없고 **인쇄에서만** 눈에 띈다).
    // 19: figure-print-size-mm 추가 (2026-08-19 — 그림 크기를 픽셀이 아니라
    //     물리 크기(mm)로 정한다. 값이 들어오는 순간 그림 문항 전량의 지면 크기가
    //     바뀐다. 지금은 값이 0건이라 종이에 변화가 없다).
    // 18: inline-choice-repair-r2 추가 (D-58, 2026-08-19 — 한 줄에 붙어 있던 보기
    //     다섯이 처음 지면에 선다. 문항 높이가 커지므로 칸을 넘칠 수 있다).
    // 17: short-answer-badge 추가 (2026-08-19 — 단답형에 「단답형 n」 배지가
    //     처음 지면에 나간다. 원장님 확정: 서답형은 서술형으로 합치고 단답형은 그대로).
    // 16: figure-svg-inline 추가 (D-55, 2026-08-19 — figureSvg 가 처음 지면에 나간다)
    expect(ITEMS.length).toBe(23);
  });

  /**
   * 근거가 썩는 것도 조용하다 — 없는 파일을 가리켜도 초록이었다.
   * 커밋 해시·줄 번호는 못 보지만 **파일이 있는지**는 볼 수 있다.
   */
  it("근거가 가리키는 파일은 실재한다", () => {
    for (const item of ITEMS) {
      for (const ev of item.evidence) {
        const path = ev.split(/[\s:(]/)[0];
        if (!path.includes("/") || path.startsWith("커밋")) continue;
        expect(existsSync(path), `${item.id}: ${path}`).toBe(true);
      }
    }
  });

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
