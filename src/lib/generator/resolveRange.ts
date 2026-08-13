/**
 * 범위 계산 — 출제 대상 단원(unitId) 목록을 결정하는 순수 함수.
 *
 * - daily(일일테스트): 현재 진도 소단원 하나만 범위로 삼는다.
 * - review(확인테스트): 시작~끝 단원의 orderIndex 구간 전체를 범위로 삼는다. orderIndex는
 *   전역 연속값(D-27, docs/planning/06-tasks.md T0.3)이므로 입력 units 배열의 순서에
 *   의존하지 않고 orderIndex 값으로 판정한다.
 *
 * 참조: docs/planning/06-tasks.md T4.1, src/mocks/data/units.ts(MOCK_UNITS)
 */

/** Unit 계약 전용 스키마가 없어(problem.contract.ts 주석 참조) id/orderIndex만 요구하는
 *  최소 구조 타입으로 받는다 — MockUnit·Prisma Unit 모두 구조적으로 호환된다. */
export interface RangeUnit {
  id: string;
  orderIndex: number;
}

export interface ResolveDailyRangeArgs {
  testType: "daily";
  currentProgressUnitId: string;
  units: RangeUnit[];
}

export interface ResolveReviewRangeArgs {
  testType: "review";
  rangeStartUnitId: string;
  rangeEndUnitId: string;
  units: RangeUnit[];
}

export type ResolveRangeArgs = ResolveDailyRangeArgs | ResolveReviewRangeArgs;

export interface ResolveRangeResult {
  /** orderIndex 오름차순으로 정렬된 대상 단원 id 목록. */
  unitIds: string[];
}

export function resolveRange(args: ResolveRangeArgs): ResolveRangeResult {
  if (args.testType === "daily") {
    return { unitIds: [args.currentProgressUnitId] };
  }

  const { rangeStartUnitId, rangeEndUnitId, units } = args;
  const start = units.find((u) => u.id === rangeStartUnitId);
  const end = units.find((u) => u.id === rangeEndUnitId);
  if (!start || !end) {
    throw new Error(
      "[resolveRange] rangeStartUnitId/rangeEndUnitId가 units 목록에 없습니다.",
    );
  }

  const [minOrder, maxOrder] =
    start.orderIndex <= end.orderIndex
      ? [start.orderIndex, end.orderIndex]
      : [end.orderIndex, start.orderIndex];

  const unitIds = units
    .filter((u) => u.orderIndex >= minOrder && u.orderIndex <= maxOrder)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((u) => u.id);

  return { unitIds };
}
