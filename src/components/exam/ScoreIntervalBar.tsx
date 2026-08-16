import type { ScoreInterval } from "@/contracts/predictor.contract";

import { intervalGeometry, intervalText } from "./viewModel";

/**
 * 예측 구간 — **연속 막대 + 눈금** (D-42 확정, 폭 132px).
 *
 * 회색 구간 위에 점추정을 2px 세로 눈금으로 얹고, 옆에 `80~93`을 **말로 병기**한다.
 * 예상 점수는 점 하나가 아니라 구간으로 적는다(D-40) — 관리 지표가 "±N점"이 아니라
 * **구간 적중률**이기 때문이다(11 §4).
 *
 * 막대 자체는 `aria-hidden` 이다. 같은 정보를 옆 숫자가 글자로 이미 말하고 있어
 * 스크린 리더에 두 번 읽힐 이유가 없다.
 */
type Props = {
  interval: ScoreInterval;
  expectedScore: number;
};

export function ScoreIntervalBar({ interval, expectedScore }: Props) {
  const geo = intervalGeometry(interval, expectedScore);

  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className="relative inline-block h-2.5 w-[132px] bg-[#dcdcda] align-[-2px]"
      >
        <span
          className="absolute inset-y-0 bg-[#b4b4b2]"
          style={{ left: `${geo.leftPct}%`, width: `${geo.widthPct}%` }}
        />
        <span
          className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-ink"
          style={{ left: `${geo.pointPct}%` }}
        />
      </span>
      <span className="text-[12px] text-muted tabular-nums">
        {intervalText(interval)}
      </span>
    </span>
  );
}
