"use client";

import { memo } from "react";

import { MathText } from "@/components/math/MathText";
import { ProblemExcerpt } from "@/components/problem/ProblemExcerpt";
import { Button } from "@/components/ui/Button";
import type { ProblemEntity } from "@/contracts/problem.contract";
import { splitSolutionSteps } from "@/lib/solutionSteps";

import { DIFFICULTY_LABEL } from "./labels";

type Props = {
  orderIndex: number;
  problem: ProblemEntity;
  onReplace?: (orderIndex: number) => void;
  replacing?: boolean;
};

const MICRO = "text-[10px] font-extrabold tracking-[1.2px] text-text-2";

/**
 * `memo` 인 이유: 검수는 한 화면에 최대 30카드이고 카드마다 본문·답·해설 KaTeX
 * 조판이 붙는다. 확정 진행 상태·오류 문구처럼 카드와 무관한 상태가 바뀔 때
 * 전 카드를 다시 조판할 이유가 없다.
 *
 * 답·해설은 **오른쪽에 상시 표시**한다 (2026-08-21 원장님 확정 — 문제 본문 폭은
 * 「인쇄와 동일」 원칙으로 고정이라 오른쪽이 비어 있었고, 검수는 어차피 답·해설을
 * 보는 일이라 펼침 클릭이 매 문항 손품이었다). 예전 `<details>` 지연 조판은
 * 상시 표시로 역할이 끝나 걷어냈다 — 이제 보이는 것만 조판한다.
 */
export const ReviewProblemCard = memo(function ReviewProblemCard({
  orderIndex,
  problem,
  onReplace,
  replacing,
}: Props) {
  const solution = problem.solution?.trim() ?? "";

  return (
    <article
      aria-label={`문 ${orderIndex}`}
      className="grid grid-cols-[auto_1px_auto_minmax(0,1fr)_auto] items-stretch gap-x-4 border-b border-divider bg-white px-6 py-4"
    >
      <div className="self-start">
        <p className="text-[24px] font-black tabular-nums text-ink">
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
      <ProblemExcerpt problem={problem} className="leading-relaxed" />
      <aside
        aria-label="답과 해설"
        className="min-w-0 self-start border-l border-divider pl-4"
      >
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
            // 해설은 DB 에 개행이 없어 한 줄 벽이 된다 — 표시할 때 잃어버린
            // 줄 경계를 되찾는다 (splitSolutionSteps, 데이터는 그대로).
            <div className="mt-1 space-y-1">
              {splitSolutionSteps(solution).map((step, i) => (
                <MathText
                  key={i}
                  as="div"
                  className="text-[12.5px] leading-relaxed"
                  text={step}
                />
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[12.5px] text-text-2">해설 없음</p>
          )}
        </section>
      </aside>
      {onReplace ? (
        <Button
          variant="ghost"
          className="shrink-0 self-start"
          disabled={replacing}
          onClick={() => onReplace(orderIndex)}
        >
          교체
        </Button>
      ) : null}
    </article>
  );
});
