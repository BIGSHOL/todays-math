import { useMemo, useState } from "react";

import {
  chaptersOf,
  findUnit,
  gradesOf,
  sectionsOf,
  type UnitNode,
} from "@/lib/units/groupUnits";

export function useUnitTree(units: UnitNode[], currentUnitId: string | null) {
  const current = findUnit(units, currentUnitId);
  const [browse, setBrowse] = useState<{
    unitId: string | null;
    grade: string;
    chapter: string;
  } | null>(null);

  const active = browse?.unitId === currentUnitId ? browse : null;
  const grade = active?.grade ?? current?.grade ?? units[0]?.grade ?? "";
  const chapter =
    active?.chapter ?? current?.chapter ?? chaptersOf(units, grade)[0] ?? "";

  const grades = useMemo(() => gradesOf(units), [units]);
  const chapters = useMemo(() => chaptersOf(units, grade), [units, grade]);
  const sections = useMemo(
    () => sectionsOf(units, grade, chapter),
    [units, grade, chapter],
  );

  function selectGrade(next: string) {
    setBrowse({
      unitId: currentUnitId,
      grade: next,
      chapter: chaptersOf(units, next)[0] ?? "",
    });
  }

  function selectChapter(next: string) {
    setBrowse({ unitId: currentUnitId, grade, chapter: next });
  }

  return {
    current,
    grade,
    chapter,
    grades,
    chapters,
    sections,
    selectGrade,
    selectChapter,
  };
}
