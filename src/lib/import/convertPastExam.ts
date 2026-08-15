import { blocksToLatex } from "./blocksToLatex";
import { mapDifficultyLabel } from "./mapDifficulty";
import { mapProblemType } from "./mapProblemType";
import type { ContentBlock, ImportDraft } from "./types";

export interface PastExamQuestion {
  number: number;
  score?: number;
  type?: string;
  topic?: string;
  difficulty?: string;
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
    exam_id?: number | string;
    school?: string;
    grade?: number | string;
    subject?: string;
    unit?: string;
  };
  header?: { title?: string; school?: string; subject?: string };
  /** N드라이브 원본 파일 경로 (추출기가 채운다) */
  _sourceFile?: string;
  questions?: PastExamQuestion[];
  _source?: { exam_id?: number | string };
}

export function convertPastExamQuestion(
  question: PastExamQuestion,
  answer: PastExamAnswer | undefined,
  paper: PastExamPaper,
): ImportDraft {
  const stem = blocksToLatex(question.contents);
  const choiceLatex = (question.choices ?? []).map((choice) =>
    blocksToLatex(choice.contents),
  );
  const choiceParts = choiceLatex.map(
    (body, index) =>
      `${question.choices?.[index]?.number ?? index + 1}. ${body.content}`,
  );
  const content = [stem.content, choiceParts.join("\n")]
    .filter(Boolean)
    .join("\n\n");

  const unitHint =
    question.topic?.trim() ||
    answer?.topic?.trim() ||
    paper.meta?.unit?.trim() ||
    "";
  // exam_index 는 `meta.grade` 에 이미 우리 트리 라벨을 담아 준다("중3","공통수학1").
  // `meta.subject` 는 시험지 원본 표기("수학","수상")라 트리 라벨이 아니므로 폴백이다.
  const gradeHint = paper.meta?.grade ?? paper.meta?.subject;

  return {
    externalId: `${paper.meta?.exam_id ?? "exam"}-${question.number}`,
    source: "past_exam",
    directUseAllowed: true,
    difficulty: mapDifficultyLabel(
      question.difficulty || answer?.difficulty,
      question.score,
    ),
    problemType: mapProblemType(question.type),
    content,
    answer: (answer?.answer ?? "").trim() || "(정답 없음)",
    solution: answer?.solution?.trim() ? answer.solution : null,
    unitHint,
    hasFigure: stem.hasFigure || choiceLatex.some((choice) => choice.hasFigure),
    gradeHint,
    // 원본 역추적 — 적재까지 그대로 흘려보낸다 (08-import-ledger.md)
    sourceFile: paper._sourceFile ?? null,
    school: paper.meta?.school?.trim() || null,
    subject: paper.meta?.subject?.trim() || null,
    examId: paper.meta?.exam_id != null ? String(paper.meta.exam_id) : null,
    questionNumber:
      typeof question.number === "number" ? question.number : null,
    score: typeof question.score === "number" ? question.score : null,
  };
}

/** ocr_pilot의 header/_source/파일명을 meta로 정규화한다. */
export function normalizePastExamPaper(
  raw: PastExamPaper,
  fileStem?: string,
): PastExamPaper {
  const examId =
    raw.meta?.exam_id ?? raw._source?.exam_id ?? fileStem ?? "exam";
  return {
    ...raw,
    meta: {
      ...raw.meta,
      exam_id: examId,
      school: raw.meta?.school ?? raw.header?.school,
      subject: raw.meta?.subject ?? raw.header?.subject,
    },
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
