/**
 * **탐침 전용** 보기-그림 조판 시안 렌더러 (제품 코드 아님).
 *
 * 왜 여기 있나: 「보기 그림을 어디에 놓을 것인가」는 D-07(원장님 확정 사항)이라
 * 제품 컴포넌트를 고칠 수 없다. 그런데 시안마다 **세로 px 를 실측**해야 고르실 수
 * 있으므로, 제품과 **같은 CSS·같은 KaTeX·같은 A4 지면**에 시안만 갈아 끼워 그린다.
 * `src/components/**` 는 한 글자도 안 바뀐다.
 *
 * ## 이 파일이 스스로 지키는 것
 *
 * 1. **발문·상자·수식·발문 그림은 제품 컴포넌트 그대로**(`ProblemContent`) — 시안 사이의
 *    차이가 «보기 조판» 하나만 남게 한다. 발문까지 새로 그리면 무엇이 줄었는지 못 가른다.
 *    그래서 자(`figrefRuler.ts`)도 그 부분은 제품 `estimateProblemPx` 를 그대로 부를 수 있다 —
 *    **조판과 자가 같은 입력·같은 함수를 본다**(D-52 「한 규칙·한 숫자」).
 * 2. **Tailwind 유틸리티를 새로 쓰지 않는다.** `paperProbe` 의 Tailwind 빌드는
 *    `@source "../../src"` 라 `scripts/qa/` 에서만 쓰는 클래스는 **한 줄도 안 나온다**
 *    (paperProbe 함정 (2)). 새 조판은 전부 아래 `PROBE_CSS` 의 평범한 CSS 로 적는다 —
 *    보고서에 그대로 옮겨 적을 수 있는 형태이기도 하다.
 * 3. **짝을 «추측»하지 않는다.** 짝은 호출자가 `FigurePlan` 으로 **넘겨준다**.
 *    이 파일은 「짝을 알면 어떻게 그리나」만 답한다.
 */
import { ProblemContent } from "../../src/components/math/ProblemContent";
import { CHOICE_MARKS } from "../../src/lib/math/circledNumber";

/* ──────────────────────────────────────────────────────────────────────────
 * 시안 목록
 * ────────────────────────────────────────────────────────────────────────── */

export const VARIANTS = [
  "현행", // 제품 그대로 — renderSlot 이 그린다 (이 파일을 안 탄다)
  "상한45", // 제품 + 그림 폭 상한만 45mm (앞 트랙 §3 권고안 2열)
  "상한29", // 제품 + 그림 폭 상한만 29mm (앞 트랙 §3 권고안 3열)
  "ㄱ-옆2", // 번호 옆 · 2열
  "ㄴ-옆3", // 번호 옆 · 3열
  "ㄷ-아래2", // 번호 아래 · 2열
  "ㄹ-아래3", // 번호 아래 · 3열
  "ㅁ-확인필요", // 짝을 모를 때 ㉠ 그림을 안 그리고 「그림 확인 필요」만 남긴다
  "ㅂ-무번호격자", // 짝을 모를 때 ㉡ 격자로 놓되 **번호를 안 붙이고** 머리말로 알린다
] as const;
export type Variant = (typeof VARIANTS)[number];

/** 제품 컴포넌트가 그리는 시안(이 파일을 안 탄다). */
export const PRODUCT_VARIANTS: readonly Variant[] = [
  "현행",
  "상한45",
  "상한29",
];

/** 시안별 그림 폭 상한 덧칠(mm). 제품 CSS 가 아니라 탐침 `<style>` 로만 넣는다. */
export const CAP_MM: Partial<Record<Variant, number>> = {
  상한45: 45,
  상한29: 29,
};

/* ──────────────────────────────────────────────────────────────────────────
 * 짝 (호출자가 정한다)
 * ────────────────────────────────────────────────────────────────────────── */

export interface FigurePlan {
  /** 발문에 딸린 그림 URL (0장일 수 있다). */
  stem: string[];
  /** 보기 ①②③… 순서대로의 그림 URL. */
  choiceFigures: string[];
  /** 보기에 그림 말고 글자도 있으면 여기에 (없으면 빈 문자열). */
  choiceTexts?: string[];
}

/* ──────────────────────────────────────────────────────────────────────────
 * 탐침 CSS — 시안의 «치수»가 전부 여기 있다. 보고서 §2 가 이 값을 그대로 싣는다.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 제품이 지금 쓰는 값과 맞춘 것:
 *   `.figrefChoices` margin-top 16px  = `mt-4`      (ProblemContent 보기 그리드)
 *   row-gap 8px                       = `gap-y-2`
 *   발문 그림 묶음은 손대지 않는다 — 제품 `ProblemContent` 가 그대로 그린다.
 *
 * 새로 정한 것(원장님 확정 대상):
 *   보기 열 사이 간격 16px — 제품 보기 그리드는 `gap-x-8`(32px) 이지만 그림 보기는
 *   글자 보기와 달리 «칸을 넓게 쓸수록 그림이 커지는» 쪽이라 좁혔다. 32px 로 두면
 *   3열에서 칸이 99.8px 밖에 안 된다(16px 이면 110.5px).
 */
