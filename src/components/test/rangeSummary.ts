/**
 * 확인테스트 범위를 **한 줄과 막대**로 옮기는 순수 함수 (S-04, Hi-fi ④).
 *
 * 원장님이 실물 시안(`/dev/range-hifi`)을 보고 ④ 막대로 확정했다(2026-08-19).
 * 막대가 답하는 것은 「이번 범위가 **그 학년 과정 어디쯤**인가」다.
 *
 * ## 분모를 무엇으로 잡나
 *
 * **끝 단원이 속한 학년/과목**의 소단원 수다. 범위는 학년 경계를 넘을 수 있는데
 * (orderIndex 가 전역이다 — D-27), 그때 두 학년을 합쳐 분모로 쓰면 범위가 바뀔 때마다
 * 분모가 같이 움직여 막대끼리 견줄 수가 없다. 그래서 분모는 **끝 학년 하나로 고정**하고,
 * 시작이 그보다 앞 학년이면 막대를 왼쪽 끝까지 채운 뒤 「(이전 학년부터)」라고 적는다 —
 * 채운 길이가 거짓말을 하지 않게.
 */
import type { UnitNode } from "@/lib/units/groupUnits";

export interface RangeSummary {
  /** 한 줄 값 — 「유리수와 소수 ~ 일차부등식의 풀이」 */
  text: string;
  /** 막대 아래 라벨 — 「중2 소단원 56개 중 1~10번째」 */
  label: string;
  /** 막대에서 채운 부분의 왼쪽 오프셋(%) */
  offsetPct: number;
  /** 채운 부분의 너비(%) */
  widthPct: number;
}

export function describeRange(
  units: UnitNode[],
  startUnitId: string,
  endUnitId: string,
): RangeSummary | null {
  const start = units.find((u) => u.id === startUnitId);
  const end = units.find((u) => u.id === endUnitId);
  if (!start || !end) return null;

  // 시작이 끝보다 뒤면 뒤바꿔 읽는다 — `resolveRange` 도 같은 방향으로 정렬한다.
  const [from, to] =
    start.orderIndex <= end.orderIndex ? [start, end] : [end, start];

  const gradeUnits = units
    .filter((u) => u.grade === to.grade)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const total = gradeUnits.length;
  const endPos = gradeUnits.findIndex((u) => u.id === to.id) + 1;
  const startIndex = gradeUnits.findIndex((u) => u.id === from.id);
  const crossGrade = startIndex < 0;
  const startPos = crossGrade ? 1 : startIndex + 1;

  const label = total
    ? `${to.grade} 소단원 ${total}개 중 ${startPos}~${endPos}번째` +
      (crossGrade ? ` (${from.grade}부터 이어짐)` : "")
    : `${to.grade} 소단원`;

  return {
    text: `${from.section} ~ ${to.section}`,
    label,
    offsetPct: total ? ((startPos - 1) / total) * 100 : 0,
    widthPct: total ? ((endPos - startPos + 1) / total) * 100 : 0,
  };
}
