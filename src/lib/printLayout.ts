import type { TestPrintProblem } from "@/components/print/types";
import { JASEUP_GEOMETRY } from "@/lib/printGeometry";

export interface AnswerKeyPage {
  problems: TestPrintProblem[];
  startingNumber: number;
}

/** 빠른 정답과 해설이 A4 높이를 넘지 않도록 정답 항목을 보수적으로 나눈다. */
export function paginateAnswerKey(
  problems: TestPrintProblem[],
): AnswerKeyPage[] {
  const pages: AnswerKeyPage[] = [];

  for (
    let index = 0;
    index < problems.length;
    index += JASEUP_GEOMETRY.answerEntriesPerPage
  ) {
    pages.push({
      problems: problems.slice(
        index,
        index + JASEUP_GEOMETRY.answerEntriesPerPage,
      ),
      startingNumber: index + 1,
    });
  }

  return pages;
}
