import type { MapResult, UnitLike } from "./types";

const GRADE_ALIASES: Record<string, string> = {
  middle_1: "중1",
  middle_2: "중2",
  middle_3: "중3",
  elementary_3: "초3",
  elementary_4: "초4",
  elementary_5: "초5",
  elementary_6: "초6",
  high_1: "공통수학1",
  high_2: "공통수학2",
  공수1: "공통수학1",
  공수2: "공통수학2",
  공통수학1: "공통수학1",
  공통수학2: "공통수학2",
};

export function normalizeGrade(
  raw: string | number | undefined,
): string | null {
  if (raw === undefined || raw === "") return null;
  if (typeof raw === "number") {
    if (raw === 1) return "공통수학1";
    if (raw === 2) return "공통수학2";
    return null;
  }
  const trimmed = raw.trim();
  if (GRADE_ALIASES[trimmed]) return GRADE_ALIASES[trimmed];

  const conceptId = trimmed.match(/^(e|m|h)(\d)/i);
  if (conceptId) {
    const n = conceptId[2];
    const kind = conceptId[1].toLowerCase();
    if (kind === "e") return `초${n}`;
    if (kind === "m") return `중${n}`;
    if (kind === "h") return n === "1" ? "공통수학1" : "공통수학2";
  }

  const book = trimmed.match(/중([123])(?:\s*[-–]\s*[12])?/);
  if (book) return `중${book[1]}`;
  const elem = trimmed.match(/초([1-6])/);
  if (elem) return `초${elem[1]}`;

  return trimmed;
}

function includesLoose(haystack: string, needle: string): boolean {
  return haystack.replace(/\s+/g, "").includes(needle.replace(/\s+/g, ""));
}

export function mapUnitHint(
  hint: string,
  units: UnitLike[],
  gradeHint?: string | number,
): MapResult {
  const cleaned = hint.trim();
  if (!cleaned) {
    return { status: "unclassified", reason: "단원 힌트가 비어 있습니다." };
  }

  const grade = normalizeGrade(gradeHint);
  const scoped = grade ? units.filter((unit) => unit.grade === grade) : units;
  const pool = scoped.length > 0 ? scoped : units;

  const tokens = cleaned
    .split(/[~～,，/|·]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const hints = tokens.length > 0 ? tokens : [cleaned];

  for (const hint of hints) {
    const sectionHit = longestHit(pool, hint, "section");
    if (sectionHit) return { status: "mapped", unitId: sectionHit.id };
  }
  for (const hint of hints) {
    const chapterHit = longestHit(pool, hint, "chapter");
    if (chapterHit) return { status: "mapped", unitId: chapterHit.id };
  }

  return {
    status: "unclassified",
    reason: `단원 힌트 '${cleaned}'를 교육과정 트리에 연결하지 못했습니다.`,
  };
}

function longestHit(
  pool: UnitLike[],
  hint: string,
  field: "section" | "chapter",
): UnitLike | undefined {
  const hits = pool.filter(
    (unit) =>
      includesLoose(unit[field], hint) || includesLoose(hint, unit[field]),
  );
  if (hits.length === 0) return undefined;
  hits.sort((a, b) => b[field].length - a[field].length);
  return hits[0];
}
