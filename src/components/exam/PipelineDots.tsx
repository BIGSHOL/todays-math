import type { StageView } from "./viewModel";

/**
 * 4단계 파이프라인 — **색 점(7px) + 라벨, 점이 앞** (D-42 확정).
 *
 * 완료 그린 / 진행 블루 / 대기 무색.
 * 🔴 라벨(말)이 본체다. 색은 훑는 속도를 위한 보조이고, 색만으로는 아무것도 전달하지 않는다.
 *    D-44 의 "블루 금지"는 좌측 인셋 바(신뢰도)에만 적용된다 — 단계 점의 블루는 확정 표기다.
 */
const DOT: Record<StageView["state"], string> = {
  done: "bg-g-green",
  current: "bg-g-blue",
  waiting: "bg-seg-empty",
};

const TEXT: Record<StageView["state"], string> = {
  done: "text-ink",
  current: "text-g-blue font-bold",
  waiting: "text-ghost",
};

export function PipelineDots({ stages }: { stages: StageView[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] tabular-nums">
      {stages.map((s) => (
        <span
          key={s.key}
          className={`inline-flex items-center ${TEXT[s.state]}`}
        >
          <i
            aria-hidden="true"
            className={`mr-[5px] inline-block h-[7px] w-[7px] ${DOT[s.state]}`}
          />
          {s.label}
        </span>
      ))}
    </div>
  );
}
