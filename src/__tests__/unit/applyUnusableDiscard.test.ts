/**
 * 「학생이 정답을 고를 수 없는 문항」 출제 제외 — **뺄지 말지**를 가르는 규칙.
 *
 * 이 검사는 **변이로 시험한다**: 가드를 하나씩 지우면 반드시 하나 이상이 빨개져야 한다.
 * 「가드는 망가뜨려 봐야 가드인 줄 안다」(CLAUDE.md 2026-08-18).
 */
import { describe, expect, it } from "vitest";

import {
  FATAL_VERDICTS,
  decideUnusableDiscard,
  revertUnusable,
  type DbRow,
  type FatalRow,
  type LockedRow,
} from "../../../scripts/qa/apply-unusable-discard";

function fatal(over: Partial<FatalRow> = {}): FatalRow {
  return {
    id: "a",
    verdict: "보기0칸",
    cause: "보기 그림 (figref 부류)",
    school: "대구북중",
    questionNumber: 13,
    source: "past_exam",
    sourceFile: "N:\\개인\\기출\\x.PDF",
    unitId: "u1",
    ...over,
  };
}

function db(over: Partial<DbRow> = {}): DbRow {
  return {
    id: "a",
    externalId: null,
    directUseAllowed: true,
    unitId: "u1",
    pool: "shared",
    reviewStatus: "approved",
    noAnswer: false,
    ...over,
  };
}

describe("치명 판정만 뺀다", () => {
  it("다섯 가지 치명 판정은 뺀다", () => {
    for (const v of FATAL_VERDICTS)
      expect(decideUnusableDiscard(fatal({ verdict: v }), db(), false)).toEqual(
        {
          lock: true,
        },
      );
  });

  // 🔴 43이 433이 된 사고와 같은 자리다 — ⚠️ 부류는 정답을 고를 수 **있다.**
  it.each(["지면번호어긋남", "보기수이상", "정답표기가번호아님", "정상"])(
    "«%s» 은 치명이 아니므로 안 뺀다",
    (verdict) => {
      const d = decideUnusableDiscard(fatal({ verdict }), db(), false);
      expect(d.lock).toBe(false);
      expect(d.lock === false && d.reason).toContain("치명 판정이 아니다");
    },
  );
});

describe("다른 잠금 원장을 침범하지 않는다", () => {
  // 한 컬럼을 두 원장이 잠그면 **한쪽을 되돌릴 때 다른 쪽이 풀린다.**
  it("그림 유실·보기그림 원장에 이미 있으면 안 뺀다", () => {
    const d = decideUnusableDiscard(fatal(), db(), true);
    expect(d.lock).toBe(false);
    expect(d.lock === false && d.reason).toContain("다른 잠금 원장");
  });

  it("이미 빠져 있으면 그대로 둔다 (멱등)", () => {
    const d = decideUnusableDiscard(
      fatal(),
      db({ directUseAllowed: false }),
      false,
    );
    expect(d.lock).toBe(false);
    expect(d.lock === false && d.reason).toContain("멱등");
  });

  it("DB 에 행이 없으면 안 뺀다", () => {
    expect(decideUnusableDiscard(fatal(), undefined, false).lock).toBe(false);
  });
});

describe("되돌리기는 우리가 쓴 값일 때만", () => {
  const locked: LockedRow = {
    id: "a",
    externalId: null,
    directUseAllowed: true,
    school: null,
    questionNumber: null,
    판정: "보기0칸",
    원인: "x",
    unitId: "u1",
    원본: null,
  };

  it("지금 false 면 잠그기 전 값으로 되돌린다", () => {
    expect(revertUnusable(locked, { directUseAllowed: false })).toEqual({
      restore: true,
      to: true,
    });
  });

  // 그 사이 누가 풀었으면 **덮지 않는다** — 남의 변경을 되돌리는 것이 된다.
  it("지금 true 면 건드리지 않는다", () => {
    const d = revertUnusable(locked, { directUseAllowed: true });
    expect(d.restore).toBe(false);
    expect(d.restore === false && d.reason).toContain("남의 변경");
  });

  it("DB 에 행이 없으면 건드리지 않는다", () => {
    expect(revertUnusable(locked, undefined).restore).toBe(false);
  });
});
