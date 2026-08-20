/**
 * 🔴 RED → 🟢 — **확인테스트가 「범위 안 단원」을 고루 훑는다.**
 *
 * 근거: `docs/planning/tracks/reports/review-spread.md` (실측 자:
 * `scripts/qa/measure-review-spread.ts`).
 *
 * ## 왜 필요한가
 *
 * 확인테스트(`review`)는 여러 단원을 묶어 **누적 점검**을 하는 물건이다. 그런데
 * 엔진은 난이도(`balanceDifficulty`)·유형(`arrangeByType`)·지면(D-52)은 보면서
 * **단원은 안 봤다.** 후보를 시드로 섞어 순서대로 집으니, 뽑힐 확률이 단원의
 * **재고에 비례**한다 — 그리고 재고는 고르지 않다(중2 앞 10단원 실측: 1건 ~ 736건,
 * 한 단원이 28.8%). 그래서 10단원 범위 8문항이 평균 4.5단원에서만 나왔고
 * 한 단원이 39%를 먹었다(시드 30개 실측).
 *
 * 「한 단원이 시험지의 절반」인 확인테스트는 누적 점검이라는 제 일을 못 한다.
 *
 * ## 무엇을 잠그나
 *
 * 1. 재고가 큰 단원이 시험지를 통째로 먹지 않는다 — **어느 시드에서도**.
 * 2. **일일테스트(단원 하나)는 한 글자도 안 바뀐다** — 이 정책이 켜지는 자리가
 *    아니다. 기대값은 정책 **이전** 엔진이 실제로 낸 순서를 그대로 못 박았다
 *    (제품 상수에서 «참»을 만들지 않는다 — CLAUDE.md 2026-08-18).
 * 3. **지면(D-52)이 단원보다 앞이다.** 단원을 고루 하려고 「칸에 안 들어가는
 *    문항」을 집으면 안 된다 — 원장님이 확정한 순서를 뒤집는 것이다.
 * 4. 난이도 배분은 단원 때문에 흔들리지 않는다(대체하지 않는다).
 */
import { describe, expect, it } from "vitest";

import { cssPxToMm } from "@/lib/figurePrintSize";
import type { SelectableProblem } from "@/lib/generator/balanceDifficulty";
import { selectProblems } from "@/lib/generator/selectProblems";
import { assessOverflowRisk } from "@/lib/printOverflow";

/** 어느 칸에도 들어가는 평범한 문항. */
const problem = (
  id: string,
  unitId: string,
  over: Partial<SelectableProblem> = {},
): SelectableProblem & { content: string } => ({
  id,
  unitId,
  difficulty: "mid",
  problemType: "계산",
  directUseAllowed: true,
  content: "짧은 발문이다.",
  figureUrls: [],
  figureDims: [],
  ...over,
});

/**
 * 이어지는 장 칸(484px)에도 첫 장 칸(405px)에도 **안 들어간다**.
 * `selectFitsPage.test.ts` 의 `tall` 과 같은 방식 — 그림 하나로 높이를 만든다.
 */
const tall = (
  id: string,
  unitId: string,
  over: Partial<SelectableProblem> = {},
) =>
  problem(id, unitId, {
    figureUrls: ["/f.png"],
    figureDims: [200, 600],
    // 🔴 크기를 픽스처가 직접 말한다 — 「mm 를 모르면 70mm(최대)」였던 기본값이
    //    2026-08-20 에 「픽셀에서 환산」으로 바뀌었다. 그때 폭을 mm 로 못 박는다
    //    (`cssPxToMm(200)` → 다시 200px). 여기서 재는 것은 **선정 정책**이다.
    figureSourceMm: [cssPxToMm(200)],
    ...over,
  });

const asPrint = (problems: SelectableProblem[]) =>
  problems.map((p, index) => ({
    id: p.id,
    orderIndex: index + 1,
    content: p.content ?? "",
    answer: "",
    solution: null,
    figureUrls: p.figureUrls,
    figureDims: p.figureDims,
    figureSourceMm: p.figureSourceMm,
  }));

