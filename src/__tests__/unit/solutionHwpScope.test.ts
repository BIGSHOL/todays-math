/**
 * 🔴 **어느 수식 덩어리를 변환해도 되는가** — 해설 HWP 변환의 첫 가드.
 *
 * 이미 LaTeX 인 덩어리를 정본 변환기에 다시 넣으면 **부서진다**(실측):
 * `\frac{5}{16}` → `\frac516` · `\begin{cases}…` → 뭉개짐. **에러는 안 난다.**
 * 그리고 대상 해설은 **섞여 있다** — 한 행에 LaTeX 덩어리와 HWP 덩어리가 같이 있다.
 */
import { describe, expect, it } from "vitest";

import {
  judgeSpan,
  residueRuns,
  scopeOf,
} from "../../../scripts/qa/solutionHwpScope";

describe("변환해도 되는 덩어리 가리기", () => {
  it.each([
    "LEFT ( 3x ^{2} +ax-5 RIGHT )",
    "lim _{n rarrow INF } {{a _{n}} over {n}}",
    "RM BAR {Q_1 H}=root 3",
    "{1} over {2}",
  ])("날 HWP 는 변환한다: %s", (body) => {
    expect(judgeSpan(body).convert).toBe(true);
  });

  it.each([
    "\\frac{5}{16}",
    "\\triangle \\mathrm{ABC}=4\\sqrt{2}",
    "\\begin{cases}x+2y=1000 \\\\ 3x+y=1500\\end{cases}",
    "\\lim _{x\\to 0}\\frac{\\sin x}{x}=1",
  ])("🔴 이미 LaTeX 이면 **손대지 않는다**: %s", (body) => {
    const v = judgeSpan(body);
    expect(v.convert).toBe(false);
    if (!v.convert) expect(v.why).toBe("latex");
  });

  it("HWP 키워드가 없으면 손대지 않는다 — 바꿀 것이 없다", () => {
    const v = judgeSpan("x^{2}-6x+2");
    expect(v.convert).toBe(false);
    if (!v.convert) expect(v.why).toBe("잔재없음");
  });

  it("한 행에 섞여 있으면 **HWP 덩어리만** 센다", () => {
    const s = scopeOf("답 $\\frac{5}{16}$ 이고 $LEFT ( x RIGHT )$ 이다 $a=1$");
    expect(s.convert).toBe(1);
    expect(s.latex).toBe(1);
    expect(s.clean).toBe(1);
  });
});

describe("🔴 고친 뒤 잔재 검사는 **다른 질문**이다", () => {
  /**
   * `scopeOf` 의 「역슬래시가 있으면 LaTeX」 규칙을 결과에 그대로 대면
   * **구조적으로 0**이 된다 — 변환한 덩어리에는 역슬래시가 반드시 있다.
   * 실측으로 `sqrt {3} of 3` → `\sqrt{3}of3` 의 날 `of` 를 못 잡았다.
   */
  it("명령 이름은 잔재가 아니지만 그 사이의 맨 낱말은 잔재다", () => {
    expect(residueRuns("$\\sqrt{3}of3$")).toEqual(["of"]);
    expect(residueRuns("$\\left( n-4\\right) \\left( n-9\\right) >0$")).toEqual(
      [],
    );
    expect(residueRuns("$\\mathrm{\\overline{AB}}=3$")).toEqual([]);
  });

  it("🔴 `scopeOf` 로는 그 자리를 **못 본다** — 그래서 함수가 둘이다", () => {
    // 같은 문자열을 두 검사에 대 본다. 앞쪽은 0, 뒤쪽은 1이어야 한다.
    const 고친것 = "$\\sqrt{3}of3$";
    expect(scopeOf(고친것).convert).toBe(0);
    expect(residueRuns(고친것)).toHaveLength(1);
  });

  it("바꾸기 전 날 HWP 는 당연히 잔재로 잡힌다", () => {
    expect(residueRuns("$LEFT ( x RIGHT )$").length).toBeGreaterThan(0);
  });
});
