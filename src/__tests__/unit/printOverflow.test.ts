/**
 * 인쇄 넘침 경고 — 넘쳐도 모르는 게 진짜 피해다.
 *
 * 자습 지면은 문항 하나가 **고정 높이 반 페이지 칸**(본문 1.15 : 연습칸 1)인데
 * 그 칸(`.problemItem`)에는 **`overflow` 가 없다.** 그래서 넘친 내용은 잘리는 게
 * 아니라 **옆 문항 위에 겹쳐 찍히고**, 2번 자리에서 넘치면 보기·정답란이 지면
 * 밖으로 밀려 통째로 사라진다(적대적 리뷰 ③ §3 — 스크린샷·A4 PDF 근거).
 * 지면 형태는 원장님 확정 사항(D-07)이라 바꾸지 않는다 — 대신 **인쇄 전에 알린다.**
 */
import { describe, expect, it } from "vitest";

import type { TestPrintProblem } from "@/components/print/types";
import { packProblems } from "@/lib/printPack";
import { JASEUP_MEASURED_PX } from "@/lib/printGeometry";
import {
  assessOverflowRisk,
  OVERFLOW_LINE_LIMIT,
  OVERFLOW_LINE_LIMIT_FIRST_PAGE,
  OVERFLOW_WIDTH_LIMIT,
  OVERFLOW_FIGURE_LIMIT,
} from "@/lib/printOverflow";

const problem = (over: Partial<TestPrintProblem> = {}): TestPrintProblem => ({
  id: "p1",
  orderIndex: 0,
  content: "다음을 계산하시오.",
  answer: "1",
  solution: null,
  ...over,
});

describe("[T2] 인쇄 넘침 위험 판정", () => {
  it("보통 문항은 경고하지 않는다", () => {
    expect(assessOverflowRisk([problem(), problem()])).toEqual([]);
  });

  it("본문이 길면 경고하고 **인쇄 번호**로 가리킨다", () => {
    const risks = assessOverflowRisk([
      problem(),
      problem({ content: "가".repeat(OVERFLOW_WIDTH_LIMIT) }),
    ]);
    expect(risks).toHaveLength(1);
    expect(risks[0].number).toBe(2); // 배열 위치가 아니라 지면에 찍히는 번호
    expect(risks[0].reasons).toContain("본문이 길다");
  });

  /**
   * 장수 규칙은 **치수를 모를 때만** 켜지는 안전망이다. 치수를 알면 높이 규칙이
   * 같은 문항을 이미 보므로, 실측에서 「장수만 걸리는」 39건은 **한 건도 안 넘쳤다**
   * (적대적 리뷰 ③ 수리, `scripts/qa/eval-overflow-rules.ts`).
   */
  it("치수를 모르는 그림이 여러 장이면 경고한다", () => {
    const risks = assessOverflowRisk([
      problem({
        figureUrls: Array.from(
          { length: OVERFLOW_FIGURE_LIMIT },
          () => "/f.svg",
        ),
      }),
    ]);
    expect(risks[0].reasons).toContain("그림이 여러 장이다");
  });

  it("치수를 알면 장수 규칙은 안 켜진다 — 높이가 이미 답을 안다", () => {
    const risks = assessOverflowRisk([
      problem({
        figureUrls: ["/a.png", "/b.png"],
        // 작은 그림 두 장 — 나란히 놓여도 칸을 안 넘는다.
        figureDims: [80, 40, 80, 40],
      }),
    ]);
    expect(risks).toEqual([]);
  });

  it("사유가 겹치면 둘 다 적는다 — 어디를 손봐야 할지 알아야 한다", () => {
    const risks = assessOverflowRisk([
      problem({
        content: "가".repeat(OVERFLOW_WIDTH_LIMIT),
        figureUrls: ["/a.svg", "/b.svg"],
      }),
    ]);
    expect(risks[0].reasons).toHaveLength(2);
  });

  // 실측 근거(2026-08-17, 실데이터 20,000건): 원문 글자 수로 재면 같은 경고 건수에서
  // 한글이 많은 문항 107건을 놓치고, 수식이 많은 문항 108건을 헛경고했다.
  it("수식이 많아 원문만 긴 문항은 경고하지 않는다 — 지면에서는 좁다", () => {
    // 원문 1,000자가 넘지만 구조 명령뿐이라 지면 폭은 100.
    const mathHeavy = "$" + String.raw`\frac{1}{2}`.repeat(100) + "$";
    expect(mathHeavy.length).toBeGreaterThan(1000);
    expect(assessOverflowRisk([problem({ content: mathHeavy })])).toEqual([]);
  });

  it("한글이 많으면 원문 글자 수가 적어도 경고한다 — 전각은 두 배 폭이다", () => {
    // 원문 300자(<500)지만 전각이라 지면 폭은 600.
    const hangul = "가".repeat(300);
    expect(hangul.length).toBeLessThan(500);
    expect(
      assessOverflowRisk([problem({ content: hangul })])[0]?.reasons,
    ).toContain("본문이 길다");
  });

  it("경계값은 경고하지 않는다 — 딱 한계까지는 들어간다", () => {
    expect(
      assessOverflowRisk([
        problem({ content: "가".repeat(OVERFLOW_WIDTH_LIMIT / 2) }),
      ]),
    ).toEqual([]);
    expect(
      assessOverflowRisk([
        problem({
          figureUrls: Array.from(
            { length: OVERFLOW_FIGURE_LIMIT - 1 },
            () => "/f.svg",
          ),
        }),
      ]),
    ).toEqual([]);
  });
});

