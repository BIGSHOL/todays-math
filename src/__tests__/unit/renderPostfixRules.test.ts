/**
 * 본문 후보정 규칙 (트랙 렌더-C).
 *
 * 이 테스트가 지키는 것은 두 가지다.
 *
 * 1. **고쳐야 할 것을 고치는가** — 원장님 스크린샷의 `aDIVIDEb`, 지면에 박힌
 *    `[서술형 3]`.
 * 2. **고치면 안 되는 것을 안 건드리는가** — 이쪽이 더 중요하다. 47,152건 중
 *    1%를 고치려다 나머지를 망가뜨리면 손해다(CLAUDE.md 2026-08-16·17 교훈:
 *    "경계를 확실히 못 자르는 오염은 지우지 말고 막는다").
 *
 * 그래서 각 규칙마다 **보류(hold) 케이스를 먼저** 적는다.
 */
import { describe, expect, it } from "vitest";

import {
  fixHwpResidue,
  fixStrayDollar,
  isWholesaleHwpScript,
  stripQuestionLabel,
} from "../../../scripts/qa/renderPostfixRules";

describe("[stripQuestionLabel] 문두 유형 라벨 떼기", () => {
  it("문두 `[서술형 3]` 을 뗀다", () => {
    const r = stripQuestionLabel("[서술형 3] 명제 ‘모든 양수’가 참이 되도록");
    expect(r.hold).toBeNull();
    expect(r.kind).toBe("서술형");
    expect(r.content).toBe("명제 ‘모든 양수’가 참이 되도록");
  });

  it("번호가 수식으로 감싸인 `[서술형 $2$]` 도 뗀다 — 실측 최빈 모양", () => {
    // 기존 지표가 이 모양을 못 세서 502건으로 보고했다. 실제는 8,502건이었다.
    const r = stripQuestionLabel("[서술형 $2$] 등식 $(x+2)i=3$가 성립하도록");
    expect(r.kind).toBe("서술형");
    expect(r.content).toBe("등식 $(x+2)i=3$가 성립하도록");
  });

  it("줄바꿈이 낀 `[서술형\\n\\n$3$\\n\\n]` 도 뗀다", () => {
    const r = stripQuestionLabel("[서술형\n\n$3$\n\n] 세 점 A에 대하여");
    expect(r.kind).toBe("서술형");
    expect(r.content).toBe("세 점 A에 대하여");
  });

  it("대괄호가 수식 안에 갇힌 `$[$서답형$4]$` 변종도 뗀다", () => {
    const r = stripQuestionLabel("$[$\n\n서답형\n\n$4]$\n\n등식을 만족시키는");
    expect(r.kind).toBe("서답형");
    expect(r.content).toBe("등식을 만족시키는");
  });

  it("라벨 뒤에 붙은 `(서술형)` 도 같이 뗀다 — 원장님: 문제에 서술형 글자가 있으면 안 된다", () => {
    const r = stripQuestionLabel("[서답형 $7$](서술형) 점 $(1,-1)$에서 곡선");
    expect(r.kind).toBe("서답형");
    expect(r.content).toBe("점 $(1,-1)$에서 곡선");
  });

  it("번호 없는 `[서술형]` 도 뗀다", () => {
    expect(stripQuestionLabel("[서술형] 다음을 구하시오").content).toBe(
      "다음을 구하시오",
    );
  });

  it("라벨이 없으면 아무것도 하지 않는다", () => {
    const r = stripQuestionLabel("다음 삼각형 ABC 의 넓이는?");
    expect(r.hold).toBeNull();
    expect(r.kind).toBeNull();
    expect(r.content).toBe("다음 삼각형 ABC 의 넓이는?");
  });

  // ── 보류 ────────────────────────────────────────────────────────────
  it("라벨이 둘 이상이면 보류 — 문항 경계가 무너진 행이다", () => {
    // 실측 49건. 한 행에 문항 여러 개가 붙어 있어 앞 라벨만 떼면 더 나빠진다.
    const r = stripQuestionLabel(
      "[서술형 $2$] 앞 문항입니다. [서술형 $3$] 뒤 문항입니다.",
    );
    expect(r.hold).toBe("multi-label");
    expect(r.content).toBe(
      "[서술형 $2$] 앞 문항입니다. [서술형 $3$] 뒤 문항입니다.",
    );
  });

  it("문두가 아닌 라벨은 보류 — 본문 중간의 라벨은 다음 문항의 것이다", () => {
    const r = stripQuestionLabel(
      "앞 문항 본문이 길게 이어지다가 [서술형 $1$] 이 나온다",
    );
    expect(r.hold).toBe("not-head");
  });

  it("대괄호 안에 유형 말고 다른 것이 있으면 보류", () => {
    // `[$5$점, 단답형]` 은 배점까지 들어 있어 통째로 지우면 정보가 사라진다.
    expect(stripQuestionLabel("[$5$점, 단답형] 다음을 구하시오").hold).toBe(
      "unknown-shape",
    );
    // `[서술형 $1-\left( 1\right)$]` 은 하위 문항 번호다.
    expect(
      stripQuestionLabel("[서술형 $1-\\left( 1\\right)$] 사건 $A$를 구하시오")
        .hold,
    ).toBe("unknown-shape");
    // 범위 라벨은 여러 문항의 공통 지문 머리다.
    expect(stripQuestionLabel("[서술형 $1$ ~ $2$] 그림과 같이").hold).toBe(
      "unknown-shape",
    );
  });

  it("`[삼각형]` 처럼 유형이 아닌 낱말은 라벨로 보지 않는다", () => {
    const r = stripQuestionLabel("[도형 모양 아이콘] 다음 그림에서");
    expect(r.hold).toBeNull();
    expect(r.kind).toBeNull();
    expect(r.content).toBe("[도형 모양 아이콘] 다음 그림에서");
  });

  it("떼고 나면 본문이 없어지는 행은 보류", () => {
    expect(stripQuestionLabel("[서술형 $3$]").hold).toBe("empty-after");
  });
});

