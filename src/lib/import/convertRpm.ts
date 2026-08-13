import { mapDifficultyLabel } from "./mapDifficulty";
import { mapProblemType } from "./mapProblemType";
import type { ImportDraft } from "./types";

/** sumaek RPM 추출 JSON의 최소 필드 — 읽기 전용 dump를 전제로 한다. */
export interface RpmRow {
  id: string;
  stem?: string;
  content?: string;
  answer?: string;
  solution?: string | null;
  topic?: string;
  concept?: string;
  difficulty?: string | number;
  problemType?: string;
}

export function convertRpmRow(row: RpmRow): ImportDraft {
  return {
    externalId: row.id,
    source: "transformed",
    directUseAllowed: false,
    difficulty: mapDifficultyLabel(
      typeof row.difficulty === "number"
        ? String(row.difficulty)
        : row.difficulty,
    ),
    problemType: mapProblemType(row.problemType),
    content: (row.stem ?? row.content ?? "").trim(),
    answer: (row.answer ?? "").trim() || "(정답 없음)",
    solution: row.solution ?? null,
    unitHint: row.topic ?? row.concept ?? "",
    hasFigure: false,
  };
}
