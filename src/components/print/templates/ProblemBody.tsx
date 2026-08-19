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
      // 그림 크기는 **물리 크기(mm)** 로 정한다. 모르면 오늘 그대로 픽셀이다.
      // 배선이 한쪽만 되면 그쪽 지표만 좋아진다(CLAUDE.md 2026-08-18) —
      // 자(`printOverflow`)와 지면이 같은 값을 받아야 한다.
      figureDims={problem.figureDims}
      figureSourceMm={problem.figureSourceMm}
      framed={false}
    />
  );
}
