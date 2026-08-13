import { mapNumericDifficulty } from "./mapDifficulty";
import { mapProblemType } from "./mapProblemType";
import type { ImportDraft } from "./types";

export interface ManualSeedQuestion {
  id: string;
  concept_id?: string;
  category?: string;
  question_type?: string;
  difficulty?: number;
  content?: string;
  options?: Array<{ label?: string; text?: string } | string> | null;
  correct_answer?: string;
  explanation?: string;
  concept_name?: string;
  concept_grade?: string;
  grade?: string;
}

export function convertManualSeedQuestion(
  question: ManualSeedQuestion,
): ImportDraft {
  const options = (question.options ?? []).map((option, index) => {
    if (typeof option === "string") return `${index + 1}. ${option}`;
    const label = option.label ?? String(index + 1);
    return `${label}. ${option.text ?? ""}`;
  });
  const content = [question.content ?? "", options.join("\n")]
    .filter(Boolean)
    .join("\n\n");

  return {
    externalId: question.id,
    source: "manual",
    directUseAllowed: true,
    difficulty: mapNumericDifficulty(question.difficulty ?? 5),
    problemType: mapProblemType(
      [question.category, question.question_type].filter(Boolean).join(" "),
    ),
    content,
    answer: question.correct_answer ?? "",
    solution: question.explanation ?? null,
    unitHint: question.concept_name ?? question.concept_id ?? "",
    hasFigure: false,
    gradeHint: question.concept_grade ?? question.grade ?? question.concept_id,
  };
}
