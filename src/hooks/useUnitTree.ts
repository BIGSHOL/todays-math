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

  /**
   * 열을 옮긴다.
   *
   * `forUnitId` — **바뀐 뒤의** 현재 단원. 브라우즈 상태는 `currentUnitId` 에 매여
   * 있어서(`active` 판정), 이동과 **동시에** 선택이 바뀌는 경우 지금 값으로 저장하면
   * 다음 렌더에서 버려진다. 범위 피커의 「학년 전체」가 그 경우다 — 학년을 누르면
   * 범위가 그 학년 끝 단원으로 옮겨 가므로, 그 id 로 저장해야 이동이 살아남는다.
   * 안 넘기면 종전대로 지금 값을 쓴다(`UnitTreePicker` 는 이동만 하므로 안 넘긴다).
   */
  function selectGrade(next: string, forUnitId?: string | null) {
    setBrowse({
      unitId: forUnitId === undefined ? currentUnitId : forUnitId,
      grade: next,
      chapter: chaptersOf(units, next)[0] ?? "",
    });
  }

  function selectChapter(next: string, forUnitId?: string | null) {
    setBrowse({
      unitId: forUnitId === undefined ? currentUnitId : forUnitId,
      grade,
      chapter: next,
    });
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
