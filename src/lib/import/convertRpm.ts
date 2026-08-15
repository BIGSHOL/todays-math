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
    // RPM 원본에는 학교/시험 메타가 없다. 파일 경로만 있으면 싣는다.
    sourceFile: (row as { _sourceFile?: string })._sourceFile ?? null,
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

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮";

/** 보기 배열을 `{id, marker, 본문}` 으로 편다. marker 가 없으면 순번으로 만든다. */
function flattenChoices(
  value: unknown,
): Array<{ id: string; marker: string; text: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    const record = (raw ?? {}) as Record<string, unknown>;
    const marker =
      typeof record.marker === "string" && record.marker.trim()
        ? record.marker.trim()
        : (CIRCLED[index] ?? `${index + 1}.`);
    return {
      // ⚠️ 원본 키는 `choiceId` 다. `id` 로만 읽으면 correctChoiceIds 대조가
      // 전부 실패해 객관식 정답이 통째로 빈다(실측: 원본 보기 9,518개 중
      // `id` 키를 가진 것은 0개). 픽스처를 `id` 로 만들면 테스트는 통과하므로
      // 합성 데이터만으로 검증하지 말 것.
      id:
        (typeof record.choiceId === "string" && record.choiceId) ||
        (typeof record.id === "string" && record.id) ||
        String(index),
      marker,
      text: flattenStructured(
        record.content ?? record.runs ?? record.value ?? record.text ?? raw,
      ).content,
    };
  });
}

/**
 * 정답을 되살린다.
 *
 * ⚠️ `flattenStructured` 만으로는 **절대** 안 된다. 그 함수는
 * runs/content/choices/items/rows 만 훑어서 `correctChoiceIds`(객관식)와
 * `accepted`(주관식)를 못 본다. 그래서 RPM 4,862행의 정답이 통째로
 * 빈 문자열이 됐다(2026-08-15 실측, 원본에서 복구).
 *
 * 객관식은 원장님 확정대로 **보기 번호**로 돌려준다 — 시험지에 ①~⑤ 가
 * 찍히므로 학생이 대조할 수 있다.
 */
function rpmAnswer(
  value: unknown,
  choices: Array<{ id: string; marker: string }>,
): string {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;

  if (record && Array.isArray(record.correctChoiceIds)) {
    const markers = record.correctChoiceIds
      .map((id) => choices.find((choice) => choice.id === id)?.marker)
      .filter((marker): marker is string => Boolean(marker));
    if (markers.length > 0) return markers.join(", ");
  }

  if (record && Array.isArray(record.accepted)) {
    const values = record.accepted
      .map((item) => {
        const entry = (item ?? {}) as Record<string, unknown>;
        return typeof entry.value === "string" ? entry.value.trim() : "";
      })
      .filter(Boolean);
    if (values.length > 0) return values.join(", ");
  }

  return flattenStructured(value).content;
}

/** 공백을 턴 비교용 문자열. */
function squeeze(value: string): string {
  return value.replace(/\s+/g, "");
}

/**
 * 본문 꼬리에 마커 없이 겹쳐 있는 보기 블록을 걷어 낸다.
 * **보기 전체와 완전일치할 때만** 자른다. 하나라도 어긋나면 원문을 그대로 둔다.
 */
function stripTrailingChoices(
  content: string,
  choices: Array<{ text: string }>,
): string {
  if (choices.length === 0) return content;
  const tail = squeeze(choices.map((choice) => choice.text).join(""));
  if (!tail) return content;
  const squeezed = squeeze(content);
  if (!squeezed.endsWith(tail)) return content;

  // 원문에서 잘라 낼 위치를 찾는다 — 뒤에서부터 공백 아닌 글자를 tail 길이만큼 센다.
  let remaining = tail.length;
  let cut = content.length;
  while (cut > 0 && remaining > 0) {
    cut -= 1;
    if (!/\s/.test(content[cut])) remaining -= 1;
  }
  const head = content.slice(0, cut).trimEnd();
  return head || content;
}

/** sumaek questions + current version SELECT 행 → 잠긴 ImportDraft. */
export function convertRpmExtractedRow(row: RpmExtractedRow): ImportDraft {
  const rawBody = flattenStructured(row.body);
  const choiceList = flattenChoices(row.choices);
  // 원본 body 꼬리에는 마커 없는 보기 값이 **이미 한 벌** 들어 있다
  // (실측 1,884행 전부). 그대로 두고 마커 보기를 또 붙이면 같은 보기가
  // 지면에 두 번 인쇄된다. 꼬리가 보기 전체와 완전일치할 때만 걷어 낸다 —
  // 어림짐작으로 자르면 지문을 잘라 먹는다.
  const body = {
    ...rawBody,
    content: stripTrailingChoices(rawBody.content, choiceList),
  };
  const choices = choiceList.length
    ? {
        // 마커를 붙여 싣는다. 없으면 시험지에 보기 번호가 안 찍혀
        // 번호로 된 정답과 대조할 수 없다(실측 1,319건이 그랬다).
        content: choiceList
          .map((choice) => `${choice.marker} ${choice.text}`.trim())
          .join("\n"),
        hasFigure: flattenStructured(row.choices).hasFigure,
      }
    : flattenStructured(row.choices);
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
    answer: rpmAnswer(row.answer, choiceList) || "(정답 없음)",
    solution: explanation.content || null,
    unitHint,
    hasFigure: body.hasFigure || choices.hasFigure,
    gradeHint,
  };
}
