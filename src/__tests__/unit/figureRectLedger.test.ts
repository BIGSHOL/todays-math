/**
 * 전후 비교 지면이 **실측 원장**을 읽는가 — 그리고 못 읽으면 **말하는가**.
 *
 * ## 왜 이 검사가 생겼나 (실제로 있었던 일)
 *
 * 1차의 `/dev/figure-print-size` 는 원장을 «URL → 객체» 지도로 읽었다. 그런데
 * `그림벡터` 트랙이 실제로 낸 원장은 `{"행": [{figure, width_mm, …}]}` 다.
 * 두 모양이 다르므로 그 화면은 원장이 **있어도** 한 장도 못 읽고 `catch` 로 떨어져
 * **조용히 가정값으로 내려갔다.** 화면에는 「가정값이다」라고 정직하게 적혀 있었지만,
 * 다음 사람은 「원장이 아직 없구나」로 읽는다 — 실은 있는데 못 읽는 것이었다.
 *
 * 그래서 이 파일이 잠그는 것은 두 가지다:
 *   ㉠ **실제 원장 모양**을 읽는다
 *   ㉡ 못 읽으면 **못 읽는다고 말한다.** 빈 지도로 미끄러지지 않는다 —
 *      「값이 하나도 없다」와 「모양이 다르다」는 다음 수가 다르다.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseFigureRectLedger,
  proofLabel,
} from "@/app/dev/figure-print-size/ledger";

/** 실제 원장(`figure-rect-ledger.json`)의 한 행을 그대로 본뜬 것. */
const REAL_ROW = {
  figure: "1111/q06.png",
  source_pdf: "N:\\개인\\기출\\…\\[경명여고].PDF",
  source_exists: true,
  page_index0: 0,
  rect_pt: [324.5, 533.3, 530.1, 629.8],
  width_mm: 72.53,
  height_mm: 34.04,
  native_xref: true,
  kind: "raster",
  current_px: [1161, 544],
  render_dpi: null,
  match: "bytes",
  note: null,
};

const ledgerText = (rows: unknown[]) =>
  JSON.stringify({ 기준: "…", 만든이: "…", 집계: {}, 행: rows });

describe("parseFigureRectLedger — 실제 원장 모양", () => {
  it("`행` 배열을 읽고 `/figures/` 를 붙인 URL 로 색인한다", () => {
    const result = parseFigureRectLedger(ledgerText([REAL_ROW]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.entries.get("/figures/1111/q06.png");
    expect(entry).toBeDefined();
    expect(entry!.sourceMm).toBeCloseTo(72.53, 5);
    expect(entry!.proof).toBe("bytes");
    expect(entry!.currentPx).toEqual([1161, 544]);
  });

  it("증명 갈래를 세어 준다 — 근거의 세기가 다르면 판단도 다르다", () => {
    const result = parseFigureRectLedger(
      ledgerText([
        REAL_ROW,
        { ...REAL_ROW, figure: "a/q1.png", match: "dims" },
        { ...REAL_ROW, figure: "a/q2.png", match: "png-dpi", rect_pt: null },
        { ...REAL_ROW, figure: "a/q3.png", match: "png-dpi", rect_pt: null },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proofCounts).toEqual({ bytes: 1, dims: 1, "png-dpi": 2 });
    expect(result.total).toBe(4);
    expect(result.withMm).toBe(4);
  });

  it("mm 가 없는 행도 **행으로 남는다** — 사유를 화면에 적어야 하니까", () => {
    const result = parseFigureRectLedger(
      ledgerText([
        {
          ...REAL_ROW,
          figure: "b/q1.png",
          width_mm: null,
          match: null,
          note: "HWP BinData",
        },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.entries.get("/figures/b/q1.png")!;
    expect(entry.sourceMm).toBeNull();
    expect(entry.note).toBe("HWP BinData");
    expect(result.withMm).toBe(0);
  });

  it("**제품 술어**로 거른다 — 지면이 안 받는 값을 화면이 받으면 둘이 갈라진다", () => {
    // 210mm 초과는 `parseFigureSourceMm` 이 «모른다»로 미끄러뜨리는 값이다.
    const result = parseFigureRectLedger(
      ledgerText([{ ...REAL_ROW, figure: "c/q1.png", width_mm: 7000 }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.entries.get("/figures/c/q1.png")!;
    expect(entry.sourceMm).toBeNull();
    // 원장에 무엇이 적혀 있었는지는 그대로 보여 준다 — 지우면 왜 «모른다»인지 못 본다.
    expect(entry.rawWidthMm).toBe(7000);
  });
});

describe("parseFigureRectLedger — 못 읽으면 말한다", () => {
  it("1차가 쓰던 «URL → 객체» 지도는 **못 읽는다고 말한다** (빈 지도로 미끄러지지 않는다)", () => {
    const old = JSON.stringify({
      "/figures/1111/q06.png": { width_mm: 72.53 },
    });
    const result = parseFigureRectLedger(old);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 「행이 없다」가 사유에 나와야 다음 사람이 모양을 고칠 수 있다.
    expect(result.reason).toContain("행");
  });

  it("JSON 이 아니면 그렇게 말한다", () => {
    const result = parseFigureRectLedger("{ 이건 JSON 이 아니다");
    expect(result.ok).toBe(false);
  });

  it("행이 **비어 있으면** 성공이 아니다 — 「실측인데 0장」은 실측이 아니다", () => {
    const result = parseFigureRectLedger(ledgerText([]));
    expect(result.ok).toBe(false);
  });

  it("행은 있는데 `figure` 가 하나도 없으면 성공이 아니다", () => {
    const result = parseFigureRectLedger(
      ledgerText([{ width_mm: 40 }, { width_mm: 50 }]),
    );
    expect(result.ok).toBe(false);
  });

  it("쓸 수 없는 행이 섞이면 **몇 개를 버렸는지 센다**", () => {
    const result = parseFigureRectLedger(
      ledgerText([REAL_ROW, { width_mm: 40 }, "이건 행이 아니다"]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBe(1);
    expect(result.dropped).toBe(2);
  });
});

describe("proofLabel — 증명 갈래", () => {
  it("네 갈래를 다 안다. `png-dpi` 는 **자리를 못 찾은** 갈래라 따로 적는다", () => {
    expect(proofLabel("bytes").rank).toBeGreaterThan(proofLabel("dims").rank);
    expect(proofLabel("dims").rank).toBeGreaterThan(proofLabel("png-dpi").rank);
    expect(proofLabel("rect+png-dpi").rank).toBeGreaterThan(
      proofLabel("png-dpi").rank,
    );
    expect(proofLabel("png-dpi").detail).toContain("자리");
  });

  it("모르는 갈래는 **모른다고 적는다** — 아는 척하면 근거가 부풀려진다", () => {
    const label = proofLabel("어느날 생긴 새 갈래");
    expect(label.rank).toBe(0);
    expect(label.name).toContain("모르는");
  });
});

describe("전후 비교 지면 — 원장이 없으면 멈춘다", () => {
  it("가정값으로 내려가는 경로가 **코드에 없다**", () => {
    const src = readFileSync("src/app/dev/figure-print-size/page.tsx", "utf8");
    expect(src).toContain("가정값으로 내려가지 않는다");
    expect(src).not.toContain("assumedSourceMm");
    expect(src).not.toContain("ASSUMED_CROP_DPI");
    expect(src).toContain("비교를 그리지 않았다");
  });
});
