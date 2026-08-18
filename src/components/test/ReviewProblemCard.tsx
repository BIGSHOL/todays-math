"use client";

import { memo, useState } from "react";

import { MathText } from "@/components/math/MathText";
import { ProblemExcerpt } from "@/components/problem/ProblemExcerpt";
import { Button } from "@/components/ui/Button";
import type { ProblemEntity } from "@/contracts/problem.contract";

import { DIFFICULTY_LABEL } from "./labels";

type Props = {
  orderIndex: number;
  problem: ProblemEntity;
  /**
   * 교체 핸들러. 호출부가 카드마다 화살표 함수를 새로 만들면 아래 `memo` 가
   * 매 렌더 죽으므로, 번호는 인자로 받고 함수 자체는 고정된 것을 넘기게 한다.
   */
  onReplace?: (orderIndex: number) => void;
  replacing?: boolean;
};

const MICRO = "text-[10px] font-extrabold tracking-[1.2px] text-text-2";

/**
 * `memo` 인 이유: 검수는 한 화면에 최대 30카드이고 카드마다 본문 KaTeX 조판이
 * 붙는다. 확정 진행 상태·오류 문구처럼 카드와 무관한 상태가 바뀔 때 전 카드를
 * 다시 조판할 이유가 없다.
 */
export const ReviewProblemCard = memo(function ReviewProblemCard({
  orderIndex,
  problem,
  onReplace,
  replacing,
}: Props) {
  const solution = problem.solution?.trim() ?? "";

  /**
   * `<details>` 가 닫혀 있어도 React 는 자식을 렌더한다 — 브라우저가 감출 뿐이라
   * 답·해설의 KaTeX 조판 비용은 100% 지불된다. 30문항이면 **보이지도 않는**
   * 파이프라인 60개다. 그래서 한 번이라도 펼쳐진 뒤에만 그린다.
   *
   * 닫아도 다시 false 로 내리지 않는다 — 접었다 펴는 것이 재조판이 되면
   * 원장이 문항을 훑을 때마다 비용을 다시 낸다.
   *
   * 신호를 둘 다 듣는 이유:
   *  - `summary` 의 click: 마우스/키보드(Enter·Space) 활성화는 기본 동작(open
   *    토글)보다 **먼저** 이벤트를 흘린다. 여기서 미리 그려 두면 펼치는 순간
   *    이미 내용이 있다(빈 칸이 잠깐 보이지 않는다).
   *  - `details` 의 toggle: 브라우저가 스스로 펼치는 경우(페이지 내 찾기 등)와
   *    코드로 `open` 을 건드리는 경우까지 빠짐없이 잡는다.
   * summary 마크업·키보드 동작은 그대로다.
   */
  const [revealed, setRevealed] = useState(false);

  return (
    <article
      aria-label={`문 ${orderIndex}`}
      className="grid grid-cols-[auto_1px_minmax(0,1fr)_auto] items-stretch gap-x-4 border-b border-divider bg-white px-6 py-4"
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
      <details
        className="min-w-0"
        onToggle={(event) => {
          if (event.currentTarget.open) setRevealed(true);
        }}
      >
        <summary
          className="list-none [&::-webkit-details-marker]:hidden"
          onClick={() => setRevealed(true)}
        >
          <ProblemExcerpt problem={problem} className="leading-relaxed" />
        </summary>
        <div className="mt-3 border-t border-divider pt-3">
          <section>
            <h3 className={MICRO}>답</h3>
            {revealed ? (
              <MathText
                as="div"
                className="mt-1 text-[12.5px] leading-relaxed"
                text={problem.answer}
              />
            ) : null}
          </section>
          <section className="mt-3">
            <h3 className={MICRO}>해설</h3>
            {solution ? (
              revealed ? (
                <MathText
                  as="div"
                  className="mt-1 text-[12.5px] leading-relaxed"
                  text={solution}
                />
              ) : null
            ) : (
              <p className="mt-1 text-[12.5px] text-text-2">해설 없음</p>
            )}
          </section>
        </div>
      </details>
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
