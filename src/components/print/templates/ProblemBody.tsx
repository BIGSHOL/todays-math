import { MathText } from "@/components/math/MathText";
import type { TestPrintProblem } from "@/components/print/types";

import styles from "../TestPrint.module.css";

interface ProblemBodyProps {
  problem: TestPrintProblem;
}

/** 검수 화면과 같은 MathText 경로로 문제의 KaTeX를 렌더한다. */
export function ProblemBody({ problem }: ProblemBodyProps) {
  return (
    <MathText as="div" className={styles.problemText} text={problem.content} />
  );
}
