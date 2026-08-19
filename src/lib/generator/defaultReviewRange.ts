/**
 * 확인테스트 **기본 범위** 제안 — 진도가 정한다. 순수 함수.
 *
 * 원장님 확정(2026-08-19): **끝은 항상 현재 진도**, 시작은 **직전 확인테스트의 끝
 * 다음 소단원**. 직전 확인테스트가 없으면 그 반이 나간 진도의 **첫 단원**부터.
 *
 * 고친 것: 화면(`useGenerateSetup`)이 시작을 `units[0]`(초1 첫 소단원), 끝을
 * `units[마지막]`(미적분2 마지막)로 채우고 있었다. 손대지 않고 출제하면 범위가
 * **전 교육과정 735단원**이 되고, 그래도 오류가 안 난다 — 후보가 44,125건이라
 * 정원이 채워지기 때문이다. 실측으로 8문항이 다섯 학년에서 뽑혔다.
 *
 * 참조: `resolveRange`(범위 → 단원 목록) · D-27(orderIndex 는 전역 연속값)
 */
import type { RangeUnit } from "./resolveRange";

export interface DefaultReviewRangeArgs {
  /** 전체 단원 — id 와 orderIndex 만 본다. */
  units: RangeUnit[];
  /** 현재 진도 소단원 id (반 또는 학생 개별 — 호출자가 이미 골라 넘긴다). */
  currentUnitId: string;
  /** 직전 확인테스트의 `rangeEndUnitId`. 한 번도 안 냈으면 null. */
  lastReviewEndUnitId: string | null;
  /** 그 반의 진도 이력 단원 id 들 — 순서는 상관없다(orderIndex 로 판정한다). */
  progressUnitIds: string[];
}

export interface DefaultReviewRange {
  startUnitId: string;
  endUnitId: string;
  /**
   * 시작을 무엇이 정했나 — 화면 안내 문구가 갈린다.
   * · `last-review`     직전 확인테스트 다음부터
   * · `progress-start`  확인테스트를 안 냈으니 진도 이력 첫 단원부터
   * · `current-only`    시작을 **못 정했다** — 직전 확인 뒤로 진도가 안 나갔거나
   *                     진도 이력이 비어 있다. 범위는 현재 진도 한 단원이 된다.
   *                     («한 단원이다»가 아니라 «못 정했다»가 이 값의 뜻이다 —
   *                      이력 첫 단원이 곧 현재 진도인 경우는 `progress-start` 다.)
   */
  startedFrom: "last-review" | "progress-start" | "current-only";
}

/**
 * 못 내면 `null` 이다 — 현재 진도 단원을 단원 목록에서 못 찾는 경우.
 * (호출자는 그때 범위를 비워 두고 원장이 직접 고르게 한다.)
 */
export function resolveDefaultReviewRange(
  args: DefaultReviewRangeArgs,
): DefaultReviewRange | null {
  const { units, currentUnitId, lastReviewEndUnitId, progressUnitIds } = args;

  const byId = new Map(units.map((u) => [u.id, u]));
  const current = byId.get(currentUnitId);
  if (!current) return null;

  const { start, startedFrom } = resolveStart();

  // 🔒 **거꾸로 된 범위를 만들지 않는다.** 시작이 현재 진도보다 뒤면 그 한 단원이다.
  // `resolveRange` 는 시작·끝을 크기순으로 정렬하므로, 뒤집힌 채 넘기면 「직전에 이미
  // 낸 범위」를 통째로 다시 내게 된다 — 조용히 틀리는 쪽이라 여기서 막는다.
  if (!start || start.orderIndex > current.orderIndex) {
    return {
      startUnitId: current.id,
      endUnitId: current.id,
      startedFrom: "current-only",
    };
  }
  return { startUnitId: start.id, endUnitId: current.id, startedFrom };

  function resolveStart(): {
    start: RangeUnit | undefined;
    startedFrom: DefaultReviewRange["startedFrom"];
  } {
    const lastEnd = lastReviewEndUnitId
      ? byId.get(lastReviewEndUnitId)
      : undefined;

    if (lastEnd) {
      // 「다음 소단원」은 orderIndex 가 그보다 큰 것 중 **가장 작은** 것이다.
      // 학년 경계를 따로 보지 않는다 — orderIndex 가 전역이라 그대로 이어진다(D-27).
      const next = units
        .filter((u) => u.orderIndex > lastEnd.orderIndex)
        .reduce<RangeUnit | undefined>(
          (best, u) => (!best || u.orderIndex < best.orderIndex ? u : best),
          undefined,
        );
      return { start: next, startedFrom: "last-review" };
    }

    // 확인테스트를 한 번도 안 냈으면 **그 반이 실제로 나간 데**부터다.
    // 학년 첫 단원이 아니다 — 학기 중간에 받은 반은 앞부분을 안 나갔다.
    const earliest = progressUnitIds
      .map((id) => byId.get(id))
      .filter((u): u is RangeUnit => u !== undefined)
      .reduce<RangeUnit | undefined>(
        (best, u) => (!best || u.orderIndex < best.orderIndex ? u : best),
        undefined,
      );
    return { start: earliest, startedFrom: "progress-start" };
  }
}
