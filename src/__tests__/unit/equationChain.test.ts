/**
 * 계산 과정 다단 등식 — `= … = … = …` 를 단계마다 줄바꿈한다.
 *
 * 원장님(2026-08-18): "이런 문제는 좀 심각하네. 다음 계산 과정이 너무 줄바꿈 하나도
 * 처리 안되어있음"
 *
 * ── 이 규칙의 위험은 «자르면 안 되는 것»이다 ───────────────────────────────
 * 처음엔 「한 수식에 `=` 가 2개 이상이면 계산 과정」으로 셌더니 2,724건(5.78%)이
 * 나왔다. 표본을 눈으로 보니 **거의 전부 오탐**이었다:
 *   · `$y=ax\,,~y=bx$`               두 그래프의 식을 나열
 *   · `$ax+y=-2,10x-2y=-3$`          연립방정식
 *   · `$\overline{AE}=\overline{BF}=\overline{CG}=a$`  주어진 조건(한 줄이 옳다)
 *   · `$2^{x}=5^{y}=10$`             주어진 조건
 * 여기서 줄을 바꾸면 **문제가 달라 보인다.** 그래서 세 가지를 동시에 요구한다:
 *   ① 쉼표로 갈리지 않고 **잇따르는** `=` (나열·연립은 쉼표가 가른다)
 *   ② 그 `=` 가 괄호·중괄호·`\left…\right` **밖**에 있다 (`(x=0,1,2)` 는 첨언이다)
 *   ③ 수식이 문항 열보다 **넓다** — 한 줄에 들어가는 식은 이미 멀쩡하다.
 *      본문과 독립인 근거다: 안 넘치면 바꿀 이유가 없다.
 * 그리고 HWP 변환 잔재가 남은 수식은 **건드리지 않는다** — 이미 깨진 것을
 * 자르면 더 깨진다.
 */
import { describe, expect, it } from "vitest";

import { isWorkedProcess, splitEquationChain } from "@/lib/math/equationChain";

/** 「계산 과정이다」라고 말한 문항 안에서 자르는 경우. */
const inProcess = { workedProcess: true };

describe("splitEquationChain — 자를 것", () => {
  it("유한소수 변형 과정을 단계마다 자른다 (실측 3f425023)", () => {
    const span =
      "$\\frac{9}{250}=\\frac{9}{2\\times 5^{3}}=\\frac{9\\times a}{2\\times 5^{3}\\times a}=\\frac{b}{10^{3}}=c$";
    expect(splitEquationChain(span, inProcess)).toEqual([
      "$\\frac{9}{250}$",
      "$=\\frac{9}{2\\times 5^{3}}$",
      "$=\\frac{9\\times a}{2\\times 5^{3}\\times a}$",
      "$=\\frac{b}{10^{3}}$",
      "$=c$",
    ]);
  });

  it("맨 앞이 `=` 로 시작해도 자른다 (실측 1ea935f1)", () => {
    const span =
      "$=\\frac{500^{2}}{500}+\\frac{\\square \\,(다)\\,\\times 500}{500}=500+\\square \\,(라)\\,\\,=\\,\\square \\,(마)\\,$";
    const parts = splitEquationChain(span, inProcess);
    expect(parts).not.toBeNull();
    expect(parts).toHaveLength(3);
    expect(parts![0]!.startsWith("$=")).toBe(true);
    // 조각마다 `$` 짝이 맞아야 한다 — 안 맞으면 KaTeX 가 통째로 깨진다.
    for (const p of parts!) expect(p.match(/\$/g)).toHaveLength(2);
  });
});

