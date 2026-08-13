import type { Difficulty } from "@/contracts/common.contract";
import type { ProblemType } from "@/contracts/problem.contract";

export interface ContentBlock {
  type: string;
  value?: string;
}

export interface ImportDraft {
  externalId: string;
  source: "past_exam" | "manual" | "transformed";
  directUseAllowed: boolean;
  difficulty: Difficulty;
  problemType: ProblemType;
  content: string;
  answer: string;
  solution: string | null;
  unitHint: string;
  hasFigure: boolean;
}

export interface UnitLike {
  id: string;
  grade: string;
  chapter: string;
  section: string;
}

export type MapResult =
  | { status: "mapped"; unitId: string }
  | { status: "unclassified"; reason: string };

export interface ImportReportItem {
  externalId: string;
  source: ImportDraft["source"];
  status: "ok" | "unclassified" | "skipped_figure";
  unitId: string | null;
  unitHint: string;
  reason?: string;
}

export interface ImportReport {
  source: string;
  total: number;
  ok: number;
  unclassified: number;
  skippedFigure: number;
  items: ImportReportItem[];
}
