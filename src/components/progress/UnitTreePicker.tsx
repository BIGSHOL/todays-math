"use client";

import type { ReactNode } from "react";

import { useUnitTree } from "@/hooks/useUnitTree";
import type { UnitNode } from "@/lib/units/groupUnits";

type UnitTreePickerProps = {
  units: UnitNode[];
  currentUnitId: string | null;
  onSelect: (unitId: string) => void;
};

export function UnitTreePicker({
  units,
  currentUnitId,
  onSelect,
}: UnitTreePickerProps) {
  const tree = useUnitTree(units, currentUnitId);

  return (
    <div
      role="group"
      aria-label="단원 선택"
      className="grid grid-cols-3 border border-divider"
    >
      <PickerColumn title="학년">
        {tree.grades.map((grade) => (
          <PickButton
            key={grade}
            label={grade}
            current={tree.current?.grade === grade}
            selected={tree.grade === grade}
            onClick={() => tree.selectGrade(grade)}
          />
        ))}
      </PickerColumn>
      <PickerColumn title="대단원">
        {tree.chapters.map((chapter) => (
          <PickButton
            key={chapter}
            label={chapter}
            current={
              tree.current?.grade === tree.grade &&
              tree.current.chapter === chapter
            }
            selected={tree.chapter === chapter}
            onClick={() => tree.selectChapter(chapter)}
          />
        ))}
      </PickerColumn>
      <PickerColumn title="소단원">
        {tree.sections.map((unit) => (
          <PickButton
            key={unit.id}
            label={unit.section}
            current={unit.id === currentUnitId}
            selected={false}
            onClick={() => onSelect(unit.id)}
          />
        ))}
      </PickerColumn>
    </div>
  );
}

function PickerColumn({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 border-r border-divider last:border-r-0">
      <h2 className="border-b border-divider px-2 py-2 text-[10.5px] font-extrabold tracking-[1.2px] text-text-2">
        {title}
      </h2>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function PickButton({
  label,
  current,
  selected,
  onClick,
}: {
  label: string;
  current: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const tone = current
    ? "bg-g-blue text-white"
    : selected
      ? "bg-white text-ink"
      : "bg-transparent text-ink";

  return (
    <button
      type="button"
      aria-current={current ? "true" : undefined}
      onClick={onClick}
      className={`min-h-11 w-full cursor-pointer truncate px-2 text-left text-[12.5px] font-bold ${tone}`}
    >
      {label}
    </button>
  );
}
