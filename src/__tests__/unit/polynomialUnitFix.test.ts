/**
 * 🟢 회귀 가드 — 중2 「다항식의 곱셈과 나눗셈」(J20108) 재배정 규칙.
 *
 * ## 왜 이 파일이 있는가
 *
 * 이 단원은 **제 문항이 0개**였다. 문항이 없어서가 아니라 옆 소단원에 앉아 있었다
 * (J20107 다항식의 덧셈과 뺄셈에 85행). 규칙을 만들며 함정 셋에 실제로 걸렸고,
 * 셋 다 **표본을 눈으로 봐서** 나왔다. 그 셋을 여기서 잠근다 —
 * 규칙을 손보다 하나만 되돌아가도 빨개져야 한다.
 */
import { describe, expect, it } from "vitest";

import {
  isPolyTimesMono,
  mergeLedgerRows,
  REVIEWED_EXCLUDE,
  SOURCE_UNITS,
  stemOf,
} from "../../../scripts/classify/apply-polynomial-unit-fix";

describe("무엇이 곱해지는가 — 계수와 단항식을 가른다", () => {
  it("괄호 앞에 **문자**가 있으면 J20108 이다", () => {
    expect(isPolyTimesMono("$3a(a-2b+3c)$를 바르게 전개한 것은?")).toBe(true);
  });

  it("괄호 앞이 **계수뿐**이면 덧셈·뺄셈 쪽이다 — 안 옮긴다", () => {
    // 중2 「다항식의 덧셈과 뺄셈」의 분배법칙. 여기까지 가져오면 J20107 이 텅 빈다.
    expect(isPolyTimesMono("$3(2x^{2}+5x-4)-4(3x^{2}-x-4)$ 를 계산하면?")).toBe(
      false,
    );
  });

  it("(다항식)÷(문자를 포함한 단항식)은 J20108 이다", () => {
    expect(isPolyTimesMono("$(12x^{2}y^{3}-4xy)÷4xy$ 를 계산하면?")).toBe(true);
  });

  it("(다항식)÷(수)는 덧셈·뺄셈 쪽이다", () => {
    expect(isPolyTimesMono("$(6x+3y)÷3$ 을 계산하면?")).toBe(false);
  });

  it("(다항식)×(다항식)은 **중3 곱셈공식**이라 뺀다", () => {
    // 앞에 단항식이 붙어 있어도 뒤가 (다항식)(다항식)이면 중3이다.
    // (이 모양이 앞의 「문자 계수」 규칙에도 걸리므로, 그 가드가 없으면 딸려 온다.)
    expect(isPolyTimesMono("$2a(a+1)(a-1)$ 을 전개하면?")).toBe(false);
    expect(isPolyTimesMono("$(x+2)(x-5)$ 를 전개하면?")).toBe(false);
  });
});

describe("함정 셋 — 전부 표본을 눈으로 봐서 나왔다", () => {
  /**
   * ⑴ `(-2a^{2}b)` 는 괄호 안에 `-` 가 있지만 **음수 단항식**이다. 이걸 다항식으로
   *    읽으면 J20106 지수법칙 문항이 대거 딸려 온다(실측 128 → 114).
   */
  it("음수 단항식은 다항식이 아니다", () => {
    expect(
      isPolyTimesMono(
        "다음 식을 계산하시오. $6ab^{2}\\times (-2a^{2}b)\\div 4ab$",
      ),
    ).toBe(false);
  });

  /**
   * ⑵ 「다음 중 옳지 않은 것은?」류는 **보기마다 다른 단원의 식**이 들어 있다.
   *    본문 전체를 보면 지수법칙 문항이 다항식 문항으로 읽힌다(실측 114 → 100).
   */
  it("보기(선택지) 안의 식은 판정에 안 쓴다", () => {
    const content =
      "계산 결과가 옳지 않은 것은?\n1. $(9x^{2}+15x)÷3x=3x+5$\n2. $-xy(x^{2}-y)=-x^{3}y+xy^{2}$";
    expect(isPolyTimesMono(content)).toBe(false);
  });

  /** ⑶ 발문 안의 「보기」 상자도 같은 이유로 잘라 낸다(실측 100 → 96). */
  it("발문 안의 «보기» 상자를 잘라 낸다", () => {
    const content =
      "다음 <보기>에서 옳은 것만을 있는 대로 고른 것은? <보기> ㄱ. $x(2x-1)=2x^{2}-x$";
    expect(stemOf(content)).not.toContain("ㄱ.");
    expect(isPolyTimesMono(content)).toBe(false);
  });
});

