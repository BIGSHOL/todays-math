import { CURRICULUM_UNITS, type UnitSeed } from "../../../prisma/seed-data/units";

import { G3 } from "./g3";
import { G4 } from "./g4";
import { G5 } from "./g5";
import { G6 } from "./g6";
import { createRng } from "./rng";
import { ELEM_GRADES, type ElemProblem } from "./types";

const HANDLERS = { ...G3, ...G4, ...G5, ...G6 };

export function elementaryUnits(): UnitSeed[] {
  return CURRICULUM_UNITS.filter((unit) =>
    (ELEM_GRADES as readonly string[]).includes(unit.grade),
  );
}

export function elementaryChapters(): { grade: string; chapter: string }[] {
  const seen = new Set<string>();
  const out: { grade: string; chapter: string }[] = [];
  for (const unit of elementaryUnits()) {
    const key = `${unit.grade}|${unit.chapter}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ grade: unit.grade, chapter: unit.chapter });
  }
  return out;
}

export function generateElementaryProblem(
  unit: UnitSeed,
  seed = 20260821,
): ElemProblem {
  const key = `${unit.grade}|${unit.chapter}`;
  const handler = HANDLERS[key];
  if (!handler) {
    throw new Error(`초등 생성기가 없습니다: ${key}`);
  }
  return handler(unit, createRng(seed + unit.orderIndex * 17));
}

export function generateElementaryChapter(
  grade: string,
  chapter: string,
  seed = 20260821,
): ElemProblem[] {
  return elementaryUnits()
    .filter((unit) => unit.grade === grade && unit.chapter === chapter)
    .map((unit) => generateElementaryProblem(unit, seed));
}

export function handlerKeys(): string[] {
  return Object.keys(HANDLERS);
}
