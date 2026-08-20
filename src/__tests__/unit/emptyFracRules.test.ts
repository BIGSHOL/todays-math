/**
 * 🔴 **빈 분수는 「분자를 잃은 것」이 아니라 분수 밖에 남겨 둔 것이다.**
 *
 * 지면 전처리가 `\frac{}{b}` 를 `\frac{0}{b}` 로 바꾸고 있었다(KaTeX parse
 * error 를 막으려던 밴드에이드). 들어온 자료에 대고 쓰면 **숫자를 지어낸다** —
 * `87\frac{}{2}` 가 종이에 `87·0/2` 로 찍힌다. 정답은 87/2 다.
 *
 * 여기서 잠그는 것:
 *   1. `overline` 흉터(`\frac{}{line}`)를 **선분으로** 되돌린다
 *   2. 앞의 한 덩어리를 분자로 끌어온다
 *   3. 🔴 **합의 한 항이면 손대지 않는다** — 끌어오면 평균 120/10 이 `…+4/10` 이 된다
 *   4. 🔴 **분자가 될 수 없는 모양이면 손대지 않는다** — `lim t→1(` 이 분자가 되면 안 된다
 *   5. 분모의 중괄호가 두 겹이어도 본다
 */
import { describe, expect, it } from "vitest";

import { fixEmptyFrac } from "../../../scripts/qa/emptyFracRules";

describe("㉠ overline 흉터 — 선분이 분수가 됐던 것", () => {
  it("`\\frac{}{line}\\mathrm{A}B\\mathit{\\,}` → 선분 AB", () => {
    const got = fixEmptyFrac("\\frac{}{line}\\mathrm{A}B\\mathit{\\,}=2");
    expect(got.text).toBe("\\overline{\\mathrm{AB}}=2");
    expect(got.left).toBe(0);
  });

  it("두 글자가 한꺼번에 `\\mathrm{AC}` 로 든 것도 본다", () => {
    expect(fixEmptyFrac("\\frac{}{line}\\mathrm{AC}\\mathit{}=5").text).toBe(
      "\\overline{\\mathrm{AC}}=5",
    );
  });

  it("홑글자(표본평균 x̄)도 선분으로 되돌린다", () => {
    expect(fixEmptyFrac("\\frac{}{line}x=500").text).toBe("\\overline{x}=500");
  });

  it("🔴 `\\mathit{}` 에 **값이 들어 있으면 안 삼킨다** — 삼키면 수를 잃는다", () => {
    const got = fixEmptyFrac("\\frac{}{line}\\mathrm{H}D\\mathit{9}");
    expect(got.text).toContain("9");
  });
});

describe("㉡ 분자를 앞에서 끌어온다", () => {
  it.each([
    ["87\\frac{}{2}", "\\frac{87}{2}"],
    ["2\\sqrt{5}\\frac{}{5}", "\\frac{2\\sqrt{5}}{5}"],
    ["4!\\frac{}{2}", "\\frac{4!}{2}"],
    ["(2+\\sqrt{2})\\pi \\frac{}{4}", "\\frac{(2+\\sqrt{2})\\pi }{4}"],
  ])("%s → %s", (from, to) => {
    const got = fixEmptyFrac(from);
    expect(got.text).toBe(to);
    expect(got.left).toBe(0);
  });

  it("분모가 두 겹 중괄호여도 본다 — 한 겹만 보면 이 자리를 **아예 못 본다**", () => {
    const got = fixEmptyFrac(
      "\\sqrt{21}\\frac{}{\\left( \\frac{\\sqrt{3}}{2}\\right)}",
    );
    expect(got.text).toBe(
      "\\frac{\\sqrt{21}}{\\left( \\frac{\\sqrt{3}}{2}\\right)}",
    );
    expect(got.left).toBe(0);
  });
});

describe("🔴 못 가르는 것은 **고치지 않는다**", () => {
  it("합의 한 항이면 손대지 않는다 — 평균 120/10 이 «…+4/10» 이 되면 안 된다", () => {
    const src = "4+8+9+4+10+5+6+9+61+4\\frac{}{10}";
    const got = fixEmptyFrac(src);
    expect(got.text).toBe(src); // 한 글자도 안 바뀐다
    expect(got.left).toBe(1);
  });

  it("맨 앞의 홑부호는 합이 아니다 — 끌어온다", () => {
    expect(fixEmptyFrac("-\\sqrt{5}\\frac{}{4}").text).toBe(
      "-\\frac{\\sqrt{5}}{4}",
    );
  });

  it("🔴 `wholePrefix` 를 켜도 **분자가 될 수 없는 모양**은 막는다", () => {
    // 실측: `lim t→1(\frac{}{t^2-1}` 에 그냥 대면 `\frac{t→1(}{t^2-1}` 이 된다.
    // 뜻이 없는데 KaTeX 는 에러를 안 낸다 — 그럴듯한 헛것이다.
    for (const src of [
      "t→1(\\frac{}{t^{2}-1}",
      "n→∞\\frac{}{S_{n}}",
      "\\frac{}{2024×2025}",
    ]) {
      const got = fixEmptyFrac(src, { wholePrefix: true });
      expect(got.text, src).toBe(src);
      expect(got.left, src).toBe(1);
    }
  });

  it("`wholePrefix` 를 켜면 검산으로 확인한 합은 끌어온다", () => {
    expect(
      fixEmptyFrac("4+8+9+4+10+5+6+9+61+4\\frac{}{10}", { wholePrefix: true })
        .text,
    ).toBe("\\frac{4+8+9+4+10+5+6+9+61+4}{10}");
  });

  it("윗자리 관계(`=`)가 있으면 그 **뒤**부터가 분자다", () => {
    expect(
      fixEmptyFrac("x=a-2+b+3\\frac{}{2}", { wholePrefix: true }).text,
    ).toBe("x=\\frac{a-2+b+3}{2}");
  });
});

describe("🔴 수를 잃지 않는다", () => {
  it("고친 뒤에도 원래 있던 수가 전부 남는다", () => {
    for (const src of [
      "87\\frac{}{2}",
      "3\\sqrt{10}\\frac{}{10}",
      "\\frac{}{line}\\mathrm{B}D\\mathit{\\,}=10",
    ]) {
      const got = fixEmptyFrac(src, { wholePrefix: true });
      for (const n of src.match(/\d+/g) ?? [])
        expect(got.text, `${src} 에서 ${n}`).toContain(n);
    }
  });
});
