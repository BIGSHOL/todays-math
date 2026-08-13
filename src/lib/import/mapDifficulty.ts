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

export function mapDifficultyLabel(raw: string | undefined, score?: number): Difficulty {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized === "easy" || normalized === "하" || normalized === "low") {
    return "easy";
  }
  if (normalized === "hard" || normalized === "상" || normalized === "high") {
    return "hard";
  }
  if (normalized === "mid" || normalized === "중" || normalized === "medium") {
    return "mid";
  }
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return mapNumericDifficulty(asNumber);
  }
  return mapScoreToDifficulty(score);
}
