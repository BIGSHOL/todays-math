/**
 * 🔴 적대적 리뷰 ④ — 「넘침 판정 수리」 구현물 재현물.
 *
 * 보고서: `docs/planning/tracks/reports/adv-overflow-review.md`
 * 대상:   `docs/planning/tracks/reports/fix-overflow.md` (브랜치 `BIGSHOL/fix-overflow`)
 * 실행:   npm run test:adv
 *
 * 이 파일은 **수리를 믿지 않는 심판**의 재현물이다. 숫자(재현율 96.1%)를 다시 재는 게
 * 아니라 **그 숫자가 가리키지 못하는 것**을 재현한다.
 *
 * 고친 것은 `src/__tests__/**` 로 옮기고 여기서 지운다(앞 트랙 규약).
 * 여기 남은 것은 **아직 빨간 것**이다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { TestPrintProblem } from "@/components/print/types";
import {
  OVERFLOW_LINE_LIMIT_FIRST_PAGE,
  assessOverflowRisk,
  estimateProblemLines,
} from "@/lib/printOverflow";

const problem = (over: Partial<TestPrintProblem> = {}): TestPrintProblem => ({
  id: "p1",
  orderIndex: 0,
  content: "다음을 계산하시오.",
  answer: "1",
  solution: null,
  ...over,
});

/**
 * 🔴 A — **자가 «세로로 쌓이는 수식»을 안 본다.**
 *
 * 해설 쪽 자(`estimateSolutionPx`)에는 `TALL_MATH_EXTRA_PX` 가 있다. 보고서 §3 이
 * 「과소평가가 곧 놓침이라 정확도보다 이쪽이 중요하다」며 넣은 항이다.
 * 그런데 **문제지 자(`estimateProblemPx`)에는 그 항이 없다.** 같은 규칙이
 * 한쪽에만 배선됐다.
 *
 * 실측(전수 47,152건 · `.measure/cont.json`):
 *   세로 수식 0개    27,516건 · 평균 오차 **+4.0px** · 20px 넘게 과소 0.8%
 *   세로 수식 3~5개   6,976건 · 평균 오차 **−22.0px** · 과소 **64.4%**
 *   세로 수식 6~10개  2,582건 · 평균 오차 **−36.3px** · 과소 **82.6%**
 * 보고서가 스스로 적은 「20px 넘게 과소 17.9%」의 **97.4%가 세로 수식이 있는 문항**이다
 * (오차 20px 이내인 쪽은 32.7%).
 */
describe("[적대④-A] 문제지 자에 «세로로 쌓이는 수식» 항이 없다", () => {
  /**
   * 실데이터 `8973feaa-aad8-4b22-b084-742ae878609d` — 이어지는 장에서 가장 크게
   * 놓친 문항(실측 556px, 칸 484px 을 **72px** 넘긴다). Σ 하나와 분수 다섯이
   * 보기마다 쌓이는데 자는 23줄로 봐서 한계(23)를 **딱 안 넘는다.**
   */
  const SUM_CHOICES = `한 변의 길이가 $3$인 정사각형 모양의 종이가 있다. 다음 그림과 같이 첫 번째 시행에서 정사각형을 $9$등분 한 후 중앙의 정사각형 부분을 잘라내고 남은 도형을 $A_{1}$이라 하자. 두 번째 시행에서 $A_{1}$에서 $8$개의 정사각형 각각을 다시 $9$등분하여 중앙의 정사각형 부분을 잘라내고 남은 도형을 $A_{2}$라 하자. 이와 같은 과정을 계속하여 $n$번째 얻은 도형을 $A_{n}$이라 하자. $A_{n}$의 넓이를 $S_{n}$이라 할 때, $\\sum _{n=1}^{20}S_{n}$의 값을 구하면?

1. $36\\left\\{ 1-\\left( \\frac{1}{9}\\right) ^{20}\\right\\}$
2. $36\\left\\{ 1-\\left( \\frac{8}{9}\\right) ^{20}\\right\\}$
3. $72\\left\\{ 1-\\left( \\frac{1}{9}\\right) ^{20}\\right\\}$
4. $72\\left\\{ 1-\\left( \\frac{8}{9}\\right) ^{20}\\right\\}$
5. $81\\left\\{ 1-\\left( \\frac{8}{9}\\right) ^{20}\\right\\}$`;

  it("Σ·분수가 쌓인 문항이 이어지는 장 칸을 72px 넘기는데 경고가 없다", () => {
    // 그림 491×270 → 인쇄 폭 상한(264.567px)으로 줄면 145.5px.
    const risks = assessOverflowRisk([
      problem({ id: "f1" }),
      problem({ id: "f2" }),
      problem({
        id: "sum",
        content: SUM_CHOICES,
        figureUrls: ["/figures/3294/q15.jpeg"],
        figureDims: [491, 270],
      }),
      problem({ id: "f4" }),
    ]);
    expect(risks.map((r) => r.number)).toContain(3);
  });

  /**
   * 실데이터 `ad734b0d-3221-478d-b46f-7c2cea73ed40` — 첫 장에서 놓친 것 중
   * 둘째로 크다(실측 463px, 첫 장 칸 405px 을 **58px** 넘긴다).
   * Σ 넷이 <보기> 상자 안에 쌓인다.
   */
  const SIGMA_BOX = `수열 $\\left\\{ r^{2}n\\right\\}$이 수렴할 때, 다음 중 항상 수렴하는 것만을 <보기>에서 고른 것은?
<보기>
ㄱ. $\\sum _{n=1}^{\\infty }\\left( \\frac{r}{2}\\right) ^{n}$
ㄴ. $\\sum _{n=1}^{\\infty }\\left( \\frac{r+1}{3}\\right) ^{n}$
ㄷ. $\\sum _{n=1}^{\\infty }r^{2}n+1$
ㄹ. $\\sum _{n=1}^{\\infty }\\left( \\frac{r-1}{2}\\right) ^{n}$

1. ㄱ, ㄴ
2. ㄱ, ㄷ
3. ㄴ, ㄷ
4. ㄴ, ㄹ
5. ㄷ, ㄹ`;

  it("Σ 넷이 상자에 쌓인 문항이 첫 장 칸을 58px 넘기는데 경고가 없다", () => {
    expect(estimateProblemLines(SIGMA_BOX)).toBeGreaterThan(
      OVERFLOW_LINE_LIMIT_FIRST_PAGE,
    );
  });
});