describe("[확인테스트] 범위 안 단원을 고루 훑는다", () => {
  /**
   * 🔒 **어느 시드에서도** 성립해야 한다.
   *
   * 시드 하나로 재면 「그 시드에서만 되는 것」과 구분이 안 된다. 재고가 40 : 3 : 3 : 3
   * 으로 기울어 있으므로, 정책이 없으면 대부분의 시드에서 u-big 이 두 자리 이상을
   * 먹는다(실제로 정책 이전 엔진은 20개 시드 중 20개에서 그랬다).
   */
  it("재고가 큰 단원이 시험지를 통째로 먹지 않는다", () => {
    const pool = [
      ...Array.from({ length: 40 }, (_, i) => problem(`big-${i}`, "u-big")),
      ...Array.from({ length: 3 }, (_, i) => problem(`a-${i}`, "u-a")),
      ...Array.from({ length: 3 }, (_, i) => problem(`b-${i}`, "u-b")),
      ...Array.from({ length: 3 }, (_, i) => problem(`c-${i}`, "u-c")),
    ];

    for (let seed = 0; seed < 20; seed += 1) {
      const { problems } = selectProblems({
        pool,
        difficultyRatio: { easy: 0, mid: 4, hard: 0 },
        count: 4,
        recentProblemIds: [],
        seed: `spread-${seed}`,
      });

      expect(problems).toHaveLength(4);
      const units = new Set(problems.map((p) => p.unitId));
      expect(units.size, `시드 ${seed}: 단원 ${[...units].join(",")}`).toBe(4);
    }
  });

  /**
   * 범위 단원이 문항 수보다 많으면 **다 다른 단원**에서 나온다.
   * (뽑을 수 있는 최대가 곧 문항 수다.)
   */
  it("단원이 문항 수보다 많으면 한 단원에서 두 개를 안 집는다", () => {
    const pool = Array.from({ length: 8 }, (_, u) =>
      Array.from({ length: 5 }, (_, i) => problem(`u${u}-${i}`, `u-${u}`)),
    ).flat();

    const { problems } = selectProblems({
      pool,
      difficultyRatio: { easy: 0, mid: 5, hard: 0 },
      count: 5,
      recentProblemIds: [],
      seed: "many-units",
    });

    expect(new Set(problems.map((p) => p.unitId)).size).toBe(5);
  });

  /**
   * 🔒 **일일테스트(단원 하나)는 한 글자도 안 바뀐다.**
   *
   * 기대값은 이 정책을 넣기 **전**의 엔진에 같은 풀·같은 시드를 넣어 받은 순서
   * 그대로다(실측 리터럴). 제품 코드로 기대값을 만들면 정책이 바뀔 때 기대값도
   * 같이 바뀌어 아무것도 안 잠근다.
   */
  it("단원이 하나뿐이면 고르는 순서가 예전 그대로다", () => {
    const { problems } = selectProblems({
      pool: DAILY_POOL,
      difficultyRatio: { easy: 3, mid: 4, hard: 1 },
      count: 8,
      recentProblemIds: [],
      seed: "daily:2026-08-19",
    });

    expect(problems.map((p) => p.id)).toEqual(DAILY_EXPECTED_ORDER);
  });

  /**
   * 🔒 **순서를 가르는 픽스처** — 지면(D-52)이 단원 분산보다 **앞**이다.
   *
   * 「아직 안 쓴 단원」과 「칸에 들어가는 것」이 **다른 문항**에 걸리게 둔다.
   *   · 지면 우선 → u-a 에서 둘을 고른다(단원은 하나뿐이 안 된다).
   *   · 단원 우선 → 두 번째 자리에서 u-b 의 «안 들어가는» 문항을 집는다.
   * 순서를 뒤집으면 이 테스트만 빨개진다.
   */
  it("«아직 안 쓴 단원»보다 «칸에 들어가는 것»을 먼저 고른다", () => {
    const pool = [
      problem("ok-1", "u-a"),
      problem("ok-2", "u-a"),
      problem("ok-3", "u-a"),
      tall("big-1", "u-b"),
      tall("big-2", "u-b"),
    ];

    const { problems } = selectProblems({
      pool,
      difficultyRatio: { easy: 0, mid: 2, hard: 0 },
      count: 2,
      recentProblemIds: [],
      seed: "seat-beats-unit",
    });

    expect(problems).toHaveLength(2);
    expect(problems.every((p) => p.unitId === "u-a")).toBe(true);
    expect(assessOverflowRisk(asPrint(problems))).toEqual([]);
  });

  /**
   * 🔒 **규칙이 「단원 우선」으로 미끄러지면 빨개진다** (D-54 는 **합산**이다).
   *
   * 난이도 tier 순서(easy → mid)로 앞의 두 자리를 **강제**해 상태를 만든다:
   *   easy 둘이 `unit A / 계산` 과 `unit C / 계산` → 단원 A=1 · C=1, 유형 계산=2.
   * 그다음 mid 한 자리의 후보는 둘뿐이고 두 규칙이 **다른 답**을 낸다:
   *   · X(unit A · 개념) = 단원 1 + 유형 0 = **1**
   *   · Y(unit B · 계산) = 단원 0 + 유형 2 = **2**
   * 합산은 X, 「단원 우선」은 Y(단원 0 < 1)를 고른다.
   *
   * 실측 근거: 단원 우선은 커버리지 98.8%·유형최다 41.7%, 합산은 95.9%·37.3%
   * (`tracks/reports/review-spread.md`). 원장님이 2026-08-19 합산으로 확정했다.
   */
  it("«단원만» 보지 않는다 — 단원·유형을 합쳐 제일 덜 쓴 것을 고른다", () => {
    const pool = [
      problem("e-a", "u-a", { difficulty: "easy" }),
      problem("e-c", "u-c", { difficulty: "easy" }),
      problem("x", "u-a", { problemType: "개념" }),
      problem("y", "u-b", { problemType: "계산" }),
    ];

    for (let seed = 0; seed < 10; seed += 1) {
      const { problems } = selectProblems({
        pool,
        difficultyRatio: { easy: 2, mid: 1, hard: 0 },
        count: 3,
        recentProblemIds: [],
        seed: `sum-not-unit-${seed}`,
      });
      const ids = problems.map((p) => p.id);
      expect(ids, `시드 ${seed}`).toContain("x");
      expect(ids, `시드 ${seed}`).not.toContain("y");
    }
  });

  /**
   * 🔒 **규칙이 「유형 우선」으로 미끄러져도 빨개진다.** 위와 짝이다.
   *
   *   easy 둘이 **같은 단원** `u-a / 계산` → 단원 A=2, 유형 계산=2.
   *   · X(unit A · 개념) = 2 + 0 = **2**
   *   · Y(unit B · 계산) = 0 + 2 = **2**  → 합이 같으니 **단원이 적은 Y**
   * 「유형 우선」은 X(유형 0)를 고른다. 두 테스트를 함께 통과하는 것은 합산뿐이다.
   */
  it("«유형만» 보지도 않는다 — 합이 같으면 단원이 적은 쪽이다", () => {
    const pool = [
      problem("e-a1", "u-a", { difficulty: "easy" }),
      problem("e-a2", "u-a", { difficulty: "easy" }),
      problem("x", "u-a", { problemType: "개념" }),
      problem("y", "u-b", { problemType: "계산" }),
    ];

    for (let seed = 0; seed < 10; seed += 1) {
      const { problems } = selectProblems({
        pool,
        difficultyRatio: { easy: 2, mid: 1, hard: 0 },
        count: 3,
        recentProblemIds: [],
        seed: `sum-not-type-${seed}`,
      });
      const ids = problems.map((p) => p.id);
      expect(ids, `시드 ${seed}`).toContain("y");
      expect(ids, `시드 ${seed}`).not.toContain("x");
    }
  });

  it("난이도 배분은 단원 분산 때문에 흔들리지 않는다 — 대체하지 않는다", () => {
    const pool = [
      problem("e-1", "u-a", { difficulty: "easy" }),
      problem("e-2", "u-a", { difficulty: "easy" }),
      problem("m-1", "u-b", { difficulty: "mid" }),
      problem("m-2", "u-c", { difficulty: "mid" }),
    ];

    const { problems, substitutions } = selectProblems({
      pool,
      difficultyRatio: { easy: 2, mid: 0, hard: 0 },
      count: 2,
      recentProblemIds: [],
      seed: "ratio-holds",
    });

    // 단원을 늘리려고 mid 를 끌어오면 안 된다 — 배분이 먼저다.
    expect(problems.map((p) => p.difficulty)).toEqual(["easy", "easy"]);
    expect(substitutions).toEqual([]);
  });
});

