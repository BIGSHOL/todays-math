export interface FlattenResult {
  content: string;
  hasFigure: boolean;
}

const FIGURE_TYPES = new Set([
  "figure",
  "diagram",
  "image",
  "image_crop",
  "figure_svg",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function join(left: string, right: string): string {
  if (!right) return left;
  if (!left) return right;
  return `${left}\n\n${right}`;
}

function wrapMath(latex: string): string {
  const trimmed = latex.trim();
  if (trimmed.startsWith("$") || trimmed.startsWith("\\[")) return trimmed;
  return `$${trimmed}$`;
}

function append(acc: FlattenResult, text: string): void {
  acc.content = join(acc.content, text);
}

function flattenUnknown(value: unknown, acc: FlattenResult): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (value.trim()) append(acc, value.trim());
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    append(acc, String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenUnknown(item, acc);
    return;
  }

  const record = asRecord(value);
  if (!record) return;

  const type = typeof record.type === "string" ? record.type : "";
  const kind = typeof record.kind === "string" ? record.kind : "";
  if (FIGURE_TYPES.has(type) || FIGURE_TYPES.has(kind)) {
    acc.hasFigure = true;
    const alt =
      (typeof record.altText === "string" && record.altText) ||
      (typeof record.caption === "string" && record.caption) ||
      (typeof record.value === "string" && record.value) ||
      "";
    append(acc, `[그림] ${alt}`.trim());
    return;
  }

  if (type === "inline_math" || type === "display_math" || kind === "math") {
    const math = asRecord(record.math);
    const latex = math?.latex ?? record.latex ?? record.value ?? record.text;
    if (typeof latex === "string" && latex.trim()) append(acc, wrapMath(latex));
    return;
  }

  if (typeof record.latex === "string" && record.latex.trim()) {
    append(acc, wrapMath(record.latex));
  } else if (typeof record.text === "string" && record.text.trim()) {
    append(acc, record.text.trim());
  } else if (typeof record.value === "string" && record.value.trim()) {
    append(acc, record.value.trim());
  }

  if (Array.isArray(record.runs)) flattenUnknown(record.runs, acc);
  if (Array.isArray(record.content)) flattenUnknown(record.content, acc);
  if (Array.isArray(record.choices)) flattenUnknown(record.choices, acc);
  if (Array.isArray(record.items)) flattenUnknown(record.items, acc);
  if (Array.isArray(record.rows)) flattenUnknown(record.rows, acc);
}

/** sumaek question_versions.body/choices/answer JSON을 마크다운+LaTeX로 편다. */
export function flattenStructured(value: unknown): FlattenResult {
  const acc: FlattenResult = { content: "", hasFigure: false };
  flattenUnknown(value, acc);
  return { content: acc.content.trim(), hasFigure: acc.hasFigure };
}