/**
 * 🟢 회귀 가드 — 적대적 리뷰 ③ `[적대③-A]` 승격.
 *
 * 실측(Chromium 인쇄 매체 전수 47,152건): 넘치는 2,726건 중 **2,557건이 그림 문항**
 * 인데 판정의 인자에 그림이 아예 없었다. **인자에 없는 것은 임계값을 어떻게 옮겨도
 * 안 잡힌다** — 한계를 14에서 8까지 내려도 전수 재현율이 50%를 못 넘었다.
 * 그림 높이를 세게 한 뒤 재현율 30.4% → **96.3%** (`scripts/qa/eval-overflow-rules.ts`).
 */
describe("[적대③-A] 그림 높이를 판정이 본다", () => {
  /**
   * 실데이터 `0129fdcd-8f19-42e3-99a1-5e3137ebf721`.
   * 그림 `/figures/4729/hwp-q03.png` 원본 598×688 → 인쇄 폭 70mm 로 264.6×304.4.
   * 실측 지면 높이 550.5px 로 이어지는 장 칸(484px)을 66px 넘긴다.
   * 폭 171(<530) · 그림 1장(<2) 이라 예전에는 **어떤 규칙에도 안 걸렸다.**
   */
  const ONE_FIGURE_CONTENT = `그림과 같이 두 직선 $y=2x$와 $y=x$가 이루는 예각의 크기를 $\theta$라 할 때, $\cos \theta$의 값은?

1. $\frac{\sqrt{10}}{10}$
2. $\frac{\sqrt{10}}{6}$
3. $\frac{\sqrt{10}}{5}$
4. $\frac{\sqrt{10}}{4}$
5. $3\sqrt{10}\frac{}{10}$`;

  it("그림 1장짜리도 칸을 넘기면 경고한다", () => {
    const risks = assessOverflowRisk([
      problem({
        content: ONE_FIGURE_CONTENT,
        figureUrls: ["/figures/4729/hwp-q03.png"],
        figureDims: [598, 688],
      }),
    ]);
    expect(risks).toHaveLength(1);
    expect(risks[0].reasons).toContain("그림이 크다");
  });

  it("같은 본문에 작은 그림이면 경고하지 않는다 — 장수가 아니라 높이다", () => {
    expect(
      assessOverflowRisk([
        problem({
          content: ONE_FIGURE_CONTENT,
          figureUrls: ["/figures/4729/hwp-q03.png"],
          figureDims: [598, 60],
        }),
      ]),
    ).toEqual([]);
  });

  it("사유는 **그림**을 가리킨다 — 원장이 지면에서 찾을 것과 같아야 한다", () => {
    const risks = assessOverflowRisk([
      problem({
        content: "짧은 발문이다.",
        figureUrls: ["/f.png"],
        figureDims: [300, 900],
      }),
    ]);
    expect(risks[0].reasons).toEqual(["그림이 크다"]);
  });

  /**
   * ⚠️ 손상된 입력. 짝이 안 맞는 치수를 «작은 그림»으로 읽으면 **넘치는 문항일수록
   *    조용해진다**(CLAUDE.md 2026-08-16). 모르면 보수적 상수(207px)로 받아야 한다.
   */
  it("치수가 손상되면 «작은 그림»이 아니라 «모른다»로 받는다", () => {
    const corrupted = assessOverflowRisk([
      problem({
        content: ONE_FIGURE_CONTENT,
        figureUrls: ["/f.png"],
        figureDims: [598], // 짝이 안 맞는다
      }),
    ]);
    const none = assessOverflowRisk([
      problem({ content: ONE_FIGURE_CONTENT, figureUrls: ["/f.png"] }),
    ]);
    expect(corrupted).toEqual(none);
  });
});

