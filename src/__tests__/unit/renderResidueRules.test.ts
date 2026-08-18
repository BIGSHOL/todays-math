/**
 * 지면에 **날 글자로 나가는 수식**의 후보정 규칙 (트랙 수식잔재).
 *
 * 규칙마다 «고치는 케이스» 보다 **«막는 케이스»를 먼저** 적는다.
 * 47,152건 중 1%를 고치려다 나머지를 망가뜨리면 손해다.
 *
 * ## 표본을 눈으로 본 근거
 *
 *  · `le`/`ge` — 분해되는 덩어리 **87종 전량**을 눈으로 확인했다(표본이 아니라 전량).
 *    전부 부등호였다. 분해에 실패한 4종(`rpilea`·`lebox`·`ballet`·`LEmle`) 중
 *    `rpilea`·`ballet` 은 부등호가 **아니었다** — 그래서 분해 검사를 남긴다.
 *  · `vert` — 서로 다른 모양 158종 전량 확인. 전부 `|` (집합기호·조건부확률·절댓값).
 *  · 소문자 `times` — 36 span 전량 확인. 전부 곱셈.
 *  · 붉은 명령 — 33종 전량이 census 에 나왔다. 목록이 아니라 **실제 렌더**로 판정한다.
 */
import { describe, expect, it } from "vitest";

import { fixRenderResidue } from "../../../scripts/qa/renderPostfixRules";

const fix = (s: string) => fixRenderResidue(s).content;

describe("[fixRenderResidue] 막아야 하는 것 — 이쪽이 먼저다", () => {
  it("통째로 안 변환된 HWP 스크립트 행은 손대지 않는다", () => {
    const raw = "$1 over {1 times 3} + CDOTS$";
    const r = fixRenderResidue(raw);
    expect(r.content).toBe(raw);
    expect(r.holds).toContain("wholesale");
  });

  it("행렬 정렬 키워드 `rpile` 의 `le` 를 부등호로 읽지 않는다", () => {
    // 실측: `\left( rpile-1&&1#0&&-3\right)`. 여기서 le 를 ≤ 로 바꾸면 행렬이 부서진다.
    expect(fix("$\\left( rpile-1&&1#0&&-3\\right)$")).toBe(
      "$\\left( rpile-1&&1#0&&-3\\right)$",
    );
  });

  it("영어 낱말의 `le`·`ge` 를 건드리지 않는다 — 원장님이 지목한 함정", () => {
    for (const word of ["ballet", "double", "large", "angle", "triangle"]) {
      expect(fix(`$${word}$`)).toBe(`$${word}$`);
    }
  });

  it("`\\text{}` · `\\mathrm{}` 안은 건드리지 않는다", () => {
    expect(fix("$\\text{3 times a day}$")).toBe("$\\text{3 times a day}$");
    expect(fix("$\\mathrm{ABLE}$")).toBe("$\\mathrm{ABLE}$");
  });

  it("`\\overline{GE}` 는 선분 GE 다 — 부등호로 읽지 않는다", () => {
    // 실제로 두 행을 이렇게 망가뜨린 뒤 발견했다(`\overline{\geq }`).
    expect(fix("$\\overline{GE}=2$")).toBe("$\\overline{GE}=2$");
    // 중괄호 한 겹 중첩까지 보호해야 한다 — `[^{}]*` 만 쓰면 여기서 보호가 샌다.
    expect(fix("$\\mathrm{\\overline{GE}}=2$")).toBe(
      "$\\mathrm{\\overline{GE}}=2$",
    );
  });

  it("전부 대문자인 덩어리는 기하 라벨과 구분이 안 되므로 손대지 않는다", () => {
    // 해설 컬럼 실측: `\angle GEF` · `\angle CGE` · `GECF` · `AGE` · `BGE`.
    for (const label of ["GEF", "FGE", "AGE", "CGE", "GECF", "BGE"]) {
      expect(fix(`$\\angle ${label}=90\\degree$`)).toBe(
        `$\\angle ${label}=90\\degree$`,
      );
    }
    // 키워드 그 자체와, 대소문자가 섞인 것은 라벨일 수 없다.
    expect(fix("$f(7)LE6$")).toBe("$f(7)\\leq 6$");
    expect(fix("$a_{n}GE0$")).toBe("$a_{n}\\geq 0$");
    expect(fix("$1LEmle4$")).toBe("$1\\leq m\\leq 4$");
  });

  it("KaTeX 가 **아는** 대문자 명령은 백슬래시를 떼지 않는다", () => {
    // `\Delta`·`\Re`·`\S` 는 멀쩡한 명령이다. 목록이 아니라 렌더가 판정한다.
    expect(fix("$\\Delta ABC$")).toBe("$\\Delta ABC$");
    expect(fix("$\\Re z$")).toBe("$\\Re z$");
  });

  it("수식 밖 한글 지문은 건드리지 않는다", () => {
    expect(fix("도형의 넓이는 times 몇 배인가")).toBe(
      "도형의 넓이는 times 몇 배인가",
    );
  });

  it("정상 LaTeX 명령을 건드리지 않는다", () => {
    const ok = "$\\times \\leq \\geq \\vert \\sin x \\overline{AB}$";
    expect(fix(ok)).toBe(ok);
  });
});

