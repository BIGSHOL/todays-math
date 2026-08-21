/**
 * 🔴 남은 RED — 적대적 리뷰 ③ 「조판·넘침·지면」 재현물.
 *
 * 보고서:      `docs/planning/tracks/reports/adv-print-review.md`
 * 수리 보고서: `docs/planning/tracks/reports/fix-overflow.md`
 * 실행:        npm run test:adv      (기본 `npm run test` 의 include 밖이다)
 *
 * ## 지금 남아 있는 것 — 둘 다 «판정»이 아니라 «지면 배치»다
 *
 * 판정(🔴①②③④ · 🟡⑤)은 전부 고쳤고 회귀 가드는 `src/__tests__/**` 로 옮겼다.
 *   · `[적대③-A]` 그림 높이      → `printOverflow.test.ts` · `printFigureHeight.test.ts`
 *   · `[적대③-B]` 장을 아는 판정  → `printOverflow.test.ts`
 *   · `[적대③-C]` 정답지 판정     → `answerKeyOverflow.test.ts`
 *   · `[적대③-D]` 추정기의 «자»   → `overflowLines.test.ts`
 *   · `[적대③-E]` 모형·경고 문구  → `printOverflow.test.ts`
 *
 * 아래 **한 건**은 일부러 빨간 채로 둔다. 고치면 **인쇄물 출력 결과가 바뀐다** —
 * 지면 형태는 원장님 확정 사항이므로(D-07 · 절대 규칙 1·6) 이 트랙에서 결정할 수 없다.
 * 원장님이 확정하면 이 파일에서 지우고 `printPack.test.ts` 로 옮긴다.
 *
 * ✅ **`[적대③-B]` 문제지 분할은 2026-08-21 에 나갔다.** 원장님이 「문항 길이에 따라
 *    배치를 다르게. 길이가 길면 1개로」로 확정하셔서 `packProblems` 가 문항 높이를
 *    보게 됐다. 회귀 가드는 위 규칙대로 `src/__tests__/unit/printPack.test.ts` 에 있다.
 */
import { describe, expect, it } from "vitest";

import type { TestPrintProblem } from "@/components/print/types";
import { JASEUP_GEOMETRY } from "@/lib/printGeometry";
import { paginateAnswerKey } from "@/lib/printLayout";

const problem = (over: Partial<TestPrintProblem> = {}): TestPrintProblem => ({
  id: "p1",
  orderIndex: 0,
  content: "다음을 계산하시오.",
  answer: "1",
  solution: null,
  ...over,
});

describe("[적대③-C] 정답지 1쪽 정원이 「빠른 정답」 상자를 모른다", () => {
  /**
   * 정답지 1쪽에는 **빠른 정답 상자**가 얹힌다 — 시험지 전 문항을 4열로 늘어놓고,
   * 정답이 수식이면 셀이 접혀 더 커진다(실측 25문항에서 **344~668px**).
   * 그런데 `paginateAnswerKey` 는 1쪽에도 8건을 그대로 넣는다.
   * 실측: 해설이 잘린 134장 중 **95장이 1쪽**이다(1쪽 120장 중 79%).
   *
   * 판정은 이제 안다(`assessAnswerKeyRisk` 가 1쪽 상자 높이를 계산한다) —
   * 그래서 경고는 나간다. 그래도 **8건을 넣는다는 사실 자체**는 안 바뀐다.
   *
   * ⚠️ 고치려면 1쪽 정원을 줄여야 하고, 그러면 정답지 장 수와 배치가 바뀐다 —
   *    **원장님 확정 대상**(D-07).
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
