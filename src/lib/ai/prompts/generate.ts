/**
 * AI 문제 생성 프롬프트 — v1 (2026-08-13, T3.2 최초 작성).
 * 변경 시 버전 문자열과 날짜를 갱신하고 변경 사유를 한 줄로 남긴다(07-coding-convention.md,
 * docs/planning/02-trd.md §5 "프롬프트는 lib/ai/prompts/에 버전 관리").
 *
 * 대응: src/lib/ai/generator.ts, POST /api/problems/generate(T3.1)
 */
import type { Difficulty } from "@/contracts/common.contract";

export const GENERATE_PROMPT_VERSION = "v1";

export interface GeneratePromptInput {
  /** 사람이 읽는 단원명 — 예: "일차부등식의 활용(농도)". */
  unitLabel: string;
  difficulty: Difficulty;
  count: number;
}

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "하(easy) — 기본 개념을 그대로 적용하면 풀리는 수준",
  mid: "중(mid) — 개념을 1~2단계 응용해야 하는 수준",
  hard: "상(hard) — 여러 개념을 복합적으로 활용해야 하는 수준",
};

export function buildGenerateSystemPrompt(): string {
  return [
    "당신은 한국 중학교 수학 문제를 출제하는 조교입니다.",
    "반드시 요청받은 개수만큼의 문제를 JSON 배열로만 응답하십시오. 코드펜스나 설명 문장은 절대 덧붙이지 마십시오.",
    "각 배열 원소는 problemType/content/answer/solution 4개 필드를 가진 객체여야 합니다.",
    '- problemType: "계산" | "개념" | "활용" | "서술형" 중 정확히 하나.',
    "- content: 학생에게 보여줄 발문. 수식은 $...$ 인라인 LaTeX로 표기하고, \\dfrac 대신 반드시 \\frac을 사용하십시오.",
    "- answer: 정답(LaTeX 허용, 단위/조건 포함 가능).",
    "- solution: 풀이 과정(선택). 제공하지 않으면 null로 두십시오.",
    "JSON 문자열 값 안의 백슬래시(\\frac, \\times, \\sqrt 등)는 반드시 \\\\로 이스케이프해 유효한 JSON을 만드십시오.",
  ].join("\n");
}

export function buildGenerateUserPrompt({
  unitLabel,
  difficulty,
  count,
}: GeneratePromptInput): string {
  return [
    `단원: ${unitLabel}`,
    `난이도: ${DIFFICULTY_LABEL[difficulty]}`,
    `문제 개수: ${count}개`,
    "위 조건에 맞는 서로 다른 문제를 생성해 JSON 배열로만 응답하십시오.",
  ].join("\n");
}
