/**
 * 되돌리기 원장을 **덮어쓰지 않고 이어 쓴다** — 한 곳.
 *
 * ## 왜 이 파일이 있는가 (실제로 났던 사고 아님 — 적대적 리뷰가 시연으로 잡았다)
 *
 * 잠금·적재 스크립트는 「원장을 DB 보다 **먼저** 쓴다」를 지킨다. 옳다. 그런데
 * 원장을 **무조건 덮어썼다.** 적용을 마치면 다음 실행의 계획은 **비게 된다** —
 * 잠긴 행은 멱등 가드에 걸리고, 후보를 다시 뽑으면 «출제 가능» 이 아니라서
 * 목록에서 아예 빠진다. 그래서 적용 뒤에 **드라이런을 한 번만 더 돌려도**
 * 원장이 `[]` 가 되고 `--revert` 가 0행을 되돌린다 —
 * 「영구 삭제가 아니다」의 근거가 조용히 사라진다.
 * 시연: `qa/adversarial/scripts/demo-ledger-clobber.mjs`
 *
 * 원장은 「이번에 무엇을 할까」가 아니라 **「우리가 무엇을 바꿨나」**의 기록이다.
 * 그러니 누적이어야 한다. 새 계획을 앞에 놓고, 계획에 없는 옛 행은 **그대로 남긴다.**
 * (같은 id 가 양쪽에 있으면 **새 것**이 이긴다 — 방금 읽은 `before` 가 더 정확하다.)
 */

/** 원장 한 행이 반드시 갖는 것. 되돌리기는 이 id 로 DB 행을 찾는다. */
export interface LedgerIdentified {
  id: string;
}

export interface MergedLedger<T extends LedgerIdentified> {
  rows: T[];
  /** 옛 원장에서 그대로 이어받은 행 수 — 화면에 찍어 조용하지 않게 한다. */
  carried: number;
}

/**
 * 옛 원장과 새 계획을 합친다. **잃지 않는 쪽**으로 합친다.
 *
 * 되돌리기 원장에서 「행이 사라지는 것」은 「되돌릴 수 없게 되는 것」과 같은 말이다.
 * 그래서 이 함수는 **행을 지우지 않는다.** 지워야 한다면 그건 되돌리기를 마친
 * 뒤의 일이고, 그때는 `--revert` 가 스스로 원장을 정리한다.
 */
export function mergeLedgerRows<T extends LedgerIdentified>(
  previous: readonly T[] | null | undefined,
  next: readonly T[],
): MergedLedger<T> {
  const fresh = new Set(next.map((r) => r.id));
  const carriedRows = (previous ?? []).filter((r) => !fresh.has(r.id));
  return { rows: [...next, ...carriedRows], carried: carriedRows.length };
}

/**
 * 이 원장이 「이미 적용된 것」을 담고 있는가.
 *
 * 한 번이라도 적용했으면 그 사실은 **꺼지면 안 된다.** 드라이런이 이 값을 `false`
 * 로 되돌리면 다음 사람이 원장을 보고 「아직 안 썼구나」로 읽는다.
 */
export function stillApplied(
  previouslyApplied: boolean | undefined,
  applyingNow: boolean,
): boolean {
  return previouslyApplied === true || applyingNow;
}
