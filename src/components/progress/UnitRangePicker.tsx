"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { scrollDeltaToReveal } from "@/components/progress/revealWithin";
import { useUnitTree } from "@/hooks/useUnitTree";
import type { UnitNode } from "@/lib/units/groupUnits";

/**
 * **범위를 한 피커에서 두 번 눌러 고른다** (달력의 기간 선택과 같은 손놀림).
 *
 * 시작·끝을 각각 다른 피커로 두면 같은 3열 표가 두 벌이 되고, 학년 열이 16행
 * (초1~미적분2)이라 폼 아래가 통째로 화면 밖으로 밀려난다. 한 벌이면 높이가 반이고
 * 「어느 쪽 피커를 보고 있었지」도 사라진다.
 *
 * 손놀림:
 *   1. 소단원을 누르면 그것이 **시작**이 되고 안내가 「끝을 고르세요」로 바뀐다.
 *   2. 다시 누르면 **끝**이 된다. 시작보다 앞을 누르면 그것이 새 시작이 된다
 *      (거꾸로 된 범위를 만들지 않는다 — `resolveRange` 가 정렬해 버려서
 *       엉뚱한 범위가 조용히 나가는 자리다).
 *   3. 범위 안 소단원은 옅은 면으로 이어 보여 준다. 학년·대단원 열도 그 범위에
 *      걸친 항목을 같은 옅은 면으로 표시해, 열을 옮겨도 범위가 안 보이지 않게 한다.
 */
export type UnitRangePickerProps = {
  units: UnitNode[];
  startUnitId: string | null;
  endUnitId: string | null;
  /** 두 번째 클릭으로 범위가 완성되면 (시작, 끝) 을 한 번에 알린다. */
  onChange: (startUnitId: string, endUnitId: string) => void;
  /** 첫 클릭(=시작만 정해진 상태)도 알린다 — 화면 요약을 함께 움직이려는 것. */
  onPickStart?: (startUnitId: string) => void;
  label?: string;
  columnMaxHeightPx?: number;
  /**
   * 범위를 잡는 손놀림.
   *
   * · `sequential` — 한 번 누르면 시작, 다시 누르면 끝(달력 기간 선택과 같다).
   *   배울 것이 없지만 「끝만 하나 당기기」에 두 번이 든다.
   * · `left-right` — **좌클릭이 시작, 우클릭이 끝**. 모드가 없어 어느 쪽이든 바로
   *   고친다. 대신 우클릭은 브라우저 기본 메뉴를 막아야 하고 터치·키보드에는 없다 —
   *   그래서 **Shift+클릭도 끝으로** 함께 받는다.
   */
  mode?: "sequential" | "left-right";
};