describe("다른 단원 주제어가 있으면 그 단원 것이다", () => {
  it("부등식 속 분배법칙은 부등식 문항이다", () => {
    expect(
      isPolyTimesMono("부등식 $5x-3(x+4)>2$ 의 해를 수직선 위에 나타낸 것은?"),
    ).toBe(false);
  });

  it("순환소수 문항은 안 가져온다", () => {
    expect(
      isPolyTimesMono(
        "분수 $\\frac{6}{7}$ 을 소수로 나타내었을 때, 소숫점 아래 $n$ 번째 자리의 숫자를 $f(n)$ 이라 하자.",
      ),
    ).toBe(false);
  });

  /**
   * 실데이터 `J20107-BLD4`. ⑴은 다항식 나눗셈인데 ⑵가 「유한소수인지 순환소수인지
   * 판별」이라 **두 단원에 걸친 문항**이다. 주제어 가드가 없으면 통째로 옮겨진다 —
   * 이 규칙이 실제로 막는 유일한 자리라, 여기가 비면 그 가드는 장식이 된다.
   */
  it("두 단원에 걸친 문항은 안 옮긴다 — 주제어 가드가 실제로 막는 자리", () => {
    expect(
      isPolyTimesMono(
        "다음 등식에 대하여 물음에 답하시오. ($2xy-7x$)÷A×(-3xy3)=(-6xy)2 " +
          "⑴ 식 $A$ 를 구하시오. ⑵ $A$ 에서 $y$ 의 계수가 유한소수인지 순환소수인지 판별하시오.",
      ),
    ).toBe(false);
  });
});

describe("안전장치", () => {
  it("옮겨 오는 곳은 중2 「1. 수와 식」 안뿐이다 — 중3은 안 건드린다", () => {
    // 중3 J30201·J30203 에도 규칙에 걸리는 문항이 있지만(689건 중 10건) 그쪽은
    // 곱셈공식·인수분해 문항이라 제자리다. 범위를 넓히면 멀쩡한 것을 옮긴다.
    expect([...SOURCE_UNITS]).toEqual(["J20104", "J20106", "J20107"]);
    expect([...SOURCE_UNITS].some((u) => u.startsWith("J3"))).toBe(false);
  });

  it("눈으로 뺀 문항은 **근거와 함께** 적는다", () => {
    for (const [code, why] of Object.entries(REVIEWED_EXCLUDE)) {
      expect(code).toMatch(/^J\d{5}-/);
      expect(why.length).toBeGreaterThan(10);
    }
  });

  it("원장은 옛 행을 **안 지운다** — 지우면 되돌릴 수 없다", () => {
    const old = [
      {
        id: "a",
        code: "J20107-AAAA",
        fromUnitId: "u1",
        fromUnit: "J20107",
        toUnitId: "u2",
        head: "",
      },
    ];
    const next = [
      {
        id: "b",
        code: "J20107-BBBB",
        fromUnitId: "u1",
        fromUnit: "J20107",
        toUnitId: "u2",
        head: "",
      },
    ];
    expect(mergeLedgerRows(old, next).map((r) => r.id)).toEqual(["a", "b"]);
    // 같은 id 가 다시 와도 **처음 값**을 지킨다 — 되돌릴 목적지가 바뀌면 안 된다.
    expect(
      mergeLedgerRows(old, [{ ...next[0]!, id: "a", fromUnitId: "다른곳" }]),
    ).toEqual(old);
  });
});
