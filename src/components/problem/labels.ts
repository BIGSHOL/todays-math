import type { Difficulty, ReviewStatus } from "@/contracts/common.contract";

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "쉬움",
  mid: "보통",
  hard: "어려움",
};

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: "대기",
  approved: "승인",
  rejected: "반려",
};

export const SOURCE_LABEL = {
  manual: "자작",
  past_exam: "기출",
} as const;

export const PROBLEM_TYPES = ["계산", "개념", "활용", "서술형"] as const;