describe("[fixRenderResidue] 붉은 글씨 — KaTeX 가 못 그리는 명령", () => {
  it("`\\overarc` 를 KaTeX 가 아는 호 표기로 옮긴다", () => {
    // 정본 `latex_to_hwpeq` 가 `\overarc ↔ arch` 로 맵을 두어 역변환이
    // `\overarc` 를 내놓는데, **KaTeX 에는 그런 명령이 없다**.
    const r = fixRenderResidue("$\\overarc{AB}:\\overarc{BC}=2:3$");
    expect(r.content).toBe(
      "$\\overset{\\frown}{AB}:\\overset{\\frown}{BC}=2:3$",
    );
    expect(r.applied).toContain("overarc");
  });

  it("`\\cm` 을 단위 정자로 옮긴다", () => {
    expect(fix("$120\\,\\cm$")).toBe("$120\\,\\mathrm{cm}$");
  });

  it("`\\leftvert` · `\\rightvert` 를 절댓값 구분자로 되돌린다", () => {
    expect(fix("$\\leftvert b\\,\\rightvert$")).toBe(
      "$\\left\\vert b\\,\\right\\vert$",
    );
  });

  it("`\\P` 는 ¶ 로 그려진다 — 붉지 않아 렌더 판정이 못 잡는 부류", () => {
    // 실측 23곳 전량이 확률 P(…) 아니면 점 라벨 P 였다. 지면에는 ¶ 가 찍힌다.
    // 근거 ① 뒤에 인자가 온다.
    expect(fix("$\\P\\left( A\\cap B\\right) =0$")).toBe(
      "$P\\left( A\\cap B\\right) =0$",
    );
    // 근거 ② 같은 행에 `\O` 같은 «모르는» 대문자 라벨이 이미 있다.
    expect(fix("$\\O$ 위의 점 $\\P$")).toBe("$O$ 위의 점 $P$");
  });

  it("근거가 없으면 `\\P` 를 건드리지 않는다 — ¶ 가 진짜일 수도 있다", () => {
    const r = fixRenderResidue("$x+\\P$");
    expect(r.content).toBe("$x+\\P$");
    expect(r.holds).toContain("text-symbol-command");
  });

  it("KaTeX 가 모르는 **대문자 명령**은 백슬래시만 뗀다 — 점 라벨이다", () => {
    // `\E\left( \overline{X}\right)` = 기댓값 E(X̄). `\A=x+1` = A=x+1.
    expect(fix("$\\E\\left( X\\right) +\\V\\left( X\\right)$")).toBe(
      "$E\\left( X\\right) +V\\left( X\\right)$",
    );
    expect(fix("$\\square \\ABCD$")).toBe("$\\square ABCD$");
  });
});

