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
  avoidTightFirstSeats,
  risksTightSeat,
  seatCapacitiesFor,
  selectProblems,
} from "@/lib/generator/selectProblems";
import { cssPxToMm } from "@/lib/figurePrintSize";
import { JASEUP_MEASURED_PX } from "@/lib/printGeometry";
import { assessOverflowRisk, assessSeat } from "@/lib/printOverflow";

/**
 * 그림 하나로 높이를 정확히 만든다. 폭 200px 은 인쇄 상한(264.567px)보다 좁아
 * 축소가 없으므로 묶음 높이는 `figureBlockTop(12) + h` 다. 본문 한 줄까지 더하면
 * 문항 높이는 **94.8125 + h** — 실측 칸과 바로 견줄 수 있다.
 *
 * 🔴 **크기를 픽스처가 직접 말한다**(`figureSourceMm`). 예전에는 안 적었는데,
 *    그때는 「mm 를 모르면 70mm(상한=최대)」라 200px 이 그대로 200px 로 그려졌다.
 *    2026-08-20 에 그 기본값이 **픽셀에서 환산**으로 바뀌면서(모르면 최대가 아니라
 *    실제 크기) 같은 픽스처가 20mm 짜리 작은 그림이 되어 「안 들어가는 문항」이
 *    통째로 «들어가는 문항»으로 미끄러졌다 — 이 파일 7건이 그래서 빨개졌다.
 *    여기서 재려는 것은 **선정 정책**이지 기본값이 아니므로, 기본값에 기대지 않게
 *    그 시절의 폭을 mm 로 못 박는다: `cssPxToMm(200) = 52.9166…mm` → 다시 200px.
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
  figureSourceMm: h > 0 ? [cssPxToMm(200)] : [],
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
    figureSourceMm: p.figureSourceMm,
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

  /**
   * 🔒 **순서를 가르는 픽스처** — 지면이 유형 빈도보다 **앞**이라는 것을 잠근다.
   *
   * ⚠️ 이 테스트가 왜 따로 있나: 위의 다른 픽스처는 `problemType` 이 **한 종류**라
   *    유형 빈도가 지면과 겨루는 상황이 아예 안 만들어진다. 실제로 `pickTypeBalanced`
   *    의 비교 한 줄을 뒤집어(유형 우선으로) 봤더니 **테스트 28건이 전부 초록**이었다 —
   *    가드가 아니라 장식이었다(적대적 리뷰 ④ §H 의 「픽스처가 안 가른다」와 같은 자리).
   *
   * 여기서는 «들어가는 것»과 «아직 안 쓴 유형»이 **다른 문항**에 걸리게 둔다.
   *   · 지면 우선 → 계산(들어감) 둘을 고른다.
   *   · 유형 우선 → 두 번째 자리에서 «아직 안 쓴 유형» 활용(안 들어감)을 집는다.
   * 그래서 순서를 뒤집으면 이 테스트만 빨개진다.
   *
   * 실측 근거(시험지 13,920장 · 25문항 기준): 지면 우선은 경고가 뜨는 시험지를
   * 5.9% 로 낮추고 유형 3연속을 2.091 → 2.354(+12.6%) 만든다. 유형 우선은
   * 유형 3연속이 2.113(+1.1%)로 거의 그대로인 대신 경고가 **20.9%** 로 3.5배다.
   * 원장님이 2026-08-18 지면 우선으로 확정했다(D-52 · 보고서 §5).
   */
  it("«아직 안 쓴 유형»보다 «칸에 들어가는 것»을 먼저 고른다", () => {
    const pool = [
      small("ok-1", { problemType: "계산" }),
      small("ok-2", { problemType: "계산" }),
      small("ok-3", { problemType: "계산" }),
      tall("big-1", { problemType: "활용" }),
      tall("big-2", { problemType: "활용" }),
      tall("big-3", { problemType: "활용" }),
    ];
    const { problems } = pick(pool, 2);

    expect(problems).toHaveLength(2);
    // 유형 우선이면 여기서 «활용»(안 들어감)이 한 자리를 가져간다.
    expect(problems.every((p) => p.id.startsWith("ok-"))).toBe(true);
    expect(assessOverflowRisk(asPrint(problems))).toEqual([]);
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

  it("mm 가 있으면 출제 후순위가 그 크기를 본다 — 안 넘기면 판정과 갈라진다", () => {
    // 500px 그림은 이어지는 장(484px)을 넘친다. 원본이 20mm 면 인쇄 폭이
    // 75.6px 로 줄어 같은 그림이 칸에 들어간다. 제품 assessSeat 와 같아야 한다.
    const pixelTall = withFigureHeight("tall-px", 500);
    const withMm: SelectableProblem = {
      ...pixelTall,
      id: "tall-mm",
      figureSourceMm: [20],
    };
    expect(risksTightSeat(pixelTall, JASEUP_MEASURED_PX.continuationSlot)).toBe(
      true,
    );
    expect(risksTightSeat(withMm, JASEUP_MEASURED_PX.continuationSlot)).toBe(
      false,
    );
    expect(risksTightSeat(withMm, JASEUP_MEASURED_PX.continuationSlot)).toBe(
      assessSeat(
        {
          content: withMm.content ?? "",
          figureUrls: withMm.figureUrls,
          figureDims: withMm.figureDims,
          figureSourceMm: withMm.figureSourceMm,
        },
        JASEUP_MEASURED_PX.continuationSlot,
      ).risky,
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

/**
 * **⑸-c 큰 문항을 첫 장 1·2번에 안 놓는다 — 최소 개입.**
 *
 * 첫 장 칸은 405px 로 이어지는 장(484px)보다 79px 좁다(머리글 + 「◆ 핵심 개념 정리」).
 * 그래서 405~484px 짜리는 **1·2번에 앉을 때만** 넘친다 — ⑷ 로 걸러도 남는 몫이
 * 정확히 그것이다(§11: ⑷ 만으로 8문항 0.105 · 25문항 0.123 이 남는다).
 *
 * ⚠️ **완전 재배열(⑸-a·⑸-b)은 하지 않는다.** 원장님이 그렇게 확정했다 — 실측으로
 *    같은 효과를 내면서 「같은 유형 3연속」을 33~56% 더 만든다(`arrangeByType` 가
 *    막으려는 바로 그것). ⑸-c 는 +1% 안쪽이다.
 */
describe("[⑸-c] 큰 문항을 첫 장 앞자리에 안 놓는다 (최대 두 번 맞바꿈)", () => {
  const ids = (items: SelectableProblem[]) => items.map((p) => p.id);

  it("1·2번에 첫 장 칸을 넘는 문항이 오면 뒤 문항과 맞바꾼다", () => {
    const before = [
      midsize("m-1"),
      midsize("m-2"),
      small("s-1"),
      small("s-2"),
      small("s-3"),
      small("s-4"),
      small("s-5"),
      small("s-6"),
    ];
    const after = avoidTightFirstSeats(before);

    expect(after).toHaveLength(before.length);
    expect(ids(after).sort()).toEqual(ids(before).sort()); // 문항 구성은 그대로
    expect(after[0]!.id).toMatch(/^s-/);
    expect(after[1]!.id).toMatch(/^s-/);
    expect(assessOverflowRisk(asPrint(after))).toEqual([]);
  });

  it("맞바꿀 상대가 없으면 그냥 둔다 — 억지로 섞지 않는다", () => {
    // 전부 첫 장 칸을 넘는다. 어디로 옮겨도 앞자리가 나아지지 않는다.
    const before = Array.from({ length: 8 }, (_, i) => midsize(`m-${i}`));
    expect(ids(avoidTightFirstSeats(before))).toEqual(ids(before));
  });

  it("«서로 바꿔도 둘 다 들어가는» 짝만 고른다", () => {
    // s-* 는 405px 에 들어가지만, t-1(594.8px)은 484px 자리로 가도 여전히 넘친다.
    // 그런 맞바꿈은 경고를 옮길 뿐이므로 하지 않는다.
    const before = [
      tall("t-1"),
      small("s-1"),
      small("s-2"),
      small("s-3"),
      small("s-4"),
      small("s-5"),
    ];
    expect(ids(avoidTightFirstSeats(before))).toEqual(ids(before));
  });

  it("홀수 시험지의 마지막 자리는 칸을 통째로 쓰므로 큰 문항이 갈 수 있다", () => {
    // 자리 25개 = 2×405 · 22×484 · 1×997. t-1(594.8px)은 997px 자리에 들어간다.
    const before = [
      tall("t-1"),
      ...Array.from({ length: 24 }, (_, i) => small(`s-${i}`)),
    ];
    const after = avoidTightFirstSeats(before);
    expect(after[0]!.id).toMatch(/^s-/);
    expect(after.at(-1)!.id).toBe("t-1");
    expect(assessOverflowRisk(asPrint(after))).toEqual([]);
  });

  it("3번 이후 자리는 건드리지 않는다 — 최소 개입이다", () => {
    const before = [
      small("s-1"),
      small("s-2"),
      tall("t-1"),
      small("s-3"),
      small("s-4"),
      small("s-5"),
    ];
    expect(ids(avoidTightFirstSeats(before))).toEqual(ids(before));
  });

  it("출제 결과에 그대로 걸린다 — 고른 문항을 지면에 올리면 경고가 없다", () => {
    const pool = [
      midsize("m-1"),
      midsize("m-2"),
      ...Array.from({ length: 6 }, (_, i) => small(`s-${i}`)),
    ];
    const { problems } = pick(pool, 8);
    expect(problems).toHaveLength(8);
    expect(assessOverflowRisk(asPrint(problems))).toEqual([]);
  });
});
