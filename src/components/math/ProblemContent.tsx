/**
 * 문제 본문(지문 + 보기) 렌더러 — mathgen `ProblemDisplay` 의 question/choices 레이아웃 이식.
 *
 * mathgen 정본: 보기는 `①②③④⑤` 마커 + 2열 그리드, 각 보기는 MarkdownRenderer 로 렌더.
 * 문제은행·검수·인쇄가 모두 이 컴포넌트를 쓴다 (렌더 경로 분기 금지).
 *
 * 보기 마커가 없는 문항(OCR 유실 등)은 지문만 렌더한다 — 임의로 쪼개지 않는다.
 */
import { MarkdownRenderer } from "@/components/math/MarkdownRenderer";
import { figureWidthStyle, parseFigureDimensions } from "@/lib/figurePrintSize";
import { fitsTwoColumns } from "@/lib/math/displayWidth";
import { CHOICE_MARKS } from "@/lib/math/circledNumber";
import { parseProblemContent } from "@/lib/problem/parseProblemContent";

export interface ProblemContentProps {
  content: string;
  /**
   * 원본 시험지에서 오려 온 그림 경로들 (`/figures/<examId>/qNN.jpg`).
   * 여러 장인 이유: 선택지마다 그림인 문항이 있다(실측 한 문항 최대 6장).
   * 순서는 지면에 나온 순서다. 참조: docs/planning/09-figure-engine-guide.md
   */
  figureUrls?: string[];
  /**
   * 도형 SVG (엔진 산출물, inline). `figureUrls`(스캔 래스터)와 **다른 갈래**다 —
   * 이쪽은 벡터라 화면·인쇄가 같은 것을 쓰고 해상도 손실이 없다.
   * AI 변형이 만드는 도형이 여기로 들어온다(D-55).
   *
   * ⚠️ 마크업을 그대로 붙인다. **서버(`renderFigureSpec`)만 이 값을 만든다** —
   *    엔진이 그리고 `sanitize_svg` 를 통과한 것이다. 클라이언트가 SVG 를 실어 보내는
   *    경로는 계약에 없다(채택 시 되돌아가는 것은 스펙뿐).
   */
  figureSvg?: string | null;
  /**
   * `figureUrls` 와 **같은 순서**로 짝지은 원본 픽셀 치수 `[w1,h1,w2,h2,…]`
   * (`Problem.figureDims`). 여기서는 **비율**의 근거로만 쓴다 —
   * 치수를 모르면 물리 폭도 안 쓴다(자와 지면이 같이 모른다).
   */
  figureDims?: number[];
  /**
   * `figureUrls` 와 **같은 순서·같은 길이**로 짝지은 **원본 지면 물리 폭(mm)**
   * (`Problem.figureSourceMm`). 「얼마로 그린다」의 유일한 근거다.
   *
   * ⚠️ **비면 «모른다»이고, 모르면 오늘 그대로 픽셀로 그린다**(회귀 0).
   *    규칙은 `src/lib/figurePrintSize.ts` 한 곳에 있고 넘침 판정도 같은 함수를 쓴다.
   */
  figureSourceMm?: number[];
  className?: string;
  /**
   * 그림을 지연 로딩할지. 화면 목록(문제은행·검수)은 true —
   * `public/figures` 는 12,129장에 최대 1.95MB 라 화면 밖 그림까지 원본 크기로
   * 내려받아 디코딩하면 목록이 통째로 느려진다.
   *
   * **인쇄 지면은 false** 로 온다(`PaperProblemView`가 `framed`로 판단).
   * 인쇄 시점에 아직 안 그려진 그림이 빠지면 학생이 못 푸는 시험지가 나간다
   * (절대 규칙 6). false 면 `loading`/`decoding` 을 **아예 붙이지 않아**
   * 인쇄 지면의 `<img>` 마크업이 수리 전과 한 글자도 다르지 않다.
   */
  deferFigures?: boolean;
}

