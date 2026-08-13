/**
 * AI 문제 변형 프롬프트 — v1 (2026-08-13, T3.2 최초 작성).
 * 변경 시 버전 문자열과 날짜를 갱신하고 변경 사유를 한 줄로 남긴다.
 *
 * 설계 원칙(sumaek `packages/core/src/variants/` 참조 — 읽기 전용, 그대로 복사가 아닌
 * 이 프로젝트 규모에 맞춘 재구성): **AI는 정답 사슬에 끼지 않는다.** 새 문제의 answer는
 * AI가 제시하지만 그대로 신뢰하지 않고, AI 스스로 세운 변형 규칙을 원본 문제의 숫자에
 * 되돌려 적용했을 때의 답(`originalAnswerRecomputed`)을 함께 받아 원본의 실제 정답
 * (`origin.answer`)과 일치하는지 검사한다("원본 재현 검사" —
 * src/lib/ai/transformer.ts의 `verifiesOriginalReproduction`). 불일치하는 후보는 폐기한다.
 *
 * 대응: src/lib/ai/transformer.ts, POST /api/problems/transform(T3.1)
 */
import type { Difficulty } from "@/contracts/common.contract";
import type { ProblemType } from "@/contracts/problem.contract";

export const TRANSFORM_PROMPT_VERSION = "v1";

export interface TransformPromptInput {
  originContent: string;
  originAnswer: string;
  originSolution: string | null;
  problemType: ProblemType;
  difficulty: Difficulty;
  count: number;
}

export function buildTransformSystemPrompt(): string {
  return [
    "당신은 한국 중학교 수학 문제의 숫자·조건을 바꿔 변형 문제를 만드는 조교입니다.",
    "원본 문제의 풀이 구조(개념·유형·난이도)는 그대로 유지하되, 등장하는 숫자나 조건만 바꾸십시오.",
    "반드시 요청받은 개수만큼의 변형을 JSON 배열로만 응답하십시오. 코드펜스나 설명 문장은 절대 덧붙이지 마십시오.",
    "각 배열 원소는 다음 4개 필드를 가진 객체여야 합니다.",
    "- content: 변형된 발문(수식은 $...$ 인라인 LaTeX, \\dfrac 대신 반드시 \\frac 사용).",
    "- answer: 변형된 문제의 정답.",
    "- solution: 변형된 풀이 과정(선택). 제공하지 않으면 null로 두십시오.",
    "- originalAnswerRecomputed: 지금 세운 풀이 규칙을 '원본 문제의 숫자'에 그대로 적용했을 때 나오는 답. " +
      "아래 제공되는 원본 정답을 그대로 베끼지 말고, 반드시 스스로 규칙을 적용해 계산한 값을 적으십시오.",
    "JSON 문자열 값 안의 백슬래시(\\frac, \\times, \\sqrt 등)는 반드시 \\\\로 이스케이프해 유효한 JSON을 만드십시오.",
  ].join("\n");
}

export function buildTransformUserPrompt({
  originContent,
  originAnswer,
  originSolution,
  problemType,
  difficulty,
  count,
}: TransformPromptInput): string {
  return [
    `원본 문제 유형: ${problemType}, 난이도: ${difficulty}`,
    `원본 발문: ${originContent}`,
    `원본 정답: ${originAnswer}`,
    originSolution ? `원본 풀이: ${originSolution}` : "원본 풀이: (없음)",
    `변형 개수: ${count}개`,
    "위 원본을 바탕으로 숫자·조건만 바꾼 서로 다른 변형을 JSON 배열로만 응답하십시오.",
  ].join("\n");
}
