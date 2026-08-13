import { MAIN_ROW_GRID, type ClassRow } from "@/lib/main/pipeline";

import { StageGauge } from "./StageGauge";

export function DoneSummaryRow({ row }: { row: ClassRow }) {
  return (
    <div
      role="status"
      aria-label={`${row.name} 완료`}
      className={`${MAIN_ROW_GRID} py-2.5 text-[11px] font-bold text-faint`}
    >
      <span />
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
        {row.name} — {row.meta}
      </span>
      <StageGauge stage="done" />
      <span className="text-center">완료</span>
    </div>
  );
}
