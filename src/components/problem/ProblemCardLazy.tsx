"use client";

import dynamic from "next/dynamic";

/**
 * 문제 카드를 **지연 청크로 떼어 낸다** (성능 수리 C-2).
 *
 * 왜 카드 경계에서 자르나:
 * `ProblemCard` 는 두 갈래로 KaTeX + unified/remark 스택(406KB = katex.min.js 272KB
 * + textPreprocess 56KB + react-markdown/remark/rehype)을 끌고 온다.
 *   ProblemCard → MathText → MarkdownRenderer
 *   ProblemCard → PaperProblemView → ProblemContent → MarkdownRenderer
 * 둘 중 하나만 떼면 나머지 갈래로 그대로 딸려 들어오므로 **카드 자체**를 잘라야 한다.
 *
 * 왜 `MathText`/`PaperProblemView` 를 직접 자르지 않았나:
 * 그 둘은 인쇄 지면(`TestPrint` → `JaseupTemplate`)도 쓰는 공용 부품이다. 인쇄는
 * 실물 출력이 완료 조건이라(CLAUDE.md 절대 규칙 6) 수식이 늦게 그려지면 실패다.
 * 카드 경계에서 자르면 인쇄 경로는 **정적 import 그대로** 남는다.
 *
 * 화면이 달라지지 않게 하는 장치 (D-07):
 * 목록 카드는 `/api/problems` 응답이 온 뒤에야 그려진다. 그런데 카드가 렌더될 때
 * 청크를 받기 시작하면 「fetch → 청크 → 페인트」로 직렬이 된다. 그래서 하이드레이션
 * 직후 미리 내려받기를 시작해 **목록 fetch 와 병렬로** 준비되게 한다. 첫 페인트를
 * 막지 않으면서(초기 번들에서 빠짐) 쓸 시점에는 이미 와 있다.
 */
const loadProblemCard = () =>
  import("@/components/problem/ProblemCard").then((mod) => ({
    default: mod.ProblemCard,
  }));

if (typeof window !== "undefined") {
  void loadProblemCard();
}

export const ProblemCard = dynamic(loadProblemCard, {
  ssr: false,
  loading: () => null,
});
