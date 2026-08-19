/**
 * AI 문제 변형 프롬프트 — v2 (2026-08-19).
 *
 * v1 → v2 변경 사유: 원장님이 변형 **방식**(숫자만 / 조건까지)과 **난이도 조정**(원본 유지 /
 * 한 단계 위·아래)을 화면에서 고르도록 확정(2026-08-19). v1 은 두 축이 "숫자나 조건만
 * 바꾸라"는 한 문장에 뭉뚱그려져 있어 어느 쪽으로도 지시가 되지 않았다.
 *
 * 설계 원칙(sumaek `packages/core/src/variants/` 참조 — 읽기 전용, 그대로 복사가 아닌
 * 이 프로젝트 규모에 맞춘 재구성): **AI는 정답 사슬에 끼지 않는다.** 새 문제의 answer는
 * AI가 제시하지만 그대로 신뢰하지 않고, AI 스스로 세운 변형 규칙을 원본 문제의 숫자에
 * 되돌려 적용했을 때의 답(`originalAnswerRecomputed`)을 함께 받아 원본의 실제 정답
 * (`origin.answer`)과 일치하는지 검사한다("원본 재현 검사" —
 * src/lib/ai/transformer.ts의 `verifiesOriginalReproduction`).
 *
 * ⚠️ v2 부터 **검사에 떨어진 후보를 버리지 않는다.** `verified: false` 로 표시해 화면까지
 *    올려 보내고, 원장님이 사유(재현값 ≠ 원본 정답)를 보고 판단한다 — 걸러 보내면 화면은
 *    「3개 요청했는데 1개만 왔다」는 사실만 알고 왜인지를 못 본다.
 *
 * 대응: src/lib/ai/transformer.ts, POST /api/problems/transform
 */
import type { Difficulty } from "@/contracts/common.contract";
import type {
  DifficultyShift,
  ProblemType,
  TransformMode,
} from "@/contracts/problem.contract";

export const TRANSFORM_PROMPT_VERSION = "v2";

/** 변형 방식별 지시 — 계약의 `transformModeSchema` 와 한 벌이다. */
const MODE_INSTRUCTION: Record<TransformMode, string> = {
  numbers:
    "등장하는 **숫자만** 바꾸십시오. 문장 구조·조건·상황 설정은 원본 그대로 두십시오.",
  conditions:
    "숫자뿐 아니라 **조건과 상황 설정까지** 바꾸십시오. 다만 묻는 개념과 풀이 유형(어떤 공식을 어떤 순서로 쓰는가)은 원본과 같아야 합니다.",
};

/** 난이도 조정별 지시 — 계약의 `difficultyShiftSchema` 와 한 벌이다. */
const DIFFICULTY_SHIFT_INSTRUCTION: Record<DifficultyShift, string> = {
  keep: "난이도는 원본과 같은 수준을 유지하십시오.",
  up: "원본보다 **한 단계 어렵게** 만드십시오 — 계산 단계를 하나 늘리거나 조건을 하나 더 얹는 방식이 적절합니다. 다른 단원의 개념을 끌어오지는 마십시오.",
  down: "원본보다 **한 단계 쉽게** 만드십시오 — 계산 단계를 줄이거나 조건을 덜어내고, 숫자를 다루기 쉬운 값으로 바꾸십시오.",
};

export interface TransformPromptInput {
  originContent: string;
  originAnswer: string;
  originSolution: string | null;
  problemType: ProblemType;
  difficulty: Difficulty;
  count: number;
  mode: TransformMode;
  difficultyShift: DifficultyShift;
}

export function buildTransformSystemPrompt(): string {
  return [
    "당신은 한국 중학교 수학 문제의 숫자·조건을 바꿔 변형 문제를 만드는 조교입니다.",
    "원본 문제가 묻는 개념과 풀이 유형은 그대로 유지하십시오.",
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
  mode,
  difficultyShift,
}: TransformPromptInput): string {
  return [
    `원본 문제 유형: ${problemType}, 난이도: ${difficulty}`,
    `원본 발문: ${originContent}`,
    `원본 정답: ${originAnswer}`,
    originSolution ? `원본 풀이: ${originSolution}` : "원본 풀이: (없음)",
    "",
    `[변형 방식] ${MODE_INSTRUCTION[mode]}`,
    `[난이도] ${DIFFICULTY_SHIFT_INSTRUCTION[difficultyShift]}`,
    "",
    `변형 개수: ${count}개 (서로 달라야 합니다)`,
    "위 지시에 따라 변형한 결과를 JSON 배열로만 응답하십시오.",
  ].join("\n");
}
