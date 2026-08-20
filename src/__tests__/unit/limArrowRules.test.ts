/**
 * 🔴 `\lim_{x \Rightarrow 0}` — HWP `rarrow`(→)가 정본 변환기에서 **⇒** 로 갔다.
 *
 * ⇒ 는 «함의»이고 → 는 «가까워진다»다. 지면에 `lim_{x⇒0}` 로 찍힌다(실측 530자리).
 * 그런데 **전부 바꾸면 안 된다** — 밖의 451자리는 진짜 함의다.
 */
import { describe, expect, it } from "vitest";

import { fixLimArrow } from "../../../scripts/qa/limArrowRules";

describe("극한 아래첨자 안의 ⇒ 만 → 로", () => {
  it("`\\lim _{n\\Rightarrow \\infty }` → `\\to`", () => {
    const got = fixLimArrow("\\lim _{n\\Rightarrow \\infty }\\frac{a_{n}}{n}");
    expect(got.text).toBe("\\lim _{n\\to \\infty }\\frac{a_{n}}{n}");
    expect(got.fixed).toBe(1);
  });

  it("한 식에 극한이 둘이면 둘 다 바꾼다", () => {
    const got = fixLimArrow(
      "\\lim _{x\\Rightarrow -1}f(x)=\\lim _{x\\Rightarrow -1}g(x)",
    );
    expect(got.text).not.toContain("\\Rightarrow");
    expect(got.fixed).toBe(2);
  });

  /**
   * 🔴 중첩은 **아래첨자 안**에 있어야 검사가 된다. 처음엔
   * `\lim _{n\Rightarrow \infty }{\{a_n\}}` 로 썼는데, 그 아래첨자에는
   * 중괄호가 없어서 「중첩을 못 보게」 하는 변이가 **초록**이었다 —
   * 픽스처가 경계를 안 가르면 가드가 아니라 장식이다.
   */
  it("아래첨자 **안**에 중괄호가 한 겹 더 있어도 끝을 제대로 찾는다", () => {
    const got = fixLimArrow(
      "\\lim _{x\\Rightarrow \\frac{\\pi }{2}}\\tan x=\\infty",
    );
    expect(got.text).toBe("\\lim _{x\\to \\frac{\\pi }{2}}\\tan x=\\infty");
    expect(got.fixed).toBe(1);
  });

  /**
   * 🔴 위 검사만으로는 **중첩을 못 봐도 초록**이다 — ⇒ 가 중첩 **앞**에 있어서,
   *    아래첨자가 `\frac{\pi` 에서 일찍 끊겨도 그 조각 안에 ⇒ 가 그대로 있고
   *    나머지는 잘라 붙이므로 결과가 같다. 「중첩을 못 보게」 변이가 실제로
   *    초록이었다(2026-08-21). ⇒ 를 **중첩 뒤**에 두어야 경계가 갈린다.
   */
  it("🔴 ⇒ 가 중첩 **뒤**에 있어도 찾는다 — 여기가 중괄호 세기를 실제로 가른다", () => {
    const got = fixLimArrow("\\lim _{\\frac{1}{n}\\Rightarrow 0}a_{n}=L");
    expect(got.text).toBe("\\lim _{\\frac{1}{n}\\to 0}a_{n}=L");
    expect(got.fixed).toBe(1);
  });

  it("중첩된 아래첨자 **뒤**의 ⇒ 는 안 건드린다 — 끝을 잘못 찾으면 여기가 샌다", () => {
    const got = fixLimArrow(
      "\\lim _{x\\Rightarrow \\frac{\\pi }{2}}f(x)=1\\Rightarrow a=2",
    );
    expect(got.text).toBe(
      "\\lim _{x\\to \\frac{\\pi }{2}}f(x)=1\\Rightarrow a=2",
    );
    expect(got.fixed).toBe(1);
  });

  describe("🔴 극한 **밖**은 한 글자도 안 건드린다", () => {
    it.each([
      "명제 $q\\,\\,\\Rightarrow \\,\\,p$",
      "$(x+3)(x-2)<0 \\Rightarrow -3<x<2$",
      "$0.3x>2.4 \\Rightarrow x>8$",
      "$f\\,:\\,X\\,\\Rightarrow \\,X$",
    ])("%s", (src) => {
      const got = fixLimArrow(src);
      expect(got.text).toBe(src);
      expect(got.fixed).toBe(0);
    });

    it("같은 식에 극한 안과 밖이 **둘 다** 있으면 안쪽만 바꾼다", () => {
      const got = fixLimArrow(
        "$p\\Rightarrow q$이므로 $\\lim _{x\\Rightarrow 0}f(x)=1$",
      );
      expect(got.text).toBe("$p\\Rightarrow q$이므로 $\\lim _{x\\to 0}f(x)=1$");
      expect(got.fixed).toBe(1);
    });
  });

  it("바꿀 것이 없으면 원문 그대로 돌려준다", () => {
    const src = "\\lim _{x\\to 0}\\frac{\\sin x}{x}=1";
    expect(fixLimArrow(src).text).toBe(src);
    expect(fixLimArrow(src).fixed).toBe(0);
  });
});