/**
 * 🟢 회귀 가드 — 적대적 리뷰 ③ `[적대③-B]` 승격 (§4).
 *
 * 첫 장에는 머리글과 「◆ 핵심 개념 정리」 상자가 얹혀 문항 칸이 **79px 좁다**
 * (405px vs 484px = 3.9줄 = 칸의 16.3%). 그런데 판정은 배열 인덱스를 알면서도
 * 한계를 하나만 썼다 — **같은 문항이 1·2번이면 겹치고 3번이면 멀쩡**했다.
 * 실측: 첫 장에서만 넘치는 문항 3,216건, 그중 경고도 없던 것 2,892건.
 *
 * 고친 뒤 첫 장 기준 재현율 58.5% → **93.9%** (`scripts/qa/eval-overflow-rules.ts`,
 * 전수 47,152건을 첫 장 칸 405px 에 놓고 채점).
 *
 * ⚠️ **분할은 안 고쳤다.** 첫 장 정원을 1문항으로 줄이는 것은 지면 배치 변경이라
 *    원장님 확정 대상(D-07)이다 — `[적대③-B]` 의 그 한 건은 빨간 채로 남겼다.
 */
describe("[적대③-B] 장을 아는 판정", () => {
  /** 첫 장 한계는 «칸 차이»에서 유도한다 — 손으로 고른 숫자가 아니다. */
  it("첫 장 한계는 칸 79px 차이(3.9줄)만큼 낮다", () => {
    const gap =
      JASEUP_MEASURED_PX.continuationSlot - JASEUP_MEASURED_PX.firstPageSlot;
    expect(gap).toBe(79);
    expect(OVERFLOW_LINE_LIMIT - OVERFLOW_LINE_LIMIT_FIRST_PAGE).toBe(
      Math.round(gap / JASEUP_MEASURED_PX.line),
    );
    expect(OVERFLOW_LINE_LIMIT_FIRST_PAGE).toBe(14);
  });

  /**
   * 첫 장에만 안 들어가는 높이의 문항. 1·2번 자리에서는 경고가 나오고
   * 3번(이어지는 장) 자리에서는 안 나와야 한다.
   */
  const borderline = () =>
    problem({
      content: "짧은 발문이다.",
      figureUrls: ["/f.png"],
      // 15.5줄어치 그림 — 첫 장 한계(14)는 넘고 이어지는 장 한계(18)는 안 넘는다.
      figureDims: [200, 303],
    });

  it("같은 문항이 첫 장에서는 경고, 이어지는 장에서는 무경고다", () => {
    const risks = assessOverflowRisk([
      { ...borderline(), id: "a" },
      { ...borderline(), id: "b" },
      { ...borderline(), id: "c" },
      { ...borderline(), id: "d" },
    ]);
    expect(risks.map((r) => r.number)).toEqual([1, 2]);
  });

  it("첫 장에서만 걸리면 **첫 장 때문**이라고 적는다 — 뒤로 옮기면 되니까", () => {
    const risks = assessOverflowRisk([borderline()]);
    expect(risks[0].reasons.join(" ")).toContain("첫 장");
  });

  it("이어지는 장 한계까지 넘는 문항은 첫 장 사유를 덧붙이지 않는다", () => {
    const risks = assessOverflowRisk([
      problem({
        content: "짧은 발문이다.",
        figureUrls: ["/f.png"],
        figureDims: [200, 900],
      }),
    ]);
    expect(risks[0].reasons.join(" ")).not.toContain("첫 장");
  });

  /**
   * 장 배정은 **`packProblems` 에서 받는다.** 판정이 스스로 「인덱스 2까지가 첫 장」
   * 이라고 정하면 분할이 바뀔 때 조용히 어긋난다(렌더러와 열 수를 나눠 갖던
   * `fitsTwoColumns` 와 같은 자리다).
   */
  it("장당 문항 수가 바뀌면 «첫 장»의 범위도 같이 바뀐다", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...borderline(),
      id: `p${i}`,
    }));
    const risks = assessOverflowRisk(many);
    const perPage = packProblems(many)[0]!.problems.length;
    expect(risks.map((r) => r.number)).toEqual(
      Array.from({ length: perPage }, (_, i) => i + 1),
    );
  });
});