describe("[isWholesaleHwpScript] 통째로 변환이 안 된 행 가리기", () => {
  it("`{BOX{` 선택지 자리표시자가 있으면 통째 미변환", () => {
    expect(isWholesaleHwpScript("$rm ANGLE OMA= {BOX{~~ 1. ~~}},~$")).toBe(
      true,
    );
  });

  it("맨 `over` 분수 키워드가 있으면 통째 미변환 — 분자·분모 경계를 못 자른다", () => {
    expect(
      isWholesaleHwpScript("$1 over { 3times 5 } + 1over { 5 times 7 }$"),
    ).toBe(true);
  });

  it("맨 `LEFT (` · `cdots` · `cases{` 도 미변환 표지다", () => {
    expect(isWholesaleHwpScript("$LEFT ( 0{le}Z{le}z RIGHT )$")).toBe(true);
    expect(isWholesaleHwpScript("$1+2+ cdots +n$")).toBe(true);
    expect(isWholesaleHwpScript("${cases{x+y=3&#2x-3y=1}}$")).toBe(true);
  });

  it("수식 안의 맨 `rm ` 도 미변환 표지다 — 공백까지 뭉개진 행이다", () => {
    expect(isWholesaleHwpScript("표준편차(점)$rm A$$25$$3$")).toBe(true);
    // 바깥 한글 지문에 우연히 섞인 것까지 잡지는 않는다.
    expect(isWholesaleHwpScript("rm 이라는 글자가 지문에 있다 $x+1$")).toBe(
      false,
    );
  });

  it("정상 LaTeX 에 DIVIDE 만 낀 행은 미변환이 아니다", () => {
    expect(isWholesaleHwpScript("ㄱ. $xDIVIDE(-6)=-\\frac{x}{6}$")).toBe(false);
  });

  it("정상 `\\left(`·`\\cdots` 는 표지가 아니다 — 백슬래시가 붙어 있다", () => {
    expect(
      isWholesaleHwpScript("$\\left( 1-\\frac{1}{2}\\right) \\,\\cdots \\,$"),
    ).toBe(false);
  });
});

