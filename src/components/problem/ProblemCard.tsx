import type { ProblemEntity } from "@/contracts/problem.contract";

import { DIFFICULTY_LABEL, REVIEW_STATUS_LABEL } from "./labels";
import { ProblemExcerpt } from "./ProblemExcerpt";

type ProblemCardProps = {
  problem: ProblemEntity;
};

export function ProblemCard({ problem }: ProblemCardProps) {
  return (
    <article className="border-b border-[#C2C2C0] py-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[10.5px] font-black tracking-[1.5px] text-[#6A6A68]">
          {DIFFICULTY_LABEL[problem.difficulty]}
        </span>
        <span className="text-[10.5px] font-black tracking-[1.5px] text-[#6A6A68]">
          {problem.problemType}
        </span>
        <span className="text-[10.5px] font-black tracking-[1.5px] text-[#8A8A88]">
          {REVIEW_STATUS_LABEL[problem.reviewStatus]}
        </span>
      </div>
      <ProblemExcerpt problem={problem} className="mt-2" />
    </article>
  );
}
