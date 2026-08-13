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

    expect(screen.getByRole("link", { name: "오늘의수학" })).toHaveAttribute(
      "href",
      "/",
    );
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
});
