/**
 * 주간 사용 지표 계산 — 순수 함수 (DB/AI 미의존).
 * PRD 4장: 실사용 일수, 무수정 사용률, 출제→인쇄 소요.
 */
import type { WeeklyMetrics } from "@/contracts/metrics.contract";

export interface PrintedTestLike {
  status: string;
  modified: boolean;
  createdAt: string;
  printedAt: string | null;
}

const METRICS_TIME_ZONE = "Asia/Seoul";

function toIsoDate(value: string | Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: METRICS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(typeof value === "string" ? new Date(value) : value);
  const byType = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addDays(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00.000Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function defaultWeekWindow(today = new Date()): {
  weekStart: string;
  weekEnd: string;
} {
  const weekEnd = toIsoDate(today);
  return { weekStart: addDays(weekEnd, -6), weekEnd };
}

export function resolveWeekWindow(weekStart?: string): {
  weekStart: string;
  weekEnd: string;
} {
  if (!weekStart) return defaultWeekWindow();
  return { weekStart, weekEnd: addDays(weekStart, 6) };
}

/**
 * 주간 창(KST 날짜 2개) → `printed_at` 을 SQL 에서 자를 수 있는 UTC 시각 경계.
 *
 * 🔴 이 창의 기준 컬럼은 `test_date` 가 아니라 **`printed_at`** 이다
 *    (`computeWeeklyMetrics` 가 `toIsoDate(test.printedAt)` 으로 판정한다).
 *    두 컬럼은 같지 않다 — 인쇄는 시험일 전에도 후에도 일어난다. `test_date` 로
 *    좁히면 창 안에 인쇄된 시험지가 조용히 지표에서 빠진다.
 *
 * 시간대 상수를 그대로 `+09:00` 리터럴로 쓰는 것은 KST 가 **DST 가 없는 고정
 * UTC+9** 이기 때문이다(METRICS_TIME_ZONE). 그래서 이 경계는 근사가 아니라
 * `toIsoDate` 판정과 정확히 같은 집합을 낸다. 끝은 다음 날 0시 **미만**으로 잡아
 * 밀리초 경계에서 어긋나지 않게 한다.
 *
 * 경계 동치는 `src/__tests__/unit/sqlDateWindows.test.ts` 가 잠근다 —
 * `+09:00` 을 `Z` 로 바꾸면 그 파일이 즉시 빨개진다(실제로 확인).
 */
export function weekWindowInstants(window: {
  weekStart: string;
  weekEnd: string;
}): { gte: Date; lt: Date } {
  return {
    gte: new Date(`${window.weekStart}T00:00:00.000+09:00`),
    lt: new Date(`${addDays(window.weekEnd, 1)}T00:00:00.000+09:00`),
  };
}

export function computeWeeklyMetrics(
  tests: PrintedTestLike[],
  window: { weekStart: string; weekEnd: string },
): WeeklyMetrics {
  const printed = tests.filter((test) => {
    if (test.status !== "printed" || !test.printedAt) return false;
    const day = toIsoDate(test.printedAt);
    return day >= window.weekStart && day <= window.weekEnd;
  });

  const days = new Set(printed.map((test) => toIsoDate(test.printedAt!)));
  const unmodifiedCount = printed.filter((test) => !test.modified).length;
  const printedCount = printed.length;

  let avgGenerateToPrintSeconds: number | null = null;
  if (printedCount > 0) {
    const totalMs = printed.reduce((sum, test) => {
      const start = Date.parse(test.createdAt);
      const end = Date.parse(test.printedAt!);
      return sum + Math.max(0, end - start);
    }, 0);
    avgGenerateToPrintSeconds = Math.round(totalMs / printedCount / 1000);
  }

  return {
    weekStart: window.weekStart,
    weekEnd: window.weekEnd,
    printedDays: days.size,
    printedCount,
    unmodifiedCount,
    unmodifiedRate: printedCount === 0 ? 0 : unmodifiedCount / printedCount,
    avgGenerateToPrintSeconds,
  };
}
