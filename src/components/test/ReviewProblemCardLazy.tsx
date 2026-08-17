"use client";

import dynamic from "next/dynamic";

/**
 * 검수 문제 카드를 **지연 청크로 떼어 낸다** (성능 수리 C-2).
 *
 * `ReviewProblemCard` 는 `MathText` 와 `ProblemExcerpt`(→ PaperProblemView →
 * ProblemContent) 두 갈래로 KaTeX + unified/remark 스택(406KB)을 끌고 온다.
 * 카드 경계에서 자르면 인쇄 경로(`TestPrint`)의 정적 import 는 건드리지 않는다
 * — 인쇄는 실물 출력이 완료 조건이라(CLAUDE.md 절대 규칙 6) 지연시키면 안 된다.
 *
 * 자세한 근거와 프리로드 이유는 `ProblemCardLazy.tsx` 주석 참조.
 */
const loadReviewProblemCard = () =>
  import("@/components/test/ReviewProblemCard").then((mod) => ({
    default: mod.ReviewProblemCard,
  }));

if (typeof window !== "undefined") {
  void loadReviewProblemCard();
}

export const ReviewProblemCard = dynamic(loadReviewProblemCard, {
  ssr: false,
  loading: () => null,
});
