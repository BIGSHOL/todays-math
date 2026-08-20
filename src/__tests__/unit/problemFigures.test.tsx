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
import { fallbackSourceMm } from "@/lib/figurePrintSize";
import { PaperProblemView } from "@/components/print/PaperProblemView";
import { ProblemBody } from "@/components/print/templates/ProblemBody";
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

describe("[그림] 로딩 정책 — 화면은 미루고 인쇄는 미루지 않는다", () => {
  // public/figures 는 12,129장에 최대 1.95MB. 목록 화면에서 화면 밖 그림까지
  // 원본 크기로 내려받아 디코딩하면 목록이 통째로 느려진다.
  // 반대로 인쇄 지면에서 미루면 인쇄 시점에 안 그려진 그림이 **빠진 채**
  // 학생에게 나간다 — 절대 규칙 6. 두 방향을 모두 잠근다.
  it("화면 목록(문제은행·검수)에서는 지연 로딩한다", () => {
    render(
      <PaperProblemView content={STEM} figureUrls={["/figures/1/q01.png"]} />,
    );
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
  });

  it("인쇄 지면(framed=false)에서는 지연 로딩 속성을 아예 붙이지 않는다", () => {
    render(
      <PaperProblemView
        content={STEM}
        figureUrls={["/figures/1/q01.png"]}
        framed={false}
      />,
    );
    const img = screen.getByRole("img");
    expect(img).not.toHaveAttribute("loading");
    expect(img).not.toHaveAttribute("decoding");
  });

  it("인쇄 템플릿(ProblemBody)이 실제로 인쇄 지면 쪽을 고른다", () => {
    render(
      <ProblemBody
        problem={{
          id: "p1",
          orderIndex: 1,
          content: STEM,
          answer: "$200$",
          solution: null,
          figureUrls: ["/figures/1/q01.png"],
        }}
      />,
    );
    expect(screen.getByRole("img")).not.toHaveAttribute("loading");
  });

  it("원본 치수를 모르므로 width/height 를 지어내지 않는다", () => {
    // 잘못된 치수를 적으면 비율이 틀어져 지면이 어긋난다.
    render(
      <ProblemContent content={STEM} figureUrls={["/figures/1/q01.png"]} />,
    );
    const img = screen.getByRole("img");
    expect(img).not.toHaveAttribute("width");
    expect(img).not.toHaveAttribute("height");
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

/**
 * 🔴 RED → 🟢 **그림 인쇄 크기 — 픽셀이 아니라 물리 크기(mm)** (2026-08-19 트랙).
 *
 * 오늘 지면은 「픽셀 폭이 264.567(=70mm)을 넘으면 70mm, 아니면 픽셀 그대로」뿐이라
 * **같은 삼각형이 문항마다 다른 크기**로 인쇄된다(원본 가로 41~7,343px).
 * 원장님 지시(2026-08-19) 「모든 그림이나 도형 크기가 **일관성이 있어야**」.
 *
 * 여기서 잠그는 것:
 *   1. **픽셀조차 모르면** 마크업이 오늘과 한 글자도 다르지 않다(회귀 0)
 *   1-b. **픽셀은 아는데 mm 를 모르면 픽셀에서 환산한다**(2026-08-20).
 *      예전에는 그때도 style 을 안 붙여 CSS 상한(70mm)이 걸렸는데, 상한은 곧
 *      **최대 크기**라 「모르는 그림」이 「아는 그림의 85%」보다 크게 나갔다.
 *      원장님이 종이에서 「그림이 너무 거대해」로 찾아 주셨다.
 *   2. mm 를 알면 `width: Xmm` — 그리고 **70mm 를 넘지 않는다**
 *   3. 인쇄 상한 클래스(`print:max-w-[70mm]`)가 **여전히 붙어 있다**
 *      (⚠️ 인라인 style 은 Tailwind 를 이긴다. 예전에 카드 폭을 인라인으로 박아
 *       `print:w-auto` 가 죽어 인쇄가 깨진 적이 있다.)
 *   4. **치수를 모르면 mm 도 안 쓴다** — 자와 지면이 같이 모른다
 */
describe("[그림크기] 지면이 물리 크기로 그린다", () => {
  const ONE = ["/figures/1/q01.png"];

  it("mm 를 모르면 인라인 style 을 아예 안 붙인다 — 오늘 그대로", () => {
    render(<ProblemContent content={STEM} figureUrls={ONE} />);
    expect(screen.getByRole("img").getAttribute("style")).toBeNull();
  });

  it("치수만 알고 mm 를 모르면 **픽셀에서 환산해** 그린다 — 예전엔 상한(=최대)이었다", () => {
    // 400px 스캔본 → 400/253*25.4 = 40.16mm. 상한(70)에서 뚜렷이 떨어져 있어야
    // 「환산했다」와 「그냥 70을 박았다」가 갈린다 — 상한에 걸리는 폭으로 재면
    // 옛 동작과 새 동작이 같은 값을 내서 이 검사가 아무것도 못 가른다.
    render(
      <ProblemContent
        content={STEM}
        figureUrls={ONE}
        figureDims={[400, 300]}
      />,
    );
    expect(screen.getByRole("img").style.width).toBe(
      `${fallbackSourceMm(400, ONE[0]).toFixed(2)}mm`,
    );
  });

  it("RPM(벡터)은 같은 픽셀이라도 **다른 크기**로 환산된다 — 72dpi 다", () => {
    const rpm = ["/figures/rpm/019fd1d7-abc/0.png"];
    render(
      <ProblemContent content={STEM} figureUrls={rpm} figureDims={[100, 80]} />,
    );
    expect(screen.getByRole("img").style.width).toBe(
      `${fallbackSourceMm(100, rpm[0]).toFixed(2)}mm`,
    );
    // 같은 100px 이 스캔본이면 더 작다(253dpi) — 경로가 실제로 갈라야 한다.
    expect(fallbackSourceMm(100, rpm[0])).toBeGreaterThan(
      fallbackSourceMm(100, ONE[0]),
    );
  });

  it("mm 를 알면 `width: Xmm` 로 그린다", () => {
    render(
      <ProblemContent
        content={STEM}
        figureUrls={ONE}
        figureDims={[800, 600]}
        figureSourceMm={[40]}
      />,
    );
    expect(screen.getByRole("img").style.width).toBe("40mm");
  });

  it("70mm 를 넘는 원본은 70mm 로 잘라서 적는다", () => {
    render(
      <ProblemContent
        content={STEM}
        figureUrls={ONE}
        figureDims={[3000, 2000]}
        figureSourceMm={[150]}
      />,
    );
    expect(screen.getByRole("img").style.width).toBe("70mm");
  });

  it("인쇄 상한 클래스는 그대로 살아 있다 — 인라인만 믿지 않는다", () => {
    render(
      <ProblemContent
        content={STEM}
        figureUrls={ONE}
        figureDims={[800, 600]}
        figureSourceMm={[40]}
      />,
    );
    expect(screen.getByRole("img").className).toContain("print:max-w-[70mm]");
  });

  it("치수를 모르면 mm 가 있어도 안 쓴다 — **자와 지면이 같이 모른다**", () => {
    // 자(`parseFigureDimensions`)가 치수를 모를 때 mm 를 버리는데, 지면만 mm 로
    // 그리면 자가 재는 지면과 실제 지면이 갈라진다. 같은 함수를 부르므로 같이 모른다.
    render(
      <ProblemContent
        content={STEM}
        figureUrls={ONE}
        figureDims={[0, 0]}
        figureSourceMm={[40]}
      />,
    );
    expect(screen.getByRole("img").getAttribute("style")).toBeNull();
  });

  it("mm 배열 길이가 어긋나면 **한 장도** 그 값을 안 쓴다 — 반쪽으로 그리지 않는다", () => {
    // 어긋난 배열은 어느 그림에 붙는지 알 수 없다. 그래서 40mm 는 **버린다.**
    // (2026-08-20 부터 그 뒤는 «아무것도 안 그린다»가 아니라 «픽셀에서 환산»이다.)
    const urls = ["/figures/1/a.png", "/figures/1/b.png"];
    render(
      <ProblemContent
        content={STEM}
        figureUrls={urls}
        figureDims={[800, 600, 400, 300]}
        figureSourceMm={[40]}
      />,
    );
    const imgs = screen.getAllByRole("img");
    // jsdom 은 `70.00mm` 를 `70mm` 로 줄여 적는다 — 글자가 아니라 **수**로 견준다.
    const mm = (i: HTMLElement) => Number.parseFloat(i.style.width);
    expect(imgs.map(mm)).toEqual([
      Number(fallbackSourceMm(800, urls[0]).toFixed(2)),
      Number(fallbackSourceMm(400, urls[1]).toFixed(2)),
    ]);
    // 🔴 어긋난 40mm 가 어느 장에도 새면 안 된다.
    for (const img of imgs) expect(mm(img)).not.toBe(40);
  });

  it("여러 장이면 **장마다** 제 크기로 그린다", () => {
    render(
      <ProblemContent
        content={STEM}
        figureUrls={["/figures/1/a.png", "/figures/1/b.png"]}
        figureDims={[800, 600, 400, 300]}
        figureSourceMm={[40, 62.5]}
      />,
    );
    const imgs = screen.getAllByRole("img");
    expect(imgs[0]!.style.width).toBe("40mm");
    expect(imgs[1]!.style.width).toBe("62.5mm");
  });

  it("인쇄 템플릿(ProblemBody)이 mm 를 실제로 실어 보낸다 — 배선이 끊기면 아무것도 안 바뀐다", () => {
    render(
      <ProblemBody
        problem={{
          id: "p1",
          orderIndex: 1,
          content: STEM,
          answer: "$200$",
          solution: null,
          figureUrls: ONE,
          figureDims: [800, 600],
          figureSourceMm: [40],
        }}
      />,
    );
    expect(screen.getByRole("img").style.width).toBe("40mm");
  });
});

/**
 * 원장님 지시 2026-08-20: 「그림은 배경이 흰색인데, 문제지는 배경이 흰색이 아니라
 * 좀 이상한건 있긴하네」.
 *
 * 지면은 `--paper-warm`(#FCFCF8) 이고 오려 온 그림은 배경이 순백(#FFFFFF) 이다.
 * 그래서 그림 자리마다 **더 밝은 사각형**이 떠 보인다. 원장님이 고른 해법은
 * 「그림을 종이색에 녹인다」 — `mix-blend-mode: multiply` 다.
 *
 * 곱셈 혼합은 흰색(1.0)을 곱해도 바탕이 그대로 남으므로 **흰 배경이 사라지고**,
 * 검은 획·글자는 그대로 진하게 남는다. 그림 파일은 하나도 안 건드린다.
 *
 * ⚠️ **클래스로 건다. 인라인 `style` 에 넣지 마라** — 「mm 를 모르면 style 속성이
 *    아예 없다」는 불변식(아래 「원본 치수를 모르므로…」)이 깨진다.
 */
describe("[그림] 흰 배경을 지면 색에 녹인다", () => {
  it("그림에 곱셈 혼합을 건다", () => {
    render(
      <ProblemContent content={STEM} figureUrls={["/figures/2658/q13.png"]} />,
    );
    expect(screen.getByRole("img").className).toMatch(/\bmix-blend-multiply\b/);
  });

  it("도형 SVG 도 같은 규칙을 쓴다 — 한 지면에 섞여 나간다", () => {
    const { container } = render(
      <ProblemContent content={STEM} figureSvg="<svg><rect /></svg>" />,
    );
    const svgBox = container.querySelector("[data-figure-svg]");
    expect(svgBox?.className).toMatch(/\bmix-blend-multiply\b/);
  });

  it("혼합을 인라인 style 로 걸지 않는다 — mm 를 모르면 style 은 여전히 없다", () => {
    render(
      <ProblemContent content={STEM} figureUrls={["/figures/2658/q13.png"]} />,
    );
    expect(screen.getByRole("img").getAttribute("style")).toBeNull();
  });
});

/**
 * 단계 3 — `figureUrls` 가 **벡터 SVG 경로**로 바뀌어도 지면이 같은 규칙을 쓰는가.
 *
 * 앞 세션이 「`<img src="*.svg">` 가 나온다」를 80/80 확인했지만 그건 **별도
 * 하니스**였다. 제품 컴포넌트가 실제로 그러는지는 확인한 적이 없다 —
 * 「제품 함수를 그대로 부른다」와 「제품이 실제로 그렇게 그린다」는 다른 말이다.
 */
describe("[그림] 벡터 SVG 경로도 같은 규칙으로 그린다", () => {
  const SVG = ["/figures-svg/1318/q10.svg"];

  it("`.svg` 도 같은 `<img>` 로 나간다 — 확장자만 다르다", () => {
    render(<ProblemContent content={STEM} figureUrls={SVG} />);
    expect(screen.getByRole("img").getAttribute("src")).toBe(
      "/figures-svg/1318/q10.svg",
    );
  });

  /**
   * 🔴 SVG 는 `width="70.000mm"` 를 **박아** 들고 있다 — 원본 크기가 아니라
   *    인쇄 상한이다. 인라인 style 이 그것을 이겨야 작은 그림이 안 부푼다.
   */
  it("mm 를 알면 인라인 `width` 가 SVG 내장 70mm 를 이긴다", () => {
    render(
      <ProblemContent
        content={STEM}
        figureUrls={SVG}
        figureDims={[238, 58]}
        figureSourceMm={[32.5]}
      />,
    );
    // jsdom 이 `32.50mm` 를 `32.5mm` 로 정규화한다 — 마크업에는 두 자리로 적힌다.
    expect(screen.getByRole("img").style.width).toBe("32.5mm");
  });

  it("여러 장이 전부 SVG 여도 순서·짝이 그대로다", () => {
    render(
      <ProblemContent
        content={STEM}
        figureUrls={["/figures-svg/1/a.svg", "/figures-svg/1/b.svg"]}
        figureDims={[200, 100, 300, 100]}
        figureSourceMm={[40, 60]}
      />,
    );
    const imgs = screen.getAllByRole("img");
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([
      "/figures-svg/1/a.svg",
      "/figures-svg/1/b.svg",
    ]);
    expect(imgs.map((i) => i.style.width)).toEqual(["40mm", "60mm"]);
  });
});
