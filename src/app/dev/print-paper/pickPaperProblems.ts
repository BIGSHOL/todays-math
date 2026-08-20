import { splitBoxSegments } from "@/lib/math/boxBlock";

/**
 * 인쇄 검수 **시험지 견본**에 실을 문항을 고른다 — 고르는 규칙만.
 *
 * ## 왜 골라야 하나
 *
 * `/dev/print-check` 의 미결 22건 중 **16건이 「시험지를 뽑아 봐야」 드러난다.**
 * 그런데 출제 엔진이 고르는 문항이 그 16건을 다 건드릴 보장이 없다 —
 * 서술형이 하나도 안 뽑히면 「서술형 배지」는 영영 못 본다. `items.ts` 의
 * `SAMPLING_PLAN` 이 그걸 알고 「일부러 넣어야 한다」고 적어 두었지만,
 * **일부러 넣는 장치가 없었다.** 그 자리가 여기다.
 *
 * ## 🔴 견본이라고 딴 지면을 그리지 않는다
 *
 * 이 화면은 **제품의 `TestPrint` 를 그대로** 부른다. 검수용으로 따로 그리면
 * 「본 것」과 「나가는 것」이 갈라지고, 갈라지면 같이 눈이 먼다(2026-08-18).
 * 여기서 하는 일은 **문항을 고르는 것뿐**이다.
 *
 * ## 고르는 규칙은 「무엇이 있어야 그 항목이 드러나나」다
 *
 * 문턱이나 점수가 아니라 **검수 항목과 1:1 로 맞춘 조건**이다. 그래서 어떤 항목이
 * 표본에서 빠졌는지 화면이 그대로 말할 수 있다 — 빠진 채로 「검수했다」가 되면
 * 그 항목은 영영 안 보인다.
 */

export interface Candidate {
  id: string;
  problemCode: string;
  content: string;
  answer: string;
  solution: string | null;
  questionType: string | null;
  figureUrls: string[];
  figureDims: number[];
  figureSourceMm: number[];
}

/** 검수 항목 하나를 드러내려면 시험지에 무엇이 있어야 하나. */
export interface Slot {
  /** `print-check/items.ts` 의 id — 무엇을 위해 넣는 문항인지. */
  forItem: string;
  label: string;
  want: (c: Candidate) => boolean;
  /** 몇 개나 넣나. */
  count: number;
}

const hasFigure = (c: Candidate) => c.figureUrls.length > 0;
const isSvg = (c: Candidate) =>
  c.figureUrls.some((u) => u.startsWith("/figures-svg/"));

/**
 * 본문에 「보기」·「조건」 상자가 있나.
 *
 * 🔴 처음엔 인용문(`>` 로 시작하는 줄)으로 봤는데 **0건**이 나왔다. 상자는 본문에
 *    `<보기>`·`< 보 기 >` 같은 **마커**로 들어 있고(실측 27종), 그걸 인용문으로
 *    바꾸는 것은 파서다. 규칙을 여기서 다시 쓰지 않고 **제품 함수를 그대로**
 *    부른다 — 두 벌로 적으면 한쪽만 고쳐도 아무도 모른다.
 */
const hasBox = (c: Candidate) =>
  splitBoxSegments(c.content).some((s) => s.kind === "box");

/** 정답이 둘 이상인가 — 「①, ③」·「2, 4」 처럼. */
const isMultiAnswer = (c: Candidate) =>
  /[,·]/.test(c.answer.trim()) && c.answer.trim().length <= 24;

/**
 * 수식이 **여러 줄** 든 문항 — 2열 배치와 본문 조판이 여기서 드러난다.
 * 짧은 문항만 뽑히면 지면이 늘 널널해서 아무것도 안 보인다.
 */
const isLong = (c: Candidate) => c.content.length >= 220;

export const SLOTS: readonly Slot[] = [
  {
    forItem: "essay-badge",
    label: "서술형 — 「서술형 n」 배지가 찍히나",
    want: (c) => c.questionType === "서술형",
    count: 2,
  },
  {
    forItem: "short-answer-badge",
    label: "단답형 — 배지 두 갈래가 같이 나와야 갈린다",
    want: (c) => c.questionType === "단답형",
    count: 2,
  },
  {
    forItem: "figures-multi",
    label: "그림이 2장 이상 — 다장 배치",
    want: (c) => c.figureUrls.length >= 2,
    count: 2,
  },
  {
    forItem: "figure-svg-adopt",
    label: "벡터 그림 — 종이에서 선이 연한가",
    want: isSvg,
    count: 3,
  },
  {
    forItem: "figure-raster-300dpi",
    label: "스캔 그림 — 또렷한가",
    want: (c) => hasFigure(c) && !isSvg(c),
    count: 3,
  },
  {
    forItem: "box-card",
    label: "「보기」·「조건」 상자 — 카드 조판",
    want: hasBox,
    count: 2,
  },
  {
    forItem: "multi-answer",
    label: "복수 정답 — 정답지 표기",
    want: isMultiAnswer,
    count: 2,
  },
  {
    forItem: "two-column",
    label: "긴 본문 — 2열 배치와 본문 조판",
    want: isLong,
    count: 3,
  },
];

export interface PickResult {
  picked: Candidate[];
  /** 항목별로 몇 개를 넣었나 — **못 채운 것이 화면에 보여야 한다.** */
  filled: { forItem: string; label: string; want: number; got: number }[];
  /** 자리를 채우고 남은 정원을 메운 평범한 문항 수. */
  padding: number;
}

/**
 * 자리를 채우고, **못 채운 자리를 숨기지 않는다.**
 *
 * 🔴 못 채운 자리를 조용히 넘기면 「시험지를 뽑아 검수했다」가 되면서 그 항목은
 *    영영 안 드러난다. 이 저장소가 여러 번 적은 「분모를 먼저 세어 찍어라」와
 *    같은 자리다 — 여기서 분모는 **검수 항목**이다.
 */
export function pickPaperProblems(
  pool: readonly Candidate[],
  total: number,
  slots: readonly Slot[] = SLOTS,
): PickResult {
  const used = new Set<string>();
  const picked: Candidate[] = [];
  const filled: PickResult["filled"] = [];

  for (const slot of slots) {
    let got = 0;
    for (const c of pool) {
      if (got >= slot.count || picked.length >= total) break;
      if (used.has(c.id) || !slot.want(c)) continue;
      used.add(c.id);
      picked.push(c);
      got++;
    }
    filled.push({
      forItem: slot.forItem,
      label: slot.label,
      want: slot.count,
      got,
    });
  }

  // 정원을 메운다 — 정답지 1쪽 정원(overflow-first-page)은 문항 수가 있어야 드러난다.
  let padding = 0;
  for (const c of pool) {
    if (picked.length >= total) break;
    if (used.has(c.id)) continue;
    used.add(c.id);
    picked.push(c);
    padding++;
  }
  return { picked, filled, padding };
}
