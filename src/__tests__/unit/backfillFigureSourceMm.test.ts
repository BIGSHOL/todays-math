/**
 * 🟢 회귀 가드 — `figure_source_mm` 적재 스크립트의 가드들.
 *
 * 가드를 `main()` 안에 두면 DB 없이는 시험할 수 없고, 그러면 「가드가 있다」는
 * 말만 남는다. 판단을 순수 함수로 떼어 **가드마다 반증 표본**을 댄다.
 *
 * 막는 것은 「모르는 mm 을 그럴듯하게 채우는 것」이다. 추측한 값을 넣으면
 * 판정이 «안다」고 착각한다(CLAUDE.md 2026-08-16). 한 문항의 그림 중 일부만
 * 원장에 있으면 통째로 못 쓴다(지시서 §1 ⑶).
 */
import { describe, expect, it } from "vitest";

import {
  planRow,
  resolveMm,
  revertRow,
  type DbRow,
  type LedgerRow,
} from "../../../scripts/qa/backfill-figure-source-mm";

const URLS = ["/figures/1111/q06.png", "/figures/1111/q06_1.png"];

const lookup = (over: Record<string, number | null> = {}) =>
  new Map<string, number | null>([
    [URLS[0]!, 40],
    [URLS[1]!, 62.5],
    ...Object.entries(over),
  ]);

const db = (over: Partial<DbRow> = {}): DbRow => ({
  id: "p1",
  figureUrls: URLS,
  figureSourceMm: [],
  figureDims: [200, 100, 200, 100],
  examId: "1111",
  questionNumber: 6,
  ...over,
});

describe("resolveMm — 원장에서 배열을 만든다", () => {
  it("전부가 유효 mm 이면 배열을 준다", () => {
    const d = resolveMm(URLS, lookup());
    expect(d).toEqual({ ok: true, mm: [40, 62.5] });
  });

  it("🔴 한 장이라도 원장에 없으면 통째로 모른다", () => {
    const missing = new Map(lookup());
    missing.delete(URLS[1]!);
    expect(resolveMm(URLS, missing)).toEqual({
      ok: false,
      reason: "일부만 원장에 있다 (2장 중 1장)",
    });
  });

  it("🔴 전량이 없으면 「일부」로 뭉개지 않는다 — 분모가 다르다", () => {
    expect(resolveMm(URLS, new Map())).toEqual({
      ok: false,
      reason: "원장에 mm 이 없다 (2장)",
    });
  });

  it("🔴 원장은 있는데 mm 이 없으면 통째로 모른다", () => {
    expect(resolveMm(URLS, lookup({ [URLS[1]!]: null }))).toEqual({
      ok: false,
      reason: "일부만 원장에 있다 (2장 중 1장)",
    });
  });

  it("🔴 그림이 없으면 쓰지 않는다 — 빈 배열은 «모른다」", () => {
    expect(resolveMm([], lookup())).toEqual({
      ok: false,
      reason: "그림이 없다",
    });
  });

  it("🔴 물리 폭 범위를 벗어나면 제품 술어가 배열째 막는다", () => {
    const d = resolveMm(URLS, lookup({ [URLS[0]!]: 7000 }));
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toContain("물리 폭");
  });

  it("🔴 URL 규약 밖(/figures/ 가 아님)은 추측하지 않는다", () => {
    expect(resolveMm(["http://x/a.png"], lookup())).toEqual({
      ok: false,
      reason: "URL 규약 밖이다 (http://x/a.png)",
    });
  });
});

describe("planRow — 쓰는 경우", () => {
  it("전부 알고 · 빈 값 · 규약 통과면 쓴다. before 는 적용 전 값", () => {
    const resolved = resolveMm(URLS, lookup());
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const d = planRow(db(), resolved.mm);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.row.after).toEqual([40, 62.5]);
    expect(d.row.before).toEqual([]);
    expect(d.row.figureUrls).toEqual(URLS);
  });
});

describe("planRow — 🔴 안 쓰는 경우", () => {
  it("이미 같은 값이면 멱등 — 안 건드린다", () => {
    const d = planRow(db({ figureSourceMm: [40, 62.5] }), [40, 62.5]);
    expect(d).toEqual({ ok: false, reason: "이미 같은 값이다 (멱등)" });
  });

  it("🔴 이미 다른 값이 있으면 덮지 않는다 (남의 변경)", () => {
    const d = planRow(db({ figureSourceMm: [12] }), [40, 62.5]);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toContain("이미 값이 있다");
  });

  it("DB 에 행이 없으면 안 쓴다", () => {
    expect(planRow(undefined, [40, 62.5])).toEqual({
      ok: false,
      reason: "DB 에 그 행이 없다",
    });
  });

  it("🔴 길이가 그림 수와 다르면 제품 술어가 막는다", () => {
    const d = planRow(db(), [40]);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toContain("길이가 다르다");
  });
});

describe("되돌리기 — 우리가 쓴 값일 때만", () => {
  const ledger = (over: Partial<LedgerRow> = {}): LedgerRow => ({
    id: "p1",
    examId: "1111",
    questionNumber: 6,
    figureUrls: URLS,
    before: [],
    after: [40, 62.5],
    why: "",
    ...over,
  });

  it("우리가 쓴 값이면 `before` 로 되돌린다", () => {
    expect(revertRow(ledger(), db({ figureSourceMm: [40, 62.5] }))).toEqual({
      restore: true,
      to: [],
    });
  });

  it("🔴 되돌릴 값은 원장의 `before` 그대로다", () => {
    expect(
      revertRow(
        ledger({ before: [11, 12] }),
        db({ figureSourceMm: [40, 62.5] }),
      ),
    ).toEqual({ restore: true, to: [11, 12] });
  });

  it("🔴 지금 값이 우리가 쓴 값과 다르면 안 덮는다", () => {
    const d = revertRow(ledger(), db({ figureSourceMm: [1, 2] }));
    expect(d.restore).toBe(false);
    if (d.restore) return;
    expect(d.reason).toContain("남의 변경");
  });

  it("이미 되돌아가 있으면 다시 안 건드린다", () => {
    expect(revertRow(ledger(), db({ figureSourceMm: [] })).restore).toBe(false);
  });

  it("DB 에 행이 없으면 안 건드린다", () => {
    expect(revertRow(ledger(), undefined).restore).toBe(false);
  });
});
