import { PaperProblemView } from "@/components/print/PaperProblemView";
import type { TestPrintProblem } from "@/components/print/types";

interface ProblemBodyProps {
  problem: TestPrintProblem;
}

/** 검수·문제은행과 같은 지면 문항 뷰(PaperProblemView) 한 경로로 문제 본문을 렌더한다. */
export function ProblemBody({ problem }: ProblemBodyProps) {
  return (
    <PaperProblemView
      content={problem.content}
      figureUrls={problem.figureUrls}
      framed={false}
    />
  );
}
