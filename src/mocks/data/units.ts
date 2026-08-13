/**
 * Mock 단원 픽스처 (T0.5.2) — 실제 시드 데이터에서 발췌한다 (재정의 금지).
 *
 * 원본: prisma/seed-data/units.ts (CURRICULUM_UNITS, T0.3 — eywa 이관 735개 차시).
 * 중2 "1. 수와 식"(orderIndex 413~420, 8개) + "2. 부등식"(orderIndex 421~427, 7개) 총 15개
 * 차시를 그대로 가져와 Mock UUID만 부여한다. 이 범위를 고른 이유:
 *   - 8+7 = 15개 연속 구간이라 daily(단일 소단원)/review(구간) 범위 계산 테스트 양쪽에 쓰기 좋다.
 *   - 마지막 차시(427 "일차부등식의 활용(농도)")는 의도적으로 Mock 문제를 0건만 배정해
 *     (src/mocks/data/problems.ts 참조) INSUFFICIENT_PROBLEMS 실패 경로를 재현한다.
 *
 * 대응 API 경로: 없음 — Unit은 계약(src/contracts)에 전용 스키마가 없다(id 참조만 존재).
 * 참조: prisma/schema.prisma Unit 모델, prisma/seed-data/units.ts
 */
import { CURRICULUM_UNITS } from "../../../prisma/seed-data/units";
import { unitId } from "./ids";

const RANGE_START_ORDER_INDEX = 413; // 중2 "1. 수와 식" 첫 차시(유리수와 소수)
const RANGE_END_ORDER_INDEX = 427; // 중2 "2. 부등식" 마지막 차시(일차부등식의 활용(농도))

export interface MockUnit {
  id: string;
  grade: string;
  chapter: string;
  section: string;
  orderIndex: number;
}

const pickedSeeds = CURRICULUM_UNITS.filter(
  (u) =>
    u.orderIndex >= RANGE_START_ORDER_INDEX &&
    u.orderIndex <= RANGE_END_ORDER_INDEX,
).sort((a, b) => a.orderIndex - b.orderIndex);

if (pickedSeeds.length !== 15) {
  // 시드 원본이 바뀌면(단원 추가/삭제) 이 픽스처와 아래 problems.ts의 단원별 배정이 깨진다.
  throw new Error(
    `[mocks/data/units] 예상 15개 차시가 아니라 ${pickedSeeds.length}개가 선택되었습니다. ` +
      "prisma/seed-data/units.ts 변경 여부를 확인하세요.",
  );
}

/** orderIndex 413~427(15개 차시) — 배열 인덱스 0~14가 그대로 orderIndex 순서와 일치한다. */
export const MOCK_UNITS: MockUnit[] = pickedSeeds.map((seed, idx) => ({
  id: unitId(idx + 1),
  grade: seed.grade,
  chapter: seed.chapter,
  section: seed.section,
  orderIndex: seed.orderIndex,
}));

// ── 이름 있는 접근자 (테스트 가독성용) ──────────────────────────
/** "1. 수와 식" 8개 차시 (orderIndex 413~420). */
export const MOCK_UNITS_SUWASIK = MOCK_UNITS.slice(0, 8);
/** "2. 부등식" 7개 차시 (orderIndex 421~427). */
export const MOCK_UNITS_BUDEUNGSIK = MOCK_UNITS.slice(8, 15);

/** daily(일일테스트) 시나리오의 "현재 진도" 소단원 — 순환소수를 포함한 식의 계산(416). */
export const MOCK_CURRENT_PROGRESS_UNIT = MOCK_UNITS[3]!;
/** review(확인테스트) 범위 시작 — 유리수와 소수(413). */
export const MOCK_REVIEW_RANGE_START_UNIT = MOCK_UNITS[0]!;
/** review(확인테스트) 범위 끝 — 다항식의 곱셈과 나눗셈(420). */
export const MOCK_REVIEW_RANGE_END_UNIT = MOCK_UNITS[7]!;
/** 등록된 문제가 0건인 소단원 — INSUFFICIENT_PROBLEMS 재현용(일차부등식의 활용(농도), 427). */
export const MOCK_EMPTY_PROBLEM_UNIT = MOCK_UNITS[14]!;
