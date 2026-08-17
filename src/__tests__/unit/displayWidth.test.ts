/**
 * 🔴 RED → 🟢 GREEN — 표시 폭 측정 (시험지변환기 `_sol_seg_width` 이식).
 *
 * 원본: F:\시험지변환기\core\content_parser.py:330 `_sol_seg_width`
 * 왜 필요한가: 넘침 판정이 **원문 글자 수**를 세면 수식이 많은 문항을 실제보다 길게 본다
 * (`$\frac{1}{2}$` 는 13자지만 지면에서는 두 글자 폭). 렌더 폭에 가깝게 세야 한다.
 */
import { describe, expect, it } from "vitest";

import { displayWidth } from "@/lib/math/displayWidth";

describe("표시 폭 — 한글·전각은 2, 반각은 1", () => {
  it("한글은 글자당 2로 센다", () => {
    expect(displayWidth("가나다")).toBe(6);
  });

  it("영숫자·기호는 글자당 1로 센다", () => {
    expect(displayWidth("abc123")).toBe(6);
  });

  it("섞이면 각각 더한다", () => {
    expect(displayWidth("값은 3")).toBe(2 + 2 + 1 + 1); // 값은(4) + 공백(1) + 3(1)
  });
});

describe("표시 폭 — 수식은 원문이 아니라 글리프 근사로 센다", () => {
  it("구조 명령(frac)과 중괄호는 폭 0이다", () => {
    // "$\frac{1}{2}$" 는 원문 13자지만 지면에는 1과 2 두 글자만 보인다.
    expect(displayWidth("$\\frac{1}{2}$")).toBe(2);
  });

  it("첨자 기호(^ _)는 폭 0이다", () => {
    expect(displayWidth("$x^2$")).toBe(2);
  });

  // 원본의 실측 회귀(적대검증 2026-08-10): 모든 `\명령`을 0으로 세었더니 개행 뒤에도
  // 25.5%가 한계를 넘었다. **보이는 글리프**인 명령은 1로 세야 한다.
  it("실제로 보이는 기호 명령(\\triangle, \\pi)은 폭 0이 아니다", () => {
    expect(displayWidth("$\\triangle$")).toBe(1);
    expect(displayWidth("$\\pi$")).toBe(1);
    expect(displayWidth("$\\times$")).toBe(1);
    expect(displayWidth("$\\angle$")).toBe(1);
  });

  it("수식 밖 텍스트와 수식을 함께 센다", () => {
    // "삼각형 " = 6+1, "$\triangle ABC$" = x + " ABC" = 1+4
    expect(displayWidth("삼각형 $\\triangle ABC$")).toBe(6 + 1 + 1 + 4);
  });

  it("원문 글자 수보다 훨씬 작게 나온다 — 이게 이식한 이유다", () => {
    const text = "$\\dfrac{a+b}{c+d}$";
    expect(text.length).toBe(18);
    expect(displayWidth(text)).toBe(6); // a+bc+d
  });
});
