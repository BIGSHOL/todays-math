import { MathText } from "@/components/math/MathText";
import { Button } from "@/components/ui/Button";
import type { ProblemEntity } from "@/contracts/problem.contract";

import { DIFFICULTY_LABEL } from "./labels";

type Props = {
  orderIndex: number;
  problem: ProblemEntity;
  onReplace?: () => void;
  replacing?: boolean;
};

export function ProblemCard({
  orderIndex,
  problem,
  onReplace,
  replacing,
}: Props) {
  return (
    <article
      aria-label={`문 ${orderIndex}`}
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-4 border-b border-[#C2C2C0] bg-white px-6 py-4"
    >
      <div>
        <p className="text-[24px] font-black tabular-nums text-[#161616]">
          문 {orderIndex}
        </p>
        <p className="mt-1 text-[10px] font-extrabold tracking-[1.2px] text-[#6A6A68]">
          <span>{DIFFICULTY_LABEL[problem.difficulty]}</span>
          <span className="ml-2">{problem.problemType}</span>
        </p>
      </div>
      <MathText
        text={problem.content}
        as="div"
        className="min-w-0 text-[12.5px] leading-relaxed"
      />
      {onReplace ? (
        <Button
          variant="ghost"
          className="shrink-0"
          disabled={replacing}
          onClick={onReplace}
        >
          교체
        </Button>
      ) : null}
    </article>
  );
}
