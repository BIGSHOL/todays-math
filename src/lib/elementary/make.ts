import type { UnitSeed } from "../../../prisma/seed-data/units";

import type { ElemProblem } from "./types";

export function make(
  unit: UnitSeed,
  content: string,
  answer: string,
  solution: string,
  figureSpec: Record<string, unknown> | null = null,
): ElemProblem {
  return {
    grade: unit.grade,
    chapter: unit.chapter,
    section: unit.section,
    orderIndex: unit.orderIndex,
    content,
    answer,
    solution,
    figureSpec,
  };
}

export function fig(kind: string, rest: Record<string, unknown>): Record<string, unknown> {
  return { version: "elem-1", kind, ...rest };
}
