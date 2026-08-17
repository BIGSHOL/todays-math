import type { TestPrintProblem } from "@/components/print/types";

/**
 * 서술형 문항에 **지면 순번**을 매긴다.
 *
 * 배경: DB 본문에 `[서술형 3]` 같은 원본 시험지 라벨이 박혀 있었다(실측 8,436건).
 * 원장님 지시로 본문에서는 걷어내고, 대신 **문항을 배치할 때** 조판이 붙인다.
 *
 * 매기는 번호는 **이 시험지에서의 순번**이다. 원본 시험지의 `3` 은 새 시험지에서
 * 아무 뜻이 없고, 오히려 학생이 문항 번호로 오해한다.
 *
 * `questionType` 이 비어 있으면 매기지 않는다 — 모르는 것을 서술형이라 단정하면
 * **틀린 표시**가 나가고, 그건 표시가 없는 것보다 나쁘다.
 */
export function assignEssayLabels(
  problems: readonly TestPrintProblem[],
): Map<string, number> {
  const labels = new Map<string, number>();
  let next = 1;
  for (const problem of problems) {
    if (problem.questionType !== "서술형") continue;
    labels.set(problem.id, next);
    next += 1;
  }
  return labels;
}