export function ProblemContent({
  content,
  figureUrls,
  figureSvg,
  figureDims,
  figureSourceMm,
  className = "",
  deferFigures = true,
}: ProblemContentProps) {
  const { question, choices } = parseProblemContent(content);
  const figures = figureUrls ?? [];
  /**
   * 🔴 **넘침 판정과 같은 함수**다(`printOverflow` 도 이걸 부른다). 규칙이 두 벌이 되면
   * 자가 재는 지면과 실제 지면이 갈라지는데, 그건 아무도 모르게 어긋난다.
   * 모르는 자리는 `sourceMm` 이 없어 `figureWidthStyle` 이 `undefined` 를 돌려주고,
   * 그러면 React 가 `style` 속성 자체를 안 만든다 — 마크업이 오늘 그대로다.
   */
  const placements = parseFigureDimensions(
    figures.length,
    figureDims,
    figureSourceMm,
  );
  /**
   * 2열은 **들어갈 때만** 쓴다 (원장님 지적: "보기가 보기내에서 두줄처리되잖아").
   * 예전에는 `md:grid-cols-2 print:grid-cols-2` 로 강제해 조금만 긴 보기도 열 안에서
   * 접혔다. 한계값 근거는 `displayWidth.ts` 의 `TWO_COLUMN_WIDTH_LIMIT` 주석 —
   * 인쇄 문항 열 폭에서 실제로 접히는 지점이다. 실측 6.0% 가 1열로 내려온다.
   * **인쇄 지면도 같이 바뀐다**(절대 규칙 6 — 실물 출력 검수 대상).
   */
  const choicesInTwoColumns = fitsTwoColumns(choices);
  // undefined 면 React 가 속성 자체를 만들지 않는다 — 인쇄 지면은 종전 그대로.
  const figureLoading = deferFigures ? "lazy" : undefined;
  const figureDecoding = deferFigures ? "async" : undefined;

  return (
    <div className={className}>
      <MarkdownRenderer content={question} />
      {figureSvg ? (
        // 발문 뒤 — 스캔 그림과 같은 자리다. 장식 없음(05 §0).
        <div
          data-figure-svg
          className="mt-3 max-w-[360px] print:max-w-[70mm] [&>svg]:h-auto [&>svg]:w-full print:break-inside-avoid"
          dangerouslySetInnerHTML={{ __html: figureSvg }}
        />
      ) : null}
      {figures.length > 0 ? (
        // 발문 뒤·보기 앞 — 원본 지면 순서 그대로.
        // 장식 없음(05 §0: 유리·그림자·그라데이션 금지). 그림 자체가 내용이다.
        <div className="mt-3 flex flex-wrap items-start gap-4 print:break-inside-avoid">
          {figures.map((url, index) => (
            // 원본 비율·자연 크기를 그대로 써야 인쇄물이 원본 시험지와 같아진다.
            // next/image 는 리사이즈·포맷 변환을 하므로 여기선 쓰지 않는다.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt={figures.length > 1 ? `문항 그림 ${index + 1}` : "문항 그림"}
              // 원본이 최대 1,423px 이라 자연 크기로 두면 본문을 압도한다(실측 표시폭 1,178px).
              // 작은 그림은 그대로 두고 큰 것만 줄인다.
              // ⚠️ 상한 클래스는 mm 를 알아도 **그대로 둔다** — mm 를 모르는 그림이
              //    같은 지면에 섞이고, `max-width` 는 인라인 `width` 도 이겨 이중 안전망이다.
              className="h-auto w-auto max-w-full sm:max-w-[360px] print:max-w-[70mm]"
              /**
               * 원본 지면에서 그 그림이 차지하던 **물리 폭**. 모르면 `undefined` 라
               * React 가 `style` 속성을 아예 안 만든다 — 마크업이 2026-08-19 이전 그대로다.
               * ⚠️ 인라인 style 은 Tailwind 를 이긴다. 그래서 값 자체를 70mm 로 잘라
               *    보낸다(`figureWidthStyle`) — CSS 상한 한쪽만 믿지 않는다.
               */
              style={figureWidthStyle(placements[index]?.sourceMm)}
              // height 는 넣지 않는다 — 폭만 정하고 높이는 비율대로 따라오게 둔다
              // (`h-auto`). 원본 치수를 모르는 채로 적으면 비율이 틀어진다.
              loading={figureLoading}
              decoding={figureDecoding}
            />
          ))}
        </div>
      ) : null}
      {choices.length > 0 ? (
        <div
          className={`mt-4 grid grid-cols-1 gap-x-8 gap-y-2${
            choicesInTwoColumns ? " md:grid-cols-2 print:grid-cols-2" : ""
          }`}
        >
          {choices.map((choice, index) => (
            <div
              key={index}
              className="flex items-start gap-1.5 print:break-inside-avoid"
            >
              <span className="flex-shrink-0 leading-relaxed">
                {CHOICE_MARKS[index] ?? `(${index + 1})`}
              </span>
              <div className="min-w-0 flex-1">
                <MarkdownRenderer content={choice} className="[&_p]:my-0" />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
