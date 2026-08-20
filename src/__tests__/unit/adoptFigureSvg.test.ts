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
  mergeLedgerRows,
  readPathList,
  type FigureSlot,
  type LedgerRow,
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

describe("눈으로 본 것만 채택한다 (허용 목록)", () => {
  // 🔴 왜 필요한가: 전량 검수가 **중간에 끊겼다**(계정 세션 한도). 그때
  //    「결함만 빼고 나머지 다 채택」이면 **안 본 자리가 같이 들어간다.**
  //    안 본 자리에 무엇이 있는지는 정의상 모른다 — 실제로 눈으로 본 구간에서
  //    「전혀 다른 그림」이 나왔고, 그건 수치 가드를 전부 통과했다.
  //    그래서 판정을 뒤집는다: **본 것만 들어온다.**
  it("허용 목록을 주면 그 목록에 없는 자리는 안 바꾼다", () => {
    const s = slot();
    const d = decideAdoption([s], new Set(), new Set());
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.why).toContain("눈으로 안 본");
  });

  it("허용 목록에 있으면 바꾼다", () => {
    const s = slot();
    const d = decideAdoption([s], new Set(), new Set([s.svgPath]));
    expect(d.ok).toBe(true);
  });

  it("한 자리만 목록에 있으면 통째로 안 바꾼다 — 절반만 바꾸면 짝이 어긋난다", () => {
    const a = slot();
    const b = slot({ svgPath: "public/figures-svg/1111/q07.svg" });
    const d = decideAdoption([a, b], new Set(), new Set([a.svgPath]));
    expect(d.ok).toBe(false);
  });

  it("허용 목록을 안 주면 예전대로 — 전부 후보다", () => {
    expect(decideAdoption([slot()]).ok).toBe(true);
  });

  it("허용 목록에 있어도 결함 판정이면 막는다 — 본 결과가 「결함」이었다", () => {
    const s = slot();
    const d = decideAdoption([s], new Set([s.svgPath]), new Set([s.svgPath]));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.why).toContain("결함");
  });
});

describe("목록 파일 읽기 — 차단·허용이 같은 함수를 쓴다", () => {
  // 🔴 이 결함은 실제로 났다: 줄 끝 주석을 안 떼서 어떤 경로와도 안 맞았고,
  //    「바꿀 것 0」으로만 드러났다. 차단 목록이었으면 **에러 없이** 결함 SVG 가
  //    지면에 나간다 — 숫자만 조용히 달라진다.
  it("줄 끝 주석을 뗀다", () => {
    const got = readPathList("public/figures-svg/4208/q23_2.svg  # 1390");
    expect([...got]).toEqual(["public/figures-svg/4208/q23_2.svg"]);
  });

  it("온줄 주석과 빈 줄은 버린다", () => {
    const NL = String.fromCharCode(10);
    const got = readPathList(
      ["# 머리말", "", "public/a.svg", "   ", "# 꼬리", ""].join(NL),
    );
    expect([...got]).toEqual(["public/a.svg"]);
  });

  it("역슬래시 경로를 슬래시로 맞춘다 — 윈도우에서 만든 목록이 섞인다", () => {
    const bs = String.fromCharCode(92);
    const got = readPathList(["public", "figures-svg", "b.svg"].join(bs));
    expect([...got]).toEqual(["public/figures-svg/b.svg"]);
  });

  it("경로 안의 # 는 안 건드린다 — 앞에 공백이 있어야 주석이다", () => {
    expect([...readPathList("public/fig#1/a.svg")]).toEqual([
      "public/fig#1/a.svg",
    ]);
  });
});

describe("가드는 **저장할 값**을 본다 (반올림 뒤 비율)", () => {
  // 🔴 실제로 났다: 가드는 반올림 **전** viewBox 비율을 재고, 지면은 반올림
  //    **후** `figureDims` 를 쓴다. viewBox 가 74×29 처럼 작으면 반올림만으로
  //    비율이 3% 흔들려 «2% 안»이라는 보장이 거짓이 된다.
  //    세는 쪽과 쓰는 쪽이 다른 값을 보면 그 지표는 아무것도 보장하지 않는다.
  it("반올림 전엔 맞고 반올림 뒤 어긋나면 안 바꾼다", () => {
    const d = decideAdoption([
      slot({ rasterDims: [100, 40], svgViewBox: [7.4, 2.96] }),
    ]);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.why).toContain("비율이 어긋난다");
  });

  it("반올림해도 2% 안이면 바꾼다", () => {
    const d = decideAdoption([
      slot({ rasterDims: [1000, 400], svgViewBox: [750.4, 300.2] }),
    ]);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.dims).toEqual([750, 300]);
  });
});

describe("되돌리기 원장은 **회차를 누적한다**", () => {
  const row = (id: string, before: string, after: string): LedgerRow => ({
    id,
    beforeUrls: [before],
    beforeDims: [100, 50],
    afterUrls: [after],
    afterDims: [10, 5],
  });

  /**
   * 🔴 2차 채택이 1차 원장을 덮어쓰면 **1차의 되돌리기 자료가 사라진다.**
   *    `--revert` 는 이 파일 하나만 읽고 돈다 — 덮어쓰는 순간 1차는
   *    되돌릴 수 없다. 파괴적 작업의 되돌리기 파일은 이 저장소가 이미
   *    두 번 놓친 자리다(2026-08-18).
   */
  it("🔴 앞선 회차의 행이 남는다 — 덮어쓰면 안 된다", () => {
    const first = [row("a", "/figures/1.png", "/figures-svg/1.svg")];
    const second = [row("b", "/figures/2.png", "/figures-svg/2.svg")];
    const got = mergeLedgerRows(first, second);
    expect(got.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  /**
   * 🔴 같은 문항이 두 회차에 걸치면 **처음의 before** 를 남겨야 한다.
   *    마지막 before 를 쓰면 1차가 만든 SVG 경로로 되돌아가서
   *    「되돌렸다」고 하면서 아무것도 안 되돌린 것이 된다.
   */
  it("🔴 두 번 나온 문항은 **맨 처음** before 로 되돌아간다", () => {
    const first = [row("a", "/figures/1.png", "/figures-svg/1.svg")];
    const second = [row("a", "/figures-svg/1.svg", "/figures-svg/1b.svg")];
    const [got] = mergeLedgerRows(first, second);
    expect(got!.beforeUrls).toEqual(["/figures/1.png"]); // 래스터 원본
    expect(got!.beforeDims).toEqual([100, 50]);
    expect(got!.afterUrls).toEqual(["/figures-svg/1b.svg"]); // 마지막 값
  });

  it("앞선 원장이 비어 있으면 이번 것만 남는다", () => {
    const second = [row("b", "/figures/2.png", "/figures-svg/2.svg")];
    expect(mergeLedgerRows([], second)).toEqual(second);
  });
});
