/**
 * Mock 문제(Problem) 픽스처 (T0.5.2) — 30개, 난이도/유형/출처 분포 + LaTeX 수식 4종 필수 포함.
 *
 * 대응 API 경로: POST/GET /api/problems, GET/PATCH/DELETE /api/problems/{id},
 * PATCH /api/problems/{id}/review-status (src/contracts/problem.contract.ts)
 *
 * 단원 배정(src/mocks/data/units.ts의 MOCK_UNITS, orderIndex 413~427 기준):
 *   - "1. 수와 식"(index 0~7, 8개 차시) × 3문항 = 24문항
 *   - "2. 부등식"(index 8~13, 6개 차시) × 1문항 = 6문항
 *   - index 14(427 "일차부등식의 활용(농도)")는 의도적으로 0문항
 *     → INSUFFICIENT_PROBLEMS 실패 경로 재현 전용(src/mocks/handlers/test.ts 참조).
 *
 * LaTeX 수식 4종(분수/루트/지수/도형 기호) 필수 포함 위치:
 *   - 분수: PROBLEM_SPECS[0] (unit 0, "$\frac{7}{25}$")
 *   - 지수: PROBLEM_SPECS[13] (unit 4, "$a^{3} \times a^{2} \div a^{4}$")
 *   - 루트: PROBLEM_SPECS[25] (unit 9, "$\sqrt{3}x - 2 < 4$")
 *   - 도형 기호: PROBLEM_SPECS[29] (unit 13, "$\triangle ABC$", "$\angle C$")
 */
import type {
  Difficulty,
  ProblemSource,
  ReviewStatus,
} from "@/contracts/common.contract";
import type { ProblemEntity, ProblemType } from "@/contracts/problem.contract";

import {
  PROBLEM_OTHER_ID,
  problemId,
  USER_OTHER_ID,
  USER_TEACHER_ID,
} from "./ids";
import { MOCK_UNITS } from "./units";

interface ProblemSpec {
  unitIdx: number;
  difficulty: Difficulty;
  problemType: ProblemType;
  source: Extract<ProblemSource, "manual" | "past_exam">;
  reviewStatus: ReviewStatus;
  content: string;
  answer: string;
  solution: string | null;
  createdAt: string;
  updatedAt?: string;
}

