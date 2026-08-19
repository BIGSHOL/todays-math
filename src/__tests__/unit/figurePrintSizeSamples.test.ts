/**
 * 전후 비교 지면의 **표본 조립** — 화면이 제품과 같은 것을 그리는가.
 *
 * 이 화면은 원장님이 «새 규칙이 어떻게 보이나»를 판단하시는 자리다. 그러니 화면이
 * 제품보다 무르거나 세면 **원장님이 못 가려낸다.** 그래서 여기서 잠그는 것은
 * 「예쁘게 나오는가」가 아니라 **「제품과 같은 규칙으로 갈리는가」**다:
 *
 *   ㉠ 「지금 폭」은 제품 함수(`figurePrintWidthPx`)에서 나온다 — 옛 규칙을 흉내 내지 않는다
 *   ㉡ 한 장이라도 mm 를 모르면 그 **문항 전체**가 오늘 그대로 나간다
 *      (적재 술어 `checkFigureSourceMm` 가 배열째 막는다 — 화면만 자리별로 그리면
 *       실제로는 절대 안 나오는 지면을 보여 주게 된다)
 *   ㉢ 픽셀 치수를 모르면 mm 도 버린다 — 자와 지면이 **같이** 모른다
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { FigureLedgerEntry } from "@/app/dev/figure-print-size/ledger";
import {
  BUCKET_ORDER,
  SAMPLES_PATH,
  buildSampleViews,
  parseGeneratedSamples,
} from "@/app/dev/figure-print-size/samples";

const entry = (url: string, sourceMm: number | null): FigureLedgerEntry => ({
  url,
  sourceMm,
  rawWidthMm: sourceMm,
  heightMm: null,
  proof: sourceMm == null ? null : "bytes",
  kind: "raster",
  nativeXref: true,
  renderDpi: null,
  currentPx: null,
  note: sourceMm == null ? "HWP BinData 에서 꺼낸 이미지" : null,
});

const ledgerOf = (pairs: [string, number | null][]) =>
  new Map(pairs.map(([url, mm]) => [url, entry(url, mm)]));

const item = (figures: string[]) => ({
  key: "t/q01",
  bucket: "시험",
  why: "시험",
  figures,
});

describe("buildSampleViews — 「지금 폭」은 제품 함수에서 나온다", () => {
  it("상한 아래 그림은 픽셀 그대로(96dpi)로 환산된다", () => {
    const [view] = buildSampleViews(
      [item(["/figures/a.png"])],
      ledgerOf([["/figures/a.png", 30]]),
      () => [100, 80],
    );
    expect(view!.figures[0]!.currentMm).toBeCloseTo((100 * 25.4) / 96, 6);
    expect(view!.figures[0]!.newMm).toBe(30);
  });

  it("상한을 넘는 그림은 70mm 에서 잘린다 — 지금도 새 규칙도", () => {
    const [view] = buildSampleViews(
      [item(["/figures/a.png"])],
      ledgerOf([["/figures/a.png", 120]]),
      () => [900, 700],
    );
    // ⚠️ 정확히 70.000000 이 아니다. 자의 상한은 **실측 px**(`figureMaxWidth` = 264.567)
    //    이고 지면 CSS 는 `70mm` 다 — 되돌리면 70.0000187mm 가 나온다. 0.00002mm 는
    //    300dpi 에서 0.0002점이라 지면에서 뜻이 없지만, 「둘이 같은 수」라고 적으면
    //    거짓이므로 자릿수를 밝혀 둔다(`printGeometryPin.test.ts` 가 그 둘을 못 박는다).
    expect(view!.figures[0]!.currentMm).toBeCloseTo(70, 3);
    expect(view!.figures[0]!.newMm).toBe(70);
    expect(view!.figures[0]!.ratio).toBeCloseTo(1, 5);
  });
});

describe("buildSampleViews — 모르는 것이 섞이면", () => {
  it("한 장만 mm 를 몰라도 **문항 전체**가 오늘 그대로 나간다", () => {
    const [view] = buildSampleViews(
      [item(["/figures/a.png", "/figures/b.png"])],
      ledgerOf([
        ["/figures/a.png", 40],
        ["/figures/b.png", null],
      ]),
      () => [200, 150],
    );
    expect(view!.afterSourceMm).toBeUndefined();
    expect(view!.blockedReason).not.toBeNull();
    // 그래도 아는 쪽 값은 표에 남는다 — 왜 막혔는지 보여야 하니까.
    expect(view!.figures[0]!.newMm).toBe(40);
    expect(view!.figures[1]!.newMm).toBeNull();
  });

  it("전부 알면 막지 않는다", () => {
    const [view] = buildSampleViews(
      [item(["/figures/a.png", "/figures/b.png"])],
      ledgerOf([
        ["/figures/a.png", 40],
        ["/figures/b.png", 25],
      ]),
      () => [200, 150],
    );
    expect(view!.blockedReason).toBeNull();
    expect(view!.afterSourceMm).toEqual([40, 25]);
  });

  it("**픽셀 치수를 모르면 mm 도 버린다** — 비율을 모르면 높이를 못 잰다", () => {
    const [view] = buildSampleViews(
      [item(["/figures/a.png", "/figures/b.png"])],
      ledgerOf([
        ["/figures/a.png", 40],
        ["/figures/b.png", 25],
      ]),
      (url) => (url === "/figures/b.png" ? null : [200, 150]),
    );
    expect(view!.figureDims).toEqual([]);
    expect(view!.afterSourceMm).toBeUndefined();
    expect(view!.blockedReason).toContain("치수");
  });

  it("원장에 아예 없는 그림도 **행으로 남는다** — 표에서 빠지면 표본이 조용히 준다", () => {
    const [view] = buildSampleViews(
      [item(["/figures/a.png"])],
      ledgerOf([]),
      () => [200, 150],
    );
    expect(view!.figures).toHaveLength(1);
    expect(view!.figures[0]!.entry).toBeNull();
    expect(view!.figures[0]!.newMm).toBeNull();
    expect(view!.blockedReason).toContain("원장");
  });
});

describe("parseGeneratedSamples — 생성물 모양", () => {
  it("한글 키(`문항`·`갈래`)를 읽는다", () => {
    const result = parseGeneratedSamples(
      JSON.stringify({
        기준: "규칙으로 뽑았다",
        원장행: 10,
        "잰 그림": 8,
        "15mm미만": 2,
        "큰 문항": [],
        문항: [
          {
            키: "a/q01",
            갈래: "15mm 미만",
            왜: "8.78mm",
            그림: ["/figures/a/q01.png"],
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.samples.tinyCount).toBe(2);
    expect(result.samples.items).toHaveLength(1);
    expect(result.samples.items[0]?.bucket).toBe("15mm 미만");
  });

  it("문항이 없으면 **못 읽는다고 말한다** — 빈 목록으로 미끄러지지 않는다", () => {
    expect(parseGeneratedSamples("{}").ok).toBe(false);
    expect(parseGeneratedSamples('{"문항":[]}').ok).toBe(false);
    expect(parseGeneratedSamples("이건 JSON 이 아니다").ok).toBe(false);
  });
});

describe("커밋된 표본 목록 — 지시서 ㉯ 다섯 갈래", () => {
  const raw = readFileSync(SAMPLES_PATH, "utf8");
  const result = parseGeneratedSamples(raw);

  it("생성물을 읽고, 15mm 미만 **53장**이 적혀 있다", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.samples.tinyCount).toBe(53);
    expect(result.samples.items.length).toBeGreaterThan(0);
  });

  it("지시서가 요구한 갈래가 **빠지지 않는다**", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const present = new Set(result.samples.items.map((item) => item.bucket));
    for (const bucket of [
      "배율 하위 5%",
      "배율 중앙",
      "배율 상위 5%",
      "15mm 미만",
      "커진다",
      "mm 모름 섞임",
      "세로로 길다",
      "한 문항 여러 장",
    ]) {
      expect(present.has(bucket), bucket).toBe(true);
    }
    // 화면에 없는 갈래는 맨 뒤에 붙는다(BUCKET_ORDER). 생성기가 새 갈래를
    // 만들어도 화면에서 조용히 사라지지 않게 목록을 잠근다.
    expect(BUCKET_ORDER).toContain("mm 통째로 모름");
  });

  it("15mm 미만 갈래에 **그림이 있다** — 숫자만 있고 절이 비면 전량이 아니다", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tiny = result.samples.items.filter((i) => i.bucket === "15mm 미만");
    const figures = tiny.flatMap((i) => i.figures);
    expect(tiny.length).toBeGreaterThan(0);
    expect(figures.length).toBeGreaterThanOrEqual(53);
  });
});
