import type { Difficulty } from "@/contracts/common.contract";

/** 자작 시드 1~10 → easy/mid/hard */
export function mapNumericDifficulty(value: number): Difficulty {
  if (value <= 3) return "easy";
  if (value <= 7) return "mid";
  return "hard";
}

/** 배점 기반 휴리스틱 — 기출 문항의 difficulty 필드가 비어 있을 때. */
export function mapScoreToDifficulty(score: number | undefined): Difficulty {
  if (score === undefined) return "mid";
  if (score <= 3) return "easy";
  if (score >= 5) return "hard";
  return "mid";
}

export function mapDifficultyLabel(
  raw: string | undefined,
  score?: number,
): Difficulty {
  const normalized = (raw ?? "").trim().toLowerCase();
  const first = normalized.split(/\s+/)[0] ?? "";
  if (
    first === "easy" ||
    first === "하" ||
    first === "low" ||
    first.startsWith("하")
  ) {
    return "easy";
  }
  if (
    first === "hard" ||
    first === "상" ||
    first === "high" ||
    first.startsWith("상")
  ) {
    return "hard";
  }
  if (first === "mid" || first === "중" || first === "medium") {
    return "mid";
  }
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return mapNumericDifficulty(asNumber);
  }
  return mapScoreToDifficulty(score);
}
