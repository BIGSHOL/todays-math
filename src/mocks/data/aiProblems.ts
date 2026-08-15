/**
 * AI 응답 Mock 픽스처 (T0.5.2) — 생성 5개 + 변형 3개.
 *
 * 대응 API 경로: POST /api/problems/generate, POST /api/problems/transform
 * (src/contracts/problem.contract.ts)
 *
 * 이 파일은 두 가지 용도로 쓰인다:
 *   1) src/mocks/handlers/problem.ts — MSW가 두 엔드포인트 성공 응답으로 그대로 반환한다.
 *   2) T3.2(AI API 래퍼) — `vi.mock("openai")`가 SDK 응답 형태(텍스트/JSON)로
 *      감싸 쓸 수 있도록, 여기서는 계약을 통과하는 "정제된 결과"만 내보낸다
 *      (SDK 원시 응답 포맷팅은 T3.2 구현 책임 — 이 픽스처는 파싱 이후의 최종 결과다).
 *
 * 생성 문제는 의도적으로 MOCK_EMPTY_PROBLEM_UNIT(orderIndex 427, 등록된 문제 0건)을 대상으로
 * 한다 — "문제 부족(INSUFFICIENT_PROBLEMS) → AI 생성으로 보충"이라는 실제 사용 시나리오
 * (여정 C, 06-tasks.md T6.1)와 픽스처를 일치시키기 위함이다.
 *
 * 생성물은 계약 규칙대로 항상 reviewStatus="pending"이며, 등록 엔드포인트와 달리
 * source는 "ai_generated"/"transformed"만 허용된다(problemCreateRequestSchema는 이 두 값을
 * 등록 요청 출처로 reject한다 — 이 값들은 서버가 전용 엔드포인트에서만 부여한다).
 */
import type { ProblemEntity } from "@/contracts/problem.contract";

import {
  aiGeneratedProblemId,
  aiTransformedProblemId,
  USER_TEACHER_ID,
} from "./ids";
import { MOCK_EMPTY_PROBLEM_UNIT } from "./units";
import { MOCK_PROBLEMS } from "./problems";

const GENERATED_UNIT_ID = MOCK_EMPTY_PROBLEM_UNIT.id; // 427 일차부등식의 활용(농도)

// ── AI 생성 (POST /api/problems/generate) — 5개 ──────────────
export const MOCK_AI_GENERATED_PROBLEMS: ProblemEntity[] = [
  {
    id: aiGeneratedProblemId(1),
    userId: USER_TEACHER_ID,
    unitId: GENERATED_UNIT_ID,
    source: "ai_generated",
    originProblemId: null,
    difficulty: "easy",
    problemType: "계산",
    content:
      "$5\\%$의 소금물 $200\\text{g}$에 물을 더 넣어 농도를 $2\\%$ 이하로 만들려고 한다. 더 넣어야 하는 물의 양의 범위를 구하시오.",
    answer: "$300\\text{g}$ 이상",
    solution:
      "더 넣는 물의 양을 $x\\text{g}$이라 하면 $\\frac{200 \\times 0.05}{200+x} \\le 0.02$",
    reviewStatus: "pending",
    directUseAllowed: true,
    pool: "shared",
    figureUrls: [],
    createdAt: "2026-08-05T09:00:00Z",
    updatedAt: "2026-08-05T09:00:00Z",
  },
  {
    id: aiGeneratedProblemId(2),
    userId: USER_TEACHER_ID,
    unitId: GENERATED_UNIT_ID,
    source: "ai_generated",
    originProblemId: null,
    difficulty: "easy",
    problemType: "개념",
    content:
      "소금물의 농도를 구하는 식 $\\frac{\\text{소금의 양}}{\\text{소금물의 양}} \\times 100$에서, 소금물의 양이 늘어나고 소금의 양이 일정하면 농도는 어떻게 변하는지 서술하시오.",
    answer: "낮아진다.",
    solution: null,
    reviewStatus: "pending",
    directUseAllowed: true,
    pool: "shared",
    figureUrls: [],
    createdAt: "2026-08-05T09:01:00Z",
    updatedAt: "2026-08-05T09:01:00Z",
  },
  {
    id: aiGeneratedProblemId(3),
    userId: USER_TEACHER_ID,
    unitId: GENERATED_UNIT_ID,
    source: "ai_generated",
    originProblemId: null,
    difficulty: "mid",
    problemType: "계산",
    content:
      "$8\\%$의 소금물 $300\\text{g}$에서 물을 증발시켜 농도를 $12\\%$ 이상으로 만들려고 한다. 증발시켜야 하는 물의 양의 범위를 구하시오.",
    answer: "$100\\text{g}$ 이상",
    solution:
      "증발시키는 물의 양을 $x\\text{g}$이라 하면 $\\frac{24}{300-x} \\times 100 \\ge 12$",
    reviewStatus: "pending",
    directUseAllowed: true,
    pool: "shared",
    figureUrls: [],
    createdAt: "2026-08-05T09:02:00Z",
    updatedAt: "2026-08-05T09:02:00Z",
  },
  {
    id: aiGeneratedProblemId(4),
    userId: USER_TEACHER_ID,
    unitId: GENERATED_UNIT_ID,
    source: "ai_generated",
    originProblemId: null,
    difficulty: "mid",
    problemType: "활용",
    content:
      "$10\\%$의 소금물과 $4\\%$의 소금물을 섞어 $6\\%$ 이상 $8\\%$ 이하의 소금물 $300\\text{g}$을 만들려고 한다. 필요한 $10\\%$ 소금물의 양의 범위를 구하시오.",
    answer: "$100\\text{g}$ 이상 $200\\text{g}$ 이하",
    solution: null,
    reviewStatus: "pending",
    directUseAllowed: true,
    pool: "shared",
    figureUrls: [],
    createdAt: "2026-08-05T09:03:00Z",
    updatedAt: "2026-08-05T09:03:00Z",
  },
  {
    id: aiGeneratedProblemId(5),
    userId: USER_TEACHER_ID,
    unitId: GENERATED_UNIT_ID,
    source: "ai_generated",
    originProblemId: null,
    difficulty: "hard",
    problemType: "서술형",
    content:
      "농도를 알 수 없는 소금물 $A$ $200\\text{g}$과 $15\\%$ 소금물 $B$ $100\\text{g}$을 섞었더니 $10\\%$ 소금물이 되었다. 소금물 $A$의 농도를 구하는 풀이 과정을 서술하시오.",
    answer: "$7.5\\%$",
    solution: null,
    reviewStatus: "pending",
    directUseAllowed: true,
    pool: "shared",
    figureUrls: [],
    createdAt: "2026-08-05T09:04:00Z",
    updatedAt: "2026-08-05T09:04:00Z",
  },
];

