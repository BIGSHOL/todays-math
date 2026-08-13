import {
  STAGE_LABELS,
  stageCurrentIndex,
  type PipelineStage,
} from "@/lib/main/pipeline";

type Props = {
  stage: PipelineStage;
  compact?: boolean;
  waiting?: boolean;
};

export function StageGauge({ stage, compact = false, waiting = false }: Props) {
  const current = stageCurrentIndex(stage);

  return (
    <div
      role="group"
      aria-label="진도 단계"
      className={compact ? "w-[110px]" : "w-[232px]"}
    >
      <div
        className={`mb-1 flex ${compact ? "h-[7px] gap-[2.5px]" : "h-2 gap-[3px]"}`}
      >
        {STAGE_LABELS.map((label, i) => {
          const done = i < current;
          const cur = i === current && stage !== "done";
          return (
            <span
              key={label}
              className={`flex-1 ${
                done
                  ? "bg-g-green"
                  : cur && waiting
                    ? "bg-g-yellow"
                    : cur
                      ? "bg-g-blue"
                      : "bg-seg-empty"
              }`}
            />
          );
        })}
      </div>
      {compact ? null : (
        <div className="flex">
          {STAGE_LABELS.map((label, i) => {
            const done = i < current || stage === "done";
            const cur = i === current && stage !== "done";
            return (
              <span
                key={label}
                className={`flex-1 text-center text-[9px] font-extrabold tracking-[1.2px] ${
                  done
                    ? "text-g-green"
                    : cur && waiting
                      ? "text-g-yellow-text"
                      : cur
                        ? "text-g-blue"
                        : "text-ghost"
                }`}
              >
                {label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
