export type UnitNode = {
  id: string;
  grade: string;
  chapter: string;
  section: string;
  orderIndex: number;
};

function uniqueInOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function gradesOf(units: UnitNode[]): string[] {
  return uniqueInOrder(units.map((unit) => unit.grade));
}

export function chaptersOf(units: UnitNode[], grade: string): string[] {
  return uniqueInOrder(
    units.filter((unit) => unit.grade === grade).map((unit) => unit.chapter),
  );
}

export function sectionsOf(
  units: UnitNode[],
  grade: string,
  chapter: string,
): UnitNode[] {
  return units
    .filter((unit) => unit.grade === grade && unit.chapter === chapter)
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex);
}

export function findUnit(
  units: UnitNode[],
  id: string | null,
): UnitNode | undefined {
  if (!id) return undefined;
  return units.find((unit) => unit.id === id);
}
