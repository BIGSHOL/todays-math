/**
 * 문제 본문·정답·해설 공통 수식 렌더러.
 * 검수(S-05)·문제은행(S-08)·인쇄(S-06)가 이 컴포넌트만 쓴다 — 경로 분기 금지.
 */
import { renderMathHtml } from "@/lib/math/renderMathHtml";

export interface MathTextProps {
  text: string;
  className?: string;
  as?: "span" | "div" | "p";
}

export function MathText({ text, className, as: Tag = "span" }: MathTextProps) {
  return (
    <Tag
      className={className}
      dangerouslySetInnerHTML={{ __html: renderMathHtml(text) }}
    />
  );
}
