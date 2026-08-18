/**
 * 🔴 RED → 🟢 — **⑷ 출제가 「칸에 안 들어가는 문항」을 후순위로 돌린다.**
 *
 * 근거: `docs/planning/tracks/reports/adv-overflow-review.md` §8(G)·§11.
 * 원장님이 2026-08-18 확정했다(D-07 — 실리는 문항이 바뀌므로 확정 없이는 못 하던 일).
 *
 * ## 왜 필요한가
 *
 * `assessOverflowRisk` 는 「이 문항은 칸에 안 들어간다」를 잘 맞힌다. 그런데 그 앎이
 * 쓰이는 시점은 **인쇄 미리보기**다 — 문항이 이미 정해진 뒤다. 정작 고르는 쪽
 * (`selectProblems`)의 후보 타입에는 `content` 도 `figureUrls` 도 없어서 출제 엔진은
 * 구조적으로 그걸 **알 수가 없었다**. 25문항 시험지의 89%에 경고가 떴다.
 *
 * ## 무엇을 잠그나
 *
 * 1. 들어가는 문항이 남아 있으면 안 들어가는 것을 안 고른다.
 * 2. **제외가 아니라 후순위다** — 얇은 단원에서 출제가 막히면 안 된다(D-20).
 * 3. 난이도 배분은 지면 때문에 흔들리지 않는다.
 * 4. **출제와 판정이 한 규칙을 본다** — 한쪽만 옮기면 여기가 빨개진다(리뷰 §A·§E).
 */
import { describe, expect, it } from "vitest";

import type { TestPrintProblem } from "@/components/print/types";
import type { SelectableProblem } from "@/lib/generator/balanceDifficulty";
import {
  risksTightSeat,
  seatCapacitiesFor,
  selectProblems,
} from "@/lib/generator/selectProblems";
import { JASEUP_MEASURED_PX } from "@/lib/printGeometry";
import { assessOverflowRisk } from "@/lib/printOverflow";

/**
 * 그림 하나로 높이를 정확히 만든다. 폭 200px 은 인쇄 상한(264.567px)보다 좁아
 * 축소가 없으므로 묶음 높이는 `figureBlockTop(12) + h` 다. 본문 한 줄까지 더하면
 * 문항 높이는 **94.8125 + h** — 실측 칸과 바로 견줄 수 있다.
 */
const withFigureHeight = (
  id: string,
  h: number,
  over: Partial<SelectableProblem> = {},
): SelectableProblem & { content: string } => ({
  id,
  unitId: "u1",
  difficulty: "mid",
  problemType: "계산",
  directUseAllowed: true,
  content: "짧은 발문이다.",
  figureUrls: h > 0 ? ["/f.png"] : [],
  figureDims: h > 0 ? [200, h] : [],
  ...over,
});

/** 어느 칸에도 들어간다 (82.8px). */
const small = (id: string, over: Partial<SelectableProblem> = {}) =>
  withFigureHeight(id, 0, over);
/** 이어지는 장(484px)에는 들어가고 첫 장(405px)에는 안 들어간다 (444.8px). */
const midsize = (id: string, over: Partial<SelectableProblem> = {}) =>
  withFigureHeight(id, 350, over);
/** 반 칸에는 어디서도 안 들어간다 (594.8px). 혼자 쓰는 칸(997px)에는 들어간다. */
const tall = (id: string, over: Partial<SelectableProblem> = {}) =>
  withFigureHeight(id, 500, over);
/** **어느 칸에도** 안 들어간다 (1328.8px) — 실측 135건(0.3%)이 이 부류다. */
const huge = (id: string, over: Partial<SelectableProblem> = {}) =>
  withFigureHeight(id, 1234, over);

const asPrint = (problems: SelectableProblem[]): TestPrintProblem[] =>
  problems.map((p, index) => ({
    id: p.id,
    orderIndex: index,
    content: p.content ?? "",
    answer: "1",
    solution: null,
    figureUrls: p.figureUrls ?? [],
    figureDims: p.figureDims ?? [],
  }));

const pick = (
  pool: SelectableProblem[],
  count: number,
  over: Partial<Parameters<typeof selectProblems>[0]> = {},
) =>
  selectProblems({
    pool,
    difficultyRatio: { easy: 0, mid: count, hard: 0 },
    count,
    recentProblemIds: [],
    seed: "fit-select",
    ...over,
  });

