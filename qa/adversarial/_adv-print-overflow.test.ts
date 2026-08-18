/**
 * 🔴 RED — 적대적 리뷰 ③ 「조판·넘침·지면」 재현물.
 *
 * 보고서: `docs/planning/tracks/reports/adv-print-review.md`
 * 실행:   npm run test:adv      (기본 `npm run test` 의 include 밖이다)
 *
 * ## 이 파일이 재현하는 것
 *
 * 자습 지면은 문항 하나가 **고정 높이 반 페이지 칸**이고, 넘친 내용은 아무 표시 없이
 * 사라진다. 그래서 넘침 경고(`assessOverflowRisk`)는 «원장이 알고 누르게 하는 유일한
 * 장치»다. 그 장치가 지금 **넘치는 문항의 70%를 못 본다.**
 *
 * ## 실측 기준 (전부 Chromium + 실제 KaTeX CSS + 지면 글꼴, **인쇄 매체**)
 *
 * 측정 도구는 보고서 §9 에 적어 두었다. 아래 숫자는 그 도구가 낸 값이다.
 *   · 이어지는 장 문항 칸 = 484.0px · 첫 장 문항 칸 = 405.0px
 *   · 본문 행높이 = 20.3125px (12.5px × leading-relaxed 1.625)
 *   · 문항번호 + 정답란(고정 chrome) = 62.5px = 3.08줄  ← 추정기가 **0줄**로 센다
 *   · 상자 하나의 글자 아닌 세로 = 98.0px = 4.83줄      ← 추정기는 3줄(테두리 2 + 라벨 1)
 *   · 문항 열 363.5px = 58.2단위 / 1열 보기 글자칸 345.0px = 55.2단위 /
 *     상자 항목칸 329.5px = 52.7단위                    ← 추정기는 전부 59단위
 *
 * ⚠️ 이 파일은 제품 코드를 **고치지 않는다.** 결함이 고쳐지면 이 파일을 지우고
 *    회귀 가드를 `src/__tests__/**` 로 옮긴다(vitest.adversarial.mts 주석 참조).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { TestPrintProblem } from "@/components/print/types";
import { JASEUP_GEOMETRY } from "@/lib/printGeometry";
import { paginateAnswerKey } from "@/lib/printLayout";
import { packProblems } from "@/lib/printPack";
import {
  assessOverflowRisk,
  estimateProblemLines,
  OVERFLOW_FIGURE_LIMIT,
  OVERFLOW_LINE_LIMIT,
} from "@/lib/printOverflow";

/* ── 실측 상수 (scratch 측정 도구 산출, 인쇄 매체) ────────────────────────── */
const LINE_PX = 20.3125;
const SLOT_CONTINUATION_PX = 484;
const SLOT_FIRST_PAGE_PX = 405;
const FIXED_CHROME_PX = 62.5;

const problem = (over: Partial<TestPrintProblem> = {}): TestPrintProblem => ({
  id: "p1",
  orderIndex: 0,
  content: "다음을 계산하시오.",
  answer: "1",
  solution: null,
  ...over,
});

/**
 * 실데이터 `0129fdcd-8f19-42e3-99a1-5e3137ebf721`.
 * 그림 1장(`/figures/4729/hwp-q03.png`, 원본 419×482 → 인쇄 폭 70mm 로 264.6×304.3).
 * 실측 지면 높이 **550.5px** — 이어지는 장 칸 484px 을 66px(3.3줄) 넘긴다.
 * 그런데 폭 171(<530) · 추정 5줄(<14) · 그림 1장(<2) 이라 **어떤 규칙에도 안 걸린다.**
 */
const ONE_FIGURE_CONTENT = `그림과 같이 두 직선 $y=2x$와 $y=x$가 이루는 예각의 크기를 $\\theta$라 할 때, $\\cos \\theta$의 값은?

1. $\\frac{\\sqrt{10}}{10}$
2. $\\frac{\\sqrt{10}}{6}$
3. $\\frac{\\sqrt{10}}{5}$
4. $\\frac{\\sqrt{10}}{4}$
5. $3\\sqrt{10}\\frac{}{10}$`;
const ONE_FIGURE_MEASURED_PX = 550.5;

