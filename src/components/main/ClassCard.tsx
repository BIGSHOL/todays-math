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
      // 배경이 흰색이 되면서 `bg-white` 는 아무 일도 하지 않게 됐다(구 회색 배경 시절의
      // "hot = 흰 표면" 신호). 지금 처리 중인 반은 **왼쪽 잉크 바 + 굵은 밑선**으로 표시한다.
      //
      // ⚠️ `opacity` 로 대기 행을 흐리게 하던 것을 걷었다. 투명도는 그 행의 **모든** 색
      // 대비를 한꺼번에 깎아서, 78% 만으로도 경고 글자가 4.5:1 밑으로 내려갔다.
      // 흐림은 이제 색 자체(`text-text-3`)로만 준다 — 대비를 계산할 수 있어야 한다.
      className={`${MAIN_ROW_GRID} py-3 ${
        hot
          ? "border-b-2 border-ink shadow-[inset_5px_0_0_var(--blue)]"
          : "border-b border-divider"
      }`}
    >
      <span
        className={`text-2xl font-black tabular-nums leading-none ${
          hot ? "text-g-blue" : "text-text-3"
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
