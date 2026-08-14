import type { ClassRow } from "@/lib/main/pipeline";

import { ActionControl } from "./ActionControl";
import { StageGauge } from "./StageGauge";

type Props = {
  rows: ClassRow[];
  onProgress: (classId: string) => void;
};

export function LedgerTable({ rows, onProgress }: Props) {
  return (
    <div className="px-6 pt-1.5">
      <table className="w-full border-collapse text-xs tabular-nums">
        <thead>
          <tr>
            {["반", "현재 진도", "오늘", "내일 테스트", "작업"].map((h) => (
              <th
                key={h}
                scope="col"
                className="border-b-[2.5px] border-ink px-2.5 py-2 text-left text-[10px] font-black tracking-[1.5px] text-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.classId}>
              <td className="border-b border-divider px-2.5 py-2.5 text-[13px] font-black">
                {row.name}
              </td>
              <td className="border-b border-divider px-2.5 py-2.5">
                {row.unitLabel}
              </td>
              <td className="border-b border-divider px-2.5 py-2.5">
                <StageGauge stage={row.stage} compact />
              </td>
              <td className="border-b border-divider px-2.5 py-2.5">
                {/* 자동 준비 스케줄러는 없다(반자동, D-32 후속). 진도가 있으면 그 차시를
                    원장이 직접 출제하는 흐름이므로 "직접 출제"로 정직하게 표기한다. */}
                {row.hasProgress ? "직접 출제" : "다음 단원 시작"}
              </td>
              <td className="border-b border-divider px-2.5 py-2.5">
                <ActionControl row={row} onProgress={onProgress} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