export const PROBE_CSS = `
/* 발문 그림 묶음은 제품 ProblemContent 가 그대로 그린다 — 여기서 다시 정의하지 않는다.
   발문 그림 폭 상한은 탐침 style 태그가 mt-3 안의 img 를 덧칠해서 준다. */

[data-figref] .figrefChoices {
  margin-top: 16px;
  display: grid;
  column-gap: 16px;
  row-gap: 8px;
}
[data-figref] .figrefChoices.cols2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
[data-figref] .figrefChoices.cols3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }

/* 번호 옆 — 마커와 그림이 한 줄에 나란히 */
[data-figref] .figrefChoices.beside .figrefCell {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}
/* 번호 아래 — 마커가 제 줄을 갖는다 */
[data-figref] .figrefChoices.below .figrefCell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
}
[data-figref] .figrefCell > .figrefMark { flex-shrink: 0; line-height: 1.625; }
/* 그림을 감싸는 칸이 반드시 있어야 한다. 없이 img 에만 max-width:100% 를 주면
   그 100% 가 «칸 전체»로 풀려 마커(12.5px)와 간격(6px)만큼 오른쪽으로 삐져나간다 —
   3열에서 실제로 그래프의 x 축 라벨이 잘렸다(시안 사진으로 확인).
   제품 보기 셀도 같은 이유로 min-w-0 flex-1 을 두고 있다 (ProblemContent.tsx). */
[data-figref] .figrefCell > .figrefFig { display: block; min-width: 0; }
[data-figref] .beside .figrefCell > .figrefFig { flex: 1 1 auto; }
[data-figref] .below .figrefCell > .figrefFig { align-self: stretch; }
[data-figref] .figrefCell img { max-width: 100%; height: auto; width: auto; }

/* 짝을 모를 때 — 지면에 «모른다»가 남는다 */
[data-figref] .figrefUnknown {
  margin-top: 12px;
  border: 1px dashed #8a5a00;
  padding: 6px 8px;
  color: #8a5a00;
  font-size: 11px;
}
`;

/* ──────────────────────────────────────────────────────────────────────────
 * 렌더
 * ────────────────────────────────────────────────────────────────────────── */

export interface FigrefBodyProps {
  /**
   * `[그림]` 표시와 빈 보기 줄을 걷어낸 **원문** (`figrefRuler.stripFigureMarks`).
   * 자(`estimateProblemPx`)에 넘기는 것과 **같은 문자열**이어야 한다.
   */
  question: string;
  plan: FigurePlan;
  variant: Variant;
  className?: string;
  /** 「그림 확인 필요」 시안에서 지면에 남길 문구. */
  unknownNote?: string;
}

export function FigrefBody({
  question,
  plan,
  variant,
  className = "",
  unknownNote = "그림 확인 필요 — 보기와 그림의 짝을 알 수 없음",
}: FigrefBodyProps) {
  const beside = variant === "ㄱ-옆2" || variant === "ㄴ-옆3";
  const cols =
    variant === "ㄴ-옆3" ||
    variant === "ㄹ-아래3" ||
    variant === "ㅂ-무번호격자"
      ? 3
      : 2;
  const unknown = variant === "ㅁ-확인필요";
  const unnumbered = variant === "ㅂ-무번호격자";

  return (
    <div className={className} data-figref>
      {/* 발문·상자·수식·발문 그림·«글자가 남은 보기» 전부 제품 경로 그대로. */}
      <ProblemContent
        content={question}
        figureUrls={plan.stem}
        deferFigures={false}
      />
      {unknown ? (
        <div className="figrefUnknown">{unknownNote}</div>
      ) : plan.choiceFigures.length > 0 ? (
        <>
          {unnumbered ? (
            <div className="figrefUnknown">
              보기 그림 · 번호와의 짝을 확인하지 못했다
            </div>
          ) : null}
          <div
            className={`figrefChoices cols${cols} ${beside ? "beside" : "below"}`}
            data-figref-choices
          >
            {plan.choiceFigures.map((url, index) => (
              <div className="figrefCell" key={`${index}-${url}`}>
                {unnumbered ? null : (
                  <span className="figrefMark">
                    {CHOICE_MARKS[index] ?? `(${index + 1})`}
                  </span>
                )}
                <span className="figrefFig">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`보기 ${index + 1} 그림`} />
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
