import type { TestPrintProblem } from "@/components/print/types";
import { JASEUP_GEOMETRY } from "@/lib/printGeometry";

export interface PackedProblemPage {
  problems: TestPrintProblem[];
  startingNumber: number;
}

/** 자습 지면의 읽기 순서를 유지하며 장당 두 문항으로 나눈다. */
export function packProblems(
  problems: TestPrintProblem[],
): PackedProblemPage[] {
  const pages: PackedProblemPage[] = [];

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
