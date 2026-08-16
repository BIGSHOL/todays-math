import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppChrome } from "@/components/chrome/AppChrome";

describe("[AppChrome]", () => {
  it("로고와 메인 탐색 링크를 보여 준다", () => {
    render(
      <AppChrome dateLabel="2026.08.14. 금">
        <p>본문</p>
      </AppChrome>,
    );

    const logo = screen.getByRole("link", { name: "오늘의수학" });
    expect(logo).toHaveAttribute("href", "/");
    expect(logo.className).toMatch(/text-\[28\.5px\]/);
    expect(screen.getByRole("link", { name: "메인" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "반" })).toHaveAttribute(
      "href",
      "/classes",
    );
    expect(screen.getByRole("link", { name: "문제은행" })).toHaveAttribute(
      "href",
      "/problems",
    );
    expect(screen.getByText("본문")).toBeInTheDocument();
  });

  it("남은 작업 수와 추가 탐색을 보여 준다", () => {
    render(
      <AppChrome
        remaining={2}
        extraNav={<button type="button">전체 표 ⇄</button>}
      >
        <p>본문</p>
      </AppChrome>,
    );

    expect(screen.getByText("남은 작업 2")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "전체 표 ⇄" }),
    ).toBeInTheDocument();
  });

  /**
   * 2026-08-16 T7.14 추가 — 워드마크 분기(D-39).
   *
   * 위 두 테스트는 **한 줄도 바꾸지 않았다.** 워드마크가 둘로 갈렸지만 '오늘의수학'은
   * 여전히 `/` 로 가는 링크이고 글자 크기도 그대로라, 기존 계약이 그대로 성립한다.
   * 선택된 쪽을 링크에서 뺐다면 위 테스트를 고쳐야 했을 텐데, 그러지 않은 이유는
   * AppChrome.tsx 머리주석에 적었다(워드마크=홈 링크 관례 + 색만으로 전달 금지).
   *
   * 이 분기가 없으면 '오늘의 시험' 탭에 들어갈 경로가 아예 없다 — T7.14 보고서 §4-3.
   */
  it("워드마크가 두 제품으로 갈리고 반대편 탭으로 건너간다 (D-39)", () => {
    render(
      <AppChrome>
        <p>본문</p>
      </AppChrome>,
    );

    expect(screen.getByRole("link", { name: "오늘의시험" })).toHaveAttribute(
      "href",
      "/exam",
    );
  });

  it("현재 탭을 색이 아니라 aria-current 로 알린다", () => {
    const { rerender } = render(
      <AppChrome>
        <p>본문</p>
      </AppChrome>,
    );

    // 기본값은 '오늘의 수학' 탭이다.
    expect(screen.getByRole("link", { name: "오늘의수학" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "오늘의시험" }),
    ).not.toHaveAttribute("aria-current");

    rerender(
      <AppChrome tab="exam">
        <p>본문</p>
      </AppChrome>,
    );

    expect(screen.getByRole("link", { name: "오늘의시험" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "오늘의수학" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("날짜·남은 작업 크롬은 두 탭이 공유한다", () => {
    render(
      <AppChrome tab="exam" dateLabel="2026-08-16 일" remaining={3}>
        <p>본문</p>
      </AppChrome>,
    );

    expect(screen.getByText("2026-08-16 일")).toBeInTheDocument();
    expect(screen.getByText("남은 작업 3")).toBeInTheDocument();
    // nav 는 그대로다 — D-39 는 'nav 항목 추가'안을 반려했다.
    expect(screen.getByRole("link", { name: "문제은행" })).toBeInTheDocument();
  });
});
