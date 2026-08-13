/**
 * 최근 windowDays일 이내 출제된 problemId 목록을 조회한다 (D-20).
 * 날짜 윈도우 판정은 여기서 끝내고, 엔진(selectProblems/excludeRecent)에는 id만 넘긴다.
 */
import { db } from "@/lib/db";

import { DUPLICATE_EXCLUSION_DAYS } from "./constants";

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function daysBetween(today: string, testDate: string): number {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const testDateMs = Date.parse(`${testDate}T00:00:00Z`);
  return Math.round((todayMs - testDateMs) / 86_400_000);
}

export async function loadRecentProblemIds(
  userId: string,
  today: string,
  windowDays: number = DUPLICATE_EXCLUSION_DAYS,
): Promise<string[]> {
  const tests = await db.test.findMany({ where: { userId } });
  const recentTestIds = tests
    .filter((row) => {
      const diff = daysBetween(today, toIsoDate(row.testDate));
      return diff >= 0 && diff <= windowDays;
    })
    .map((row) => row.id);

  if (recentTestIds.length === 0) return [];

  const items = await db.testProblem.findMany({
    where: { testId: { in: recentTestIds } },
  });
  return items.map((item) => item.problemId);
}
