/**
 * 정규화된 학교명 키에서 학교급을 뽑는다. `Student.schoolLevel` 채움과 예측 대상 판정에 쓴다.
 *
 * SSOT 이식: eywa `school-name.ts` 의 `kindFromKey` (읽기 전용, 손대지 않음).
 */
import { isSchoolLikeKey } from "./normalizeSchoolName";

/** '오늘의 시험'이 다루는 학교급. 초등은 내신 시험이 없어 애초에 예측 대상이 아니다(11 §6.1). */
export type PredictableSchoolLevel = "중" | "고";

/**
 * 정규화 키 끝 글자로 학교급을 추론한다(`침산초` → "초"). 학교 이름 꼴이 아니거나
 * 판정할 수 없으면 `null` — 애매한 값을 지어내 채우지 않는다.
 */
export function schoolLevelFromKey(key: string): "초" | "중" | "고" | null {
  if (!isSchoolLikeKey(key)) return null;
  if (key.endsWith("여상")) return "고";
  const last = key.at(-1);
  return last === "초" || last === "중" || last === "고" ? last : null;
}

/**
 * 예측 대상 학교급인가 — 초등은 내신이 없어 제외한다(11-score-predictor.md §6.1: 재원 179명이
 * "대상이 아니다"로 명시됨). 판정 불가(null)도 대상이 아니다.
 */
export function isPredictableSchoolLevel(
  level: "초" | "중" | "고" | null,
): level is PredictableSchoolLevel {
  return level === "중" || level === "고";
}
