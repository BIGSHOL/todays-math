import type { ImportDraft } from "./types";

/** Prisma Problem.createMany에 넣을 최소 행. DB 클라이언트를 여기서 import하지 않는다. */
export interface ImportLoadRow {
  userId: string;
  unitId: string;
  source: ImportDraft["source"];
  difficulty: ImportDraft["difficulty"];
  problemType: ImportDraft["problemType"];
  content: string;
  answer: string;
  solution: string | null;
  reviewStatus: "pending";
  directUseAllowed: boolean;
}

export interface LoadRowSkip {
  externalId: string;
  reason: string;
}

export const IMPORT_TEXT_MAX = 10_000;

export function toLoadRows(
  classified: Array<ImportDraft & { unitId: string }>,
  userId: string,
): { rows: ImportLoadRow[]; skipped: LoadRowSkip[] } {
  const rows: ImportLoadRow[] = [];
  const skipped: LoadRowSkip[] = [];

  for (const draft of classified) {
    if (!draft.content.trim()) {
      skipped.push({
        externalId: draft.externalId,
        reason: "본문이 비어 있습니다.",
      });
      continue;
    }
    if (draft.content.length > IMPORT_TEXT_MAX) {
      skipped.push({
        externalId: draft.externalId,
        reason: `본문이 ${IMPORT_TEXT_MAX}자를 초과합니다.`,
      });
      continue;
    }
    if (draft.answer.length > IMPORT_TEXT_MAX) {
      skipped.push({
        externalId: draft.externalId,
        reason: `정답이 ${IMPORT_TEXT_MAX}자를 초과합니다.`,
      });
      continue;
    }

    rows.push({
      userId,
      unitId: draft.unitId,
      source: draft.source,
      difficulty: draft.difficulty,
      problemType: draft.problemType,
      content: draft.content,
      answer: draft.answer,
      solution: draft.solution,
      reviewStatus: "pending",
      directUseAllowed: draft.directUseAllowed,
    });
  }

  return { rows, skipped };
}
