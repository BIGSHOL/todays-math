import type { UnitSeed } from "../../../prisma/seed-data/units";

import type { ChapterHandler } from "./types";

/**
 * 초등 난이도 4단 (D-71, 원장님 확정 2026-08-22).
 *
 * 이름이 곧 값이다 — 지면·반 프리셋·상담에서 같은 말을 쓰므로 매핑이 없다.
 * 중·고등 `easy/mid/hard` 와는 **다른 축**이다. 억지로 잇지 말 것 (D-71).
 */
export type ElemTier = "연산" | "기본" | "응용" | "심화";
export const ELEM_TIERS = ["연산", "기본", "응용", "심화"] as const;

/**
 * 반 프리셋 안A (%, D-71). 원장님이 언제든 숫자를 조정한다 —
 * 여기 값과 07 문서 D-71 행이 서로의 참이다. 합 100 은 시험이 잠근다.
 */
export type ClassPreset = "하위반" | "중위반" | "상위반";
export const TIER_PRESETS: Record<ClassPreset, Record<ElemTier, number>> = {
  하위반: { 연산: 40, 기본: 40, 응용: 20, 심화: 0 },
  중위반: { 연산: 15, 기본: 40, 응용: 30, 심화: 15 },
  상위반: { 연산: 0, 기본: 25, 응용: 40, 심화: 35 },
};

/**
 * 소단원 하나의 난이도 갈래 묶음. **넷을 전부** 채워야 등록된다 —
 * `Record` 라 일부만 채우면 컴파일이 막는다. 일부 갈래만 있으면
 * 프리셋 비율이 그 소단원에서 조용히 못 서기 때문이다.
 */
export type TierVariants = Record<ElemTier, ChapterHandler>;

/** 키는 `학년|소단원 코드` (예: `"초3|1-1-2"`) — `tierKey()` 가 만든다. */
export type ElemTierMap = Record<string, TierVariants>;

/** `"1-1-2 받아올림이 …"` → `"1-1-2"`. 코드가 키다 — 소단원 이름은 바뀔 수 있다. */
export function sectionCode(unit: Pick<UnitSeed, "section">): string {
  return unit.section.split(" ")[0]!;
}

export function tierKey(unit: Pick<UnitSeed, "grade" | "section">): string {
  return `${unit.grade}|${sectionCode(unit)}`;
}

/**
 * 같은 씨앗에서 갈래마다 다른 수가 나오게 하는 소금.
 * 값이 겹치면 두 갈래가 같은 rng 흐름을 타서 숫자가 같이 움직인다 — 시험이 잠근다.
 */
export const TIER_SALT: Record<ElemTier, number> = {
  연산: 0x1_0001,
  기본: 0x2_0002,
  응용: 0x3_0003,
  심화: 0x4_0004,
};
