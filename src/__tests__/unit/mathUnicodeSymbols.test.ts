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

import { applyMathInnerNormalization } from "@/lib/math/textPreprocess";

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
