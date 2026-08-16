/**
 * 인쇄 넘침 위험 판정 — **잘려도 모르는 것**이 진짜 피해다.
 *
 * 자습 지면은 문항 하나가 고정 높이 반 페이지 박스(본문 1.15 : 연습칸 1)이고
 * `.problemBox` 에 `overflow: hidden` 이 걸려 있다. 장당 문항 수도 2로 고정이라
 * (`JASEUP_GEOMETRY.questionsPerPage`) 긴 문항은 **조용히 잘린 채 인쇄돼** 학생에게
 * 배포된다. 실데이터로 본문 500자 초과 45건(0.5%), 그림 2장 이상 57건이 걸린다.
 *
 * 지면 형태는 원장님 확정 사항(D-07)이라 여기서 바꾸지 않는다.
 * **인쇄를 막지도 않는다** — 원장이 알고 누르게만 한다.
 *
 * ⚠️ 이건 확정이 아니라 **개연성**이다. 본문 길이를 원문 글자 수로 재기 때문에
 *    수식이 많은 문항은 실제보다 길게 잡힌다(`\frac{1}{2}` 는 11자지만 좁게 렌더된다).
 *    잘림을 놓치는 것보다 한 번 더 보게 하는 쪽이 낫다고 보고 이렇게 둔다.
 *    정확히 재려면 실제 렌더 높이를 측정해야 하고, 그건 인쇄 미리보기에서만 가능하다.
 */
import type { TestPrintProblem } from "@/components/print/types";

/** 이 글자 수까지는 박스에 들어간다(실측 지면 기준). 초과분부터 경고. */
export const OVERFLOW_CHAR_LIMIT = 500;

/** 그림이 이 장수 이상이면 세로 공간을 넘길 개연성이 크다. */
export const OVERFLOW_FIGURE_LIMIT = 2;

export interface OverflowRisk {
  /** 지면에 찍히는 문항 번호(1부터). 배열 위치가 아니다 — 원장이 지면에서 찾는 번호다. */
  number: number;
  problemId: string;
  reasons: string[];
}

export function assessOverflowRisk(
  problems: TestPrintProblem[],
): OverflowRisk[] {
  const risks: OverflowRisk[] = [];

  problems.forEach((problem, index) => {
    const reasons: string[] = [];
    if (problem.content.length > OVERFLOW_CHAR_LIMIT)
      reasons.push("본문이 길다");
    if ((problem.figureUrls?.length ?? 0) >= OVERFLOW_FIGURE_LIMIT)
      reasons.push("그림이 여러 장이다");

    if (reasons.length) {
      risks.push({ number: index + 1, problemId: problem.id, reasons });
    }
  });

  return risks;
}
