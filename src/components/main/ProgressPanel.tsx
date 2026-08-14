import type { ClassEntity } from "@/contracts/class.contract";
import type { UnitEntity } from "@/contracts/unit.contract";

import { adjacentUnitIds, unitSectionName } from "@/lib/main/unitLookup";

type Props = {
  classes: ClassEntity[];
  units: readonly Pick<UnitEntity, "id" | "section" | "orderIndex">[];
  selectedClassId: string;
  selectedUnitId: string | null;
  printedDays: number;
  unmodifiedRate: number;
  error: string | null;
  onSelectClass: (classId: string) => void;
  onStep: (unitId: string) => void;
};

const ARROW =
  "inline-flex min-h-11 min-w-[44px] items-center justify-center border-2 border-ink text-[14px] font-black";

export function ProgressPanel({
  classes,
  units,
  selectedClassId,
  selectedUnitId,
  printedDays,
  unmodifiedRate,
  error,
  onSelectClass,
  onStep,
}: Props) {
  const lesson = unitSectionName(selectedUnitId, units);
  const { prevId, nextId } = adjacentUnitIds(selectedUnitId, units);

  return (
    <aside className="w-[250px] shrink-0 border-l-[3px] border-ink bg-side px-5 py-4">
      <h2 className="mb-2 border-t-[3px] border-ink pt-1.5 text-[10.5px] font-black tracking-[2.5px]">
        진도 입력
      </h2>
      <div className="text-[11.5px] leading-[2.1] text-[#4a4a48]">
        <label className="block">
          <span className="sr-only">반 선택</span>
          <select
            aria-label="반 선택"
            value={selectedClassId}
            onChange={(e) => onSelectClass(e.target.value)}
            className="w-full cursor-pointer bg-transparent font-bold text-ink"
          >
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {cls.name}
              </option>
            ))}
          </select>
        </label>
        <span
          aria-label="현재 소단원"
          className={`mt-0.5 mb-2 block text-[13.5px] font-black ${
            lesson === "—" ? "text-faint" : "text-ink"
          }`}
        >
          {lesson}
        </span>
        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            aria-label="이전 차시"
            disabled={!prevId}
            onClick={() => {
              if (prevId) onStep(prevId);
            }}
            className={`${ARROW} cursor-pointer disabled:cursor-not-allowed disabled:opacity-40`}
          >
            &lt;
          </button>
          <span className="min-w-0 flex-1 text-center text-[10.5px] font-black tracking-[1.2px]">
            차시이동
          </span>
          <button
            type="button"
            aria-label="다음 차시"
            disabled={!nextId}
            onClick={() => {
              if (nextId) onStep(nextId);
            }}
            className={`${ARROW} cursor-pointer disabled:cursor-not-allowed disabled:opacity-40`}
          >
            &gt;
          </button>
        </div>
        {error ? <p className="mt-2 text-g-red-text">{error}</p> : null}
      </div>
      <h3 className="mt-5 mb-2 border-t-[3px] border-ink pt-1.5 text-[10.5px] font-black tracking-[2.5px]">
        이번 주
      </h3>
      <div className="flex gap-[18px]">
        <div>
          <div className="text-[26px] font-black leading-none tabular-nums text-g-blue">
            {printedDays}
          </div>
          <div className="mt-1 text-[9.5px] font-extrabold tracking-[1.2px] text-faint">
            출제 일수
          </div>
        </div>
        <div>
          <div className="text-[26px] font-black leading-none tabular-nums text-g-blue">
            {unmodifiedRate}
            <small className="text-[13px] font-extrabold text-faint">%</small>
          </div>
          <div className="mt-1 text-[9.5px] font-extrabold tracking-[1.2px] text-faint">
            무수정
          </div>
        </div>
      </div>
    </aside>
  );
}
