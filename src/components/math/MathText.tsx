/**
 * 정답·해설 등 단문 수식 렌더러 — mathgen MarkdownRenderer 경로를 그대로 탄다.
 * 검수(S-05)·문제은행(S-08)·인쇄(S-06)가 이 경로만 쓴다 — 렌더 경로 분기 금지.
 *
 * 문제 본문(지문 + 보기)은 `ProblemContent`를 쓴다 (mathgen ProblemDisplay 구조).
 */
import { MarkdownRenderer } from "@/components/math/MarkdownRenderer";
import { normalizeOcrText } from "@/lib/problem/parseProblemContent";

export interface MathTextProps {
  text: string;
  className?: string;
  as?: "span" | "div" | "p";
}

export function MathText({ text, className, as = "span" }: MathTextProps) {
  return (
    <MarkdownRenderer
      content={normalizeOcrText(text)}
      className={className}
      inline={as === "span"}
    />
  );
}
