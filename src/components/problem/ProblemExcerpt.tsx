import { MathText } from "@/components/math/MathText";
import type { ProblemEntity } from "@/contracts/problem.contract";

type ProblemExcerptProps = {
  problem: ProblemEntity;
  className?: string;
};

export function ProblemExcerpt({
  problem,
  className = "",
}: ProblemExcerptProps) {
  return (
    <MathText
      as="div"
      className={`min-w-0 overflow-visible text-[12.5px] leading-relaxed font-normal text-[#161616] ${className}`}
      text={problem.content}
    />
  );
}
