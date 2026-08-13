import type { ProblemType } from "@/contracts/problem.contract";

export function mapProblemType(raw: string | undefined): ProblemType {
  const value = (raw ?? "").trim();
  if (value.includes("서술") || value === "essay" || value === "constructed") {
    return "서술형";
  }
  if (
    value.includes("활용") ||
    value.includes("응용") ||
    value === "application"
  ) {
    return "활용";
  }
  if (
    value.includes("계산") ||
    value.includes("computation") ||
    value.includes("fill_in_blank") ||
    value.includes("단답")
  ) {
    return "계산";
  }
  return "개념";
}
