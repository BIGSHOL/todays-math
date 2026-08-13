import { blocksToLatex } from "./blocksToLatex";
import { mapDifficultyLabel } from "./mapDifficulty";
import { mapProblemType } from "./mapProblemType";
import type { ContentBlock, ImportDraft } from "./types";

export interface PastExamQuestion {
  number: number;
  score?: number;
  type?: string;
  contents?: ContentBlock[];
  choices?: Array<{ number: number; contents?: ContentBlock[] }>;
  sub_questions?: unknown[];
}

export interface PastExamAnswer {
  number: number;
  answer?: string;
  solution?: string;
  topic?: string;
  difficulty?: string;
}

export interface PastExamPaper {
  meta?: {
    exam_id?: number;
    school?: string;
    grade?: number | string;
    subject?: string;
    unit?: string;
  };
  questions?: PastExamQuestion[];
}

export function convertPastExamQuestion(
  question: PastExamQuestion,
  answer: PastExamAnswer | undefined,
  paper: PastExamPaper,
): ImportDraft {
  const stem = blocksToLatex(question.contents);
  const choiceParts = (question.choices ?? []).map((choice) => {
    const body = blocksToLatex(choice.contents).content;
    return `${choice.number}. ${body}`;
  });
  const content = [stem.content, choiceParts.join("\n")]
    .filter(Boolean)
    .join("\n\n");

  const unitHint = [paper.meta?.subject, paper.meta?.unit, answer?.topic]
    .filter(Boolean)
    .join(" ");

  return {
    externalId: `${paper.meta?.exam_id ?? "exam"}-${question.number}`,
    source: "past_exam",
    directUseAllowed: true,
    difficulty: mapDifficultyLabel(answer?.difficulty, question.score),
    problemType: mapProblemType(question.type),
    content,
    answer: (answer?.answer ?? "").trim() || "(정답 없음)",
    solution: answer?.solution?.trim() ? answer.solution : null,
    unitHint,
    hasFigure: stem.hasFigure,
  };
}

export function convertPastExamPaper(
  paper: PastExamPaper,
  answers: PastExamAnswer[],
): ImportDraft[] {
  const byNumber = new Map(answers.map((item) => [item.number, item]));
  return (paper.questions ?? []).map((question) =>
    convertPastExamQuestion(question, byNumber.get(question.number), paper),
  );
}
