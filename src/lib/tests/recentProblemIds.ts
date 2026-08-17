/**
 * 최근 windowDays일 이내 출제된 problemId 목록을 조회한다 (D-20).
 * 날짜 윈도우 판정은 여기서 끝내고, 엔진(selectProblems/excludeRecent)에는 id만 넘긴다.
 */
import { db } from "@/lib/db";

import { DUPLICATE_EXCLUSION_DAYS } from "./constants";

function dayStartUtc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function addDays(isoDate: string, days: number): string {
  return new Date(dayStartUtc(isoDate).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export async function loadRecentProblemIds(
  userId: string,
  today: string,
  windowDays: number = DUPLICATE_EXCLUSION_DAYS,
): Promise<string[]> {
  // 🔴 예전에는 이 원장의 시험지를 **전부** 읽어 와서 JS 로 14일 창을 걸었다. 출제를
  //    할 때마다(그리고 문항 교체 때마다) 지난 시험지 전량이 따라 들어왔다.
  //    판정 규칙은 그대로다 — 옛 `daysBetween` 은 `0 <= today - testDate <= windowDays`,
  //    즉 UTC 날짜로 `[today-windowDays, today]` 폐구간이었다. 그것을 그대로 옮긴다.
  //    끝을 `today+1` **미만**으로 잡는 이유: @db.Date 라 값은 항상 자정이지만,
  //    시각이 섞인 값이 들어와도 옛 `toIsoDate` 절단과 같은 집합을 유지한다.
  const tests = await db.test.findMany({
    where: {
      userId,
      testDate: {
        gte: dayStartUtc(addDays(today, -windowDays)),
        lt: dayStartUtc(addDays(today, 1)),
      },
    },
    select: { id: true },
  });

  const recentTestIds = tests.map((row) => row.id);
  if (recentTestIds.length === 0) return [];

  const items = await db.testProblem.findMany({
    where: { testId: { in: recentTestIds } },
    select: { problemId: true },
  });
  return items.map((item) => item.problemId);
}
