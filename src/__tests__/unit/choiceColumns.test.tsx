/**
 * 보기(선택지) 열 수 — 렌더 수리 B.
 *
 * 원장님 지적(2026-08-17): "보기가 보기내에서 두줄처리되잖아".
 * 지금까지 `ProblemContent` 는 `md:grid-cols-2 print:grid-cols-2` 로 2열을 **강제**해서
 * 조금만 긴 보기가 한 칸 안에서 두 줄로 접혔다.
 *
 * 한계값 근거는 `src/lib/math/displayWidth.ts` 의 `TWO_COLUMN_WIDTH_LIMIT` 주석
 * (인쇄 문항 열 폭 실측에서 유도). **인쇄 지면에도 그대로 적용된다** —
 * 절대 규칙 6(실물 출력 검수)의 대상이다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProblemContent } from "@/components/math/ProblemContent";
import { displayWidth, TWO_COLUMN_WIDTH_LIMIT } from "@/lib/math/displayWidth";

const build = (choices: string[]) =>
  `다음 중 옳은 것은?\n${choices.map((c, i) => `${i + 1}. ${c}`).join("\n")}`;

/** 실측 문항에서 가져온 표본 — 표시폭 36 으로 2열 한 칸(24)을 넘는다. */
const LONG_CHOICE = "서로 다른 두 소수는 항상 서로소이다.";

describe("[보기 열 수] 긴 보기는 2열이 아니라 1열로 떨어진다", () => {
  it("한계값은 실제로 그 문항이 접히는 폭이다", () => {
    expect(displayWidth(LONG_CHOICE)).toBeGreaterThan(TWO_COLUMN_WIDTH_LIMIT);
    expect(displayWidth("$a$")).toBeLessThanOrEqual(TWO_COLUMN_WIDTH_LIMIT);
  });

  it("짧은 보기는 2열을 유지한다 — 실측 94% 는 예전 그대로다", () => {
    const out = renderToStaticMarkup(
      <ProblemContent content={build(["$a$", "$b$", "$c$", "$d$"])} />,
    );
    expect(out).toContain("md:grid-cols-2");
    expect(out).toContain("print:grid-cols-2");
  });

  it("한 항목이라도 열 폭을 넘으면 **전체**를 1열로 내린다", () => {
    // 한 칸만 접히면 그 행 전체가 어긋나 보인다 → 섞지 않고 통째로 내린다.
    const out = renderToStaticMarkup(
      <ProblemContent content={build([LONG_CHOICE, "$b$", "$c$", "$d$"])} />,
    );
    expect(out).not.toContain("md:grid-cols-2");
    expect(out).not.toContain("print:grid-cols-2");
    // 그리드 자체는 남는다 — 1열 그리드다.
    expect(out).toContain("grid grid-cols-1");
  });
});