// ── 변형 (POST /api/problems/transform) — 3개, 서로 다른 원본 문제 참조 ──
export const MOCK_AI_TRANSFORMED_PROBLEMS: ProblemEntity[] = [
  {
    id: aiTransformedProblemId(1),
    userId: USER_TEACHER_ID,
    unitId: MOCK_PROBLEMS[0]!.unitId, // 원본: 유리수와 소수(분수 문제) 변형
    source: "transformed",
    originProblemId: MOCK_PROBLEMS[0]!.id,
    difficulty: MOCK_PROBLEMS[0]!.difficulty,
    problemType: MOCK_PROBLEMS[0]!.problemType,
    content: "$\\frac{11}{40}$을 유한소수로 나타내어라.",
    answer: "0.275",
    solution: "$\\frac{11}{40} = \\frac{275}{1000} = 0.275$",
    reviewStatus: "pending",
    directUseAllowed: true,
    pool: "shared",
    figureUrls: [],
    createdAt: "2026-08-06T09:00:00Z",
    updatedAt: "2026-08-06T09:00:00Z",
  },
  {
    id: aiTransformedProblemId(2),
    userId: USER_TEACHER_ID,
    unitId: MOCK_PROBLEMS[13]!.unitId, // 원본: 지수법칙 문제 변형
    source: "transformed",
    originProblemId: MOCK_PROBLEMS[13]!.id,
    difficulty: MOCK_PROBLEMS[13]!.difficulty,
    problemType: MOCK_PROBLEMS[13]!.problemType,
    content: "$a^{4} \\times a^{3} \\div a^{5}$을 간단히 하여라.",
    answer: "$a^{2}$",
    solution: "$a^{4+3-5} = a^{2}$",
    reviewStatus: "pending",
    directUseAllowed: true,
    pool: "shared",
    figureUrls: [],
    createdAt: "2026-08-06T09:01:00Z",
    updatedAt: "2026-08-06T09:01:00Z",
  },
  {
    id: aiTransformedProblemId(3),
    userId: USER_TEACHER_ID,
    unitId: MOCK_PROBLEMS[21]!.unitId, // 원본: 다항식의 곱셈 문제 변형
    source: "transformed",
    originProblemId: MOCK_PROBLEMS[21]!.id,
    difficulty: MOCK_PROBLEMS[21]!.difficulty,
    problemType: MOCK_PROBLEMS[21]!.problemType,
    content: "$(x+4)(x-2)$를 전개하여라.",
    answer: "$x^{2}+2x-8$",
    solution: null,
    reviewStatus: "pending",
    directUseAllowed: true,
    pool: "shared",
    figureUrls: [],
    createdAt: "2026-08-06T09:02:00Z",
    updatedAt: "2026-08-06T09:02:00Z",
  },
];

export const MOCK_AI_PROBLEMS: ProblemEntity[] = [
  ...MOCK_AI_GENERATED_PROBLEMS,
  ...MOCK_AI_TRANSFORMED_PROBLEMS,
];