describe("[적대③-A] 그림이 경고의 사각지대다 — 넘침의 93%", () => {
  /**
   * 전수 실측(47,152건, 인쇄 매체): 넘치는 문항 2,725건 중 **2,557건이 그림 문항**이다.
   * 그림 없는 38,710건은 넘침이 168건(0.43%)뿐이고 그중 167건은 지금 규칙이 잡는다.
   * 즉 **결함은 그림 하나에 몰려 있다.**
   */
  it("그림 1장짜리 문항은 칸을 66px 넘겨도 경고가 없다", () => {
    const risks = assessOverflowRisk([
      problem({
        content: ONE_FIGURE_CONTENT,
        figureUrls: ["/figures/4729/hwp-q03.png"],
      }),
    ]);
    expect(ONE_FIGURE_MEASURED_PX).toBeGreaterThan(SLOT_CONTINUATION_PX);
    // 🔴 지금은 [] 다.
    expect(risks).toHaveLength(1);
  });

  /**
   * `estimateProblemLines(content)` 는 **본문 문자열만** 받는다. 그림은 인자에 없다.
   * 같은 본문에 그림을 붙이면 지면은 15.6줄이 늘어나는데(실측 8.45줄 → 24.03줄)
   * 추정값은 한 줄도 안 변한다 — 구조적으로 못 본다.
   */
  it("줄 수 추정기는 그림을 0줄로 센다 — 그림이 들어갈 자리가 인자에 없다", () => {
    const withoutFigure = estimateProblemLines(ONE_FIGURE_CONTENT);
    expect(withoutFigure).toBe(5);
    // 실측: 그림 없이 8.45줄 · 그림 붙이면 24.03줄.
    const measuredWithFigure = 24.03;
    // 🔴 추정기가 그림을 볼 방법이 없으므로 이 기대는 지금 통과할 수 없다.
    expect(withoutFigure).toBeGreaterThanOrEqual(measuredWithFigure - 1);
  });

  /**
   * 그림 장수 규칙은 **2장부터** 본다. 실데이터에서 그림 1장 문항은 7,930건이고
   * 그중 2,109건(26.6%)이 실측 넘침이다. 2장 이상은 512건뿐이다.
   * 즉 한계 2는 **모집단의 94%를 처음부터 제외**한다.
   */
  it("그림 장수 한계 2는 그림 문항의 94%를 아예 안 본다", () => {
    // 🔴 지금은 2 다.
    expect(OVERFLOW_FIGURE_LIMIT).toBeLessThanOrEqual(1);
  });
});

describe("[적대③-B] 첫 장은 칸이 79px 좁은데 판정도 분할도 그걸 모른다", () => {
  /**
   * 첫 장에는 머리글 + 「핵심 개념 정리」 상자가 얹혀 문항 칸이 405px 이다.
   * 이어지는 장은 484px. 같은 문항이 **1·2번이면 잘리고 3번이면 멀쩡**하다.
   * 전수 실측: 첫 장에서만 넘치는 문항 3,216건(6.82%), 그중 경고 없는 것 2,892건.
   */
  it("첫 장 칸과 이어지는 장 칸이 다르다 — 79px, 3.9줄", () => {
    expect(SLOT_CONTINUATION_PX - SLOT_FIRST_PAGE_PX).toBe(79);
  });

  /**
   * 실데이터 `000083c0-48ae-4cf2-829b-0f38b29b4c54` 는 실측 439px 이다.
   * 이어지는 장(484)에는 들어가고 첫 장(405)에서는 34px 잘린다.
   * 판정은 «몇 번 문항인지»를 알면서도(`index`) 장을 나누지 않는다.
   */
  it("첫 장에 놓이는 1·2번만 더 엄격하게 봐야 하는데 한계가 하나뿐이다", () => {
    const p = problem({ content: ONE_FIGURE_CONTENT, id: "x" });
    const risks = assessOverflowRisk([
      { ...p, id: "a" },
      { ...p, id: "b" },
      { ...p, id: "c" },
    ]);
    // 🔴 지금은 셋 다 무경고이고, 설령 걸려도 셋이 똑같이 걸린다.
    expect(risks.map((r) => r.number)).toEqual([1, 2]);
  });

  /**
   * `packProblems` 는 장을 **문항 수로만** 자른다. 첫 장이 좁다는 사실이
   * 분할에 한 글자도 들어가 있지 않다.
   */
  it("지면 분할은 첫 장에도 그냥 두 문항을 넣는다", () => {
    const pages = packProblems(
      Array.from({ length: 6 }, (_, i) => problem({ id: `p${i}` })),
    );
    expect(JASEUP_GEOMETRY.questionsPerPage).toBe(2);
    // 🔴 첫 장이 79px 좁으므로 «장별 정원»이 같을 수 없다.
    expect(pages[0]!.problems.length).toBeLessThan(pages[1]!.problems.length);
  });
});

