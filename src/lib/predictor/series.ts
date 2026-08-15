/**
 * 시리즈 묶기와 시간 분리.
 *
 * ⚠️ 묶는 단위가 둘이다 (11 §2.1·§3 L1):
 *   - 출제 스타일 단위 = (학교, 급, 학년)        — 과목을 뺀다.
 *     고1은 1학기 공통수학1 / 2학기 공통수학2로 과목이 바뀌지만 출제 관행은 이어진다.
 *   - 시험 범위 단위   = (학교, 급, 학년, 과목)  — 단원 배분은 과목이 다르면 섞으면 안 된다.
 */
import {
  comparePeriod,
  type ExamPeriod,
  type ExamSeriesKey,
} from "@/contracts/predictor.contract";

/** 출제 스타일 단위 키 — 문항 수·유형 배분·배점 눈금을 여기서 배운다. */
export function styleSeriesKey(series: ExamSeriesKey): string {
  return `${series.school}|${series.level}${series.grade}`;
}

/** 시험 범위 단위 키 — 단원 배분을 여기서 배운다. */
export function rangeSeriesKey(series: ExamSeriesKey): string {
  return `${series.school}|${series.level}${series.grade}|${series.subject}`;
}

/** 시점을 정수 하나로 — 연도 4 + 학기 2 + 중간/기말 1. 간격 계산에 쓴다. */
export function periodOrdinal(period: ExamPeriod): number {
  return (
    period.year * 4 + (period.semester - 1) * 2 + (period.round === "중간" ? 0 : 1)
  );
}

/** 대상 시점에서 몇 회차 전인가. 가중 감쇠의 지수. */
export function periodsBack(target: ExamPeriod, past: ExamPeriod): number {
  return periodOrdinal(target) - periodOrdinal(past);
}

/** 같은 학기·같은 회차인가 — 시험 범위와 출제 교사가 같을 확률이 높다. */
export function isSameRound(a: ExamPeriod, b: ExamPeriod): boolean {
  return a.semester === b.semester && a.round === b.round;
}

export function sortByPeriod<T extends { period: ExamPeriod }>(items: T[]): T[] {
  return [...items].sort((a, b) => comparePeriod(a.period, b.period));
}

/**
 * 대상 시점 **이전**만 남긴다. 같은 시점도 뺀다.
 * backtest 의 시간 분리는 여기서 시작한다 — 예측기는 이 함수를 통과한 것만 받는다.
 */
export function historyBefore<T extends { period: ExamPeriod }>(
  items: T[],
  target: ExamPeriod,
): T[] {
  return sortByPeriod(items).filter(
    (item) => comparePeriod(item.period, target) < 0,
  );
}

/** 시리즈로 묶는다. keyFn 은 styleSeriesKey / rangeSeriesKey 중 하나. */
export function groupSeries<T extends { series: ExamSeriesKey; period: ExamPeriod }>(
  items: T[],
  keyFn: (series: ExamSeriesKey) => string,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item.series);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  for (const [key, list] of map) map.set(key, sortByPeriod(list));
  return map;
}