describe("[fixRenderResidue] 조용히 틀리게 그려지는 글자", () => {
  it("`le` · `ge` 를 부등호로 옮긴다 — 붙어 있어도", () => {
    expect(fix("$-1lexle2$")).toBe("$-1\\leq x\\leq 2$");
    expect(fix("$age2$")).toBe("$a\\geq 2$");
    expect(fix("$xle-7$")).toBe("$x\\leq -7$");
    expect(fix("$f(x)lef(0)$")).toBe("$f(x)\\leq f(0)$");
  });

  it("대문자 `LE` · `GE` 도 같이 옮긴다 — 실측 30 span", () => {
    expect(fix("$48.88LEmle51.12$")).toBe("$48.88\\leq m\\leq 51.12$");
    expect(fix("$xGE1$")).toBe("$x\\geq 1$");
  });

  it("소문자 `times` 를 곱셈 기호로 옮긴다 — 원장님 스크린샷 `2^2 × 3times5^3`", () => {
    expect(fix("$2^{2}\\times 3times5^{3}$")).toBe(
      "$2^{2}\\times 3\\times 5^{3}$",
    );
  });

  it("`vert` 를 세로선으로 옮긴다 — 집합기호·조건부확률·절댓값", () => {
    expect(fix("$\\left\\{ x\\,vert\\,x\\geq 1\\right\\}$")).toBe(
      "$\\left\\{ x\\,\\vert \\,x\\geq 1\\right\\}$",
    );
    expect(fix("$vert2x+3vert$")).toBe("$\\vert 2x+3\\vert $");
  });

  it("피연산자에 **붙은** `vert` 도 옮긴다 — 절댓값은 원래 붙는다", () => {
    // `(?![A-Za-z])` 를 붙였더니 `vertZ`·`vertf(x)vertdx` 44곳이 통째로 빠졌다.
    // 말뭉치의 `vert` 172곳 전량이 `|` 임을 확인하고 lookahead 를 뺐다.
    expect(fix("$vertf(x)vertdx$")).toBe("$\\vert f(x)\\vert dx$");
    expect(fix("$\\mathrm{P}(B\\,vertA)$")).toBe("$\\mathrm{P}(B\\,\\vert A)$");
    // 닫는 쪽이 글자 뒤에 붙는다 — 앞을 막으면 `\vert avert` 반쪽 수리가 난다.
    expect(fix("$verta-bvert$")).toBe("$\\vert a-b\\vert $");
  });

  it("`\\vert` · `\\lvert` · `\\rvert` 명령은 건드리지 않는다", () => {
    const ok = "$\\lvert x\\rvert +\\vert y\\vert$";
    expect(fix(ok)).toBe(ok);
  });

  it("정본 이름 그대로인 `LEQ`/`GEQ` 는 분해하지 않고 통째로 옮긴다", () => {
    // le/ge 규칙에 맡기면 `leq` → `\leq q` 가 돼 뜻이 망가진다. 그래서 먼저 처리한다.
    expect(fix("$-2 LEQx<3$")).toBe("$-2 \\leq x<3$");
    expect(fix("$k leq -11$")).toBe("$k \\leq  -11$");
    expect(fix("$x GEQ 4$")).toBe("$x \\geq  4$");
    expect(fix("$a neq 0$")).toBe("$a \\neq  0$");
  });

  it("맨 그리스 이름을 옮긴다 — 정확히 일치할 때만", () => {
    expect(fix("$\\cos theta<0$")).toBe("$\\cos \\theta <0$");
    expect(fix("$\\tan alpha$")).toBe("$\\tan \\alpha $");
    // `xi` 는 ξ 가 아니라 `x·i` 였다(실측 `z=(2xi+6)i-x(1+i)+12`). 짧은 이름은 뺀다.
    expect(fix("$z=(2xi+6)i$")).toBe("$z=(2xi+6)i$");
  });

  it("`CENTIGRADE` 를 섭씨로 옮긴다", () => {
    expect(fix("$10\\,CENTIGRADE$")).toBe("$10\\,^\\circ\\mathrm{C}$");
  });

  it("맨 함수 이름을 정자 명령으로 옮긴다 — 지금은 이탤릭 `sinx` 로 나간다", () => {
    expect(fix("$sinx<tanx$")).toBe("$\\sin x<\\tan x$");
    expect(fix("$2ln5$")).toBe("$2\\ln 5$");
    expect(fix("$y=4cos2x+1$")).toBe("$y=4\\cos 2x+1$");
  });

  it("`ln` 은 뒤에 영숫자가 올 때만 옮긴다 — `l_n` 수열과 부딪친다", () => {
    // 실측 145곳 중 3곳이 자연로그가 아니었다: `n(ln)2` · `y=ln` · `\dfrac{ln+1}{l_n}`.
    // 전부 수열 `l_n` 이다. 이 경계를 지우면 문항의 뜻이 바뀐다.
    expect(fix("$lnx$")).toBe("$\\ln x$");
    expect(fix("$2ln5$")).toBe("$2\\ln 5$");
    expect(fix("$\\dfrac{ln+1}{l_{n}}$")).toBe("$\\dfrac{ln+1}{l_{n}}$");
    expect(fix("$n(ln)2$")).toBe("$n(ln)2$");
    expect(fix("$y=ln$")).toBe("$y=ln$");
  });

  it("앞 글자에 붙은 함수 이름은 **손대지 않는다** — 계수인지 변수인지 못 가른다", () => {
    // `asin3x` 는 `a·sin3x` 로 보이지만 `as·in` 일 수도 있다. 목록으로 남긴다.
    const r = fixRenderResidue("$asin3x+bcos3x$");
    expect(r.content).toBe("$asin3x+bcos3x$");
    expect(r.holds).toContain("glued-function");
  });
});

describe("[fixRenderResidue] 바꾼 것을 보고한다", () => {
  it("적용한 규칙 이름을 돌려준다 — 되돌리기와 감사를 위해", () => {
    const r = fixRenderResidue("$0lexle5$ 와 $3times5$");
    expect(r.applied.sort()).toEqual(["le/ge", "times"]);
  });

  it("바꿀 것이 없으면 입력 그대로", () => {
    const r = fixRenderResidue("$x^2+1$");
    expect(r.content).toBe("$x^2+1$");
    expect(r.applied).toEqual([]);
  });
});
