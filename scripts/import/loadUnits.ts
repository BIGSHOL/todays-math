import { CURRICULUM_UNITS } from "../../prisma/seed-data/units.ts";
import type { UnitLike } from "../../src/lib/import/types";

export function seedUnitsAsLike(): UnitLike[] {
  return CURRICULUM_UNITS.map((unit, index) => ({
    id: `seed-${index + 1}`,
    grade: unit.grade,
    chapter: unit.chapter,
    section: unit.section,
  }));
}

export function seedUnitByPlaceholder(unitId: string): UnitLike | null {
  const match = /^seed-(\d+)$/.exec(unitId);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  const unit = CURRICULUM_UNITS[index];
  if (!unit) return null;
  return {
    id: unitId,
    grade: unit.grade,
    chapter: unit.chapter,
    section: unit.section,
  };
}
