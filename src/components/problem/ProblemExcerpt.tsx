import { PaperProblemView } from "@/components/print/PaperProblemView";
import type { ProblemEntity } from "@/contracts/problem.contract";

type ProblemExcerptProps = {
  problem: ProblemEntity;
  className?: string;
};

/** 검수 화면 문제 본문 — 문제은행·인쇄와 같은 지면 문항 뷰(줄바꿈까지 동일)를 쓴다. */
export function ProblemExcerpt({
  problem,
  className = "",
}: ProblemExcerptProps) {
  return (
    <div className={`min-w-0 overflow-x-auto ${className}`}>
      <PaperProblemView
        content={problem.content}
        figureUrls={problem.figureUrls}
      />
    </div>
  );
}
