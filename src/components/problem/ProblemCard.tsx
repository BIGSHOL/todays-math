import { MathText } from "@/components/math/MathText";
import type { ProblemEntity } from "@/contracts/problem.contract";

import { DIFFICULTY_LABEL, REVIEW_STATUS_LABEL } from "./labels";

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
      <MathText
        as="div"
        className="mt-2 text-[12.5px] font-normal text-[#161616]"
        text={problem.content}
      />
    </article>
  );
}
