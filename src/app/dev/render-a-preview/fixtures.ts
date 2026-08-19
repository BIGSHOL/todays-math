import type { ProblemEntity } from "@/contracts/problem.contract";

const base = {
  // 시안 표본 — 문항 코드는 형식만 맞으면 된다(D-53, 중2 1단원 1소단원 자리).
  problemCode: "J20101-K7M2",
  userId: "00000000-0000-4000-8000-000000000001",
  unitId: "00000000-0000-4000-8000-000000000002",
  source: "past_exam" as const,
  originProblemId: null,
  directUseAllowed: true,
  pool: "shared" as const,
  figureUrls: [] as string[],
  figureSvg: null,
  createdAt: "2026-06-05T10:00:00Z",
  updatedAt: "2026-06-05T10:00:00Z",
};

/** 실측 본문 패턴을 본뜬 시안용 표본 — 짧은 문항 / 긴 보기 / 긴 인라인 수식 / 디스플레이 수식. */
export const PREVIEW_PROBLEMS: ProblemEntity[] = [
  {
    ...base,
    id: "00000000-0000-4000-8000-0000000000a1",
    difficulty: "easy",
    problemType: "계산",
    reviewStatus: "approved",
    content: "$\\frac{7}{25}$를 유한소수로 나타내어라.",
    answer: "0.28",
    solution: "$\\frac{7}{25} = \\frac{28}{100} = 0.28$",
  },
  {
    ...base,
    id: "00000000-0000-4000-8000-0000000000a2",
    difficulty: "mid",
    problemType: "개념",
    reviewStatus: "approved",
    content:
      "다음 중 옳은 것을 모두 고른 것은?\n① 두 삼각형의 넓이의 합은 $30\\,\\mathrm{cm}^2$ 이다\n② 점 $\\mathrm{P}$ 가 선분 $\\overline{AB}$ 의 중점일 때 $\\overline{AP}=\\overline{PB}$ 이다\n③ $x$ 에 대한 이차방정식이 중근을 가진다\n④ 두 직선이 서로 평행하면 동위각의 크기가 같다\n⑤ $a>0$ 이면 $|a|=a$ 이다",
    answer: "②④⑤",
    solution: null,
  },
  {
    ...base,
    id: "00000000-0000-4000-8000-0000000000a3",
    difficulty: "hard",
    problemType: "계산",
    reviewStatus: "pending",
    content:
      "다음 식을 간단히 하시오. $\\dfrac{(2x^{3}-5x^{2}+7x-3)(x^{2}+4x+4)}{(x-1)(x+2)^{2}(2x-3)}+\\dfrac{3x^{2}-2x+11}{x^{2}+5x+6}$ 의 값은?",
    answer: "1",
    solution: null,
  },
  {
    ...base,
    id: "00000000-0000-4000-8000-0000000000a4",
    difficulty: "mid",
    problemType: "계산",
    reviewStatus: "approved",
    content:
      "다음 극한값을 구하시오.\n\n$$\\lim_{n \\to \\infty}\\sum_{k=1}^{n}\\frac{1}{n}\\left(1+\\frac{2k}{n}\\right)^{3}\\sqrt{1+\\frac{k^{2}}{n^{2}}}$$\n\n의 값은?",
    answer: "$\\frac{40}{3}$",
    solution: null,
  },
  {
    ...base,
    id: "00000000-0000-4000-8000-0000000000a5",
    difficulty: "easy",
    problemType: "개념",
    reviewStatus: "approved",
    content:
      "$\\triangle ABC$ 에서 $\\angle C = 90^{\\circ}$ 이고 $\\overline{AB}=10$ 일 때 $\\overline{AC}$ 의 길이는?\n1. $6$\n2. $7$\n3. $8$\n4. $9$",
    answer: "3",
    solution: null,
  },
  {
    ...base,
    id: "00000000-0000-4000-8000-0000000000a6",
    difficulty: "mid",
    problemType: "활용",
    reviewStatus: "approved",
    content:
      "농도가 8 % 인 소금물 $200\\,\\mathrm{g}$ 에 물을 더 넣어 농도가 5 % 이하가 되게 하려고 한다. 물을 몇 $\\mathrm{g}$ 이상 넣어야 하는가?",
    answer: "120",
    solution: null,
  },
  {
    ...base,
    id: "00000000-0000-4000-8000-0000000000a7",
    difficulty: "hard",
    problemType: "계산",
    reviewStatus: "approved",
    content:
      "다음을 간단히 하시오. $\\dfrac{a^{2}b^{3}c^{4}+2a^{3}b^{2}c^{5}-7a^{4}bc^{6}+11a^{5}c^{7}-3abcd+13a^{6}b^{2}c-17ab^{3}c^{2}+19a^{2}b^{4}}{a^{2}+b^{2}+c^{2}+2ab+2bc+2ca-5abc}$",
    answer: "1",
    solution: null,
  },
  {
    ...base,
    id: "00000000-0000-4000-8000-0000000000a8",
    difficulty: "mid",
    problemType: "개념",
    reviewStatus: "approved",
    content:
      "$\\overline{\\mathrm{ABCDEF}}$ 위의 점 $\\mathrm{P}$ 에 대하여 $\\overline{\\mathrm{AP}}\\times\\overline{\\mathrm{PB}}\\times\\overline{\\mathrm{PC}}\\times\\overline{\\mathrm{PD}}\\times\\overline{\\mathrm{PE}}\\times\\overline{\\mathrm{PF}}$ 의 값을 구하시오.",
    answer: "0",
    solution: null,
  },
];
