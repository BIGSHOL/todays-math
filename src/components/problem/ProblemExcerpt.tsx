import { ProblemContent } from "@/components/math/ProblemContent";
import type { ProblemEntity } from "@/contracts/problem.contract";

type ProblemExcerptProps = {
  problem: ProblemEntity;
  className?: string;
};

/** 검수 화면 문제 본문 — 문제은행·인쇄와 같은 mathgen 렌더 경로를 쓴다. */
export function ProblemExcerpt({
  problem,
  className = "",
}: ProblemExcerptProps) {
  return (
    <ProblemContent
      content={problem.content}
      figureUrls={problem.figureUrls}
      className={`min-w-0 text-[12.5px] leading-relaxed text-[#161616] ${className}`}
    />
  );
}
