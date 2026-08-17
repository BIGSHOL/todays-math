/**
 * 날짜 창을 **JS filter 에서 SQL where 로 옮긴 것**이 같은 집합을 내는지 잠근다.
 *
 * 왜 이 파일이 따로 있는가:
 *
 * 성능 수리라고 해서 "빨라졌는지"만 보면 안 된다. 이 두 창은 옮기다가 하루씩 어긋나도
 * **에러가 나지 않고 숫자만 조용히 달라진다.** 노스스타 지표(주 5일 사용)가 하루치를
 * 잃거나, 중복 제외 창(D-20)이 하루 짧아져 어제 낸 문제가 오늘 또 나온다.
 * 그래서 경계값을 양쪽 판정에 **동시에** 먹여 결과가 같은지 대조한다.
 *
 * 두 창은 기준 시간대가 다르다 — 그게 이 파일이 두 절로 나뉜 이유다:
 *   - 주간 지표: `printed_at`(timestamp)을 **KST 날짜**로 잘라 판정한다.
 *   - 중복 제외: `test_date`(@db.Date)를 **UTC 날짜**로 잘라 판정한다.
 */
import { describe, expect, it } from "vitest";

import { computeWeeklyMetrics, weekWindowInstants } from "@/lib/metrics";

const WINDOW = { weekStart: "2026-08-10", weekEnd: "2026-08-16" };

/** SQL 로 내린 조건(`gte <= printedAt < lt`)을 그대로 흉내 낸다. */
function sqlWouldKeep(printedAt: string): boolean {
  const { gte, lt } = weekWindowInstants(WINDOW);
  const at = new Date(printedAt).getTime();
  return at >= gte.getTime() && at < lt.getTime();
}

/** 기존 JS 판정 — `computeWeeklyMetrics` 가 실제로 세는지로 본다. */
function jsWouldKeep(printedAt: string): boolean {
  return (
    computeWeeklyMetrics(
      [
        {
          status: "printed",
          modified: false,
          createdAt: printedAt,
          printedAt,
        },
      ],
      WINDOW,
    ).printedCount === 1
  );
}

describe("[성능 수리] 주간 지표 창 — SQL 경계가 KST 날짜 판정과 같은 집합을 낸다", () => {
  // 경계 앞뒤 1밀리초까지 본다. KST 자정은 UTC 로 전날 15:00 이다.
  const CASES: Array<[label: string, instant: string]> = [
    ["창 시작 1ms 전 (KST 8/9 23:59:59.999)", "2026-08-09T14:59:59.999Z"],
    ["창 시작 정각 (KST 8/10 00:00)", "2026-08-09T15:00:00.000Z"],
    ["창 한가운데", "2026-08-13T03:00:00.000Z"],
    ["창 마지막 날 KST 23:59:59.999", "2026-08-16T14:59:59.999Z"],
    ["창 끝 1ms 후 (KST 8/17 00:00)", "2026-08-16T15:00:00.000Z"],
    // 🔴 UTC 로만 보면 8/16 안이지만 KST 로는 8/17 이다. 시간대를 빠뜨리면
    //    이 한 건이 SQL 에만 남거나 JS 에만 남아 지표가 조용히 어긋난다.
    ["UTC 로는 창 안, KST 로는 창 밖", "2026-08-16T20:00:00.000Z"],
    // 반대 방향 — UTC 로는 창 전날이지만 KST 로는 창 첫날이다.
    ["UTC 로는 창 밖, KST 로는 창 안", "2026-08-09T15:30:00.000Z"],
  ];

  it.each(CASES)("%s — SQL 과 JS 판정이 일치한다", (_label, instant) => {
    expect(sqlWouldKeep(instant)).toBe(jsWouldKeep(instant));
  });

  it("경계 케이스가 양쪽(포함/제외)을 모두 덮는다", () => {
    // 전부 '포함' 이거나 전부 '제외' 면 위 일치 검사는 아무것도 증명하지 못한다.
    const kept = CASES.filter(([, at]) => jsWouldKeep(at)).length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(CASES.length);
  });
});

/**
 * 중복 제외 창(D-20) — 옛 판정은 UTC 날짜 기준
 * `0 <= (today - testDate) 일수 <= windowDays` 폐구간이었다.
 * SQL 로는 `gte = today-windowDays 자정(UTC)`, `lt = today+1 자정(UTC)` 이다.
 */
describe("[성능 수리] 중복 제외 창 — SQL 경계가 옛 일수 판정과 같은 집합을 낸다", () => {
  const TODAY = "2026-08-17";
  const WINDOW_DAYS = 14;

  function dayStartUtc(isoDate: string): Date {
    return new Date(`${isoDate}T00:00:00.000Z`);
  }
  function addDays(isoDate: string, days: number): string {
    return new Date(dayStartUtc(isoDate).getTime() + days * 86_400_000)
      .toISOString()
      .slice(0, 10);
  }

  /** 옛 코드의 판정 그대로. */
  function jsWouldKeep(testDate: Date): boolean {
    const diff = Math.round(
      (Date.parse(`${TODAY}T00:00:00Z`) -
        Date.parse(`${testDate.toISOString().slice(0, 10)}T00:00:00Z`)) /
        86_400_000,
    );
    return diff >= 0 && diff <= WINDOW_DAYS;
  }

  function sqlWouldKeep(testDate: Date): boolean {
    const gte = dayStartUtc(addDays(TODAY, -WINDOW_DAYS));
    const lt = dayStartUtc(addDays(TODAY, 1));
    return (
      testDate.getTime() >= gte.getTime() && testDate.getTime() < lt.getTime()
    );
  }

  const CASES: Array<[label: string, testDate: string]> = [
    ["창보다 하루 이른 시험지(15일 전)", "2026-08-02T00:00:00.000Z"],
    ["창 첫날(정확히 14일 전)", "2026-08-03T00:00:00.000Z"],
    ["창 한가운데", "2026-08-10T00:00:00.000Z"],
    ["오늘", "2026-08-17T00:00:00.000Z"],
    // 🔴 미래 시험지는 제외였다(diff < 0). 창을 옮기며 이걸 흘리면 아직 치지도 않은
    //    시험지의 문항이 중복 제외 목록에 들어가 출제 후보가 이유 없이 줄어든다.
    ["내일(미래 시험지)", "2026-08-18T00:00:00.000Z"],
  ];

  it.each(CASES)("%s — SQL 과 옛 일수 판정이 일치한다", (_label, iso) => {
    const testDate = new Date(iso);
    expect(sqlWouldKeep(testDate)).toBe(jsWouldKeep(testDate));
  });

  it("경계 케이스가 양쪽(포함/제외)을 모두 덮는다", () => {
    const kept = CASES.filter(([, iso]) => jsWouldKeep(new Date(iso))).length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(CASES.length);
  });
});
