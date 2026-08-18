/**
 * 🟢 회귀 가드 — 적대적 리뷰 ④ `[적대④-C]` `[적대④-D]` 승격.
 *
 * ## 왜 이 파일이 있는가
 *
 * 넘침 판정은 그림 높이를 **DB 컬럼**(`problem.figure_dims`)에서만 읽는다 — 판정은
 * 브라우저에서 돌아 이미지 파일을 못 읽기 때문이다. 2026-08-18 수리는 그 컬럼을
 * backfill 스크립트로 **한 번** 채웠다(8,442건). 그런데 **문항이 들어오는 길**
 * (`toLoadRows` → `load-classified`)은 `figureUrls` 만 쓰고 치수는 안 썼다.
 * 그래서 그 뒤로 들어오는 그림 문항은 전부 «모른다»가 된다 —
 * **수리가 오늘 자 데이터에만 유효**했다.
 *
 * 실측 대조 (`eval-overflow-rules.ts`, 전수 47,152건):
 * ```
 * 치수 앎   경고 3,649 · 놓침    21 · 재현율 99.2% · 정밀도 74.1%
 * 치수 모름 경고 2,683 · 놓침 1,080 · 재현율 60.4% · 정밀도 61.3%
 * ```
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { toLoadRows } from "@/lib/import/toLoadRows";
import type { ImportDraft } from "@/lib/import/types";
import { parseFigureDimensions } from "@/lib/printOverflow";

const draft = (over: Partial<ImportDraft> = {}) =>
  ({
    externalId: "e1",
    unitId: "11111111-1111-4111-8111-111111111111",
    source: "manual",
    difficulty: "mid",
    problemType: "계산",
    content: "그림을 보고 답하시오.",
    answer: "1",
    solution: null,
    directUseAllowed: true,
    ...over,
  }) as ImportDraft & { unitId: string };

const USER = "22222222-2222-4222-8222-222222222222";

describe("[적대④-C] 적재가 그림 치수를 채운다", () => {
  it("그림 경로와 **같은 순서**로 짝지은 평탄 배열을 만든다", () => {
    const { rows } = toLoadRows(
      [draft({ figureUrls: ["/a.png", "/b.png"] })],
      USER,
      { resolveDimensions: (url) => (url === "/a.png" ? [10, 20] : [30, 40]) },
    );
    expect(rows[0]!.figureDims).toEqual([10, 20, 30, 40]);
    // 판정이 실제로 읽어 낼 수 있는 모양이어야 한다.
    expect(parseFigureDimensions(2, rows[0]!.figureDims)).toEqual([
      { width: 10, height: 20 },
      { width: 30, height: 40 },
    ]);
  });

  /**
   * ⚠️ 한 장이라도 못 읽으면 **통째로 비운다.** 반쪽 배열은 짝이 어긋나 판정이
   *    어차피 «모른다»로 받는데, 넣어 두면 «안다»고 착각할 여지만 남긴다
   *    (CLAUDE.md 2026-08-16 — 손상을 정상으로 읽는 가드).
   */
  it("한 장이라도 못 읽으면 통째로 비운다 — 반쪽을 흘리지 않는다", () => {
    const { rows } = toLoadRows(
      [draft({ figureUrls: ["/a.png", "/없다.png"] })],
      USER,
      { resolveDimensions: (url) => (url === "/a.png" ? [10, 20] : null) },
    );
    expect(rows[0]!.figureDims).toEqual([]);
  });

  it("그림이 없으면 빈 배열이다", () => {
    const { rows } = toLoadRows([draft({ figureUrls: [] })], USER, {
      resolveDimensions: () => [10, 20],
    });
    expect(rows[0]!.figureDims).toEqual([]);
  });

  it("치수 읽기를 안 넘겨도 던지지 않는다 — 그때는 «모른다»다", () => {
    const { rows } = toLoadRows([draft({ figureUrls: ["/a.png"] })], USER);
    expect(rows[0]!.figureDims).toEqual([]);
  });

  /** 적재 스크립트가 실제로 치수 읽기를 **넘기는지** 본다 — 안 넘기면 위가 다 무의미하다. */
  it("load-classified 가 toLoadRows 에 치수 읽기를 넘긴다", () => {
    const src = readFileSync(
      path.join(process.cwd(), "scripts/import/load-classified.ts"),
      "utf8",
    );
    expect(src).toMatch(/resolveDimensions:\s*readFigureDimensions/);
  });
});

/**
 * 🟢 `[적대④-D]` — **되돌리기도 쓰기다.**
 *
 * `--apply` 는 `ALLOW_SHARED_IMPORT=1` 을 요구하는데(D-31, 2026-08-14 적재 사고),
 * `--revert` 분기가 그 검사보다 **위**에 있어서 `--revert --apply` 한 줄이
 * 환경변수 없이 공유 DB 의 `figure_dims` 전량을 지웠다. 지워지는 것은 판정의
 * 유일한 근거이고, 에러 없이 **숫자만** 나빠진다(재현율 99.2% → 60.4%).
 */
describe("[적대④-D] 되돌리기가 공유 DB 게이트를 건너뛰지 않는다", () => {
  const src = readFileSync(
    path.join(process.cwd(), "scripts/qa/backfill-figure-dimensions.ts"),
    "utf8",
  );

  it("ALLOW_SHARED_IMPORT 검사가 --revert 분기보다 먼저 온다", () => {
    const gate = src.indexOf("ALLOW_SHARED_IMPORT !== ");
    const revert = src.indexOf('includes("--revert")');
    expect(gate).toBeGreaterThan(-1);
    expect(revert).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(revert);
  });

  it("치수가 빈 문항을 세는 길이 있다 — 적재가 새면 알아야 한다", () => {
    expect(src).toContain('includes("--check")');
  });
});
