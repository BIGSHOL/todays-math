/**
 * 문항 그림 표시 — 원본 시험지에서 오려 온 그림을 본문과 함께 보여준다.
 *
 * 배경(2026-08-15): 완료본 PDF 는 그림을 이미지로 심고 있어 재작도 없이 그대로
 * 뽑을 수 있었다(305편 939문항). 뽑아 놓고 화면에 안 띄우면 "그림과 같이…" 문항이
 * 여전히 못 푸는 문제로 남는다.
 *
 * 렌더 경로는 `ProblemContent` 하나뿐이다(문제은행·검수·인쇄가 모두 이걸 쓴다).
 * 그림은 **발문과 보기 사이**에 온다 — 원본 지면의 순서 그대로.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProblemContent } from "@/components/math/ProblemContent";
import { serializeProblem } from "@/lib/serializers";

const STEM = "그림과 같이 밑변이 $40$m인 삼각형의 넓이를 구하시오.";
const WITH_CHOICES = `${STEM}\n\n1. $10$\n2. $20$\n3. $30$\n4. $40$\n5. $50$`;

describe("[그림] ProblemContent", () => {
  it("figureUrls 가 있으면 그림을 그린다", () => {
    render(
      <ProblemContent content={STEM} figureUrls={["/figures/2658/q13.png"]} />,
    );
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "/figures/2658/q13.png");
  });

  it("그림이 없으면 img 를 만들지 않는다", () => {
    render(<ProblemContent content={STEM} />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("빈 배열도 그림 없음으로 본다", () => {
    render(<ProblemContent content={STEM} figureUrls={[]} />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("여러 장이면 모두 그린다 — 선택지마다 그림인 문항이 있다(최대 6장)", () => {
    render(
      <ProblemContent
        content={STEM}
        figureUrls={[
          "/figures/1/q01.jpeg",
          "/figures/1/q01_1.jpeg",
          "/figures/1/q01_2.jpeg",
        ]}
      />,
    );
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });

  it("그림은 발문 뒤, 보기 앞에 온다 — 원본 지면 순서", () => {
    const { container } = render(
      <ProblemContent
        content={WITH_CHOICES}
        figureUrls={["/figures/2658/q13.png"]}
      />,
    );
    const html = container.innerHTML;
    expect(html.indexOf("삼각형")).toBeLessThan(html.indexOf("<img"));
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("①"));
  });

  it("대체 텍스트를 준다 — 스크린리더·이미지 유실 대비", () => {
    render(
      <ProblemContent content={STEM} figureUrls={["/figures/2658/q13.png"]} />,
    );
    expect(screen.getByRole("img")).toHaveAccessibleName(/그림/);
  });

  it("인쇄에서 그림이 쪽을 넘어 잘리지 않게 한다", () => {
    render(
      <ProblemContent content={STEM} figureUrls={["/figures/2658/q13.png"]} />,
    );
    const wrapper = screen.getByRole("img").parentElement;
    expect(wrapper?.className).toContain("print:break-inside-avoid");
  });
});

describe("[그림] 직렬화 — API 응답까지 전달", () => {
  const ROW = {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    unitId: "33333333-3333-4333-8333-333333333333",
    source: "past_exam",
    originProblemId: null,
    difficulty: "mid",
    problemType: "계산",
    content: STEM,
    answer: "$200$",
    solution: null,
    reviewStatus: "approved",
    directUseAllowed: true,
    pool: "shared",
    figureUrls: ["/figures/2658/q13.png"],
    createdAt: new Date("2026-08-15T00:00:00Z"),
    updatedAt: new Date("2026-08-15T00:00:00Z"),
  };

  it("serializeProblem 이 figureUrls 를 실어 보낸다", () => {
    expect(serializeProblem(ROW as never).figureUrls).toEqual([
      "/figures/2658/q13.png",
    ]);
  });

  it("그림이 없는 문항은 빈 배열이다 — null 로 새지 않는다", () => {
    expect(
      serializeProblem({ ...ROW, figureUrls: [] } as never).figureUrls,
    ).toEqual([]);
  });
});

describe("[그림] 본문에 박힌 `[그림] …` 설명", () => {
  // 비전 OCR 이 그림을 **말로 옮겨** 본문에 끼워 넣었다(681건). 진짜 그림을 붙인
  // 뒤에는 중복이고, "학원 로고…" 같은 배너 설명이 학생 시험지에 인쇄된다(59건).
  //
  // ⚠️ 렌더 계층에서 `[그림]` 뒤를 잘라내는 방식은 **쓰면 안 된다.** 설명은 발문
  // 끝에만 있는 게 아니라 문장 중간에도 들어간다 — 실제 화면에서 확인:
  //   "…지나지 않는 사분 [그림] 면은?"   ← 자르면 "면은?" 이 사라진다
  //   "⑤ −12 [그림] 이차함수 ~ …"        ← 선택지 안에도 들어간다
  // 정확히 걷어내려면 원본 ocr_json 의 figure 블록을 빼고 본문을 다시 만들어야
  // 한다(scripts/figure/strip-figure-text.mjs). 그래서 화면은 본문을 그대로 그린다.
  it("렌더는 본문을 손대지 않는다 — 문장 중간 설명을 잘라먹지 않는다", () => {
    const midSentence = "지나지 않는 사분 [그림] 면은?";
    const { container } = render(
      <ProblemContent
        content={midSentence}
        figureUrls={["/figures/1/q01.png"]}
      />,
    );
    expect(container.textContent).toContain("면은?");
  });
});

describe("[그림] 표시 크기", () => {
  // 원본이 최대 1,423px 이라 자연 크기로 두면 본문을 압도한다(실측 표시폭 1,178px).
  it("과도하게 커지지 않도록 상한을 둔다", () => {
    render(
      <ProblemContent content={STEM} figureUrls={["/figures/1/q01.png"]} />,
    );
    expect(screen.getByRole("img").className).toContain("max-w-");
  });
});
