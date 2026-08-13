// T0.4 인프라 검증용 샘플 컴포넌트 테스트 (React Testing Library 동작 확인)
// 실제 화면 컴포넌트 테스트는 각 Phase 담당 태스크에서 작성한다.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

function Greeting({ name }: { name: string }) {
  return <p>안녕하세요, {name}님</p>;
}

describe("[인프라 샘플] Greeting", () => {
  it("전달된 이름을 화면에 표시한다", () => {
    render(<Greeting name="테스트" />);

    expect(screen.getByText("안녕하세요, 테스트님")).toBeInTheDocument();
  });
});