describe("[적대③-C] 정답지는 판정 대상이 아니다", () => {
  /**
   * `.answerSolutions` 에도 `overflow: hidden` 이 걸려 있다(다단이라 넘친 해설은
   * **3번째 단**으로 밀려 지면 밖에서 잘린다). 그런데 `assessOverflowRisk` 는
   * `problem.content` 만 읽고 `solution` 은 한 글자도 안 본다.
   *
   * 실측(시험지 120개 × 25문항, 해설이 있는 문항만): 정답지 480장 중 **134장(27.9%)**
   * 에서 해설이 잘렸다. 해설이 섞인 일반 풀에서도 4.8%.
   */
  it("해설이 2,373자여도 경고가 없다 — 판정이 solution 을 안 읽는다", () => {
    const risks = assessOverflowRisk([
      problem({ content: "다음을 구하시오.", solution: "가".repeat(2373) }),
    ]);
    // 🔴 지금은 [] 다.
    expect(risks).toHaveLength(1);
  });

  /**
   * 정답지 1쪽에는 **빠른 정답 상자**가 얹힌다(문항 수에 비례해 커진다 —
   * 25문항이면 7행). 그런데 `paginateAnswerKey` 는 1쪽에도 8건을 그대로 넣는다.
   * 실측: 잘린 134장 중 **95장이 1쪽**이다(1쪽 120장 중 79%).
   */
  it("빠른 정답 상자가 얹히는 1쪽도 8건 고정이다", () => {
    const pages = paginateAnswerKey(
      Array.from({ length: 25 }, (_, i) => problem({ id: `p${i}` })),
    );
    expect(JASEUP_GEOMETRY.answerEntriesPerPage).toBe(8);
    // 🔴 1쪽은 빠른 정답 상자만큼 좁으므로 8건일 수 없다.
    expect(pages[0]!.problems.length).toBeLessThan(8);
  });
});