describe("[⑷] 출제가 «칸에 안 들어가는 문항»을 후순위로 돌린다", () => {
  it("들어가는 문항이 남아 있으면 안 들어가는 것을 안 고른다", () => {
    const pool = [
      tall("big-1"),
      tall("big-2"),
      tall("big-3"),
      small("ok-1"),
      small("ok-2"),
      small("ok-3"),
    ];
    const { problems } = pick(pool, 2);

    expect(problems).toHaveLength(2);
    // 어느 둘이 뽑히는지는 시드가 정한다 — 잠그는 것은 «큰 것이 안 뽑힌다» 쪽이다.
    expect(problems.every((p) => p.id.startsWith("ok-"))).toBe(true);
    // 고른 것을 그대로 지면에 올려도 경고가 없다 — 이게 이 작업의 성적이다.
    expect(assessOverflowRisk(asPrint(problems))).toEqual([]);
  });

  /**
   * ⚠️ **제외가 아니라 후순위다.** 얇은 단원에서 「들어가는 것만으로 정원을 못 채우는」
   * 경우가 실측으로 8문항 0/259 · 25문항 1/215 있었다. 그 1건이 `INSUFFICIENT_PROBLEMS`
   * (D-20)로 떨어지면 안 된다 — 출제는 되고, 경고는 인쇄 미리보기가 낸다.
   */
  it("들어가는 문항만으로 정원을 못 채우면 안 들어가는 것으로 채운다", () => {
    const pool = [small("ok-1"), tall("big-1"), tall("big-2"), tall("big-3")];
    const { problems, shortfall } = pick(pool, 3);

    expect(problems).toHaveLength(3);
    expect(problems.map((p) => p.id)).toContain("ok-1");
    expect(shortfall).toEqual([]);
  });

  it("어느 칸에도 안 들어가는 문항뿐이어도 출제를 막지 않는다", () => {
    const pool = [huge("h-1"), huge("h-2"), huge("h-3")];
    const { problems, shortfall } = pick(pool, 2);

    expect(problems).toHaveLength(2);
    expect(shortfall).toEqual([]);
  });

  it("난이도 배분은 지면 때문에 흔들리지 않는다 — 대체하지 않는다", () => {
    // hard 는 전부 안 들어가고 easy 는 전부 들어간다. 그래도 hard 자리는 hard 로 채운다.
    const pool = [
      small("e-1", { difficulty: "easy" }),
      small("e-2", { difficulty: "easy" }),
      small("e-3", { difficulty: "easy" }),
      tall("h-1", { difficulty: "hard" }),
      tall("h-2", { difficulty: "hard" }),
      tall("h-3", { difficulty: "hard" }),
    ];
    const { problems, substitutions } = selectProblems({
      pool,
      difficultyRatio: { easy: 1, mid: 0, hard: 1 },
      count: 2,
      recentProblemIds: [],
      seed: "fit-select",
    });

    expect(problems.map((p) => p.difficulty).sort()).toEqual(["easy", "hard"]);
    expect(substitutions).toEqual([]);
  });

  it("같은 난이도 안에서는 들어가는 것을 먼저 고른다", () => {
    const pool = [
      tall("h-big", { difficulty: "hard" }),
      small("h-ok", { difficulty: "hard" }),
      small("e-1", { difficulty: "easy" }),
    ];
    const { problems } = selectProblems({
      pool,
      difficultyRatio: { easy: 1, mid: 0, hard: 1 },
      count: 2,
      recentProblemIds: [],
      seed: "fit-select",
    });

    expect(problems.map((p) => p.id).sort()).toEqual(["e-1", "h-ok"]);
  });
});

/**
 * 「모른다」를 **어느 쪽으로 세는가** — 브리프가 정하라고 한 것.
 *
 * · **그림 치수를 모르는 것**은 여기서 다시 정하지 않는다. `parseFigureDimensions` 가
 *   손상된 입력(없음·짝 어긋남·0·음수·NaN)을 전부 `null` 로 받고,
 *   `estimateFigureBlockPx` 가 그 자리를 **`UNKNOWN_FIGURE_HEIGHT_PX`(207px, 실측
 *   9,587장의 중앙값)**로 센다. 판정이 이미 쓰는 값이다 — 출제가 따로 정하면
 *   두 곳이 갈라진다(리뷰 §A·§E 가 바로 그 결함이다).
 * · **본문 자체가 없는 것**(엔진이 문항을 아예 못 볼 때)은 **후순위**로 센다.
 *   「모른다」를 «들어간다»로 세면 그 문항들에 대해 이 정책이 **조용히 꺼진다** —
 *   이 저장소가 여섯 번 낸 결함이 정확히 그 모양이다(CLAUDE.md 2026-08-16·17).
 *   반대로 후순위로 세도 잃는 것은 «순서»뿐이다. 제외가 아니므로 출제는 막지 않는다.
 */
