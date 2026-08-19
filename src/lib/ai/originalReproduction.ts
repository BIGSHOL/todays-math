/**
 * 원본 재현 검사 — **여기가 유일한 구현**이다.
 *
 * 후보를 만들 때(`src/lib/ai/transformer.ts`)와 채택해 저장할 때
 * (`src/app/api/problems/transform/adopt/route.ts`)가 **다른 모듈**이라, 각자 손으로 적으면
 * 한쪽만 고쳐도 아무도 모른다 (2026-08-18 「규칙이 옳아도 배선이 한쪽만 되면 그쪽 지표만
 * 좋아진다」와 같은 자리). `shiftDifficulty` 를 계약 한 곳에 둔 것과 같은 이유다.
 *
 * `transformer.ts` 가 아니라 이 파일에 있는 이유: `transformer` 는 `./client` 를 타고
 * `openai` SDK 를 끌고 온다. 저장 라우트는 AI 를 부르지 않으므로 그 짐을 질 이유가 없다.
 */
import { normalizeLatex } from "./jsonRepair";

/** 답 비교 전 공백/개행을 제거하고 \dfrac→\frac을 정규화해 표기 차이로 인한 오탐을 줄인다. */
function normalizeForComparison(text: string): string {
  return normalizeLatex(text).replace(/\s+/g, "");
}

/**
 * 원본 재현 검사(sumaek `packages/core/src/variants/` 설계의 MVP 골격 — 읽기 전용 참조).
 * AI가 자신이 세운 변형 규칙을 원본 문제의 숫자에 되돌려 적용했을 때
 * (`candidate.originalAnswerRecomputed`) 원본의 실제 정답(`origin.answer`)을 재현하는지
 * 확인한다. 새 문제의 답(`candidate.answer`)은 이 검사를 통과했을 때만 신뢰한다 — AI가
 * 정답 사슬에 단독으로 끼지 않도록 하는 최소 방어선이다.
 *
 * ⚠️ MVP 골격: 완전한 기호 연산 solve()(sumaek parse/solve/render/vary/check 4단 분리)는
 * v2 범위 — 지금은 AI 자기 일관성 검사(self-consistency check)로 대체한다.
 */
export function verifiesOriginalReproduction(
  origin: { answer: string },
  candidate: { originalAnswerRecomputed: string },
): boolean {
  return (
    normalizeForComparison(candidate.originalAnswerRecomputed) ===
    normalizeForComparison(origin.answer)
  );
}
