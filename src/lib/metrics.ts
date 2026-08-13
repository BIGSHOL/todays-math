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

function toIsoDate(value: string): string {
  return value.slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00.000Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function defaultWeekWindow(today = new Date()): {
  weekStart: string;
  weekEnd: string;
} {
  const weekEnd = today.toISOString().slice(0, 10);
  return { weekStart: addDays(weekEnd, -6), weekEnd };
}

export function resolveWeekWindow(weekStart?: string): {
  weekStart: string;
  weekEnd: string;
} {
  if (!weekStart) return defaultWeekWindow();
  return { weekStart, weekEnd: addDays(weekStart, 6) };
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
