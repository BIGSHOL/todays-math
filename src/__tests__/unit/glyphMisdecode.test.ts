/**
 * 🟢 HWP 글자 오독 되돌리기 — **진짜 기호를 건드리면 안 된다.**
 *
 * 원장님이 종이에서 `70≠`(=70%)·`sin ↔`(=sin θ)를 찾아 주셨다(2026-08-20).
 * 이 부류가 위험한 이유는 **못 푸는 게 아니라 다르게 푼다**는 것이다 —
 * 에러도 안 나고 지면도 멀쩡해 보인다.
 *
 * 그래서 이 검사가 지키는 것은 「고치나」보다 **「안 고쳐야 할 것을 안 고치나」**다.
 */
import { describe, expect, it } from "vitest";

import { fixGlyphs, looksGenuine } from "../../lib/problem/glyphMisdecode";

describe("꼬리 글자를 되돌린다", () => {
  it("`70≠` 는 `70%` 다", () => {
    expect(fixGlyphs("기숙사생의 $70≠$ 가 남학생").text).toBe(
      "기숙사생의 $70%$ 가 남학생",
    );
  });

  it("`90≅` 는 `90°` 다", () => {
    expect(fixGlyphs("$∠$ C $=90≅$ 인 직각삼각형").text).toBe(
      "$∠$ C $=90°$ 인 직각삼각형",
    );
  });

  it("`sin ↔` 는 `sin θ` 다", () => {
    expect(fixGlyphs("sin $↔=\\frac{1}{3}$").text).toBe("sin $θ=\\frac{1}{3}$");
  });

  it("`90≅-x` 는 `90°-x` 다 — 뒤의 `-` 는 오른쪽 항이 아니라 다음 연산자다", () => {
    // 🔴 여기를 「관계 기호」로 읽어 실제로 8건을 놓칠 뻔했다.
    expect(fixGlyphs("cos $(90≅-x)$").text).toBe("cos $(90°-x)$");
  });
});

describe("🔴 **진짜 기호는 안 건드린다**", () => {
  it.each([
    ["$y≠0$ 일 때", "오른쪽에 항이 있다"],
    ["$a≠-3$ 거나 $a≠2$", "음수도 오른쪽 항이다"],
    ["$p:a≠b$ 이고 $b≠0$", "변수도 오른쪽 항이다"],
    ["$x≠\\frac{1}{2}$", "LaTeX 명령도 오른쪽 항이다"],
  ])("%s — %s", (text) => {
    expect(fixGlyphs(text).text).toBe(text);
  });

  it("도형 사이 합동이 있으면 **그 문항을 통째로** 건너뛴다", () => {
    const t = "$△ABC≅△DEF$ 이고 $∠A=60≅$";
    expect(looksGenuine(t)).toBe(true);
    expect(fixGlyphs(t).text).toBe(t);
  });

  it("명제 사이 동치가 있으면 통째로 건너뛴다", () => {
    const t = "$p↔q$ 가 참이고 sin $↔$";
    expect(looksGenuine(t)).toBe(true);
    expect(fixGlyphs(t).text).toBe(t);
  });

  it("고칠 게 없으면 **문자열이 그대로**다 — 4만여 건의 지면이 안 바뀐다", () => {
    const t = "$x+y=3$ 일 때 $x$ 의 값은?";
    expect(fixGlyphs(t).text).toBe(t);
    expect(fixGlyphs(t).counts).toEqual({});
  });
});

describe("자리별로 센다", () => {
  it("한 문항에 꼬리와 진짜가 섞이면 **꼬리만** 고친다", () => {
    const got = fixGlyphs("$20≠$ 를 할인, 단 $y≠0$");
    expect(got.text).toBe("$20%$ 를 할인, 단 $y≠0$");
    expect(got.counts).toEqual({ "≠": 1 });
  });

  it("고친 자리 수를 돌려준다", () => {
    expect(fixGlyphs("$45≅$ 와 $60≅$ 와 sin $↔$").counts).toEqual({
      "≅": 2,
      "↔": 1,
    });
  });
});
