/**
 * 최근 출제 중복 제외(D-20) — 최근 windowDays일 이내 출제된 문제를 후보 풀에서 제거하는
 * 순수 함수.
 *
 * `recent` 항목은 두 형태를 모두 받는다:
 *   - `string`(problemId만): 날짜 정보 없이 "무조건 최근"으로 간주해 제외한다 — 호출자가
 *     이미 windowDays 판정을 끝낸 뒤 id만 넘기는 경우(selectProblems의 recentProblemIds).
 *   - `{ problemId, testDate }`: today 기준 windowDays 이내일 때만 제외한다 — 호출자(API
 *     계층, T4.2)가 원본 출제 이력을 그대로 넘기는 경우.
 *
 * 참조: docs/planning/06-tasks.md T4.1(D-20), src/__tests__/unit/generator.test.ts
 */
import type { ProblemEntity } from "@/contracts/problem.contract";

export interface RecentProblemEntry {
  problemId: string;
  /** ISO 날짜(YYYY-MM-DD) — 해당 문제가 마지막으로 출제된 날. */
  testDate: string;
}

export type RecentProblemInput = string | RecentProblemEntry;

export interface ExcludeRecentOptions {
  /** ISO 날짜(YYYY-MM-DD) — 기준일(보통 출제하려는 오늘 날짜). */
  today: string;
  /** 이 일수 이내에 출제된 문제만 제외한다(D-20 기본 14일). */
  windowDays: number;
}

function daysBetween(today: string, testDate: string): number {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const testDateMs = Date.parse(`${testDate}T00:00:00Z`);
  return Math.round((todayMs - testDateMs) / 86_400_000);
}

export function excludeRecent(
  pool: ProblemEntity[],
  recent: RecentProblemInput[],
  options: ExcludeRecentOptions,
): ProblemEntity[] {
  const excludedIds = new Set<string>();

  for (const entry of recent) {
    if (typeof entry === "string") {
      excludedIds.add(entry);
      continue;
    }
    const diffDays = daysBetween(options.today, entry.testDate);
    if (diffDays >= 0 && diffDays <= options.windowDays) {
      excludedIds.add(entry.problemId);
    }
  }

  return pool.filter((p) => !excludedIds.has(p.id));
}
