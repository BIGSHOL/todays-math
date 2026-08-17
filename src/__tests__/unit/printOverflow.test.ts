/**
 * 인쇄 넘침 경고 — 잘려도 모르는 게 진짜 피해다.
 *
 * 자습 지면은 문항 하나가 **고정 높이 반 페이지 박스**(본문 1.15 : 연습칸 1)이고
 * `overflow: hidden` 이라, 긴 문항은 조용히 잘린 채로 인쇄돼 학생에게 배포된다.
 * 지면 형태는 원장님 확정 사항(D-07)이라 바꾸지 않는다 — 대신 **인쇄 전에 알린다.**
 */
import { describe, expect, it } from "vitest";

import type { TestPrintProblem } from "@/components/print/types";
import {
  assessOverflowRisk,
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

  it("그림이 여러 장이면 경고한다", () => {
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
