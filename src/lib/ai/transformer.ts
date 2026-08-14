/**
 * AI 문제 변형 — 원본 문제 → 숫자/조건을 바꾼 draft 배열.
 *
 * 대응 API 경로: POST /api/problems/transform (T3.1 — 이 함수를 호출해 DB 영속만 담당한다.
 * originProblemId로 원본을 조회하는 것도 T3.1 책임 — 이 모듈은 이미 조회된 원본을 받는다.)
 * 대응 계약: src/contracts/problem.contract.ts (problemTransformRequestSchema/ResponseSchema)
 * 참조: docs/planning/06-tasks.md T3.2, sumaek packages/core/src/variants/(읽기 전용 참조)
 */
import type { Difficulty } from "@/contracts/common.contract";
import type { ProblemType } from "@/contracts/problem.contract";
import { z } from "zod";

import { callAi } from "./client";
import { AiGenerationError } from "./errors";
import { normalizeLatex, parseAiJsonArray } from "./jsonRepair";
import {
  buildTransformSystemPrompt,
  buildTransformUserPrompt,
} from "./prompts/transform";
import { withOneRetryOnParseFailure } from "./retry";

/**
 * AI 응답 원소 형태 — content/answer/solution 및 원본 재현 검사용
 * originalAnswerRecomputed만 AI 책임(그 외는 원본에서 서버가 물려받아 부여).
 */
const transformedItemSchema = z.strictObject({
  content: z.string().min(1),
  answer: z.string().min(1),
  solution: z.string().nullable().optional(),
  originalAnswerRecomputed: z.string().min(1),
});
type TransformedItem = z.infer<typeof transformedItemSchema>;

/** 변형 대상 원본 — T3.1이 DB에서 조회한 ProblemEntity 중 변형에 필요한 필드만 받는다. */
export interface TransformProblemOrigin {
  id: string;
  unitId: string;
  difficulty: Difficulty;
  problemType: ProblemType;
  content: string;
  answer: string;
  solution: string | null;
}

export interface TransformProblemInput {
  origin: TransformProblemOrigin;
  count: number;
}

/**
 * DB 영속 직전 형태 — id/userId/createdAt/updatedAt은 T3.1(Route Handler + Prisma)이 부여한다.
 * `problemSchema`(계약)에서 이 4개 필드만 빠진 형태와 정확히 일치한다.
 */
export interface TransformedProblemDraft {
  unitId: string;
  difficulty: Difficulty;
  problemType: ProblemType;
  content: string;
  answer: string;
  solution: string | null;
  source: "transformed";
  originProblemId: string;
  reviewStatus: "pending";
}

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
  origin: Pick<TransformProblemOrigin, "answer">,
  candidate: Pick<TransformedItem, "originalAnswerRecomputed">,
): boolean {
  return (
    normalizeForComparison(candidate.originalAnswerRecomputed) ===
    normalizeForComparison(origin.answer)
  );
}

/**
 * AI 문제 변형. unitId/difficulty/problemType/source/originProblemId/reviewStatus는 원본에서
 * 그대로 물려받아 서버가 부여한다(AI가 분류를 바꿀 수 없다) — AI는 content/answer/solution 및
 * 원본 재현 검사용 originalAnswerRecomputed만 책임진다.
 *
 * `verifiesOriginalReproduction`을 통과하지 못한 후보는 폐기하고, 통과한 후보만 반환한다.
 * JSON/스키마 파싱은 1회 재시도하며, 재시도 후에도 파싱에 실패하거나 검증을 통과한 후보가
 * 하나도 없으면 `AiGenerationError`를 던진다(호출자 —
 * `src/app/api/problems/transform/route.ts`, T3.1 — 가
 * `jsonError("AI_GENERATION_FAILED", error.message, 502)`로 매핑).
 */
export async function transformProblem(
  input: TransformProblemInput,
): Promise<TransformedProblemDraft[]> {
  const { origin, count } = input;

  const attempt = () =>
    callAi({
      system: buildTransformSystemPrompt(),
      prompt: buildTransformUserPrompt({
        originContent: origin.content,
        originAnswer: origin.answer,
        originSolution: origin.solution,
        problemType: origin.problemType,
        difficulty: origin.difficulty,
        count,
      }),
    }).then((raw) => parseAiJsonArray(raw, transformedItemSchema));

  const items = await withOneRetryOnParseFailure(attempt);

  const verified: TransformedProblemDraft[] = items
    .filter((item) => verifiesOriginalReproduction(origin, item))
    .slice(0, count)
    .map((item) => ({
      unitId: origin.unitId,
      difficulty: origin.difficulty,
      problemType: origin.problemType,
      content: normalizeLatex(item.content),
      answer: normalizeLatex(item.answer),
      solution: item.solution ? normalizeLatex(item.solution) : null,
      source: "transformed" as const,
      originProblemId: origin.id,
      reviewStatus: "pending" as const,
    }));

  if (verified.length === 0) {
    throw new AiGenerationError(
      "AI 문제 변형에 실패했습니다 — 원본 재현 검사를 통과한 후보가 없습니다.",
    );
  }

  return verified;
}
