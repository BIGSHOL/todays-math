/**
 * 🟢 회귀 가드 — 적대적 리뷰 ④ `[적대④-E]` `[적대④-F]` 승격.
 *
 * ## 왜 이 파일이 있는가
 *
 * 「재현율 96.1%」의 분모는 높이 캐시(`.measure/cont.json`)다. 그 캐시는 지면을
 * Chromium 으로 그려 뜬 것이라, **지면이 바뀌면 통째로 거짓**이 된다.
 * 그런데 채점기가 보던 것은 문항 id 목록과 건수뿐이었다. 실제로 재현했다:
 *
 *   · `TWO_COLUMN_WIDTH_LIMIT` 24 → 40 (보기 열 수가 바뀌어 지면 높이가 진짜로
 *     달라진다) 으로 바꾸고 같은 캐시로 채점 → 아무 말 없이 「재현율 95.2%」.
 *   · `continuationSlot` 484 → 600 (지면과 어긋난 상수) → 「채점기 ↔ 제품 일치
 *     확인 (0건 불일치)」 그대로 초록이고, **재현율이 96.1% → 97.1% 로 올랐다.**
 *     «넘쳤는가»의 참을 **제품 상수**로 갈랐기 때문이다 — 참과 규칙이 같이 움직였다.
 *
 * 그래서 (1) 참은 캐시가 **실측한** 칸(`availPx`)에서 오고, (2) 캐시 옆에 지면
 * 입력의 지문을 남겨 어긋나면 멈춘다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertHeightCacheFresh,
  buildHeightCacheManifest,
  heightCacheProblems,
  manifestPathFor,
  measuredRowsHash,
  pageInputsHash,
} from "../../../scripts/qa/heightCacheManifest";

const NOW = {
  kind: "continuation" as const,
  rows: 3,
  rowsHash: "abc",
  slotPx: 484,
};

const manifest = () =>
  buildHeightCacheManifest({ ...NOW, measuredAt: "2026-08-18T00:00:00.000Z" });

describe("[적대④-F] 캐시 지문", () => {
  it("지면 원문의 지문을 만든다 — 같은 지면이면 같은 값이다", () => {
    const a = pageInputsHash();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(pageInputsHash()).toBe(a);
  });

  /**
   * ⚠️ **본문이 바뀌면 높이가 바뀐다.** 이 저장소는 `apply-*` 스크립트로 본문을
   *    자주 고친다. id 목록만 보면 그 변화가 통째로 안 보인다.
   */
  it("문항 본문이 바뀌면 지문이 바뀐다 — id 목록만으로는 못 본다", () => {
    const rows = [
      { id: "b", content: "둘", figureUrls: [], questionType: null },
      { id: "a", content: "하나", figureUrls: [], questionType: null },
    ];
    const same = [...rows].reverse(); // 순서는 상관없다
    expect(measuredRowsHash(same)).toBe(measuredRowsHash(rows));

    const changed = rows.map((r) =>
      r.id === "a" ? { ...r, content: "하나 고침" } : r,
    );
    expect(measuredRowsHash(changed)).not.toBe(measuredRowsHash(rows));
  });

  it("그림이 붙거나 유형이 바뀌어도 지문이 바뀐다", () => {
    const base = [
      { id: "a", content: "본문", figureUrls: [], questionType: null },
    ];
    expect(
      measuredRowsHash([{ ...base[0]!, figureUrls: ["/f.png"] }]),
    ).not.toBe(measuredRowsHash(base));
    expect(
      measuredRowsHash([{ ...base[0]!, questionType: "서술형" }]),
    ).not.toBe(measuredRowsHash(base));
  });

  it("지문이 없으면 «없다»고 말한다 — 조용히 통과하지 않는다", () => {
    expect(heightCacheProblems(null, NOW)).toHaveLength(1);
  });

  it("장 종류·문항 수·본문·실측 칸이 어긋나면 **전부** 짚는다", () => {
    const problems = heightCacheProblems(manifest(), {
      kind: "first",
      rows: 4,
      rowsHash: "다른값",
      slotPx: 405,
    });
    expect(problems.map((p) => p.what)).toEqual([
      "장 종류",
      "문항 수",
      "문항 본문 지문",
      "실측 문항 칸",
    ]);
  });

  it("같은 지면·같은 문항이면 아무 문제도 없다", () => {
    expect(heightCacheProblems(manifest(), NOW)).toEqual([]);
  });

  it("지문 파일은 캐시 옆에 둔다", () => {
    expect(manifestPathFor(".measure/cont.json")).toBe(
      ".measure/cont.manifest.json",
    );
  });

  it("어긋나면 «다시 재라»를 말하며 멈춘다", () => {
    expect(() => assertHeightCacheFresh(".measure/없는캐시.json", NOW)).toThrow(
      /다시 재라/,
    );
  });
});

/**
 * 🟢 `[적대④-E]` — 채점기가 **제품 상수가 아니라 실측 칸**으로 «넘쳤는가»를 가른다.
 * 그리고 상수가 실측과 어긋나면 멈춘다 — 그게 «지면 ↔ 상수» 검산이다.
 */
describe("[적대④-E] 채점기의 참이 제품 상수에서 나오지 않는다", () => {
  const read = (file: string) =>
    readFileSync(path.join(process.cwd(), file), "utf8");

  it("«넘쳤는가»를 캐시의 실측 칸으로 가른다", () => {
    expect(read("scripts/qa/eval-overflow-rules.ts")).toMatch(
      /overflows:\s*h\.neededPx\s*>\s*h\.availPx/,
    );
  });

  it("실측 칸과 제품 상수가 다르면 멈춘다", () => {
    expect(read("scripts/qa/eval-overflow-rules.ts")).toMatch(
      /slot !== constant/,
    );
  });

  it("채점기가 캐시 지문을 대조한다", () => {
    expect(read("scripts/qa/eval-overflow-rules.ts")).toContain(
      "assertHeightCacheFresh",
    );
  });

  it("측정 스크립트가 캐시와 함께 지문을 남긴다", () => {
    expect(read("scripts/qa/measure-print-overflow.tsx")).toContain(
      "writeHeightCacheManifest",
    );
  });

  /** 전수 30분을 다시 안 쓰고 캐시를 되살리는 길 — 손이 아니라 도구가 말하게 한다. */
  it("표본으로 캐시를 대조해 지문을 다시 찍는 길이 있다", () => {
    expect(read("scripts/qa/measure-print-overflow.tsx")).toContain("--verify");
  });
});