describe("[적대③-D] 줄 수 추정기의 «자»가 지면과 다르다", () => {
  /**
   * 문항 하나에는 본문 말고도 **문항번호(18px + 마진 6px)와 정답란(마진 8px + 30.5px)**
   * 이 늘 붙는다 — 실측 62.5px = 3.08줄. 추정기는 이걸 0으로 센다.
   * 그래서 «14줄» 은 칸(484px)에서 유도된 값이 아니라 폭 규칙과 건수를 맞춘 값이다.
   */
  it("빈 본문도 지면에서는 이미 3.08줄을 쓴다 — 추정은 0줄", () => {
    expect(estimateProblemLines("")).toBe(0);
    expect(FIXED_CHROME_PX / LINE_PX).toBeCloseTo(3.08, 1);
    // 🔴 고정 chrome 을 세면 빈 문항도 3줄이어야 한다.
    expect(estimateProblemLines("")).toBeGreaterThanOrEqual(3);
  });

  /**
   * 한계 14줄에 고정 chrome 을 더해도 284 + 62.5 = 346.5px 로 칸 484px 과 안 맞는다.
   * 어느 쪽으로 틀렸는지가 아니라 **칸에서 유도된 숫자가 아니라는 것**이 요점이다.
   */
  it("한계 14줄은 문항 칸 484px 에서 유도된 값이 아니다", () => {
    const impliedPx = OVERFLOW_LINE_LIMIT * LINE_PX + FIXED_CHROME_PX;
    expect(impliedPx).toBeCloseTo(346.9, 0);
    // 🔴 칸에서 유도했다면 484px 근처여야 한다.
    expect(impliedPx).toBeGreaterThan(SLOT_CONTINUATION_PX - LINE_PX);
  });

  /**
   * 1열 보기는 마커(①)와 `gap-1.5` 만큼 좁고(345.0px = 55.2단위),
   * `mt-4`(16px)와 행 간격 `gap-y-2`(8px×4)를 더 먹는다.
   * 실측 8.36줄인데 추정은 6줄이다.
   */
  it("1열 보기 다섯 개 — 실측 8.36줄, 추정 6줄", () => {
    const content = `다음 중 옳은 것은?\n1. ${"가".repeat(20)}\n2. ${"나".repeat(20)}\n3. ${"다".repeat(20)}\n4. ${"라".repeat(20)}\n5. ${"마".repeat(20)}`;
    expect(estimateProblemLines(content)).toBe(6);
    // 🔴 실측 8.36줄.
    expect(estimateProblemLines(content)).toBeGreaterThanOrEqual(8);
  });

  /**
   * 상자는 `my-4`(위아래 16px)까지 먹는다 — 실측 98px = 4.83줄인데
   * 추정은 테두리·여백 2줄 + 라벨 1줄 = 3줄이다. 상자를 그리는 문항이 3,573건이다.
   * 게다가 상자 **안쪽 폭**은 329.5px(52.7단위)인데 추정기는 59단위로 나눈다.
   */
  it("<보기> 상자 둘 — 실측 9.04줄, 추정 8줄", () => {
    const content = `다음 <보기> 에서 옳은 것을 고르시오.\n<보기>\nㄱ. ${"가".repeat(30)}\nㄴ. ${"나".repeat(30)}`;
    expect(estimateProblemLines(content)).toBe(8);
    // 🔴 실측 9.04줄.
    expect(estimateProblemLines(content)).toBeGreaterThanOrEqual(9);
  });
});

describe("[적대③-E] 넘침은 «잘림»이 아니라 «겹침»이다 — 모형이 틀렸다", () => {
  const css = readFileSync(
    path.join(process.cwd(), "src/components/print/TestPrint.module.css"),
    "utf8",
  );

  /**
   * `printOverflow.ts` 머리 주석과 `printOverflow.test.ts` 머리 주석이 모두
   * 「`.problemBox` 에 `overflow: hidden` 이 걸려 있다」고 적었다.
   * **그런 클래스는 없다.** `overflow: hidden` 은 `.a4Page` 하나에만 있다.
   *
   * 결과가 다르다. 문항 칸에 클립이 없으므로 1번 문항이 넘치면 **2번 문항 위에
   * 겹쳐 찍히고**(스크린샷 §2), 2번이 넘치면 보기·정답란이 통째로 지면 밖으로
   * 밀려 사라진다. 「그 문항만 조금 잘린다」가 아니다.
   */
  it("`.problemBox` 라는 클래스는 존재하지 않는다", () => {
    expect(css).not.toContain("problemBox");
  });

  it("문항 칸(.problemItem)에는 overflow 가 없다 — 그래서 옆 문항을 덮는다", () => {
    const rule = /\.problemItem\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("flex: 1");
    // 🔴 넘침이 그 칸 안에서 끝나려면 여기에 overflow 가 있어야 한다.
    expect(rule).toMatch(/overflow/);
  });
});