describe("[⑷] 「모른다」는 «안 넘친다»로 미끄러지지 않는다", () => {
  const blind = (id: string): SelectableProblem => ({
    id,
    unitId: "u1",
    difficulty: "mid",
    problemType: "계산",
    directUseAllowed: true,
  });

  it("본문을 모르는 문항보다 «들어가는 것이 확인된» 문항을 먼저 고른다", () => {
    const pool = [blind("blind-1"), blind("blind-2"), small("ok-1")];
    const { problems } = pick(pool, 1);
    expect(problems.map((p) => p.id)).toEqual(["ok-1"]);
  });

  it("그림 치수를 모르면 판정과 같은 값(207px 중앙값)으로 센다", () => {
    // 치수를 아는 207px 짜리와, 치수가 없는(짝이 어긋난) 그림 하나가 같은 등급이어야 한다.
    const known = withFigureHeight("known", JASEUP_MEASURED_PX.figureMaxWidth, {
      figureDims: [200, 207],
    });
    const unknown: SelectableProblem = {
      ...known,
      id: "unknown",
      figureDims: [200], // 짝이 어긋난다 → 통째로 «모른다»
    };
    expect(risksTightSeat(unknown, JASEUP_MEASURED_PX.continuationSlot)).toBe(
      risksTightSeat(
        { ...known, figureDims: [200, 207] },
        JASEUP_MEASURED_PX.continuationSlot,
      ),
    );
  });

  it("풀 전체가 «모른다»면 지면 때문에 순서가 흔들리지 않는다", () => {
    // 본문을 아무도 안 실은 풀(예전 호출부)과, 전부 똑같이 들어가는 풀은 같은 답이어야 한다.
    const blindPool = ["a", "b", "c", "d"].map(blind);
    const uniformPool = ["a", "b", "c", "d"].map((id) => small(id));
    expect(pick(blindPool, 3).problems.map((p) => p.id)).toEqual(
      pick(uniformPool, 3).problems.map((p) => p.id),
    );
  });
});

/**
 * **출제와 판정이 한 규칙을 본다.** 리뷰 §A 가 남긴 교훈이 이 자리다 —
 * 같은 규칙을 쓰는 자리가 둘이면 «한 숫자를 두 곳이 쓰게» 하고,
 * 「한쪽만 옮기면 빨개지는」 테스트를 같이 둔다.
 */
describe("[⑷] 출제의 후순위 판정 = 인쇄 판정의 경고", () => {
  const samples = [
    small("s"),
    midsize("m"),
    tall("t"),
    huge("h"),
    // 폭 규칙만 걸리는 것 — 높이는 한 줄이지만 판정은 「본문이 길다」로 경고한다.
    { ...small("wide"), content: "가".repeat(400) },
  ];

  it("이어지는 장 칸에서 두 판정이 한 건도 다르지 않다", () => {
    for (const sample of samples) {
      const filler: TestPrintProblem = {
        id: "filler",
        orderIndex: 0,
        content: "",
        answer: "",
        solution: null,
      };
      // 캐시·채점기와 같은 자리 잡기 — 3번 자리는 이어지는 장의 반 칸(484px)이다.
      const placed = [filler, filler, ...asPrint([sample]), filler];
      const warned = assessOverflowRisk(placed).some((r) => r.number === 3);
      expect(risksTightSeat(sample, JASEUP_MEASURED_PX.continuationSlot)).toBe(
        warned,
      );
    }
  });

  it("자리별 칸은 판정이 쓰는 것과 같다", () => {
    const {
      firstPageSlot,
      continuationSlot,
      soloContinuationSlot,
      soloFirstPageSlot,
    } = JASEUP_MEASURED_PX;
    expect(seatCapacitiesFor(8)).toEqual([
      firstPageSlot,
      firstPageSlot,
      ...Array<number>(6).fill(continuationSlot),
    ]);
    // 홀수면 마지막 하나가 칸을 통째로 쓴다(적대적 리뷰 ④ B).
    expect(seatCapacitiesFor(25).at(-1)).toBe(soloContinuationSlot);
    expect(seatCapacitiesFor(1)).toEqual([soloFirstPageSlot]);

    // 판정이 실제로 그 칸으로 재는지 — 첫 장에서만 넘치는 문항으로 확인한다.
    expect(
      assessOverflowRisk(asPrint([midsize("a"), midsize("b")])).map(
        (r) => r.number,
      ),
    ).toEqual([1, 2]);
    expect(
      assessOverflowRisk(
        asPrint([small("a"), small("b"), midsize("c"), midsize("d")]),
      ),
    ).toEqual([]);
  });
});
