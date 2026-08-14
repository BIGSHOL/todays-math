/**
 * 혼합 본문(한글 + 수식) → HTML 레이아웃 정규화.
 *
 * 배경(2026-08-14): 기출/변형 문제 본문이 OCR 이관 과정에서 인라인 토큰마다
 * `\n\n`(이중 개행)으로 쪼개져 저장돼 있다. 종전 renderMathHtml 은 모든 개행을
 * `<br />`로 바꿔 문제은행/검수/인쇄에서 토막마다 세로로 쌓였다(원장 리포트).
 *
 * 데이터 규약(400건 표본 전수 확인):
 *  - `\n\n`(이중) = 인라인 토큰 구분자 → 공백으로 합쳐 한 문장으로 흐르게 한다.
 *  - 단일 `\n` = 선택지( `1.` … `2.` … ) 구분자 → 줄바꿈으로 유지한다.
 */
import { describe, expect, it } from "vitest";

import { renderMathHtml } from "@/lib/math/renderMathHtml";

const countBr = (html: string): number =>
  (html.match(/<br\s*\/?>/g) ?? []).length;

describe("[renderMathHtml] OCR 이중 개행 레이아웃 정규화", () => {
  it("이중 개행으로 쪼개진 지문 토큰을 한 줄로 합친다(줄바꿈 없음)", () => {
    const text =
      "다음 조건을 만족시키는 자연수\n\n$m,n$\n\n의 모든 순서쌍\n\n$(m,n)$\n\n의 개수는?";
    const html = renderMathHtml(text);
    expect(countBr(html)).toBe(0);
  });

  it("선택지는 각 항목 앞에서 줄바꿈한다", () => {
    const text =
      "두 수\n\n$A$\n\n의 값은?\n\n1. $a$\n2. $b$\n3. $c$\n4. $d$\n5. $e$";
    const html = renderMathHtml(text);
    // 지문→1., 1.→2., … 4.→5. : 선택지 5개 앞에서 5회 줄바꿈
    expect(countBr(html)).toBe(5);
  });

  it("원문자 선택지(①②③)도 줄바꿈한다", () => {
    const text = "그림을 보아라\n\n① $a$\n② $b$\n③ $c$";
    const html = renderMathHtml(text);
    expect(countBr(html)).toBe(3);
  });

  it("개행이 없는 깨끗한 본문은 그대로(줄바꿈 없음)", () => {
    const html = renderMathHtml("$0.25$를 분수로 나타내어라.");
    expect(countBr(html)).toBe(0);
  });

  it("합쳐진 지문 문장이 이어져 읽힌다", () => {
    const text = "순환소수\n\n$0.\\overline{3}$\n\n을 분수로 나타내어라.";
    const html = renderMathHtml(text);
    expect(countBr(html)).toBe(0);
    // 수식 밖 텍스트가 유실되지 않는다
    expect(html).toContain("순환소수");
    expect(html).toContain("을 분수로 나타내어라.");
  });
});
