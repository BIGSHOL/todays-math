import { allowNonFinalSource, isFinalSource } from "./finalSource";
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
  reviewStatus: "approved";
  directUseAllowed: boolean;
  pool: "shared";

  // 원본 역추적 메타데이터 — 없으면 null 로 넣는다 (08-import-ledger.md).
  // 이 필드들이 빠지면 훼손 문항을 원본 시험지로 되짚을 수 없다.
  externalId: string | null;
  sourceFile: string | null;
  school: string | null;
  subject: string | null;
  examId: string | null;
  questionNumber: number | null;
  score: number | null;
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
    // D-37 — 기출은 완료본에서만 추출한다. 스캔본은 OCR 훼손률이 5배다.
    if (
      draft.source === "past_exam" &&
      !isFinalSource(draft.sourceFile) &&
      !allowNonFinalSource()
    ) {
      skipped.push({
        externalId: draft.externalId,
        reason:
          "완료본이 아닌 원본입니다(D-37). 완료본이 없는 시험지라면 ALLOW_NON_FINAL_SOURCE=1로 허용하세요.",
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
      reviewStatus: "approved",
      directUseAllowed: draft.directUseAllowed,
      pool: "shared",
      externalId: draft.externalId || null,
      sourceFile: draft.sourceFile ?? null,
      school: draft.school ?? null,
      subject: draft.subject ?? null,
      examId: draft.examId ?? null,
      questionNumber: draft.questionNumber ?? null,
      score: draft.score ?? null,
    });
  }

  return { rows, skipped };
}
