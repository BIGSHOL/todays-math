import type { CSSProperties, ReactNode } from "react";

import {
  A4_DIMENSIONS,
  PAPER_COLORS,
  PAPER_FONTS,
} from "@/components/print/tokens";
import type { PrintPageKind } from "@/components/print/types";

import styles from "./TestPrint.module.css";

interface A4PageProps {
  children: ReactNode;
  kind: PrintPageKind;
  pageNumber: number;
  className?: string;
}

const pageVariables = {
  "--a4-width": `${A4_DIMENSIONS.widthMm}mm`,
  "--a4-height": `${A4_DIMENSIONS.heightMm}mm`,
  "--paper-color": PAPER_COLORS.paper,
  "--paper-warm": PAPER_COLORS.paperWarm,
  "--paper-ink": PAPER_COLORS.ink,
  "--paper-gold": PAPER_COLORS.accentGold,
  "--paper-font-serif": PAPER_FONTS.serifKR,
  "--paper-font-sans": PAPER_FONTS.sansKR,
} as CSSProperties;

/** 미리보기와 브라우저 인쇄가 함께 쓰는 A4 DOM 경계. */
export function A4Page({ children, kind, pageNumber, className }: A4PageProps) {
  return (
    <section
      aria-label={`${kind === "questions" ? "문제지" : "정답지"} ${pageNumber}쪽`}
      className={[styles.a4Page, className].filter(Boolean).join(" ")}
      data-page-kind={kind}
      data-page-number={pageNumber}
      data-print-page="true"
      style={pageVariables}
    >
      {children}
    </section>
  );
}
