/**
 * 지면에 **날 글자로 나가는 수식**을 세는 계량기.
 *
 * ## 이 계량기가 없으면 무엇을 못 보나
 *
 * 두 부류를 **동시에** 봐야 한다. 지금까지 매번 한쪽만 봤다.
 *
 *  1. **붉은 글씨** — KaTeX 가 못 그리는 명령. `renderKatexSafe` 의 실패율로 잰다고
 *     생각했지만, 화면(`MarkdownRenderer`)은 그 방어를 **한 번도 타지 않는다**.
 *     그래서 화면 기준으로 다시 재야 한다.
 *  2. **조용히 틀리게 그려지는 글자** — `1over5x` · `3times5` · `xle2`.
 *     KaTeX 는 이걸 **에러로 보지 않는다.** 그냥 이탤릭 글자로 그린다.
 *     실패율 지표는 이 부류를 **구조적으로** 못 잡는다(2026-08-16 교훈).
 *
 * ## 그리고 목록을 손으로 만들지 않는다
 *
 * `bareRuns` 는 «수식 안의 두 글자 이상 영문 덩어리»를 **전부** 센다.
 * 무엇이 잔재인지 미리 정하지 않는다 — 세어 놓고 빈도순으로 눈으로 본다.
 * 이렇게 해야 `le`·`ge` 처럼 **아무도 목록에 안 적은 것**이 드러난다.
 */
import { describe, expect, it } from "vitest";

import {
  bareRuns,
  isRedHtml,
  redCommands,
  renderLikeUi,
} from "../../../scripts/qa/mathTokenCensus";

describe("[bareRuns] 수식 안 맨 영문 덩어리 census", () => {
  it("백슬래시 명령은 세지 않는다 — 정상 LaTeX 다", () => {
    expect(bareRuns("\\frac{1}{2}\\times x")).toEqual([]);
  });

  it("맨 덩어리를 센다", () => {
    expect(bareRuns("0lexle5").map((r) => r.run)).toEqual(["lexle"]);
    expect(bareRuns("2^{2}\\times 3times5^{3}").map((r) => r.run)).toEqual([
      "times",
    ]);
  });

  it("한 글자 변수는 세지 않는다 — 그건 잔재가 아니라 미지수다", () => {
    expect(bareRuns("x+y=z")).toEqual([]);
  });

  it("`\\begin{cases}` 의 환경 이름을 세지 않는다 — 세면 상위 20 이 환경 이름으로 찬다", () => {
    expect(bareRuns("\\begin{cases} x \\end{cases}")).toEqual([]);
  });

  it("`\\htmlClass{repeat-dot}{3}` 의 클래스 이름을 세지 않는다 — 우리가 넣은 것이다", () => {
    expect(bareRuns("0.\\htmlClass{repeat-dot}{3}")).toEqual([]);
  });

  it("`\\mathrm{AB}` 안의 점 라벨은 따로 표시한다 — 잔재가 아니다", () => {
    const runs = bareRuns("\\mathrm{AB}+xle2");
    expect(runs.map((r) => r.run)).toEqual(["AB", "xle"]);
    expect(runs.map((r) => r.inLabelCommand)).toEqual([true, false]);
  });

  it("덩어리의 위치를 돌려준다 — 고치는 쪽이 같은 자리를 짚어야 한다", () => {
    const [run] = bareRuns("0lexle5");
    expect(run!.index).toBe(1);
  });
});

describe("[renderLikeUi] 화면과 **같은 방식**으로 그린다", () => {
  // MarkdownRenderer → rehype-katex 7 은 1차 throwOnError:true, 실패하면
  // 2차 throwOnError:false + strict:'ignore' 로 다시 그린다. 그 2차 결과가
  // 붉은 글씨이고, 그대로 학생 지면에 나간다.
  it("`\\overarc` 는 붉게 나간다 — 원장님 스크린샷 그대로", () => {
    const html = renderLikeUi("\\overarc{AD}", false);
    expect(isRedHtml(html)).toBe(true);
    expect(redCommands("\\overarc{AD}", false)).toContain("\\overarc");
  });

  it("`\\htmlClass` 는 **던지지도 않고** 붉게 나간다 — trust 없이는 거부", () => {
    // KaTeX 0.16 은 이걸 예외로 만들지 않는다. strict:'warn' 기본에서
    // HTML 확장을 끄고 **명령 이름을 붉은 글자로 그려** 버린다.
    // 그래서 try/catch 로는 절대 안 잡힌다.
    const html = renderLikeUi("\\htmlClass{repeat-dot}{3}", false);
    expect(isRedHtml(html)).toBe(true);
    expect(redCommands("\\htmlClass{repeat-dot}{3}", false)).toContain(
      "\\htmlClass",
    );
  });

  it("멀쩡한 식은 붉지 않다", () => {
    expect(isRedHtml(renderLikeUi("\\overset{\\frown}{AD}", false))).toBe(
      false,
    );
    expect(isRedHtml(renderLikeUi("\\frac{1}{2}", false))).toBe(false);
  });

  it("조용히 틀리는 부류는 붉지 **않다** — 그래서 따로 세야 한다", () => {
    // 이게 이 트랙의 핵심이다. `le` 는 렌더 성공이고 뜻만 틀린다.
    expect(isRedHtml(renderLikeUi("xle2", false))).toBe(false);
    expect(isRedHtml(renderLikeUi("3times5", false))).toBe(false);
  });

  it("붉은 명령 이름을 **보이는 조각에서만** 뽑는다 — MathML 주석에서 뽑으면 무고한 명령이 섞인다", () => {
    // `\displaystyle` 은 우리 전처리가 거의 모든 span 에 넣는다. MathML
    // annotation 에는 원문이 통째로 들어 있어 거기서 뽑으면 `\displaystyle` 이
    // 1위로 올라온다(실제로 1차 측정에서 1,345 로 1위였다 — 전부 오귀속이었다).
    const commands = redCommands("\\displaystyle \\overarc{AB}", false);
    expect(commands).toContain("\\overarc");
    expect(commands).not.toContain("\\displaystyle");
  });

  it("구조 오류는 명령을 **지목하지 않는다** — 식 전체가 붉어지므로 무고한 명령이 다 걸린다", () => {
    // 짝 없는 중괄호 같은 파싱 실패에서 KaTeX 는 **원문 전체**를 한 덩어리
    // 붉은 글자로 그린다. 거기서 명령을 뽑으면 `\displaystyle`·`\sqrt` 처럼
    // 아무 잘못 없는 명령이 범인 명단에 오른다(2차 측정에서 `\displaystyle` 378).
    // 붉은 조각이 **명령 이름 하나 그 자체**일 때만 그 명령을 지목한다.
    const commands = redCommands("\\displaystyle -\\sqrt{", false);
    expect(commands).toEqual(["(구조오류)"]);
  });
});
