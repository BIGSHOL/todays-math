"use client";

import { useState } from "react";

import { MathText } from "@/components/math/MathText";
import { ProblemContent } from "@/components/math/ProblemContent";
import type { ProblemEntity } from "@/contracts/problem.contract";

import { DIFFICULTY_LABEL, REVIEW_STATUS_LABEL } from "./labels";

type ProblemCardProps = {
  problem: ProblemEntity;
};

/**
 * 문제 카드 — mathgen `ProblemDisplay` 레이아웃 이식.
 * Q 배지 + 문제 카드 + 보기 그리드 + 정답·해설 토글.
 *
 * D-30: 카드 자체는 클릭 대상이 아니다. 펼침은 실제 <button> 컨트롤만 담당한다.
 */
export function ProblemCard({ problem }: ProblemCardProps) {
  const [showSolution, setShowSolution] = useState(false);

  return (
    <article className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:mb-4 print:rounded-none print:border-none print:shadow-none">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-6 py-4 print:bg-transparent print:px-0">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-lg font-bold text-white print:bg-black">
          Q
        </span>
        <span className="font-semibold text-slate-700">문제</span>
        <span className="ml-auto flex flex-wrap gap-2">
          <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold tracking-wide text-indigo-700">
            {DIFFICULTY_LABEL[problem.difficulty]}
          </span>
          <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
            {problem.problemType}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
            {REVIEW_STATUS_LABEL[problem.reviewStatus]}
          </span>
        </span>
      </div>

      <div className="p-6 print:px-0">
        <ProblemContent
          content={problem.content}
          figureUrls={problem.figureUrls}
          className="text-lg text-slate-800 print:text-black"
        />

        <div className="mt-6 flex justify-end print:hidden">
          <button
            type="button"
            aria-expanded={showSolution}
            onClick={() => setShowSolution((current) => !current)}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            {showSolution ? "정답 및 해설 숨기기" : "정답 및 해설 확인"}
          </button>
        </div>

        {showSolution ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-green-100 bg-green-50 p-6">
              <h4 className="mb-2 font-bold text-green-800">정답</h4>
              <MathText
                as="div"
                className="text-lg font-medium text-green-900"
                text={problem.answer}
              />
            </div>
            {problem.solution ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6">
                <h4 className="mb-2 font-semibold text-slate-700">상세 풀이</h4>
                <MathText
                  as="div"
                  className="text-base leading-relaxed text-slate-700"
                  text={problem.solution}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
