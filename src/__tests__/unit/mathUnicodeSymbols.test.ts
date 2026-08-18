/**
 * 수식 안 유니코드 기호 정규화 — KaTeX 가 못 그리는 날문자를 LaTeX 명령으로.
 *
 * 배경(2026-08-15): 완료본 텍스트레이어 추출물이 근호를 `√5` 처럼 **날문자**로 싣는다.
 * 전 문항 스캔 결과 `$...$` 안 유니코드 31종 중 7종을 KaTeX 가 못 그린다:
 *   √ 440문항(1,745회) · □ 39 · ∅ 19 · △ 2 · ¼ » ¨ 각 1
 * (`×` `≤` `≥` `÷` `α` `∩` `≠` 등은 KaTeX 가 알아서 그리므로 건드리지 않는다.)
 *
 * ⚠️ 근호의 **적용 범위는 텍스트에 남아 있지 않다.** `√x^{2}-6x` 가 원본에서
 * `\sqrt{x^2-6x}` 였는지 `\sqrt{x}^2-6x` 였는지 알 수 없다. 그래서 **명백한
 * 경우에만 `\sqrt{}` 로 바꾸고, 애매하면 `\surd` 로 둔다** — 겉모습은 지금과
 * 같고 KaTeX 경고만 사라진다. 뜻을 바꾸느니 안 바꾸는 쪽이 낫다.
 */
import { describe, expect, it } from "vitest";

import {
  applyMathInnerNormalization,
  collapseBlankBoxPadding,
  preprocessMathText,
} from "@/lib/math/textPreprocess";

/** 정규화 결과에 날문자가 남지 않았는지 */
const clean = (s: string) => applyMathInnerNormalization(s);

describe("[수식] 근호 날문자 → \\sqrt", () => {
  it("숫자 하나는 \\sqrt{n} 으로 바꾼다", () => {
    expect(clean("√5")).toContain("\\sqrt{5}");
    expect(clean("2√3")).toContain("2\\sqrt{3}");
  });

  it("여러 자리 숫자를 통째로 감싼다 (√10을 √1 뒤 0으로 자르지 않는다)", () => {
    expect(clean("√10")).toContain("\\sqrt{10}");
    expect(clean("√144")).toContain("\\sqrt{144}");
  });

  it("중괄호로 묶인 식은 그대로 \\sqrt 로 옮긴다", () => {
    expect(clean("√{2x+1}")).toContain("\\sqrt{2x+1}");
  });

  it("단일 문자는 \\sqrt{a} 로 바꾼다", () => {
    expect(clean("√a")).toContain("\\sqrt{a}");
  });

  it("⚠️ 적용 범위가 애매하면 뜻을 바꾸지 않고 \\surd 로 둔다", () => {
    // `√x^{2}-6x` 는 원본이 \sqrt{x^2-6x} 였을 수 있다. \sqrt{x}^{2} 로 바꾸면
    // 뜻이 달라진다 — 바꾸지 않는다.
    const out = clean("√x^{2}-6x");
    expect(out).not.toContain("\\sqrt{x}");
    expect(out).toContain("\\surd");
    expect(out).not.toContain("√");
  });

  it("소수점이 이어지면 손대지 않는다", () => {
    const out = clean("√3.7");
    expect(out).not.toContain("\\sqrt{3}");
    expect(out).toContain("\\surd");
  });

  it("이미 \\sqrt 인 식은 건드리지 않는다", () => {
    expect(clean("\\sqrt{5}+1")).toContain("\\sqrt{5}");
  });
});

describe("[수식] 그 밖의 KaTeX 미지원 기호", () => {
  it.each([
    ["□", "\\square"],
    ["∅", "\\varnothing"],
    ["△", "\\triangle"],
    // `\frac` 는 기존 규칙 6이 전부 `\dfrac` 으로 승격한다(한국 교과서 분수 크기).
    ["¼", "\\dfrac{1}{4}"],
  ])("%s → %s", (raw, latex) => {
    const out = clean(`A=${raw}`);
    expect(out).toContain(latex);
    expect(out).not.toContain(raw);
  });

  it("기존 표가 이미 다루던 기호는 그대로 둔다(회귀 방지)", () => {
    expect(clean("3×4")).toContain("\\times");
    expect(clean("a≤b")).toContain("\\le");
    expect(clean("A∩B")).toContain("\\cap");
  });
});

