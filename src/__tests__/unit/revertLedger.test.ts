/**
 * 🟢 회귀 가드 — **되돌리기 원장은 지워지지 않는다.**
 *
 * 적대적 리뷰가 시연으로 잡은 결함이다(`qa/adversarial/scripts/demo-ledger-clobber.mjs`).
 * 잠금·적재 스크립트는 원장을 **무조건 덮어썼다.** 적용을 마치면 다음 실행의 계획은
 * **비게 된다** — 잠긴 행은 멱등 가드에 걸리고, 후보를 다시 뽑으면 «출제 가능» 이
 * 아니라 목록에서 아예 빠진다. 그래서 적용 뒤에 **드라이런을 한 번만 더 돌려도**
 * 원장이 `[]` 가 되고 `--revert` 가 0행을 되돌린다.
 *
 * 「영구 삭제가 아니다」는 원장이 살아 있을 때만 참이다. 그러니 원장은
 * 「이번에 무엇을 할까」가 아니라 **「우리가 무엇을 바꿨나」**의 누적 기록이어야 한다.
 */
import { describe, expect, it } from "vitest";

import {
  mergeLedgerRows,
  stillApplied,
} from "../../../scripts/qa/revertLedger";

const r = (id: string, tag = "") => ({ id, tag });

describe("원장 합치기 — 행을 잃지 않는다", () => {
  it("🔴 계획이 비어도 옛 행이 남는다 — 이게 지워지면 되돌릴 수 없다", () => {
    const merged = mergeLedgerRows([r("a"), r("b")], []);
    expect(merged.rows.map((x) => x.id)).toEqual(["a", "b"]);
    expect(merged.carried).toBe(2);
  });

  it("새 계획을 앞에 놓고 계획에 없는 옛 행을 뒤에 잇는다", () => {
    const merged = mergeLedgerRows([r("a"), r("b")], [r("c")]);
    expect(merged.rows.map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(merged.carried).toBe(2);
  });

  it("같은 id 는 **새 것**이 이긴다 — 방금 읽은 before 가 더 정확하다", () => {
    const merged = mergeLedgerRows([r("a", "옛것")], [r("a", "새것")]);
    expect(merged.rows).toEqual([r("a", "새것")]);
    expect(merged.carried).toBe(0);
  });

  it("옛 원장이 없어도 (첫 실행) 새 계획 그대로다", () => {
    expect(mergeLedgerRows(null, [r("a")])).toEqual({
      rows: [r("a")],
      carried: 0,
    });
  });
});

describe("«적용됨» 은 꺼지지 않는다", () => {
  it("🔴 한 번 적용했으면 뒤이은 드라이런이 false 로 되돌리지 못한다", () => {
    expect(stillApplied(true, false)).toBe(true);
  });

  it("이번에 적용하면 참이다", () => {
    expect(stillApplied(false, true)).toBe(true);
    expect(stillApplied(undefined, true)).toBe(true);
  });

  it("한 번도 안 썼으면 거짓이다", () => {
    expect(stillApplied(undefined, false)).toBe(false);
  });
});
