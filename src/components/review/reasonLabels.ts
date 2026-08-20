/**
 * 신고 사유의 **화면 문구** — 기계 키(계약)와 사람 말을 한 곳에서 잇는다.
 *
 * 🔴 문구를 화면에 흩어 적으면 문구를 바꿀 때마다 **지난 기록과 갈라진다.**
 *    저장되는 것은 늘 왼쪽의 기계 키다(`problemReport.contract.ts`).
 */
import type { ReportReason } from "@/contracts/problemReport.contract";

export const REASON_LABELS: Record<ReportReason, string> = {
  figure: "그림이 이상하다",
  content: "문제가 이상하다",
  answer: "답이 틀렸다",
  solution: "해설이 없다·틀렸다",
  unit: "단원이 틀렸다",
  other: "그 밖의 것",
};

/** 화면에 늘어놓는 순서. 「그 밖의 것」은 설명을 요구하므로 맨 끝이다. */
export const REASON_ORDER: readonly ReportReason[] = [
  "figure",
  "content",
  "answer",
  "solution",
  "unit",
  "other",
];