/**
 * 🔴 B — **장에 문항이 하나면 칸이 두 배인데 판정은 반으로 본다.**
 *
 * `.problemList`(flex column)의 `.problemItem` 은 `flex: 1 1 0%` 다. 그래서 칸은
 * **그 장의 문항 수로** 갈린다 — 두 문항이면 반씩, **한 문항이면 통째로** 쓴다.
 * 지면 실측(Chromium 인쇄 매체):
 *   이어지는 장 2문항 484px · **1문항 997px**
 *   첫 장      2문항 405px · **1문항 838px**
 *
 * 그런데 `assessOverflowRisk` 는 «몇째 장인가»만 보고 «그 장에 몇 개인가»는 안 본다.
 * 그래서 **문항 수가 홀수인 시험지의 마지막 문항**은 실제 칸의 절반으로 재인다 —
 * 25문항 시험지(보고서가 쓰는 기준)의 25번이 늘 그 자리다.
 */
describe("[적대④-B] 마지막 장에 혼자 놓인 문항은 칸이 두 배다", () => {
  /** 그림 200×500 — 묶음 512px. 본문까지 594.8px 이라 484 는 넘고 997 은 안 넘는다. */
  const tall = (id: string) =>
    problem({
      id,
      content: "짧은 발문이다.",
      figureUrls: ["/f.png"],
      figureDims: [200, 500],
    });

  it("홀수 시험지의 마지막 문항은 혼자 쓰는 칸(997px)에 들어가므로 경고가 아니다", () => {
    const risks = assessOverflowRisk([tall("a"), tall("b"), tall("c")]);
    // 1·2번은 첫 장 405px 이라 진짜 경고다. 3번은 997px 을 혼자 쓴다.
    expect(risks.map((r) => r.number)).not.toContain(3);
  });

  it("첫 장에 문항이 하나뿐인 시험지도 마찬가지다 — 838px 을 혼자 쓴다", () => {
    // 594.8px 짜리 한 문항. 첫 장 2문항 칸(405)은 넘지만 혼자면 838px 이다.
    expect(assessOverflowRisk([tall("solo")])).toEqual([]);
  });
});

/**
 * 🔴 C — **적재 파이프라인이 `figure_dims` 를 안 채운다.**
 *
 * 수리는 그림 치수를 DB 컬럼에서 읽는다. 오늘 자 8,442건은 backfill 스크립트가
 * 한 번 채웠다. 그런데 **문항이 들어오는 길**(`toLoadRows` → `load-classified`)은
 * `figureUrls` 만 쓰고 `figureDims` 는 쓰지 않는다. 그래서 앞으로 들어오는
 * 그림 문항은 전부 «모른다»가 된다.
 *
 * 실측 대조(`eval-overflow-rules.ts --no-dims`, 전수 47,152건):
 *   치수 앎   경고 3,495 · 놓침   105 · 재현율 **96.1%** · 정밀도 75.0%
 *   치수 모름 경고 2,683 · 놓침 **1,080** · 재현율 **60.4%** · 정밀도 61.3%
 * 즉 **수리는 오늘 자 데이터에만 유효**하고, 새 문항에서는 조용히 60%로 되돌아간다.
 */
