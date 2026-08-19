/**
 * AI 문제 변형 — 원본 문제 → 숫자/조건을 바꾼 **후보** 배열.
 *
 * 대응 API 경로: POST /api/problems/transform (후보만 반환 — DB 를 건드리지 않는다).
 * 채택된 후보의 저장은 POST /api/problems/transform/adopt 가 맡는다.
 * 대응 계약: src/contracts/problem.contract.ts (problemTransformRequestSchema / transformCandidateSchema)
 * 참조: docs/planning/06-tasks.md T3.2, sumaek packages/core/src/variants/(읽기 전용 참조)
 *
 * ⚠️ 이 모듈은 **분류 필드(unitId·problemType·difficulty)와 source/originProblemId/
 *    reviewStatus 를 만들지 않는다.** 전부 저장 시점에 서버(adopt 라우트)가 원본에서
 *    물려받아 부여한다 — 특히 `originProblemId` 는 RPM 교재 이관본과 AI 변형본을 가르는
 *    유일한 판별자라(D-51) 여기서 흘리면 안 된다.
 */
import type { Difficulty } from "@/contracts/common.contract";
import type {
  DifficultyShift,
  ProblemType,
  TransformCandidate,
  TransformMode,
} from "@/contracts/problem.contract";
import { z } from "zod";

import { callAi } from "./client";
import { AiGenerationError } from "./errors";
import { normalizeLatex, parseAiJsonArray } from "./jsonRepair";
import { verifiesOriginalReproduction } from "./originalReproduction";
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
  /**
   * FigureSpec v2 — 그림에 기대는 문항에서만 요구한다. AI 가 「본문만으로는 못 그린다」고
   * 판단하면 null 이다. 모양 검증은 **엔진**이 한다(허용 키 밖은 예외) — 여기서 또 좁히면
   * 규칙이 두 벌이 되어 갈라진다.
   */
  figureSpec: z.record(z.string(), z.unknown()).nullable().optional(),
});

/** 변형 대상 원본 — 라우트가 DB에서 조회한 ProblemEntity 중 변형에 필요한 필드만 받는다. */
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
  /** 원장님이 화면에서 고른 변형 방식. 생략 시 가장 안전한 `numbers`. */
  mode?: TransformMode;
  /** 원장님이 화면에서 고른 난이도 조정. 생략 시 원본 유지. */
  difficultyShift?: DifficultyShift;
  /**
   * 원본이 그림에 기대는 문항인가. 참이면 프롬프트가 `figureSpec` 을 함께 요구한다.
   * 스펙을 **SVG 로 그리는 일은 여기서 하지 않는다** — 라우트가 한다(이 모듈은 AI 만 본다).
   */
  figureRequired?: boolean;
}

/**
 * AI 문제 변형 — 후보를 만들어 돌려준다. **저장하지 않는다.**
 *
 * 종전(v1)은 원본 재현 검사에 떨어진 후보를 **버리고**, 남은 것이 없으면
 * `AiGenerationError` 를 던졌다. 그래서 화면은 「3개를 요청했는데 1개만 왔다」거나
 * 「그냥 실패했다」는 것만 알고 **왜인지를 볼 수 없었다.** 이제는 떨어진 후보도
 * `verified: false` 와 `originalAnswerRecomputed` 를 달아 그대로 올려 보낸다 —
 * 원장님이 미리보기에서 사유를 보고 판단한다(2026-08-19 확정).
 *
 * `AiGenerationError` 를 던지는 경우는 이제 **하나뿐**이다: 재시도 뒤에도 AI 응답을
 * JSON 으로 파싱하지 못했을 때(=후보가 0개일 때). 호출자
 * (`src/app/api/problems/transform/route.ts`)가 502 로 매핑한다.
 */
export async function transformProblem(
  input: TransformProblemInput,
): Promise<TransformCandidate[]> {
  const {
    origin,
    count,
    mode = "numbers",
    difficultyShift = "keep",
    figureRequired = false,
  } = input;

  // 생성기(`generateProblems`)와 같은 모의 분기 — E2E 와, `DEEPSEEK_API_KEY` 가 아직 없는
  // 환경에서 **화면 흐름 자체**를 확인하기 위한 것이다. 마지막 하나를 일부러 검사 탈락으로
  // 두어 「폐기」 표시와 사유 경로가 반드시 한 번은 밟히게 한다.
  if (process.env.E2E_MOCK_AI === "1") {
    return Array.from({ length: count }, (_, at) => {
      const verified = count === 1 || at < count - 1;
      return {
        content: `모의 변형 문제 ${at + 1} (${mode}/${difficultyShift})`,
        answer: String(at + 1),
        solution: null,
        verified,
        originalAnswerRecomputed: verified ? origin.answer : "모의 불일치 값",
        // 그림 문항이면 **실제로 그려지는** 스펙을 낸다 — 라우트가 진짜 엔진으로 그려
        // 보므로, 키 없이도 도형 경로 전체가 한 번은 밟힌다.
        figureSpec: figureRequired
          ? {
              version: 2,
              points: { A: [0, 0], B: [120 + at * 10, 0], C: [0, 90] },
              segments: { AB: ["A", "B"], BC: ["B", "C"], CA: ["C", "A"] },
              labels: { A: "A", B: "B", C: "C" },
            }
          : null,
        figureSvg: null,
        figureError: null,
      };
    });
  }

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
        mode,
        difficultyShift,
        figureRequired,
      }),
    }).then((raw) => parseAiJsonArray(raw, transformedItemSchema));

  const items = await withOneRetryOnParseFailure(attempt);

  // 요청한 개수까지만 취한다(AI 가 더 얹어 보내는 경우) — 순서는 AI 가 낸 그대로 두어
  // 떨어진 후보가 뒤로 밀려 감춰지지 않게 한다.
  const candidates: TransformCandidate[] = items
    .slice(0, count)
    .map((item) => ({
      content: normalizeLatex(item.content),
      answer: normalizeLatex(item.answer),
      solution: item.solution ? normalizeLatex(item.solution) : null,
      verified: verifiesOriginalReproduction(origin, item),
      originalAnswerRecomputed: normalizeLatex(item.originalAnswerRecomputed),
      // 그림이 필요 없는 문항이면 AI 가 스펙을 냈더라도 버린다 — 안 쓰는 도형을
      // 지면에 얹을 이유가 없고, 그 자리에서만 나는 오류를 만들 이유도 없다.
      figureSpec: figureRequired ? (item.figureSpec ?? null) : null,
      figureSvg: null,
      figureError: null,
    }));

  if (candidates.length === 0) {
    throw new AiGenerationError(
      "AI 문제 변형에 실패했습니다 — 응답에서 변형 후보를 하나도 읽지 못했습니다.",
    );
  }

  return candidates;
}
