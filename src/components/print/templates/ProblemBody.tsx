import { ProblemContent } from "@/components/math/ProblemContent";
import type { TestPrintProblem } from "@/components/print/types";

import styles from "../TestPrint.module.css";

interface ProblemBodyProps {
  problem: TestPrintProblem;
}

/** 검수·문제은행과 같은 mathgen 렌더 경로(ProblemContent)로 문제 본문을 렌더한다. */
export function ProblemBody({ problem }: ProblemBodyProps) {
  return (
    <ProblemContent
      content={problem.content}
      figureUrls={problem.figureUrls}
      className={styles.problemText}
    />
  );
}
