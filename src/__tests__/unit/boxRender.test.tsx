/**
 * `<보기>` 상자 렌더 (렌더 수리 B) — mathgen MarkdownRenderer 1011~1028행 이식.
 *
 * 정본은 blockquote 의 첫 줄에 `<보기>`(또는 `<보기:cols=N>`)가 있을 때만 그리드로
 * 바꾼다. 마커가 없는 인용문(다단계 계산식 등)은 **한 열 그대로** 둔다 —
 * 이 저장소도 같은 규칙을 지켜야 기존 인용문의 렌더가 바뀌지 않는다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownRenderer } from "@/components/math/MarkdownRenderer";
import { ProblemContent } from "@/components/math/ProblemContent";

function html(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("[상자 렌더] blockquote → 보기 카드", () => {
  it("`<보기>` 헤더가 있으면 헤더와 항목을 갈라 그린다", () => {
    const out = html(
      <MarkdownRenderer content={"> <보기1>\n>\n> ㄱ. 참\n>\n> ㄴ. 거짓"} />,
    );
    expect(out).toContain("data-box-card");
    expect(out).toContain("data-box-header");
    // 항목은 각각 별도 셀로 나온다 — 한 문단에 뒤엉키면 안 된다(원장님 보고).
    expect(out.match(/data-box-item/g)).toHaveLength(2);
    // cols 지정자는 화면에 나오지 않는다.
    expect(out).not.toContain("보기1");
    expect(out).toContain("&lt;보기&gt;");
  });

  it("라벨 뒤 숫자가 열 수다 — `<보기2>` 는 두 열, `<보기1>` 은 한 열", () => {
    const two = html(
      <MarkdownRenderer content={"> <보기2>\n>\n> ㄱ. 참\n>\n> ㄴ. 거짓"} />,
    );
    expect(two).toContain("md:grid-cols-2");
    const one = html(
      <MarkdownRenderer content={"> <보기1>\n>\n> ㄱ. 참\n>\n> ㄴ. 거짓"} />,
    );
    expect(one).not.toContain("md:grid-cols-2");
  });

  it("마커가 없는 인용문은 예전 그대로 그린다 (렌더 회귀 금지)", () => {
    const content = "발문이다.\n\n> $f(1)=2$\n> $f(2)=3$\n";
    const out = html(<MarkdownRenderer content={content} />);
    expect(out).not.toContain("data-box-card");
    expect(out).toContain("my-4 border border-[#8A8A88] bg-white p-4");
  });

  it("`<조건>`·`<상자>` 라벨도 같은 카드로 그린다", () => {
    for (const label of ["조건", "상자"]) {
      const out = html(
        <MarkdownRenderer content={`> <${label}1>\n>\n> 첫째\n>\n> 둘째`} />,
      );
      expect(out).toContain("data-box-card");
      expect(out).toContain(`&lt;${label}&gt;`);
    }
  });

  it("문제 본문 경로 전체에서 보기 상자가 나온다", () => {
    // ProblemContent → parseProblemContent → MarkdownRenderer 까지 이어지는지 확인.
    const raw =
      "<보기>에서 옳은 것은?\n< 보 기 >\nㄱ. 무한소수는 무리수이다.\nㄴ. 순환소수는 유리수이다.\n1. ㄱ\n2. ㄴ";
    const out = html(<ProblemContent content={raw} />);
    expect(out).toContain("data-box-card");
    expect(out.match(/data-box-item/g)).toHaveLength(2);
  });
});
