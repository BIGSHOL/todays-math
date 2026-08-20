/**
 * 단계 3 — 문항의 `figureUrls` 를 **벡터 SVG 로 갈아 끼우는** 규칙을 잠근다.
 *
 * 🔴 이 트랙에서 가장 위험한 것: **비율 대조가 유일한 탐지기다.**
 *    치수(`figure_dims`)를 SVG 의 `viewBox` 에서 받으면 자와 지면이 저절로
 *    일치한다 — 그래서 「SVG 가 래스터와 다른 영역을 담고 있다」는 사실이
 *    **보이지 않게 된다.** 실측 167자리가 그 부류였고 최대 66% 어긋났다.
 *    가드를 끄면 그 167자리가 조용히 들어온다.
 *
 * 그리고 **한 장이라도 안 되면 그 문항은 통째로 안 바꾼다.** `figureUrls` 는
 * 순서가 곧 짝이라, 절반만 바꾸면 어느 그림이 어느 자리인지 어긋난다.
 */
import { describe, expect, it } from "vitest";

import {
  decideAdoption,
  type FigureSlot,
} from "../../../scripts/qa/adopt-figure-svg";

const slot = (over: Partial<FigureSlot> = {}): FigureSlot => ({
  url: "/figures/1111/q06.png",
  svgPath: "public/figures-svg/1111/q06.svg",
  svgUrl: "/figures-svg/1111/q06.svg",
  svgExists: true,
  svgViewBox: [200, 100],
  rasterDims: [400, 200],
  sourceMm: 45,
  ...over,
});

describe("SVG 로 갈아 끼울지 정하기", () => {
  it("전 그림이 SVG 가 있고 · mm 를 알고 · 비율이 맞으면 바꾼다", () => {
    const d = decideAdoption([
      slot(),
      slot({ url: "/figures/1111/q06_1.png" }),
    ]);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.urls).toEqual([
      "/figures-svg/1111/q06.svg",
      "/figures-svg/1111/q06.svg",
    ]);
    // 치수는 **SVG 의 viewBox** 에서 온다 — 자가 그리는 것과 같은 비율이어야 한다.
    expect(d.dims).toEqual([200, 100, 200, 100]);
  });

  it("SVG 가 없는 자리가 하나라도 있으면 통째로 안 바꾼다", () => {
    const d = decideAdoption([slot(), slot({ svgExists: false })]);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.why).toContain("SVG 가 없다");
  });

  /**
   * mm 를 모르면 폭이 아직 픽셀에서 나온다. 그런데 SVG 는 `width="70.000mm"` 를
   * **박아** 들고 있다 — 그건 원본 크기가 아니라 **인쇄 상한**이다.
   * 인라인 style 이 없으면 작은 그림이 통째로 70mm 로 부푼다.
   */
  it("mm 를 모르는 자리가 있으면 안 바꾼다 — SVG 내장 70mm 가 거짓 크기를 만든다", () => {
    const d = decideAdoption([slot({ sourceMm: null })]);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.why).toContain("mm");
  });

  /**
   * 🔴 실측 167자리. 이 가드를 끄면 그것들이 조용히 들어오고, 치수를 viewBox 에서
   *    받으므로 **자와 지면이 사이좋게 틀린 그림을 그린다.**
   */
  it("SVG 비율이 래스터와 어긋나면 안 바꾼다 — 다른 영역을 담고 있다는 뜻이다", () => {
    const d = decideAdoption([
      slot({ svgViewBox: [90, 90], rasterDims: [681, 231] }),
    ]);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.why).toContain("비율");
  });

  it("비율이 2% 안이면 통과한다 — 오려낸 자리가 몇 픽셀 다른 것은 정상이다", () => {
    // 400x200(2.000) vs 201x100(2.010) → 0.5%
    const d = decideAdoption([slot({ svgViewBox: [201, 100] })]);
    expect(d.ok).toBe(true);
  });

  it("래스터 치수를 모르면 안 바꾼다 — 견줄 근거가 없다", () => {
    const d = decideAdoption([slot({ rasterDims: null })]);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.why).toContain("래스터 치수");
  });

  it("viewBox 를 못 읽으면 안 바꾼다 — 비율을 모른다", () => {
    const d = decideAdoption([slot({ svgViewBox: null })]);
    expect(d.ok).toBe(false);
  });

  /**
   * 검수에서 결함으로 판정된 파일은 **수치가 아무리 좋아도** 막는다.
   * 이 저장소의 결함은 거의 전부 눈으로 봐서 나왔다 — 그 판정이 최종이다.
   */
  it("눈으로 결함 판정된 SVG 는 막는다 — 수치가 못 보는 것이 있다", () => {
    const d = decideAdoption(
      [slot()],
      new Set(["public/figures-svg/1111/q06.svg"]),
    );
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.why).toContain("검수");
  });

  it("그림이 없는 문항은 바꿀 것이 없다", () => {
    const d = decideAdoption([]);
    expect(d.ok).toBe(false);
  });
});
