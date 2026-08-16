import Link from "next/link";

import type { ExamRoundSummary } from "./examScreen.contract";
import { PipelineDots } from "./PipelineDots";
import {
  confidenceBarColor,
  confidenceText,
  ddayLabel,
  roundJudgement,
  roundTitle,
  stageViews,
  unavailableText,
  type ConfidenceBarColor,
} from "./viewModel";

/**
 * 회차 행 — 큰 순번 + D-day + 좌측 인셋 바(신뢰도) (D-39 · D-42 확정).
 *
 * 🔴 D-44 — 좌측 인셋 바는 **신뢰도**이고 블루를 쓰지 않는다.
 *    '오늘의 수학'에서는 같은 자리가 "지금 할 일"(블루)이라 뜻이 겹치면 안 된다.
 *
 * 🔴 D-30 — 행 본체는 누를 수 없다. 카드 전체에 손가락 커서를 주면 "눌러도 아무 일이 없는"
 *    거짓말이 된다(이 프로젝트가 실제로 낸 버그다). 회차로 들어가는 링크만 컨트롤이다.
 *
 * 🔴 근거가 부족한 회차는 신뢰도 옆에 **예측 불가**를 명시한다. 숨기면 원장님이 못 맞히는
 *    예측을 믿는다 — 이 화면의 핵심 계약이다(05 §8.7).
 */
const BAR_CLASS: Record<ConfidenceBarColor, string> = {
  green: "bg-g-green",
  yellow: "bg-g-yellow",
  red: "bg-g-red",
  none: "bg-[#c6c6c4]",
};

const CONF_TEXT_CLASS: Record<ConfidenceBarColor, string> = {
  green: "text-g-green",
  yellow: "text-g-yellow-text",
  red: "text-g-red-text",
  none: "text-ghost",
};

type Props = {
  round: ExamRoundSummary;
  index: number;
  today?: Date;
};

export function RoundRow({ round, index, today }: Props) {
  const judgement = roundJudgement(round);
  const stages = stageViews(round.stages, judgement.available);
  const bar = confidenceBarColor(round.confidence);
  const dday = ddayLabel(round.examDate, today);
  const title = roundTitle(round);

  return (
    <article
      aria-label={title}
      className="relative grid grid-cols-[44px_minmax(0,1fr)_96px] items-start gap-4 border-b border-divider bg-surface py-3.5"
    >
      <span
        aria-hidden="true"
        data-confidence-bar={bar}
        className={`absolute inset-y-0 left-0 w-[5px] ${BAR_CLASS[bar]}`}
      />
      <span
        className={`pl-[17px] font-mono text-[26px] font-bold leading-none tabular-nums ${
          judgement.available ? "text-ink" : "text-ghost"
        }`}
      >
        {String(index).padStart(2, "0")}
      </span>

      <div className="flex min-w-0 flex-col gap-1.5">
        <Link
          href={`/exam/${round.id}`}
          className="w-fit text-[15.5px] font-black tracking-[-0.01em] hover:underline"
        >
          {title}
        </Link>
        <PipelineDots stages={stages} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted tabular-nums">
          <span className={`font-bold ${CONF_TEXT_CLASS[bar]}`}>
            {confidenceText(round.confidence)}
          </span>
          <span>근거 {round.evidenceCount}회차</span>
          {judgement.available ? null : (
            <span className="font-bold text-g-red-text">
              {unavailableText(judgement)}
            </span>
          )}
        </div>
      </div>

      <span className="pr-3 text-right font-mono text-[15px] font-bold tabular-nums">
        {dday ?? "일정 미정"}
      </span>
    </article>
  );
}
