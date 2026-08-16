/**
 * 적대적 리뷰 ③ — 프로브. `<input type="number">` 가 "브라우저가 못 읽는 입력"을 만났을 때
 * `event.target.value` 가 무엇인지 이 환경(jsdom)에서 실제로 찍어 본다.
 * HTML 표준의 value sanitization algorithm: 값이 유효한 부동소수점 수가 아니면 빈 문자열.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

function Probe() {
  const [seen, setSeen] = useState<string>("<none>");
  return (
    <div>
      <input
        aria-label="probe"
        type="number"
        onChange={(e) => setSeen(e.target.value)}
      />
      <output>{`[${seen}]`}</output>
    </div>
  );
}

const BAD = ["--5", "９１", "8,5", "1-2", "9 1", "abc"];

describe("[ADV-PROBE] type=number 의 bad input", () => {
  it("fireEvent.change 로 직접 넣으면 무엇이 보이나", () => {
    for (const raw of BAD) {
      const { unmount } = render(<Probe />);
      const input = screen.getByLabelText("probe") as HTMLInputElement;
      fireEvent.change(input, { target: { value: raw } });
      console.log(
        `[ADV-PROBE] 입력 ${JSON.stringify(raw)} → onChange value=${JSON.stringify(
          input.value,
        )} · 화면=${screen.getByRole("status", { hidden: true }).textContent}`,
      );
      unmount();
    }
    expect(true).toBe(true);
  });

  it("userEvent.type 으로 사람처럼 치면 무엇이 보이나", async () => {
    const user = userEvent.setup();
    for (const raw of BAD) {
      const { unmount } = render(<Probe />);
      const input = screen.getByLabelText("probe") as HTMLInputElement;
      await user.type(input, raw);
      console.log(
        `[ADV-PROBE/type] 입력 ${JSON.stringify(raw)} → value=${JSON.stringify(
          input.value,
        )} · 화면=${screen.getByRole("status", { hidden: true }).textContent}`,
      );
      unmount();
    }
    expect(true).toBe(true);
  });
});
