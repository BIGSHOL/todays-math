/**
 * AI 문제 생성 — (단원, 난이도, 개수) → 계약(problemSchema) 형태의 draft 배열.
 *
 * 대응 API 경로: POST /api/problems/generate (T3.1 — 이 함수를 호출해 DB 영속만 담당한다)
 * 대응 계약: src/contracts/problem.contract.ts (problemGenerateRequestSchema/ResponseSchema)
 * 참조: docs/planning/06-tasks.md T3.2
 */
import type { Difficulty } from "@/contracts/common.contract";
import {
  problemTypeSchema,
  type ProblemType,
} from "@/contracts/problem.contract";
import { z } from "zod";

import { callClaude } from "./client";
import { AiParseError } from "./errors";
import { normalizeLatex, parseAiJsonArray } from "./jsonRepair";
import {
  buildGenerateSystemPrompt,
  buildGenerateUserPrompt,
} from "./prompts/generate";
import { withOneRetryOnParseFailure } from "./retry";

/** AI 응답 원소 형태 — problemType/content/answer/solution만 AI 책임(그 외는 서버가 부여). */
const generatedItemSchema = z.strictObject({
  problemType: problemTypeSchema,
  content: z.string().min(1),
  answer: z.string().min(1),
  solution: z.string().nullable().optional(),
});

export interface GenerateProblemsInput {
  /** 대상 단원 id — 서버가 부여, AI 응답에서 받지 않는다(계약 신뢰 경계). */
  unitId: string;
  /** 프롬프트 문맥용 사람이 읽는 단원명(예: "일차부등식의 활용(농도)") — T3.1이 Unit에서 조회해 전달. */
  unitLabel: string;
  difficulty: Difficulty;
  count: number;
}

/**
 * DB 영속 직전 형태 — id/userId/createdAt/updatedAt은 T3.1(Route Handler + Prisma)이 부여한다.
 * `problemSchema`(계약)에서 이 4개 필드만 빠진 형태와 정확히 일치한다.
 */
export interface GeneratedProblemDraft {
  unitId: string;
  difficulty: Difficulty;
  problemType: ProblemType;
  content: string;
  answer: string;
  solution: string | null;
  source: "ai_generated";
  originProblemId: null;
  reviewStatus: "pending";
}

/**
 * AI 문제 생성. unitId/difficulty/source/originProblemId/reviewStatus는 AI 응답을 신뢰하지
 * 않고 서버가 직접 부여한다(계약 위반 원천 차단) — AI는 problemType/content/answer/solution만
 * 책임진다.
 *
 * JSON/스키마 파싱 실패 시 1회 재시도하며, 재시도 후에도 실패하면 `AiGenerationError`를
 * 던진다(호출자 — `src/app/api/problems/generate/route.ts`, T3.1 — 가
 * `jsonError("AI_GENERATION_FAILED", error.message, 502)`로 매핑).
 */
export async function generateProblems(
  input: GenerateProblemsInput,
): Promise<GeneratedProblemDraft[]> {
  const { unitId, unitLabel, difficulty, count } = input;

  if (process.env.E2E_MOCK_AI === "1") {
    return Array.from({ length: count }, (_, index) => ({
      unitId,
      difficulty,
      problemType: "계산",
      content: `모의 생성 문제 ${index + 1}`,
      answer: String(index + 1),
      solution: null,
      source: "ai_generated" as const,
      originProblemId: null,
      reviewStatus: "pending" as const,
    }));
  }

  const attempt = async () => {
    const raw = await callClaude({
      system: buildGenerateSystemPrompt(),
      prompt: buildGenerateUserPrompt({ unitLabel, difficulty, count }),
    });
    const parsed = parseAiJsonArray(raw, generatedItemSchema);
    if (parsed.length < count) {
      throw new AiParseError(
        `AI가 요청한 ${count}개보다 적은 ${parsed.length}개를 반환했습니다.`,
      );
    }
    return parsed;
  };

  const items = await withOneRetryOnParseFailure(attempt);

  return items.slice(0, count).map((item) => ({
    unitId,
    difficulty,
    problemType: item.problemType,
    content: normalizeLatex(item.content),
    answer: normalizeLatex(item.answer),
    solution: item.solution ? normalizeLatex(item.solution) : null,
    source: "ai_generated" as const,
    originProblemId: null,
    reviewStatus: "pending" as const,
  }));
}