// 순서는 orderIndex(unitIdx) 오름차순 — 위 헤더 주석의 인덱스 참조와 일치한다.
const PROBLEM_SPECS: ProblemSpec[] = [
  // ── unit 0 (413 유리수와 소수) ──
  {
    unitIdx: 0,
    difficulty: "easy",
    problemType: "계산",
    source: "manual",
    reviewStatus: "approved",
    content: "$\\frac{7}{25}$를 유한소수로 나타내어라.",
    answer: "0.28",
    solution: "$\\frac{7}{25} = \\frac{28}{100} = 0.28$",
    createdAt: "2026-06-05T10:00:00Z",
  },
  {
    unitIdx: 0,
    difficulty: "mid",
    problemType: "개념",
    source: "past_exam",
    reviewStatus: "approved",
    content:
      "다음 중 유한소수로 나타낼 수 없는 것은? ① $\\frac{3}{8}$ ② $\\frac{5}{12}$ ③ $\\frac{7}{20}$ ④ $\\frac{9}{50}$",
    answer: "②",
    solution:
      "분모를 기약분수로 만들었을 때 소인수가 2, 5뿐이어야 유한소수가 된다.",
    createdAt: "2026-06-05T10:05:00Z",
  },
  {
    unitIdx: 0,
    difficulty: "hard",
    problemType: "활용",
    source: "manual",
    reviewStatus: "pending",
    content:
      "어떤 기약분수를 소수로 나타내었더니 $0.0125$가 되었다. 이 분수의 분모가 될 수 있는 가장 작은 자연수를 구하여라.",
    answer: "80",
    solution: null,
    createdAt: "2026-06-05T10:10:00Z",
  },
  // ── unit 1 (414 순환소수) ──
  {
    unitIdx: 1,
    difficulty: "easy",
    problemType: "서술형",
    source: "manual",
    reviewStatus: "approved",
    content:
      "$\\frac{1}{3}$을 순환소수로 나타내고 순환마디를 구하는 과정을 서술하여라.",
    answer: "$0.\\overline{3}$, 순환마디: 3",
    solution: "$\\frac{1}{3} = 0.333\\dots = 0.\\overline{3}$",
    createdAt: "2026-06-08T10:00:00Z",
  },
  {
    unitIdx: 1,
    difficulty: "mid",
    problemType: "계산",
    source: "past_exam",
    reviewStatus: "approved",
    content: "$0.4\\overline{5}$를 기약분수로 나타내어라.",
    answer: "$\\frac{41}{90}$",
    solution: "$0.4\\overline{5} = \\frac{45-4}{90} = \\frac{41}{90}$",
    createdAt: "2026-06-08T10:05:00Z",
  },
  {
    unitIdx: 1,
    difficulty: "hard",
    problemType: "활용",
    source: "manual",
    reviewStatus: "approved",
    content:
      "순환소수 $1.2\\overline{34}$를 기약분수 $\\frac{b}{a}$로 나타낼 때, $a+b$의 값을 구하여라.",
    answer: "1231",
    solution: null,
    createdAt: "2026-06-08T10:10:00Z",
  },
  // ── unit 2 (415 순환소수의 분수 표현) ──
  {
    unitIdx: 2,
    difficulty: "easy",
    problemType: "개념",
    source: "manual",
    reviewStatus: "approved",
    content:
      "순환소수를 분수로 나타내는 공식을 이용해 $0.\\overline{7}$을 분수로 나타내어라.",
    answer: "$\\frac{7}{9}$",
    solution: "$0.\\overline{7} = \\frac{7}{9}$",
    createdAt: "2026-06-11T10:00:00Z",
  },
  {
    unitIdx: 2,
    difficulty: "mid",
    problemType: "계산",
    source: "past_exam",
    reviewStatus: "approved",
    content: "$2.1\\overline{6}$을 기약분수로 나타내어라.",
    answer: "$\\frac{13}{6}$",
    solution:
      "$2.1\\overline{6} = \\frac{216-21}{90} = \\frac{195}{90} = \\frac{13}{6}$",
    createdAt: "2026-06-11T10:05:00Z",
  },
  {
    unitIdx: 2,
    difficulty: "hard",
    problemType: "서술형",
    source: "manual",
    reviewStatus: "rejected",
    content:
      "$0.5\\overline{81}$을 분수로 나타내는 과정을 단계별로 서술하여라.",
    answer: "$\\frac{64}{110}$",
    solution: null,
    createdAt: "2026-06-11T10:10:00Z",
  },
  // ── unit 3 (416 순환소수를 포함한 식의 계산 — daily 현재 진도) ──
  {
    unitIdx: 3,
    difficulty: "easy",
    problemType: "계산",
    source: "manual",
    reviewStatus: "approved",
    content: "$0.\\overline{3} + 0.\\overline{6}$을 계산하여라.",
    answer: "1",
    solution: "$\\frac{1}{3} + \\frac{2}{3} = 1$",
    createdAt: "2026-06-14T10:00:00Z",
  },
  {
    unitIdx: 3,
    difficulty: "mid",
    problemType: "활용",
    source: "past_exam",
    reviewStatus: "approved",
    content: "$1.\\overline{2} \\times 0.\\overline{9}$를 계산하여라.",
    answer: "$\\frac{11}{9}$",
    solution: null,
    createdAt: "2026-06-14T10:05:00Z",
  },
  {
    unitIdx: 3,
    difficulty: "hard",
    problemType: "서술형",
    source: "manual",
    reviewStatus: "approved",
    content:
      "$A = 0.4\\overline{5}$, $B = 0.\\overline{18}$일 때 $A-B$를 기약분수로 나타내어라.",
    answer: "$\\frac{169}{990}$",
    solution: null,
    createdAt: "2026-06-14T10:10:00Z",
  },
  // ── unit 4 (417 지수법칙) — 지수 LaTeX 필수 케이스 ──
  {
    unitIdx: 4,
    difficulty: "easy",
    problemType: "계산",
    source: "manual",
    reviewStatus: "approved",
    content: "$a^{2} \\times a^{3}$을 간단히 하여라.",
    answer: "$a^{5}$",
    solution: "지수법칙 $a^{m} \\times a^{n} = a^{m+n}$",
    createdAt: "2026-06-17T10:00:00Z",
  },
  {
    unitIdx: 4,
    difficulty: "mid",
    problemType: "계산",
    source: "past_exam",
    reviewStatus: "approved",
    content: "$a^{3} \\times a^{2} \\div a^{4}$을 간단히 하여라.",
    answer: "$a$",
    solution: "$a^{3+2-4} = a^{1} = a$",
    createdAt: "2026-06-17T10:05:00Z",
  },
  {
    unitIdx: 4,
    difficulty: "hard",
    problemType: "활용",
    source: "manual",
    reviewStatus: "approved",
    content: "$(2^{3})^{x} = 2^{12}$을 만족하는 자연수 $x$의 값을 구하여라.",
    answer: "4",
    solution: "$2^{3x} = 2^{12} \\Rightarrow 3x = 12$",
    createdAt: "2026-06-17T10:10:00Z",
  },
  // ── unit 5 (418 단항식의 곱셈과 나눗셈) ──
  {
    unitIdx: 5,
    difficulty: "easy",
    problemType: "계산",
    source: "manual",
    reviewStatus: "approved",
    content: "$3x^{2} \\times 2x$를 계산하여라.",
    answer: "$6x^{3}$",
    solution: null,
    createdAt: "2026-06-20T10:00:00Z",
  },
  {
    unitIdx: 5,
    difficulty: "mid",
    problemType: "계산",
    source: "past_exam",
    reviewStatus: "approved",
    content: "$8x^{3}y^{2} \\div 4xy$를 계산하여라.",
    answer: "$2x^{2}y$",
    solution: null,
    createdAt: "2026-06-20T10:05:00Z",
  },
  {
    unitIdx: 5,
    difficulty: "hard",
    problemType: "서술형",
    source: "manual",
    reviewStatus: "pending",
    content:
      "$(-2x^{2}y)^{3} \\times 3xy^{2}$를 간단히 하는 과정을 서술하여라.",
    answer: "$-24x^{7}y^{5}$",
    solution: null,
    createdAt: "2026-06-20T10:10:00Z",
  },
  // ── unit 6 (419 다항식의 덧셈과 뺄셈) ──
  {
    unitIdx: 6,
    difficulty: "easy",
    problemType: "계산",
    source: "manual",
    reviewStatus: "approved",
    content: "$(3x+2y) + (x-5y)$를 계산하여라.",
    answer: "$4x-3y$",
    solution: null,
    createdAt: "2026-06-23T10:00:00Z",
  },
  {
    unitIdx: 6,
    difficulty: "mid",
    problemType: "계산",
    source: "past_exam",
    reviewStatus: "approved",
    content: "$(5a-3b) - (2a-4b)$를 계산하여라.",
    answer: "$3a+b$",
    solution: null,
    createdAt: "2026-06-23T10:05:00Z",
  },
  {
    unitIdx: 6,
    difficulty: "hard",
    problemType: "활용",
    source: "manual",
    reviewStatus: "approved",
    content:
      "어떤 다항식에서 $2x-y$를 빼야 할 것을 잘못하여 더했더니 $5x+3y$가 되었다. 바르게 계산한 식을 구하여라.",
    answer: "$x+5y$",
    solution: "잘못 계산한 식 - $2(2x-y)$ = 바른 식",
    createdAt: "2026-06-23T10:10:00Z",
  },
  // ── unit 7 (420 다항식의 곱셈과 나눗셈 — review 범위 끝) ──
  {
    unitIdx: 7,
    difficulty: "easy",
    problemType: "계산",
    source: "manual",
    reviewStatus: "approved",
    content: "$2x(3x-4)$를 전개하여라.",
    answer: "$6x^{2}-8x$",
    solution: null,
    createdAt: "2026-06-26T10:00:00Z",
  },
  {
    unitIdx: 7,
    difficulty: "mid",
    problemType: "계산",
    source: "past_exam",
    reviewStatus: "approved",
    content: "$(x+3)(x-5)$를 전개하여라.",
    answer: "$x^{2}-2x-15$",
    solution: null,
    createdAt: "2026-06-26T10:05:00Z",
  },
  {
    unitIdx: 7,
    difficulty: "hard",
    problemType: "서술형",
    source: "manual",
    reviewStatus: "approved",
    content: "$(2x^{2}-6xy) \\div 2x$를 계산하는 과정을 서술하여라.",
    answer: "$x-3y$",
    solution: null,
    createdAt: "2026-06-26T10:10:00Z",
  },
  // ── unit 8 (421 부등식) ──
  {
    unitIdx: 8,
    difficulty: "easy",
    problemType: "개념",
    source: "manual",
    reviewStatus: "approved",
    content:
      "다음 중 부등식인 것을 모두 고르시오. ① $2x+1$ ② $3x-2>5$ ③ $x=4$ ④ $x+1 \\le 7$",
    answer: "②, ④",
    solution: null,
    createdAt: "2026-07-01T10:00:00Z",
  },
  // ── unit 9 (422 일차부등식의 풀이) — 루트 LaTeX 필수 케이스 ──
  {
    unitIdx: 9,
    difficulty: "mid",
    problemType: "계산",
    source: "past_exam",
    reviewStatus: "approved",
    content: "$\\sqrt{3}x - 2 < 4$의 해를 구하시오.",
    answer: "$x < 2\\sqrt{3}$",
    solution:
      "$\\sqrt{3}x < 6 \\Rightarrow x < \\frac{6}{\\sqrt{3}} = 2\\sqrt{3}$",
    createdAt: "2026-07-04T10:00:00Z",
  },
  // ── unit 10 (423 일차부등식의 응용) ──
  {
    unitIdx: 10,
    difficulty: "mid",
    problemType: "활용",
    source: "manual",
    reviewStatus: "approved",
    content: "부등식 $\\frac{x-1}{2} \\ge \\frac{2x+1}{3}$을 풀어라.",
    answer: "$x \\le -5$",
    solution: null,
    createdAt: "2026-07-07T10:00:00Z",
  },
  // ── unit 11 (424 일차부등식의 활용(수, 평균, 정가)) ──
  {
    unitIdx: 11,
    difficulty: "hard",
    problemType: "서술형",
    source: "manual",
    reviewStatus: "approved",
    content:
      "연속하는 세 자연수의 합이 $51$ 이상이 되도록 하는 가장 작은 세 자연수를 구하여라.",
    answer: "16, 17, 18",
    solution: null,
    createdAt: "2026-07-10T10:00:00Z",
  },
  // ── unit 12 (425 일차부등식의 활용(개수, 예금액, 유리한 방법)) ──
  {
    unitIdx: 12,
    difficulty: "mid",
    problemType: "활용",
    source: "past_exam",
    reviewStatus: "approved",
    content:
      "한 개에 $800$원인 사탕과 $500$원인 과자를 합하여 $10$개를 사는데 전체 금액이 $6500$원 이하가 되게 하려고 한다. 사탕을 최대 몇 개까지 살 수 있는지 구하여라.",
    answer: "5개",
    solution: null,
    createdAt: "2026-07-13T10:00:00Z",
  },
  // ── unit 13 (426 일차부등식의 활용(속력, 도형, 기타)) — 도형 기호 LaTeX 필수 케이스 ──
  {
    unitIdx: 13,
    difficulty: "hard",
    problemType: "활용",
    source: "manual",
    reviewStatus: "approved",
    content:
      "밑변의 길이가 $x\\text{cm}$이고 높이가 $8\\text{cm}$인 $\\triangle ABC$의 넓이가 $40\\text{cm}^{2}$ 이하일 때, $x$의 값의 범위를 구하시오. (단, $\\angle C = 90^{\\circ}$)",
    answer: "$0 < x \\le 10$",
    solution: "넓이 $= \\frac{1}{2} \\times x \\times 8 \\le 40$",
    createdAt: "2026-07-16T10:00:00Z",
  },
  // unit 14 (427 일차부등식의 활용(농도))는 의도적으로 0문항 — INSUFFICIENT_PROBLEMS 재현.
];

