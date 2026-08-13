import { formatMastheadDate } from "@/lib/main/pipeline";

type Props = {
  remaining: number;
  view: "stack" | "ledger";
  onToggle: () => void;
};

export function Masthead({ remaining, view, onToggle }: Props) {
  return (
    <header className="flex items-baseline gap-4 border-b-[3px] border-ink px-7 py-3.5">
      <span className="text-[19px] font-black tracking-[-0.5px]">
        오늘의수학
      </span>
      <span className="text-[11.5px] tabular-nums text-muted">
        {formatMastheadDate()}
      </span>
      <span
        className={`text-[11.5px] font-black ${
          remaining > 0 ? "text-g-red" : "text-ink"
        }`}
      >
        {remaining > 0 ? `남은 작업 ${remaining}` : "오늘 완료"}
      </span>
      <div className="ml-auto flex items-center gap-5 text-[11.5px] font-bold text-[#5c5c5a]">
        <button
          type="button"
          onClick={onToggle}
          className="bg-ink px-2.5 py-0.5 text-[10.5px] font-extrabold text-canvas"
        >
          {view === "stack" ? "전체 표 ⇄" : "오늘 작업 ⇄"}
        </button>
        <span>문제은행</span>
        <span>반 관리</span>
        <span>설정</span>
      </div>
    </header>
  );
}
