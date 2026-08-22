import type { UnitSeed } from "../../../prisma/seed-data/units";

/** 초등 엔진이 낸 한 문항. 정답은 생성기가 같은 숫자로 계산한다. */
export type ElemProblem = {
  grade: string;
  chapter: string;
  section: string;
  orderIndex: number;
  content: string;
  answer: string;
  solution: string;
  figureSpec: Record<string, unknown> | null;
};

export type Rng = () => number;

export type ChapterHandler = (unit: UnitSeed, rng: Rng) => ElemProblem;

export const ELEM_GRADES = ["초3", "초4", "초5", "초6"] as const;
