"use client";

import { memo, useState } from "react";

import { MathText } from "@/components/math/MathText";
import { PaperProblemView } from "@/components/print/PaperProblemView";
import type { ProblemEntity } from "@/contracts/problem.contract";

import { DIFFICULTY_LABEL, REVIEW_STATUS_LABEL } from "./labels";

/** 마이크로 라벨 — 검수 카드(`ReviewProblemCard`)와 같은 규격을 쓴다. */
const MICRO = "text-[10px] font-extrabold tracking-[1.2px]";

/**
 * 검수 상태에 기능색을 쓴다 (원장님 확정 2026-08-18 "검수 상태에도 색을 써서 더 명확하게").
 * G2 네 의미에 그대로 대응한다 — 승인=끝난 단계, 대기=입력 대기, 반려=경고.
 * 면색이 아니라 **글자색**이라 색 쓰는 자리가 늘지 않는다.
 */
const REVIEW_STATUS_TONE: Record<string, string> = {
  approved: "text-g-green",
  pending: "text-g-yellow-text",
  rejected: "text-g-red-text",
};

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
    // 배경이 원색 화이트로 바뀌어(2026-08-18) 흰 카드가 바탕에 묻힌다. 카드 경계는
    // 이제 그림자가 아니라 **테두리**가 만든다 — 원장님 지시 "문제마다 테두리 주면 구분될듯".
    // 색은 앱의 다른 경계선과 같은 토큰(--divider)을 쓴다. slate-200(#e2e8f0)은
    // 흰 바탕에서 거의 안 보였다.
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-divider bg-surface print:mb-4 print:block print:h-auto print:rounded-none print:border-none print:shadow-none">
      {/* 머리 띠는 면색이 아니라 1px 룰로 가른다 — 흰 바탕에서 옅은 회색 띠는
          구조가 아니라 얼룩으로 읽힌다. Q 배지는 잉크라 화면과 인쇄가 같아진다. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-divider px-6 py-4 print:px-0">
        <span className="flex h-8 w-8 items-center justify-center bg-ink text-lg font-bold text-bg print:bg-black">
          Q
        </span>
        <span className="font-semibold text-text-2">문제</span>
        {/* 난이도·유형·상태는 **마이크로 라벨**이다 (05 §8.6 확정, 원장님 재확인 2026-08-18).
            알약 칩은 면색을 세 개 더 만들어 팔레트를 흐린다. 위계는 글자 명도로 낸다. */}
        <span className={`ml-auto flex flex-wrap items-center gap-3 ${MICRO}`}>
          <span className="text-ink">
            {DIFFICULTY_LABEL[problem.difficulty]}
          </span>
          <span className="text-text-2">{problem.problemType}</span>
          <span
            data-review-status={problem.reviewStatus}
            className={REVIEW_STATUS_TONE[problem.reviewStatus]}
          >
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
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 border border-control bg-surface px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-side"
          >
            {showSolution ? "정답 및 해설 숨기기" : "정답 및 해설 확인"}
          </button>
        </div>

        {showSolution ? (
          <div className="mt-4 space-y-4">
            {/* 「정답」은 G2 네 의미가 아니다 — 초록을 쓰면 게이지의 「끝난 단계」와 뜻이 충돌한다.
                지면의 핵심 개념 박스처럼 **왼쪽 굵은 바**로 표시한다. */}
            <div className="border-l-[3px] border-ink bg-side p-6">
              <h4 className={`mb-2 ${MICRO}`}>정답</h4>
              <MathText
                as="div"
                className="text-lg font-medium text-ink"
                text={problem.answer}
              />
            </div>
            {problem.solution ? (
              <div className="border border-divider p-6">
                <h4 className={`mb-2 ${MICRO}`}>상세 풀이</h4>
                <MathText
                  as="div"
                  className="text-base leading-relaxed text-text-2"
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