describe("splitEquationChain — 자르면 안 되는 것", () => {
  it("쉼표로 나열된 여러 식은 자르지 않는다", () => {
    expect(
      splitEquationChain("$y=ax\\,,~y=bx\\,,~y=cx\\,,~y=dx\\,,~y=ex\\,,~y=fx$"),
    ).toBeNull();
  });

  it("연립방정식은 자르지 않는다", () => {
    expect(
      splitEquationChain(
        "$ax+y=-2,10x-2y=-3,3x+5y=-7,2x-9y=11,7x+y=-4,x-y=9$",
        inProcess,
      ),
    ).toBeNull();
  });

  it("주어진 조건 `AE=BF=CG=DH=a` 는 자르지 않는다 — 한 줄에 들어간다", () => {
    expect(
      splitEquationChain(
        "$\\overline{AE}=\\overline{BF}=\\overline{CG}=\\overline{DH}=a$",
      ),
    ).toBeNull();
  });

  it("괄호 안 첨언 `(x=0, 1, 2, …)` 은 계산 단계가 아니다", () => {
    // `\mathrm{P}(X=x)=f(x)~(x=0,1,2,\cdots,n)` — 마지막 `=` 는 괄호 **안**이다.
    const span =
      "$\\mathrm{P}(X=x)=\\frac{a}{x(x+1)}\\,\\,(x=0,\\,1,\\,2,\\,\\cdots,\\,n)\\,\\,\\,\\,\\,\\,\\,\\,\\,\\,\\,\\,\\,\\,\\,\\,$";
    expect(splitEquationChain(span)).toBeNull();
  });

  it("`\\{ \\}` 집합 표기 안의 `=` 도 밖이 아니다", () => {
    const span =
      "$A_{k}=\\{x \\mid x(y-k)=36,~y \\in U\\},~B=\\left\\{x \\mid \\frac{36-x}{6} \\in U\\right\\}$";
    expect(splitEquationChain(span)).toBeNull();
  });

  it("여러 줄 환경(`\\begin{cases}`)은 이미 제 줄을 가진다", () => {
    expect(
      splitEquationChain(
        "$\\begin{cases}x-2y=1 \\\\ 3x+4y=13\\end{cases}=\\begin{cases}a\\\\b\\end{cases}=c$",
      ),
    ).toBeNull();
  });

  it("한 줄에 들어가는 짧은 이음은 그대로 둔다", () => {
    // `$2^{x}=5^{y}=10$` — 이음이지만 좁다. 바꿀 이유가 없다.
    expect(splitEquationChain("$2^{x}=5^{y}=10$")).toBeNull();
  });

  it("HWP 변환 잔재가 남은 수식은 건드리지 않는다 — 이미 깨졌다", () => {
    // `box{`·`over`·`HK|` 는 변환이 못 옮긴 흔적이다. 자르면 더 깨진다.
    const span =
      "${21over60}={7}over{box{``````①``````}}={7times box{`````` 2. ``````}}over{2^{2}times5times box{``````②``````}}={box{`````` 3. ``````}}$";
    expect(splitEquationChain(span, inProcess)).toBeNull();
  });
});

describe("splitEquationChain — 손상된 입력", () => {
  it("빈 문자열·달러 없는 문자열에 죽지 않는다", () => {
    expect(splitEquationChain("")).toBeNull();
    expect(splitEquationChain("계산 과정")).toBeNull();
  });

  it("닫히지 않은 중괄호가 있으면 자르지 않는다", () => {
    expect(
      splitEquationChain(
        "$\\frac{9}{250}=\\frac{9}{2\\times 5^{3}=\\frac{b}{10^{3}}=c$",
      ),
    ).toBeNull();
  });

  it("`=` 가 연달아 붙어 빈 조각이 생기면 자르지 않는다", () => {
    expect(
      splitEquationChain("$a==b==c==d==e==f==g==h$", inProcess),
    ).toBeNull();
  });

  it("`$$` 블록 수식은 손대지 않는다", () => {
    expect(splitEquationChain("$$a=b=c$$", inProcess)).toBeNull();
  });
});

describe("isWorkedProcess — 문항이 스스로 계산 과정이라고 말하는가", () => {
  it("「…하는 과정이다」를 잡는다", () => {
    expect(
      isWorkedProcess("다음은 $\frac{9}{250}$를 유한소수로 나타내는 과정이다."),
    ).toBe(true);
    expect(
      isWorkedProcess("다음은 곱셈 공식을 이용하여 계산하는 과정이다."),
    ).toBe(true);
    expect(isWorkedProcess("수학적 귀납법으로 증명하는 과정이다.")).toBe(true);
  });

  it("그냥 계산을 시키는 문항은 아니다", () => {
    expect(isWorkedProcess("$\\frac{9}{250}$를 유한소수로 나타내시오.")).toBe(
      false,
    );
    expect(isWorkedProcess("두 수의 최대공약수를 구하시오.")).toBe(false);
  });

  it("**지시문**은 계산 과정이 아니다 — 여기서 갈라야 조건 상자가 안 쪼개진다", () => {
    // 「풀이 과정을 서술하시오」는 학생에게 시키는 말이지 지면에 실린 계산이 아니다.
    expect(isWorkedProcess("풀이 과정을 자세히 서술하시오.")).toBe(false);
    expect(isWorkedProcess("∘ 계산 과정을 반드시 적을 것")).toBe(false);
  });
});
