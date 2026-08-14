import { MathText } from "@/components/math/MathText";
import { ProblemExcerpt } from "@/components/problem/ProblemExcerpt";
import { Button } from "@/components/ui/Button";
import type { ProblemEntity } from "@/contracts/problem.contract";

import { DIFFICULTY_LABEL } from "./labels";

type Props = {
  orderIndex: number;
  problem: ProblemEntity;
  onReplace?: () => void;
  replacing?: boolean;
};

const MICRO = "text-[10px] font-extrabold tracking-[1.2px] text-[#6A6A68]";

export function ReviewProblemCard({
  orderIndex,
  problem,
  onReplace,
  replacing,
}: Props) {
  const solution = problem.solution?.trim() ?? "";

  return (
    <article
      aria-label={`문 ${orderIndex}`}
      className="grid grid-cols-[auto_1px_minmax(0,1fr)_auto] items-stretch gap-x-4 border-b border-[#C2C2C0] bg-white px-6 py-4"
    >
      <div className="self-start">
        <p className="text-[24px] font-black tabular-nums text-[#161616]">
          문 {orderIndex}
        </p>
        <p className={`mt-1 ${MICRO}`}>
          <span>{DIFFICULTY_LABEL[problem.difficulty]}</span>
          <span className="ml-2">{problem.problemType}</span>
        </p>
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        className="bg-[#C2C2C0]"
      />
      <details className="min-w-0">
        <summary className="list-none [&::-webkit-details-marker]:hidden">
          <ProblemExcerpt problem={problem} className="leading-relaxed" />
        </summary>
        <div className="mt-3 border-t border-[#C2C2C0] pt-3">
          <section>
            <h3 className={MICRO}>답</h3>
            <MathText
              as="div"
              className="mt-1 text-[12.5px] leading-relaxed"
              text={problem.answer}
            />
          </section>
          <section className="mt-3">
            <h3 className={MICRO}>해설</h3>
            {solution ? (
              <MathText
                as="div"
                className="mt-1 text-[12.5px] leading-relaxed"
                text={solution}
              />
            ) : (
              <p className="mt-1 text-[12.5px] text-[#6A6A68]">해설 없음</p>
            )}
          </section>
        </div>
      </details>
      {onReplace ? (
        <Button
          variant="ghost"
          className="shrink-0 self-start"
          disabled={replacing}
          onClick={onReplace}
        >
          교체
        </Button>
      ) : null}
    </article>
  );
}
