/**
 * 🔒 **옛 분할 — 2026-08-21 이전의 `src/lib/printPack.ts` 를 git 에서 그대로 꺼낸 것.**
 *
 *   git show 49006818:src/lib/printPack.ts
 *
 * 전후를 견주려면 **분모를 검산해야 한다.** 「이렇게 부르면 옛 동작과 같다」는
 * 추론이지 측정이 아니다 — 옛 코드는 git 에 그대로 있으니 꺼내서 같은 입력으로
 * 돌려 대조하면 된다(CLAUDE.md 2026-08-18). 한 글자도 고치지 않는다.
 *
 * 제품 코드가 아니다. 지우지 말 것 — 지우면 「얼마나 좋아졌나」를 다시 못 잰다.
 */
import type { TestPrintProblem } from "../../../src/components/print/types";
import { JASEUP_GEOMETRY } from "../../../src/lib/printGeometry";

export interface LegacyPackedPage {
  problems: TestPrintProblem[];
  startingNumber: number;
}

/** 자습 지면의 읽기 순서를 유지하며 장당 두 문항으로 나눈다. */
export function packProblemsLegacy(
  problems: TestPrintProblem[],
): LegacyPackedPage[] {
  const pages: LegacyPackedPage[] = [];

  for (
    let index = 0;
    index < problems.length;
    index += JASEUP_GEOMETRY.questionsPerPage
  ) {
    pages.push({
      problems: problems.slice(index, index + JASEUP_GEOMETRY.questionsPerPage),
      startingNumber: index + 1,
    });
  }

  return pages;
}