if (PROBLEM_SPECS.length !== 30) {
  throw new Error(
    `[mocks/data/problems] 예상 30문항이 아니라 ${PROBLEM_SPECS.length}문항이 정의되었습니다.`,
  );
}

export const MOCK_PROBLEMS: ProblemEntity[] = PROBLEM_SPECS.map(
  (spec, idx) => ({
    id: problemId(idx + 1),
    userId: USER_TEACHER_ID,
    unitId: MOCK_UNITS[spec.unitIdx]!.id,
    source: spec.source,
    originProblemId: null,
    difficulty: spec.difficulty,
    problemType: spec.problemType,
    content: spec.content,
    answer: spec.answer,
    solution: spec.solution,
    reviewStatus: spec.reviewStatus,
    createdAt: spec.createdAt,
    updatedAt: spec.updatedAt ?? spec.createdAt,
  }),
);

/** unitId → 해당 단원의 Mock 문제 목록 (핸들러의 필터 조회, 출제 가용성 계산에 사용). */
export const MOCK_PROBLEMS_BY_UNIT: Record<string, ProblemEntity[]> =
  MOCK_PROBLEMS.reduce(
    (acc, problem) => {
      (acc[problem.unitId] ??= []).push(problem);
      return acc;
    },
    {} as Record<string, ProblemEntity[]>,
  );