describe("[수식] \\left/\\right 불균형 안전망", () => {
  // textPreprocess 는 "출력은 항상 KaTeX-safe" 를 표방하지만, 원본이 이미 깨져
  // `\left(` 와 `\right)` 가 **다른 중괄호 그룹**에 흩어지면 그대로 빨간 오류가 났다.
  // 실데이터 1건(OCR 훼손 `\frac{x-a)^{2}}`)에서 확인 — 그럴 땐 크기조절을 포기하고
  // 평범한 괄호로 떨어뜨린다. 모양은 조금 아쉬워도 문항이 읽히는 게 우선이다.
  it("그룹 경계를 넘어 짝이 어긋나면 \\left/\\right 를 버린다", () => {
    const out = clean("-(-\\frac{x-a)^{2}}{b}");
    expect(out).not.toContain("\\left");
    expect(out).not.toContain("\\right");
  });

  it("짝이 맞는 \\left/\\right 는 그대로 둔다", () => {
    expect(clean("(\\frac{1}{2}+3)")).toContain("\\left(");
  });

  it("깨진 원본도 빨간 오류 없이 그려진다", async () => {
    const katex = (await import("katex")).default;
    const raw = "f(x)=\\{-(-\\frac{x-a)^{2}}{√x-a+}+b(x≤a)b(x>a)";
    const html = katex.renderToString(clean(raw), {
      throwOnError: false,
      strict: false,
    });
    expect(html).not.toContain("katex-error");
    expect(html).not.toContain("#cc0000");
  });
});

describe("[수식] 정규화 결과는 KaTeX 로 실제 렌더된다", () => {
  it.each([
    "√5",
    "2√3",
    "√10",
    "√x^{2}-6x",
    "a^{2}=9+4√5",
    "i=√-1",
    "A=∅",
    "□+1",
    "△ABC",
  ])("%s 가 빨간 오류 없이 그려진다", async (raw) => {
    const katex = (await import("katex")).default;
    const html = katex.renderToString(clean(raw), {
      throwOnError: false,
      strict: false,
    });
    expect(html).not.toContain("katex-error");
    expect(html).not.toContain("#cc0000");
  });
});

/**
 * ── 빈칸 네모(□) 뒤 공백 (2026-08-18 원장님) ────────────────────────────────
 * "네모 표현은 좋았는데 네모 뒤에 공백이 너무 많아보여. 공백 해결 방안 없는지 확인"
 *
 * 원인은 CSS 가 아니라 **LaTeX 에 남은 HWP 채움**이다. HWP 수식의 `{BOX{~~ 1. ~~}}`
 * 에서 `~` 는 한 칸 공백인데, 변환기가 `BOX` 만 `\square` 로 바꾸고 채움은 그대로
 * 흘려보냈다. LaTeX 의 `~` 는 비줄바꿈 공백이라 **개수만큼 쌓인다.**
 *
 * 브라우저 실측(12.5px 지면 글꼴): `$\square$` 11.8px · `$\square ~~~$` **23.1px**
 * — 채움이 네모 자신만큼 넓다. 전수 실측: 네모 바로 뒤 `~` 뭉치 699개 / 114문항.
 */
describe("빈칸 네모 뒤 HWP 채움 정리", () => {
  it("수식 끝에 붙은 채움은 지운다 (실측 0515aa41)", () => {
    expect(preprocessMathText("다음 $\\square ~~~$ 안에")).not.toMatch(/~/);
  });

  it("네모와 라벨 사이 채움은 한 칸만 남긴다 (실측 0a5cd178)", () => {
    const out = preprocessMathText("다음 $\\square ~~㈎~~$ 안에");
    expect(out).toContain("㈎");
    expect(out.match(/~/g) ?? []).toHaveLength(1);
  });

  it("`\\,` 채움도 같은 규칙 (실측 0e342d30)", () => {
    // 여기는 **수식 안** 규칙이라 inner 단계에서 본다 — 전체 파이프라인은
    // 한글 `가` 를 수식 밖으로 빼내므로(`splitMathInnerByHangul`) 결과가 섞인다.
    const out = collapseBlankBoxPadding(
      "\\square \\,\\,\\,\\,(가)\\,\\,\\,\\,\\,",
    );
    expect(out).toContain("(가)");
    expect(out.match(/\\,/g) ?? []).toHaveLength(1);
  });

  it("**네모가 없는 수식의 채움은 건드리지 않는다** — 목록 구분자다", () => {
    // `$1,~2,~3$` 의 `~` 는 항목 사이 간격이다. 지우면 숫자가 붙는다.
    const out = preprocessMathText("$1,~2,~3,~4$");
    expect(out.match(/~/g) ?? []).toHaveLength(3);
  });

  it("네모가 있어도 **멀리 떨어진** 채움은 그대로 둔다", () => {
    // 네모에 붙지 않은 채움까지 지우면 목록 간격이 무너진다.
    const out = preprocessMathText("$\\square = 1,~2,~3$");
    expect(out.match(/~/g) ?? []).toHaveLength(2);
  });

  it("채움이 하나뿐이면 그대로 둔다 — 이미 한 칸이다", () => {
    expect(preprocessMathText("$\\square ~a$")).toContain("~");
  });
});
