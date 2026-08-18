"use client";

import { memo, useState } from "react";

import { MathText } from "@/components/math/MathText";
import { PaperProblemView } from "@/components/print/PaperProblemView";
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
 *
 * `memo` 인 이유: 문제은행은 한 페이지에 20카드이고 카드마다 본문·보기의 KaTeX
 * 조판이 붙는다. 그런데 패널 열기/닫기·안내 문구·오류 문구·단원 목록 도착처럼
 * **카드와 무관한 상태** 하나만 바뀌어도 20카드가 전부 다시 렌더됐다.
 * `problem` 은 API 응답 객체 그대로라 이런 렌더에서 참조가 바뀌지 않는다.
 */
export const ProblemCard = memo(function ProblemCard({
  problem,
}: ProblemCardProps) {
  const [showSolution, setShowSolution] = useState(false);

  return (
    // 카드 사이 간격은 목록 그리드의 gap 이 준다(`ProblemBank`). 화면에서 `mb-6` 을
    // 같이 걸면 세로 간격만 두 배가 된다. 인쇄는 그리드를 쓰지 않으므로 `print:mb-4` 유지.
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:mb-4 print:block print:h-auto print:rounded-none print:border-none print:shadow-none">
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

      <div className="flex flex-1 flex-col overflow-x-auto p-6 print:block print:px-0">
        <PaperProblemView
          content={problem.content}
          figureUrls={problem.figureUrls}
        />

        <div className="mt-auto flex justify-end pt-6 print:hidden">
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
});