/** LaTeX 4종(분수/루트/지수/도형 기호) 대표 문제 — 컴포넌트/KaTeX 렌더링 테스트가 바로 가져다 쓸 수 있게 노출. */
export const MOCK_PROBLEM_WITH_FRACTION = MOCK_PROBLEMS[0]!;
export const MOCK_PROBLEM_WITH_EXPONENT = MOCK_PROBLEMS[13]!;
export const MOCK_PROBLEM_WITH_SQRT = MOCK_PROBLEMS[25]!;
export const MOCK_PROBLEM_WITH_GEOMETRY_SYMBOL = MOCK_PROBLEMS[29]!;

/** 검수 상태 전이(PATCH .../review-status) 테스트 전용 — pending 상태 문제. */
export const MOCK_PENDING_PROBLEM = MOCK_PROBLEMS.find(
  (p) => p.reviewStatus === "pending",
)!;

/** USER_OTHER_ID 소유 — MOCK_TEACHER가 접근 시 403 FORBIDDEN을 검증하는 픽스처. */
export const MOCK_PROBLEM_OTHER_USER: ProblemEntity = {
  id: PROBLEM_OTHER_ID,
  userId: USER_OTHER_ID,
  unitId: MOCK_UNITS[0]!.id,
  source: "manual",
  originProblemId: null,
  difficulty: "easy",
  problemType: "계산",
  content: "타 사용자 소유 문제 — 접근 차단 검증용.",
  answer: "0",
  solution: null,
  reviewStatus: "approved",
  createdAt: "2026-05-01T09:00:00Z",
  updatedAt: "2026-05-01T09:00:00Z",
};
