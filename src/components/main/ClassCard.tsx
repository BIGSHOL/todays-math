import { MAIN_ROW_GRID, type ClassRow } from "@/lib/main/pipeline";

import { ActionControl } from "./ActionControl";
import { StageGauge } from "./StageGauge";

type Props = {
  row: ClassRow;
  index: number;
  hot: boolean;
  onProgress: (classId: string) => void;
};

export function ClassCard({ row, index, hot, onProgress }: Props) {
  const waiting = row.stage === "progress";

  return (
    <article
      aria-label={row.name}
      onClick={() => onProgress(row.classId)}
      className={`${MAIN_ROW_GRID} cursor-pointer border-b border-divider py-3 ${
        hot ? "bg-white shadow-[inset_5px_0_0_#1A73E8]" : ""
      } ${waiting ? "opacity-[0.78]" : ""}`}
    >
      <span
        className={`text-2xl font-black tabular-nums leading-none ${
          hot ? "text-g-blue" : "text-[#c6c6c4]"
        }`}
      >
        {index}
      </span>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 overflow-hidden whitespace-nowrap">
          <span className="shrink-0 text-[15px] font-black tracking-[-0.3px]">
            {row.name}
          </span>
          {row.testTypeLabel ? (
            <span className="shrink-0 text-[10.5px] font-bold text-faint">
              {row.testTypeLabel}
            </span>
          ) : null}
        </div>
        <div
          className={`mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] tabular-nums ${
            waiting ? "font-bold text-g-red-text" : "text-muted"
          }`}
        >
          {row.meta}
        </div>
      </div>
      <StageGauge stage={row.stage} waiting={waiting} />
      <ActionControl row={row} onProgress={onProgress} />
    </article>
  );
}
