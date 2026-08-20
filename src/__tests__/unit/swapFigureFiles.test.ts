/**
 * 단계 2 — 300dpi 재크롭본 바꿔치기의 **고르는 규칙**을 잠근다.
 *
 * 이 규칙이 새면 잃는 것이 크다. 파일을 바꾸면서 `figure_dims` 를 안 고치면
 * **자는 옛 픽셀로 재고 지면은 새 파일을 그린다** — 오류가 안 나고 조용히 어긋난다.
 * 그리고 「고아 파일까지 바꾼다」로 새면 아무 문항도 안 쓰는 1,174장이 저장소에
 * 얹힌다(실측). 둘 다 건수만 보면 그럴듯하다.
 *
 * 규칙의 «참»은 **DB 와 디스크**에서 온다 — 계획 파일이 스스로 정하지 않는다.
 */
import { describe, expect, it } from "vitest";

import {
  selectSwaps,
  type SwapPlanRow,
} from "../../../scripts/qa/swap-figure-files";

const base: SwapPlanRow = {
  url: "/figures/1111/q06.png",
  old: "1111/q06.png",
  new: "1111/q06.png",
  oldPx: [200, 100],
  newPx: [600, 300],
  oldBytes: 1000,
  newBytes: 3000,
  oldExt: ".png",
  newExt: ".png",
  extChanged: false,
  sameBytes: false,
  verdict: "바꾼다",
};

/** 기본 상황: DB 가 쓰고 · 지면 폭은 안 바뀐다. */
function ctx(rows: SwapPlanRow[]) {
  return {
    rows,
    refs: new Map(rows.map((r) => [r.url, ["p1"]])),
    widthChanged: new Set<string>(),
  };
}

describe("바꿔치기 대상 고르기", () => {
  it("가로가 늘고 · DB 가 쓰고 · 지면 폭이 그대로면 바꾼다", () => {
    const c = ctx([base]);
    const out = selectSwaps(c.rows, c.refs, c.widthChanged);
    expect(out.swap.map((r) => r.url)).toEqual(["/figures/1111/q06.png"]);
    expect(out.skipped).toHaveLength(0);
  });

  it("가로가 안 늘었으면 안 바꾼다 — 바꿔도 화질 이득이 0 이다", () => {
    const c = ctx([{ ...base, verdict: "안바꾼다", newPx: [200, 100] }]);
    const out = selectSwaps(c.rows, c.refs, c.widthChanged);
    expect(out.swap).toHaveLength(0);
    expect(out.skipped[0]?.why).toContain("가로가 안 늘었다");
  });

  /**
   * 실측 7장 + 모호 4장. 새 파일이 `.png` 인데 DB 는 `.jpeg` 를 가리킨다.
   * PNG 내용을 `.jpeg` 이름에 써 넣으면 브라우저는 속아 주지만 **거짓말**이고,
   * 제대로 하려면 `figureUrls` 까지 바꿔야 한다 — 되돌리기 축이 하나 더 는다.
   */
  it("확장자가 달라지면 안 바꾼다 — URL 을 바꿔야 하는 일이다", () => {
    const c = ctx([
      { ...base, extChanged: true, oldExt: ".jpeg", newExt: ".png" },
    ]);
    const out = selectSwaps(c.rows, c.refs, c.widthChanged);
    expect(out.swap).toHaveLength(0);
    expect(out.skipped[0]?.why).toContain("확장자");
  });

  /**
   * 실측 1,174장(46.5%) · 371개 시험지 폴더가 통째로 고아다.
   * 바꿔도 **지면에 아무 변화가 없다.** 건수만 보면 2,524가 그럴듯하다.
   */
  it("아무 문항도 안 쓰는 고아 파일은 안 바꾼다", () => {
    const out = selectSwaps([base], new Map(), new Set());
    expect(out.swap).toHaveLength(0);
    expect(out.skipped[0]?.why).toContain("고아");
  });

  /**
   * 🔴 이 트랙의 합격 조건이다 — 「픽셀만 촘촘해지고 지면은 그대로」.
   * mm 를 모르는 그림은 폭이 아직 **픽셀에서** 나오므로, 픽셀이 늘면
   * 지면에서 **커진다**(실측 1장: 191→349px, 50.5mm → 70mm).
   * 그건 화질 개선이 아니라 **조판 변경**이라 이 트랙이 할 일이 아니다.
   */
  it("지면 폭이 달라지는 그림은 안 바꾼다 — 화질 작업이 조판을 바꾸면 안 된다", () => {
    const c = ctx([base]);
    const out = selectSwaps(c.rows, c.refs, new Set([base.url]));
    expect(out.swap).toHaveLength(0);
    expect(out.skipped[0]?.why).toContain("지면 폭");
  });

  it("바이트가 같으면 안 바꾼다 — 바꿀 것이 없다", () => {
    const c = ctx([{ ...base, sameBytes: true }]);
    const out = selectSwaps(c.rows, c.refs, c.widthChanged);
    expect(out.swap).toHaveLength(0);
    expect(out.skipped[0]?.why).toContain("바이트가 같다");
  });

  /**
   * 분모를 먼저 찍는다 — 「N건 처리」는 N 이 전부인지 말해 주지 않는다.
   * 고른 것 + 건너뛴 것이 계획 전체와 맞지 않으면 범위가 샌 것이다.
   */
  it("고른 것과 건너뛴 것을 더하면 계획 전체가 된다", () => {
    const rows: SwapPlanRow[] = [
      base,
      { ...base, url: "/figures/2/a.png", verdict: "안바꾼다" },
      { ...base, url: "/figures/3/a.png", extChanged: true },
      { ...base, url: "/figures/4/a.png", sameBytes: true },
      { ...base, url: "/figures/5/a.png" },
      { ...base, url: "/figures/6/a.png", verdict: "모호" },
    ];
    const refs = new Map(rows.slice(0, 4).map((r) => [r.url, ["p1"]]));
    const out = selectSwaps(rows, refs, new Set(["/figures/1111/q06.png"]));
    expect(out.swap.length + out.skipped.length).toBe(rows.length);
  });

  it("한 파일을 여러 문항이 쓰면 그 문항을 전부 적는다 — 하나만 고치면 나머지가 어긋난다", () => {
    const out = selectSwaps(
      [base],
      new Map([[base.url, ["p1", "p2", "p3"]]]),
      new Set(),
    );
    expect(out.swap[0]?.problemIds).toEqual(["p1", "p2", "p3"]);
  });
});
