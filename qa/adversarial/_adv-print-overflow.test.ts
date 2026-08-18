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
import { describe, expect, it } from "vitest";

import type { TestPrintProblem } from "@/components/print/types";
import { JASEUP_GEOMETRY } from "@/lib/printGeometry";
import { paginateAnswerKey } from "@/lib/printLayout";
import { packProblems } from "@/lib/printPack";
import { estimateProblemLines, OVERFLOW_LINE_LIMIT } from "@/lib/printOverflow";

/* ── 실측 상수 (scratch 측정 도구 산출, 인쇄 매체) ────────────────────────── */
const LINE_PX = 20.3125;
const SLOT_CONTINUATION_PX = 484;
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
 * ✅ `[적대③-A]` 그림 사각지대 — **고쳤다.** 회귀 가드는
 * `src/__tests__/unit/printOverflow.test.ts` 와 `printFigureHeight.test.ts` 로 옮겼다.
 * 재현율 30.4% → 96.3% (`scripts/qa/eval-overflow-rules.ts`, 전수 47,152건).
 */

/**
 * ✅ `[적대③-B]` **판정**은 고쳤다 — 첫 장 한계를 칸 차이(79px = 3.9줄)에서 유도해
 * 따로 쓴다. 첫 장 기준 재현율 19.4% → **93.9%**. 회귀 가드는
 * `src/__tests__/unit/printOverflow.test.ts` 의 `[적대③-B]` 로 옮겼다.
 *
 * 🔴 **분할은 안 고쳤다** — 아래 한 건은 일부러 빨간 채로 둔다.
 */
describe("[적대③-B] 첫 장이 좁다는 사실이 «분할» 에는 아직 없다", () => {
  /**
   * `packProblems` 는 장을 **문항 수로만** 자른다. 첫 장이 79px 좁다는 사실이
   * 분할에 한 글자도 들어가 있지 않다.
   *
   * ⚠️ **이건 판정이 아니라 지면 배치다.** 첫 장 정원을 1문항으로 줄이면 시험지
   *    장 수가 늘고 문항이 놓이는 자리가 통째로 바뀐다 — 원장님 확정 사항(D-07,
   *    절대 규칙 1·6)이라 여기서 고칠 수 없다. 제안은
   *    `docs/planning/tracks/reports/fix-overflow.md` 에 적었다.
   */
  it("지면 분할은 첫 장에도 그냥 두 문항을 넣는다", () => {
    const pages = packProblems(
      Array.from({ length: 6 }, (_, i) => problem({ id: `p${i}` })),
    );
    expect(JASEUP_GEOMETRY.questionsPerPage).toBe(2);
    // 🔴 첫 장이 79px 좁으므로 «장별 정원»이 같을 수 없다 — 원장님 확정 대기.
    expect(pages[0]!.problems.length).toBeLessThan(pages[1]!.problems.length);
  });
});

/**
 * ✅ `[적대③-C]` **판정**은 고쳤다 — `assessAnswerKeyRisk` 가 `solution` 을 읽고
 * 「어느 쪽에서 어느 문항의 해설이 사라지는가」를 짚는다. 실측 재현율 **97.7%**
 * (정밀도 75.5%, `scripts/qa/eval-answerkey-rules.ts`). 회귀 가드는
 * `src/__tests__/unit/answerKeyOverflow.test.ts` 로 옮겼다.
 *
 * 🔴 **정원은 안 고쳤다** — 아래 한 건은 일부러 빨간 채로 둔다.
 */
describe("[적대③-C] 정답지 1쪽 정원이 「빠른 정답」 상자를 모른다", () => {
  /**
   * 정답지 1쪽에는 **빠른 정답 상자**가 얹힌다(문항 수와 정답 길이에 비례해 커진다 —
   * 실측 25문항에서 344~668px). 그런데 `paginateAnswerKey` 는 1쪽에도 8건을 넣는다.
   * 실측: 잘린 134장 중 **95장이 1쪽**이다(1쪽 120장 중 79%).
   *
   * ⚠️ **이건 판정이 아니라 지면 배치다.** 1쪽 정원을 줄이면 정답지 장 수가 늘고
   *    문항이 놓이는 자리가 통째로 바뀐다 — 원장님 확정 사항(D-07, 절대 규칙 1·6).
   *    제안은 `docs/planning/tracks/reports/fix-overflow.md` 에 적었다.
   */
  it("빠른 정답 상자가 얹히는 1쪽도 8건 고정이다", () => {
    const pages = paginateAnswerKey(
      Array.from({ length: 25 }, (_, i) => problem({ id: `p${i}` })),
    );
    expect(JASEUP_GEOMETRY.answerEntriesPerPage).toBe(8);
    // 🔴 1쪽은 빠른 정답 상자만큼 좁으므로 8건일 수 없다 — 원장님 확정 대기.
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
   * 한계에 고정 chrome 을 더해도 칸 484px 과 안 맞는다. 어느 쪽으로 틀렸는지가
   * 아니라 **칸에서 유도된 숫자가 아니라는 것**이 요점이다.
   * (2026-08-18 그림 수리로 한계가 14 → 18 이 됐지만 성질은 그대로다 —
   *  둘 다 실측 넘침에 맞춘 값이지 칸 높이에서 나온 값이 아니다.)
   */
  it("줄 수 한계는 문항 칸 484px 에서 유도된 값이 아니다", () => {
    const impliedPx = OVERFLOW_LINE_LIMIT * LINE_PX + FIXED_CHROME_PX;
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

/**
 * ✅ `[적대③-E]` 모형과 문구 — **고쳤다.** `printOverflow.ts` 머리 주석,
 * `printOverflow.test.ts`·`overflowLines.test.ts` 머리 주석, 인쇄 경고 문구를
 * 전부 «겹침»으로 바로잡았다. 회귀 가드(CSS 원문 대조 + 경고 문구 대조)는
 * `src/__tests__/unit/printOverflow.test.ts` 의 `[적대③-E]` 로 옮겼다.
 */
