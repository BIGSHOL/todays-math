"use client";

import Link from "next/link";

import { Button } from "@/components/ui/Button";

import { ReviewProblemCard } from "./ReviewProblemCardLazy";
import { useTestReview } from "./useTestReview";

type Props = {
  testId: string;
};

export function TestReview({ testId }: Props) {
  const {
    state,
    replace,
    confirm,
    replacingSeq,
    confirming,
    replacedCount,
    actionError,
  } = useTestReview(testId);

  if (state.status === "loading") {
    return (
      <main className="px-8 py-6">
        <p className="text-[12.5px] text-[#6A6A68]">불러오는 중</p>
      </main>
    );
  }

  if (state.status === "notfound") {
    return (
      <main className="px-8 py-6">
        <p className="text-[12.5px]">테스트를 찾을 수 없습니다</p>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="px-8 py-6">
        <p className="text-[12.5px] text-[#C5221F]">{state.message}</p>
      </main>
    );
  }

  const draft = state.test.status === "draft";

  return (
    <div className="flex min-h-[calc(100vh-52px)] flex-col">
      <main className="flex-1 pb-20">
        <div className="flex items-baseline justify-between px-8 py-4">
          <h1 className="text-[15px] font-black">검수</h1>
          <p className="text-[11.5px] text-[#6A6A68] tabular-nums">
            {state.problems.length}문항
          </p>
        </div>
        <div>
          {state.problems.map((item) => (
            <ReviewProblemCard
              key={item.id}
              orderIndex={item.orderIndex}
              problem={item.problem}
              replacing={replacingSeq !== null}
              onReplace={
                draft ? () => void replace(item.orderIndex) : undefined
              }
            />
          ))}
        </div>
      </main>
      <footer className="sticky bottom-0 flex items-center gap-4 border-t border-[#C2C2C0] bg-[#ECECEA] px-8 py-3">
        <span className="text-[11.5px] text-[#6A6A68] tabular-nums">
          교체 {replacedCount}
        </span>
        {actionError ? (
          <p role="alert" className="text-[11.5px] font-bold text-[#C5221F]">
            {actionError}
          </p>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ink"
            disabled={!draft || confirming}
            onClick={() => void confirm()}
          >
            확정
          </Button>
          {draft ? (
            <Button variant="ghost" disabled>
              인쇄
            </Button>
          ) : (
            <Link
              href={`/tests/${testId}/print`}
              className="inline-flex min-h-11 min-w-[44px] items-center justify-center px-3 text-[12.5px] font-bold text-[#161616] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A73E8]"
            >
              인쇄
            </Link>
          )}
        </div>
      </footer>
    </div>
  );
}