export function UnitRangePicker({
  units,
  startUnitId,
  endUnitId,
  onChange,
  onPickStart,
  label = "범위 선택",
  columnMaxHeightPx = 260,
  mode = "sequential",
}: UnitRangePickerProps) {
  // 「끝을 고르는 중」은 별도 상태가 아니라 **시작과 끝이 같은가**로 읽는다.
  // 상태를 하나 더 두면 바깥에서 값을 바꿨을 때(기본 범위 다시 불러오기 등)
  // 두 개가 어긋난다.
  const pickingEnd = Boolean(startUnitId) && startUnitId === endUnitId;

  const tree = useUnitTree(units, endUnitId ?? startUnitId);
  const byId = new Map(units.map((u) => [u.id, u]));
  const start = startUnitId ? byId.get(startUnitId) : undefined;
  const end = endUnitId ? byId.get(endUnitId) : undefined;
  const [lo, hi] =
    start && end
      ? start.orderIndex <= end.orderIndex
        ? [start.orderIndex, end.orderIndex]
        : [end.orderIndex, start.orderIndex]
      : [Number.NaN, Number.NaN];

  const inRange = (unit: UnitNode) =>
    !Number.isNaN(lo) && unit.orderIndex >= lo && unit.orderIndex <= hi;
  /** 그 학년/대단원에 범위에 걸친 소단원이 하나라도 있는가. */
  const groupTouched = (predicate: (unit: UnitNode) => boolean) =>
    units.some((unit) => predicate(unit) && inRange(unit));

  /**
   * **학년·대단원 열을 누르면 그 무리 전체가 범위가 된다**
   * (원장님 확정 2026-08-19 「학년 전체 그렇게 해」).
   *
   * 종전에는 열이 **이동만** 했다. 그래서 「중2 전체」를 보려면 그 학년의 첫 소단원과
   * 끝 소단원을 찾아 두 번 눌러야 했다 — 문제은행이 계단식 드롭다운을 걷어내면서
   * 잃은 손놀림이 그것이다(D-60).
   *
   * ⚠️ 이동도 **같이** 한다. 그냥 두면 다음 렌더에서 `endUnitId` 기준으로 열이
   *    다시 잡혀 **그 학년의 마지막 대단원**이 열린다 — 누른 곳과 다른 데가 펼쳐진다.
   *    그래서 바뀐 뒤의 현재 단원(`last.id`)으로 이동을 저장한다.
   *
   * ⚠️ 순서는 `orderIndex` 로 정한다. `units` 배열 순서에 기대면 목록을 정렬해 주는
   *    쪽이 바뀌는 날 조용히 다른 범위가 된다.
   */
  const pickGroup = (
    inGroup: (unit: UnitNode) => boolean,
    move: (lastId: string) => void,
  ) => {
    const members = units
      .filter(inGroup)
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex);
    const first = members[0];
    const last = members[members.length - 1];
    if (!first || !last) return;
    move(last.id);
    onPickStart?.(first.id);
    onChange(first.id, last.id);
  };

  const pickSequential = (unitId: string) => {
    const picked = byId.get(unitId);
    if (!picked) return;
    if (!pickingEnd || !start) {
      onPickStart?.(unitId);
      onChange(unitId, unitId);
      return;
    }
    if (picked.orderIndex < start.orderIndex) {
      // 시작보다 앞을 눌렀다 — 그것을 새 시작으로 본다.
      onPickStart?.(unitId);
      onChange(unitId, unitId);
      return;
    }
    onChange(start.id, unitId);
  };

  /** 좌클릭 = 시작. 끝보다 뒤를 고르면 끝도 그리로 당겨 **거꾸로 만들지 않는다**. */
  const setStart = (unitId: string) => {
    const picked = byId.get(unitId);
    if (!picked) return;
    if (!end || picked.orderIndex > end.orderIndex) {
      onPickStart?.(unitId);
      onChange(unitId, unitId);
      return;
    }
    onChange(unitId, end.id);
  };

  /** 우클릭(또는 Shift+클릭) = 끝. 시작보다 앞이면 시작을 그리로 당긴다. */
  const setEnd = (unitId: string) => {
    const picked = byId.get(unitId);
    if (!picked) return;
    if (!start || picked.orderIndex < start.orderIndex) {
      onPickStart?.(unitId);
      onChange(unitId, unitId);
      return;
    }
    onChange(start.id, unitId);
  };

  const pick = (unitId: string, wantsEnd: boolean) => {
    if (mode === "sequential") {
      pickSequential(unitId);
      return;
    }
    if (wantsEnd) setEnd(unitId);
    else setStart(unitId);
  };

  return (
    <div className="grid gap-1">
      {/*
        조작 안내는 **피커 우상단**에 둔다 — 눈이 표로 가기 직전에 지나는 자리다.
        `aria-live` 를 두는 이유: 「시작 → 끝」으로 바뀌는 것이 **글자 하나뿐**이라
        화면을 안 보는 사람에게는 아무 일도 안 일어난 것과 같다(보이는 것은 그대로다).
      */}
      <p
        aria-live="polite"
        className="flex justify-end gap-2 text-[10.5px] font-bold tracking-normal text-text-3"
      >
        {mode === "left-right" ? (
          <>
            <span>
              <span className="text-ink">좌클릭</span> 시작
            </span>
            <span aria-hidden>·</span>
            <span>
              <span className="text-ink">우클릭</span> 끝
            </span>
            <span aria-hidden>·</span>
            <span>Shift+클릭도 끝</span>
          </>
        ) : (
          <span>
            {pickingEnd
              ? "끝 소단원을 고르세요 (시작보다 앞을 누르면 시작이 바뀝니다)"
              : "시작 소단원을 고르세요"}
          </span>
        )}
      </p>
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
              selected={tree.grade === grade}
              inRange={groupTouched((unit) => unit.grade === grade)}
              onClick={() =>
                pickGroup(
                  (unit) => unit.grade === grade,
                  (lastId) => tree.selectGrade(grade, lastId),
                )
              }
            />
          ))}
        </PickerColumn>
        <PickerColumn title="대단원" maxHeightPx={columnMaxHeightPx}>
          {tree.chapters.map((chapter) => (
            <PickButton
              key={chapter}
              label={chapter}
              selected={tree.chapter === chapter}
              inRange={groupTouched(
                (unit) => unit.grade === tree.grade && unit.chapter === chapter,
              )}
              onClick={() =>
                pickGroup(
                  (unit) =>
                    unit.grade === tree.grade && unit.chapter === chapter,
                  (lastId) => tree.selectChapter(chapter, lastId),
                )
              }
            />
          ))}
        </PickerColumn>
        <PickerColumn title="소단원" maxHeightPx={columnMaxHeightPx}>
          {tree.sections.map((unit) => (
            <PickButton
              key={unit.id}
              label={unit.section}
              edge={unit.id === startUnitId || unit.id === endUnitId}
              inRange={inRange(unit)}
              selected={false}
              onClick={(wantsEnd) => pick(unit.id, wantsEnd)}
            />
          ))}
        </PickerColumn>
      </div>
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
  edge = false,
  inRange = false,
  selected,
  onClick,
}: {
  label: string;
  /** 범위의 시작 또는 끝 — 진한 면. */
  edge?: boolean;
  /** 범위 안 — 옅은 면. */
  inRange?: boolean;
  /** 지금 열려 있는 열(학년·대단원) — 면 없이 글자만 진하게. */
  selected: boolean;
  /** `wantsEnd` 는 우클릭·Shift+클릭이었는지 — 「끝」을 뜻한다. */
  onClick: (wantsEnd: boolean) => void;
}) {
  const tone = edge
    ? "bg-g-blue text-white"
    : inRange
      ? "bg-[#DCE9FB] text-ink"
      : selected
        ? "bg-side text-ink"
        : "bg-transparent text-ink";

  /**
   * 열에 높이 상한이 걸려 있으므로 **지금 고른 것이 창 밖에 있을 수 있다.**
   * 학년 열은 16행(초1~미적분2)인데 창은 6행쯤이라, 중2 를 고른 채 열면 화면에는
   * 초1~초6 만 보이고 「아무것도 안 골라진 것」처럼 읽힌다. 열릴 때 끌어다 놓는다.
   *
   * 🔴 **`scrollIntoView` 를 쓰지 않는다.** 그것은 스크롤 가능한 조상 **전부**를
   *    굴린다 — 문서까지. 펼침 패널이 화면 아래에 걸쳐 있으면 페이지가 통째로 튀고,
   *    그건 이 작업이 고치려던 「스크롤이 강제된다」 바로 그 증상이다
   *    (적대적 리뷰 2026-08-19). 여기서는 **열 상자의 `scrollTop` 만** 건드린다.
   */
  const ref = useRef<HTMLButtonElement>(null);
  const shouldReveal = edge || selected;
  useEffect(() => {
    if (!shouldReveal) return;
    const node = ref.current;
    const container = node?.parentElement;
    if (!node || !container) return;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const delta = scrollDeltaToReveal({
      containerTop: containerRect.top,
      containerHeight: containerRect.height,
      nodeTop: nodeRect.top,
      nodeHeight: nodeRect.height,
    });
    if (delta !== 0) container.scrollTop += delta;
  }, [shouldReveal]);

  return (
    <button
      ref={ref}
      type="button"
      aria-current={edge ? "true" : undefined}
      onClick={(event) => onClick(event.shiftKey)}
      onContextMenu={(event) => {
        // 브라우저 기본 메뉴를 막고 「끝」으로 받는다. 이 한 줄이 없으면
        // 우클릭은 메뉴만 띄우고 아무것도 안 고른다.
        event.preventDefault();
        onClick(true);
      }}
      className={`min-h-11 w-full cursor-pointer truncate px-2 text-left text-[12.5px] font-bold ${tone}`}
    >
      {label}
    </button>
  );
}