describe("[적대④-C] 새로 들어오는 문항은 그림 치수가 빈 채로 적재된다", () => {
  it("toLoadRows 가 figureUrls 와 짝을 이루는 figureDims 를 만든다", async () => {
    const { toLoadRows } = await import("@/lib/import/toLoadRows");
    const rows = toLoadRows(
      [
        {
          externalId: "e1",
          unitId: "11111111-1111-4111-8111-111111111111",
          source: "past_exam",
          difficulty: "medium",
          problemType: "calculation",
          content: "그림을 보고 답하시오.",
          answer: "1",
          solution: null,
          directUseAllowed: true,
          figureUrls: ["/figures/4729/hwp-q03.png"],
          figureSource: "source",
        } as never,
      ],
      "22222222-2222-4222-8222-222222222222",
      { resolveDimensions: () => [598, 688] },
    ).rows;
    const row = rows[0] as unknown as { figureDims?: number[] };
    expect(row.figureDims).toEqual([598, 688]);
  });
});

/**
 * 🔴 D — **되돌리기가 공유 DB 게이트를 건너뛴다.**
 *
 * `backfill-figure-dimensions.ts` 는 `--apply` 에 `ALLOW_SHARED_IMPORT=1` 을 요구한다
 * (2026-08-14 적재 사고 뒤 굳은 규칙, D-31). 그런데 `--revert` 분기가 **그 검사보다
 * 위**에 있어서 `--revert --apply` 는 환경변수 없이 공유 DB 전량을 지운다.
 * 지워지는 것은 판정의 유일한 근거이고, 조용히 재현율 96.1% → 60.4% 가 된다.
 */
describe("[적대④-D] --revert 가 공유 DB 쓰기 게이트를 건너뛴다", () => {
  it("ALLOW_SHARED_IMPORT 검사가 --revert 분기보다 먼저 온다", () => {
    const src = readFileSync(
      path.join(process.cwd(), "scripts/qa/backfill-figure-dimensions.ts"),
      "utf8",
    );
    const gate = src.indexOf("ALLOW_SHARED_IMPORT !== ");
    const revert = src.indexOf('includes("--revert")');
    expect(gate).toBeGreaterThan(-1);
    expect(revert).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(revert);
  });
});

/**
 * 🔴 E — **채점기의 «참»이 제품 상수에서 나온다 (동어반복).**
 *
 * `eval-overflow-rules.ts` 는 «넘쳤는가»를 `h.neededPx > slot` 으로 가르는데,
 * 그 `slot` 이 **제품 상수** `JASEUP_MEASURED_PX.continuationSlot` 이다.
 * 캐시에는 실측 칸 높이 `availPx` 가 들어 있는데 쓰지 않는다.
 *
 * 그래서 상수를 484 → 600 으로 망가뜨리면(지면과 어긋난 값):
 *   「채점기 ↔ 제품 일치 확인 (0건 불일치)」  그대로 초록
 *   실측 넘침 2,726 → 715 · 재현율 96.1% → **97.1%** (더 좋아 보인다)
 * 지면과 어긋난 상수가 **더 좋은 성적표**를 낸다 — 지표가 그 실패를 셀 수 없다.
 */
describe("[적대④-E] 채점기가 실측 칸 높이를 안 쓴다", () => {
  it("eval-overflow-rules 가 캐시의 availPx 로 «넘침»을 가른다", () => {
    const src = readFileSync(
      path.join(process.cwd(), "scripts/qa/eval-overflow-rules.ts"),
      "utf8",
    );
    expect(src).toMatch(/overflows:\s*h\.neededPx\s*>\s*h\.availPx/);
  });
});

/**
 * 🔴 F — **캐시가 낡아도 채점기가 조용히 통과한다.**
 *
 * 높이 캐시(`.measure/cont.json`)는 지면을 Chromium 으로 그려 뜬 것이다. 지면·CSS·
 * `fitsTwoColumns` 가 바뀌면 그 값은 전부 거짓이 된다. 스크립트가 보는 것은
 * **문항 id 목록과 건수뿐**이라 그걸 못 본다.
 *
 * 실측 재현: `TWO_COLUMN_WIDTH_LIMIT` 24 → 40 (보기 열 수가 바뀌어 지면 높이가
 * 실제로 달라진다) 으로 바꾸고 같은 캐시로 채점하면 — 아무 경고 없이
 * 「재현율 95.2%」를 찍는다.
 */
describe("[적대④-F] 높이 캐시에 «무엇을 보고 잰 것인가»가 없다", () => {
  const read = (file: string) =>
    readFileSync(path.join(process.cwd(), file), "utf8");

  it("측정 스크립트가 지면 입력의 지문을 캐시와 함께 남긴다", () => {
    expect(read("scripts/qa/measure-print-overflow.tsx")).toMatch(
      /writeHeightCacheManifest/,
    );
  });

  it("채점기가 그 지문을 대조하고 어긋나면 멈춘다", () => {
    expect(read("scripts/qa/eval-overflow-rules.ts")).toMatch(
      /assertHeightCacheFresh/,
    );
  });
});
