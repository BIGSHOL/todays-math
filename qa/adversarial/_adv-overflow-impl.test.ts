/**
 * 🔴 남은 RED — 적대적 리뷰 ④ 「넘침 판정 수리」 구현물.
 *
 * 보고서: `docs/planning/tracks/reports/adv-overflow-review.md`
 * 대상:   `docs/planning/tracks/reports/fix-overflow.md`
 * 실행:   npm run test:adv      (기본 `npm run test` 의 include 밖이다)
 *
 * ## 고친 것 — 회귀 가드로 옮겼다
 *
 *   `[적대④-A]` 문제지 자의 «세로로 쌓이는 수식» → `printGeometryPin.test.ts`
 *   `[적대④-B]` 혼자 놓인 문항의 칸(997/838px)   → `printOverflow.test.ts`
 *   `[적대④-C]` 적재가 `figure_dims` 를 채운다    → `importFigureDims.test.ts`
 *   `[적대④-D]` 되돌리기의 공유 DB 게이트         → `importFigureDims.test.ts`
 *   `[적대④-E]` 채점기가 실측 칸을 쓴다           → `heightCacheManifest.test.ts`
 *   `[적대④-F]` 캐시 지문                         → `heightCacheManifest.test.ts`
 *   그리고 상수 29개 전수 변이 시험에서 **가드가 없던 9개** → `printGeometryPin.test.ts`
 *
 * ## 아래 하나는 빨간 채로 둔다 — 고치면 **인쇄물이 달라진다**
 *
 * 지면 배치·문항 자리는 원장님 확정 사항이다(D-07 · 절대 규칙 1·6).
 * 원장님이 확정하면 이 파일에서 지우고 회귀 가드로 옮긴다.
 */
import { describe, expect, it } from "vitest";

import type { TestPrintProblem } from "@/components/print/types";
import { selectProblems } from "@/lib/generator/selectProblems";
import { assessOverflowRisk } from "@/lib/printOverflow";

/**
 * 🔴 **판정은 아는데, 문항을 고르는 쪽은 못 본다.**
 *
 * `assessOverflowRisk` 는 이제 「이 문항은 칸에 안 들어간다」를 96~99% 맞힌다.
 * 그런데 그 앎이 쓰이는 시점은 **인쇄 미리보기**다 — 문항이 이미 정해진 뒤다.
 * 원장이 그때 할 수 있는 일은 문항을 하나씩 손으로 바꾸는 것뿐이다.
 *
 * 정작 **고르는 쪽**(`selectProblems`)의 후보 타입 `SelectableProblem` 에는
 * `content` 도 `figureUrls` 도 `figureDims` 도 없다. 즉 출제 엔진은 구조적으로
 * 「이 문항이 지면에 안 들어간다」를 **알 수가 없다.** 이건 이번 수리가 고친 결함
 * (「그림이 판정의 **인자에 아예 없었다**」)과 **똑같은 모양**이 한 층 위에 있는 것이다.
 *
 * 실측으로 이게 왜 문제인가 (`scripts/qa/analyze-warning-load.ts`, 전수 47,152건):
 * ```
 *  문항수  경고 기대  그중 헛것  실제 넘침  경고가 뜨는 시험지 비율
 *      8      0.78건     0.18건     0.60건        56.3%
 *     25      2.04건     0.52건     1.53건        88.2%
 *     30      2.48건     0.63건     1.87건        92.6%
 * ```
 * 25문항 시험지의 **88%에 경고가 뜬다.** 헛것을 한 건도 없이 만들어도 79% 다 —
 * 「실제 넘침 1.53건」이 남기 때문이다. **경고가 매번 뜨면 그 경고는 없는 것과 같다.**
 * 판정을 더 조이는 것으로는 못 고친다. 애초에 **안 들어가는 문항을 안 고르면** 된다.
 *
 * ⚠️ 고치려면 출제 결과(어떤 문항이 시험지에 실리는가)가 바뀐다 — 인쇄물이 달라지므로
 *    **원장님 확정 대상**(D-07). 그래서 제안으로만 남긴다:
 *    ⑴ `SelectableProblem` 에 `content`·`figureUrls`·`figureDims` 를 실어
 *       `selectProblems` 가 «칸에 안 들어가는 문항»을 후순위로 돌린다(제외가 아니라 후순위 —
 *       풀이 얇은 단원에서 출제가 막히면 안 된다).
 *    ⑵ 또는 자리만 바꾼다 — 첫 장 칸이 79px 좁으므로 큰 문항을 1·2번에 안 놓는다.
 *       ⑵ 만으로도 첫 장 몫(경고 기대의 절반 가까이)이 사라진다.
 */
describe("[적대④-G] 출제가 «지면에 안 들어가는 문항»을 그냥 고른다", () => {
  const oversize = (id: string) => ({
    id,
    unitId: "u1",
    difficulty: "mid" as const,
    problemType: "계산",
    directUseAllowed: true,
    orderIndex: 0,
    content: "짧은 발문이다.",
    answer: "1",
    solution: null,
    // 인쇄 폭 상한으로 줄여도 1,234px — 어느 칸에도 안 들어간다.
    figureUrls: ["/f.png"],
    figureDims: [200, 1234],
  });
  const fits = (id: string) => ({
    ...oversize(id),
    figureUrls: [] as string[],
    figureDims: [] as number[],
  });

  it("풀에 들어가는 문항이 넉넉해도 안 들어가는 문항을 뽑는다", () => {
    const pool = [
      oversize("big-1"),
      oversize("big-2"),
      oversize("big-3"),
      fits("ok-1"),
      fits("ok-2"),
      fits("ok-3"),
    ];
    const selected = selectProblems({
      pool,
      difficultyRatio: { easy: 0, mid: 2, hard: 0 },
      count: 2,
      recentProblemIds: [],
      seed: "adv-overflow-4",
    });
    expect(selected.problems).toHaveLength(2);

    const risks = assessOverflowRisk(
      selected.problems as unknown as TestPrintProblem[],
    );
    // 🔴 들어가는 문항이 셋이나 남아 있는데 안 들어가는 것을 골랐다 — 원장님 확정 대기.
    expect(risks).toEqual([]);
  });
});