describe("[fixHwpResidue] 남은 HWP 키워드 옮기기", () => {
  it("붙어 있는 DIVIDE 를 `\\div` 로 옮긴다 — 원장님 스크린샷의 그 모양", () => {
    const r = fixHwpResidue("ㄱ. $xDIVIDE(-6)=-\\frac{x}{6}$");
    expect(r.content).toBe("ㄱ. $x\\div (-6)=-\\frac{x}{6}$");
    expect(r.applied).toContain("DIVIDE");
  });

  it("한 span 안의 DIVIDE 를 모두 옮긴다", () => {
    expect(fixHwpResidue("$aDIVIDEbDIVIDEc$의 값은?").content).toBe(
      "$a\\div b\\div c$의 값은?",
    );
  });

  it("소문자 `divide` 도 옮긴다 — `cdivide5` 실측", () => {
    expect(fixHwpResidue("$(a+b)\\times 2-cdivide5$").content).toBe(
      "$(a+b)\\times 2-c\\div 5$",
    );
  });

  it("TIMES 를 `\\times` 로 옮긴다", () => {
    expect(fixHwpResidue("$1\\times 2TIMES3TIMES4$").content).toBe(
      "$1\\times 2\\times 3\\times 4$",
    );
  });

  it("`\\mathit{LEFT}(` 는 `\\left(` 다 — 짝 없는 `\\right` 가 KaTeX 를 깨뜨린다", () => {
    expect(
      fixHwpResidue("$\\mathrm{P}\\mathit{LEFT}(t,~t\\right)$").content,
    ).toBe("$\\mathrm{P}\\left(t,~t\\right)$");
    expect(
      fixHwpResidue("$\\mathrm{P}(\\mathit{LEFT}|Z\\right| \\leq 1.96)$")
        .content,
    ).toBe("$\\mathrm{P}(\\left|Z\\right| \\leq 1.96)$");
  });

  it("한 글자 `veca` 는 `\\vec{a}` 다", () => {
    expect(fixHwpResidue("$veca\\,+vecb\\,+vecc\\,=vec0$").content).toBe(
      "$\\vec{a}\\,+\\vec{b}\\,+\\vec{c}\\,=\\vec{0}$",
    );
  });

  it("여러 글자 `vecab` 는 건드리지 않는다 — 한 벡터인지 두 개인지 못 정한다", () => {
    const text = "$vecab$";
    expect(fixHwpResidue(text).content).toBe(text);
  });

  it("`\\mathit{ANGLEx}` 는 `\\angle x` 다", () => {
    expect(
      fixHwpResidue("$\\mathrm{\\angle }ABD=\\mathit{ANGLEx}\\,$").content,
    ).toBe("$\\mathrm{\\angle }ABD=\\angle x\\,$");
  });

  // ── 건드리면 안 되는 것 ──────────────────────────────────────────────
  it("수식 밖 한글 지문은 건드리지 않는다", () => {
    const text = "DIVIDE 라는 낱말이 지문에 있다";
    expect(fixHwpResidue(text).content).toBe(text);
  });

  it("이미 정상인 `\\div` 는 두 번 바꾸지 않는다 (멱등)", () => {
    const once = fixHwpResidue("$aDIVIDEb$").content;
    expect(fixHwpResidue(once).content).toBe(once);
  });

  it("통째 미변환 행은 손대지 않는다 — over 의 분자·분모 경계를 못 자른다", () => {
    const raw = "$1 over { 3times 5 } + 1over { 5 times 7 } DIVIDE 2$";
    const r = fixHwpResidue(raw);
    expect(r.content).toBe(raw);
    expect(r.hold).toBe("wholesale");
  });
});

describe("[fixStrayDollar] 짝이 안 맞는 `$` 걷어내기", () => {
  it("발문 끝의 떠돌이 `$` 를 지운다 — 선택지가 통째로 수식이 된다", () => {
    const r = fixStrayDollar(
      "…의 해는? (단, $a,~b$는 상수) $\n\n1. $x\\leq 1$\n2. $x\\geq 1$",
    );
    expect(r.content).toBe(
      "…의 해는? (단, $a,~b$는 상수)\n\n1. $x\\leq 1$\n2. $x\\geq 1$",
    );
    expect(r.applied).toBe("trailing-dollar");
  });

  it("줄 홀로 있는 `$` 도 지운다", () => {
    const r = fixStrayDollar("…의 합은?\n$\n\n1. $2\\pi$\n2. $3\\pi$");
    expect(r.content).toBe("…의 합은?\n\n1. $2\\pi$\n2. $3\\pi$");
  });

  it("본문 맨 끝의 떠돌이 `$` 도 지운다", () => {
    const r = fixStrayDollar("…쓰시오.) $");
    expect(r.content).toBe("…쓰시오.)");
  });

  it("떠돌이 `$LEFT` 는 통째로 지운다 — 피연산자 없는 잔재다", () => {
    const r = fixStrayDollar("…옳지 않은 것은? $LEFT\n\n1. $x=3$\n2. $x=4$");
    expect(r.content).toBe("…옳지 않은 것은?\n\n1. $x=3$\n2. $x=4$");
    expect(r.applied).toBe("stray-LEFT");
  });

  it("`$` 가 짝수면 아무것도 하지 않는다", () => {
    const ok = "값은? $a$ 와 $b$";
    expect(fixStrayDollar(ok).content).toBe(ok);
    expect(fixStrayDollar(ok).applied).toBeNull();
  });

  it("지울 자리를 특정 못 하면 보류한다 — 표가 깨진 행은 규칙으로 못 고친다", () => {
    const broken =
      "비율이 $80%$라고 한다. $$z$${rmP} LEFT ( 0{le}Z RIGHT )$$1.0$";
    const r = fixStrayDollar(broken);
    expect(r.content).toBe(broken);
    expect(r.applied).toBeNull();
    expect(r.hold).toBe("unresolved");
  });

  it("고친 뒤에는 반드시 `$` 가 짝수다", () => {
    for (const text of [
      "…의 해는? (단, $a$는 상수) $\n\n1. $x$\n2. $y$",
      "…옳지 않은 것은? $LEFT\n\n1. $x$\n2. $y$",
    ]) {
      const out = fixStrayDollar(text).content;
      expect((out.match(/\$/g) ?? []).length % 2).toBe(0);
    }
  });
});
