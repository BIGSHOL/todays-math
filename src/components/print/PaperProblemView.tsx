import type { CSSProperties } from "react";

import { ProblemContent } from "@/components/math/ProblemContent";
import { PAPER_CSS_VARIABLES } from "@/components/print/tokens";

import styles from "./TestPrint.module.css";

const paperVariables = PAPER_CSS_VARIABLES as CSSProperties;

export interface PaperProblemViewProps {
  content: string;
  figureUrls?: string[];
  /** false = 이미 지면(A4Page) 안이라 틀 없이 본문만 그린다 (인쇄 템플릿 전용). */
  framed?: boolean;
}

/**
 * 지면 문항 뷰 — 문제 본문을 **인쇄 문항 열과 같은 폭·서체·행간**으로 그린다.
 * 문제은행·검수·인쇄 어디서든 이 컴포넌트 하나를 거치므로 줄바꿈까지 화면과 지면이 같다
 * (2026-08-17 원장님 지시 "모든 문제를 인쇄시와 동일한 뷰로").
 * 렌더 경로 분기 금지 — 새 화면에서 문제를 보여줄 때도 이걸 쓸 것.
 */
export function PaperProblemView({
  content,
  figureUrls,
  framed = true,
}: PaperProblemViewProps) {
  const body = (
    <ProblemContent
      content={content}
      figureUrls={figureUrls}
      className={styles.problemText}
    />
  );

  if (!framed) {
    return <div data-paper-view>{body}</div>;
  }

  return (
    <div data-paper-view className={styles.paperParity} style={paperVariables}>
      {body}
    </div>
  );
}
