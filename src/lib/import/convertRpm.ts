import { flattenStructured } from "./flattenStructured";
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

export interface RpmExtractedRow {
  id: string;
  kind?: string | null;
  printed_number?: string | null;
  source_ref?: Record<string, unknown> | null;
  body?: unknown;
  choices?: unknown;
  answer?: unknown;
  explanation?: unknown;
  difficulty?: unknown;
  question_type_tags?: unknown;
  concepts?: Array<{ name?: string; grade_band?: string }> | null;
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function rpmDifficultyLabel(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return pickString(record.label, record.badge, record.level) || undefined;
  }
  return undefined;
}

/** sumaek questions + current version SELECT 행 → 잠긴 ImportDraft. */
export function convertRpmExtractedRow(row: RpmExtractedRow): ImportDraft {
  const body = flattenStructured(row.body);
  const choices = flattenStructured(row.choices);
  const answer = flattenStructured(row.answer);
  const explanation = flattenStructured(row.explanation);
  const ref = row.source_ref ?? {};
  const conceptNames = (row.concepts ?? [])
    .map((concept) => concept.name)
    .filter((name): name is string => Boolean(name));
  const unitHint =
    pickString(ref.unit, ref.section, ref.chapter, ref.topic, ref.type) ||
    conceptNames.join(" ");
  const gradeHint =
    pickString(ref.book, ref.gradeBand, ref.grade) ||
    row.concepts?.[0]?.grade_band ||
    undefined;
  const tags = Array.isArray(row.question_type_tags)
    ? row.question_type_tags.filter(
        (tag): tag is string => typeof tag === "string",
      )
    : [];

  return {
    externalId: row.id,
    source: "transformed",
    directUseAllowed: false,
    difficulty: mapDifficultyLabel(rpmDifficultyLabel(row.difficulty)),
    problemType: mapProblemType([row.kind, ...tags].filter(Boolean).join(" ")),
    content: [body.content, choices.content].filter(Boolean).join("\n\n"),
    answer: answer.content || "(정답 없음)",
    solution: explanation.content || null,
    unitHint,
    hasFigure: body.hasFigure || choices.hasFigure,
    gradeHint,
  };
}
