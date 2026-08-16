/**
 * 중단원까지만 판정하고 그 안의 **대표 소단원**으로 붙이는 안 (트랙 G, 2026-08-16 코디네이터 지시).
 *
 * `Unit` 테이블은 행 하나가 소단원이고 중단원 행이 따로 없다. 스키마는 건드리지 않으므로
 * "중단원까지만" 을 실제로 적재하려면 결국 **그 중단원 안의 소단원 하나를 골라야 한다.**
 *
 * 고르는 방법도 데이터로 정한다 — 이미 분류된 문항에서 그 중단원에 **실제로 제일 많이
 * 붙은 소단원**을 대표로 쓴다. 교육과정 해석이 아니라 실측이다.
 */
import type { Unit } from "./types";

/** 학년과 중단원을 한 라벨로 묶는다. 중단원 이름은 학년을 건너 겹칠 수 있다. */
export const chapterKey = (grade: string, chapter: string): string => `${grade}||${chapter}`;

/**
 * 중단원 → 대표 소단원.
 *
 * 학습셋에서 그 중단원에 가장 많이 붙은 소단원을 고른다.
 * 동수면 교육과정 순서가 앞선 쪽(`orderIndex` 최소)을 쓴다 — 임의로 고르면
 * 같은 입력에 대해 실행마다 답이 달라진다.
 */
export function buildRepresentatives(
  labels: { unitId: string }[],
  unitById: Map<string, Unit>,
): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const { unitId } of labels) {
    const unit = unitById.get(unitId);
    if (!unit) continue;
    const key = chapterKey(unit.grade, unit.chapter);
    let inner = counts.get(key);
    if (!inner) { inner = new Map(); counts.set(key, inner); }
    inner.set(unitId, (inner.get(unitId) ?? 0) + 1);
  }

  const representatives = new Map<string, string>();
  for (const [key, inner] of counts) {
    let best: string | null = null;
    let bestCount = -1;
    let bestOrder = Number.POSITIVE_INFINITY;
    for (const [unitId, count] of inner) {
      const order = unitById.get(unitId)?.orderIndex ?? Number.POSITIVE_INFINITY;
      if (count > bestCount || (count === bestCount && order < bestOrder)) {
        best = unitId; bestCount = count; bestOrder = order;
      }
    }
    if (best) representatives.set(key, best);
  }
  return representatives;
}
