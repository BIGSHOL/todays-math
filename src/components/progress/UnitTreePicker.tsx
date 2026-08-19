"use client";

import type { ReactNode } from "react";

import { useUnitTree } from "@/hooks/useUnitTree";
import type { UnitNode } from "@/lib/units/groupUnits";

type UnitTreePickerProps = {
  units: UnitNode[];
  currentUnitId: string | null;
  onSelect: (unitId: string) => void;
  /**
   * 접근성 이름. 한 화면에 피커가 둘 이상이면(확인테스트 범위의 시작·끝) 같은 이름이
   * 겹쳐 무엇을 고르는 자리인지 읽히지 않는다. 기본값은 진도 화면(S-07)이 쓰던 그대로다.
   */
  label?: string;
  /**
   * 열 하나의 최대 높이(px). 넘으면 그 열만 스크롤한다.
   *
   * 진도 화면(S-07)에서는 피커가 **본문**이라 제한이 없다(기본값). 폼 안에 넣으면
   * 이야기가 다르다 — 학년 열이 16행(초1~미적분2)이라 피커 하나가 750px 이 넘고,
   * 그 아래 필드가 통째로 화면 밖으로 밀려난다. 그때만 이 값을 준다.
   */
  columnMaxHeightPx?: number;
};

export function UnitTreePicker({
  units,
  currentUnitId,
  onSelect,
  label = "단원 선택",
  columnMaxHeightPx,
}: UnitTreePickerProps) {
  const tree = useUnitTree(units, currentUnitId);

  return (
    <div
      role="group"
      aria-label={label}
      className="grid grid-cols-3 border border-divider"
    >
      <PickerColumn title="학년" maxHeightPx={columnMaxHeightPx}>
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
      <PickerColumn title="대단원" maxHeightPx={columnMaxHeightPx}>
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
      <PickerColumn title="소단원" maxHeightPx={columnMaxHeightPx}>
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
  maxHeightPx,
}: {
  title: string;
  children: ReactNode;
  maxHeightPx?: number;
}) {
  return (
    <section className="min-w-0 border-r border-divider last:border-r-0">
      <h2 className="border-b border-divider px-2 py-2 text-[10.5px] font-extrabold tracking-[1.2px] text-text-2">
        {title}
      </h2>
      <div
        className="flex flex-col"
        style={
          maxHeightPx
            ? { maxHeight: maxHeightPx, overflowY: "auto" }
            : undefined
        }
      >
        {children}
      </div>
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