/** 일일테스트 불변 픽스처 — 단원 하나, 유형·난이도는 섞여 있다. */
const DAILY_POOL: SelectableProblem[] = [
  problem("d-01", "u-only", { difficulty: "easy", problemType: "계산" }),
  problem("d-02", "u-only", { difficulty: "easy", problemType: "개념" }),
  problem("d-03", "u-only", { difficulty: "easy", problemType: "활용" }),
  problem("d-04", "u-only", { difficulty: "easy", problemType: "계산" }),
  problem("d-05", "u-only", { difficulty: "mid", problemType: "계산" }),
  problem("d-06", "u-only", { difficulty: "mid", problemType: "개념" }),
  problem("d-07", "u-only", { difficulty: "mid", problemType: "활용" }),
  problem("d-08", "u-only", { difficulty: "mid", problemType: "서술형" }),
  problem("d-09", "u-only", { difficulty: "mid", problemType: "계산" }),
  problem("d-10", "u-only", { difficulty: "hard", problemType: "활용" }),
  problem("d-11", "u-only", { difficulty: "hard", problemType: "서술형" }),
  problem("d-12", "u-only", { difficulty: "hard", problemType: "개념" }),
];

/**
 * 정책 **이전** 엔진이 `DAILY_POOL` · 시드 `daily:2026-08-19` 로 실제로 낸 순서
 * (2026-08-19 실측, 커밋 `e158d616` 기준). 손으로 지어낸 값이 아니다.
 */
const DAILY_EXPECTED_ORDER = [
  "d-01",
  "d-03",
  "d-02",
  "d-08",
  "d-05",
  "d-07",
  "d-06",
  "d-11",
];
