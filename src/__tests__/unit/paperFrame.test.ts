/**
 * 지면 문항 열 폭이 **두 곳에 따로 적힌 것**을 잠근다 (렌더 수리 A).
 *
 * `.paperParity`(CSS) 는 화면 카드 본문의 폭이고, `PROBLEM_CARD_MIN_WIDTH`(TS) 는
 * 문제은행 다단 그리드의 열 하한이다. 둘이 갈라지면 열이 본문보다 좁아져
 * 카드마다 가로 스크롤이 생기거나(좁아짐), 열이 남아돌아 다시 우측이 빈다(넓어짐).
 *
 * CSS 변수 하나로 합치지 못하는 이유는 `tokens.ts` 주석에 적어 두었다 —
 * `PAPER_CSS_VARIABLES` 에 넣으면 `PaperProblemView` 의 `style` 이 바뀌어
 * `renderParity` 잠금이 깨진다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PAPER_COLUMN_WIDTH,
  PROBLEM_CARD_MIN_WIDTH,
} from "@/components/print/tokens";

const CSS_SOURCE = readFileSync(
  path.join(process.cwd(), "src/components/print/TestPrint.module.css"),
  "utf8",
);

/** 주석 안의 중괄호(`framed={false}` 같은 예시)가 블록 경계로 잡히지 않게 먼저 지운다. */
const CSS = CSS_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "");

/** 공백 차이는 무시하고 식만 비교한다. */
function normalize(value: string): string {
  return value.replace(/\s+/g, "");
}

describe("[렌더 수리 A] 지면 문항 열 폭 — CSS 와 TS 상수가 같아야 한다", () => {
  it(".paperParity 의 width 가 PAPER_COLUMN_WIDTH 와 같은 식이다", () => {
    const block = CSS.match(/\.paperParity\s*\{([\s\S]*?)\}/);
    expect(block).not.toBeNull();

    const width = block![1].match(/(?:^|\n)\s*width:\s*([^;]+);/);
    expect(width).not.toBeNull();
    expect(normalize(width![1])).toBe(normalize(PAPER_COLUMN_WIDTH));
  });

  it("카드 최소 폭은 본문 열 + 카드 좌우 패딩(24px×2) + 테두리(1px×2) 다", () => {
    expect(normalize(PROBLEM_CARD_MIN_WIDTH)).toBe(
      normalize(`calc(${PAPER_COLUMN_WIDTH} + 50px)`),
    );
  });
});

/**
 * 2026-08-17 원장님 "문제 내부 색상이 왜 다르지?" — 화면 카드(흰색) 안에 지면 크림색
 * 상자가 앉아 톤이 갈라졌다. 화면 틀에서 배경을 빼되, **인쇄 지면의 종이색은 그대로**
 * 남아야 한다(절대 규칙 6 — 인쇄물 색은 바꾸지 않는다).
 */
describe("[렌더 수리 A] 지면 톤 — 화면 틀에서만 빼고 인쇄 지면은 그대로", () => {
  function block(selector: string): string {
    const found = CSS.match(new RegExp(`\\${selector}\\s*\\{([\\s\\S]*?)\\}`));
    expect(found).not.toBeNull();
    return found![1];
  }

  it("화면 틀(.paperParity)은 배경을 칠하지 않는다", () => {
    expect(block(".paperParity")).not.toMatch(
      /(?:^|\n)\s*background(?:-color)?:/,
    );
  });

  it("인쇄 지면(.a4Page)은 종이색을 그대로 쓴다", () => {
    expect(block(".a4Page")).toMatch(/background:\s*var\(--paper-warm\)/);
  });

  it("화면 틀은 지면 본문 색·서체는 유지한다 — 색만 뺀 것이지 틀을 버린 게 아니다", () => {
    const paper = block(".paperParity");
    expect(paper).toMatch(/color:\s*var\(--paper-ink\)/);
    expect(paper).toMatch(/font-family:\s*var\(--paper-font-serif\)/);
  });
});
