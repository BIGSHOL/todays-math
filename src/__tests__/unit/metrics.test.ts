import { describe, expect, it } from "vitest";

import {
  computeWeeklyMetrics,
  defaultWeekWindow,
  resolveWeekWindow,
} from "@/lib/metrics";

describe("[T5.3] computeWeeklyMetrics", () => {
  it("주간 창 안의 인쇄만 세고 무수정 비율을 계산한다", () => {
    const result = computeWeeklyMetrics(
      [
        {
          status: "printed",
          modified: false,
          createdAt: "2026-08-11T08:00:00.000Z",
          printedAt: "2026-08-11T08:04:00.000Z",
        },
        {
          status: "printed",
          modified: true,
          createdAt: "2026-08-12T08:00:00.000Z",
          printedAt: "2026-08-12T08:10:00.000Z",
        },
        {
          status: "printed",
          modified: false,
          createdAt: "2026-07-01T08:00:00.000Z",
          printedAt: "2026-07-01T08:00:00.000Z",
        },
      ],
      { weekStart: "2026-08-10", weekEnd: "2026-08-16" },
    );

    expect(result.printedDays).toBe(2);
    expect(result.printedCount).toBe(2);
    expect(result.unmodifiedCount).toBe(1);
    expect(result.unmodifiedRate).toBe(0.5);
    expect(result.avgGenerateToPrintSeconds).toBe(420);
  });

  it("인쇄가 없으면 비율 0, 평균 null", () => {
    const result = computeWeeklyMetrics([], {
      weekStart: "2026-08-10",
      weekEnd: "2026-08-16",
    });
    expect(result.printedDays).toBe(0);
    expect(result.unmodifiedRate).toBe(0);
    expect(result.avgGenerateToPrintSeconds).toBeNull();
  });

  it("weekStart를 주면 6일 뒤를 weekEnd로 잡는다", () => {
    expect(resolveWeekWindow("2026-08-10")).toEqual({
      weekStart: "2026-08-10",
      weekEnd: "2026-08-16",
    });
  });

  it("한국 자정 직후 인쇄를 UTC 전날이 아닌 한국 날짜로 집계한다", () => {
    const result = computeWeeklyMetrics(
      [
        {
          status: "printed",
          modified: false,
          createdAt: "2026-08-13T15:25:00.000Z",
          printedAt: "2026-08-13T15:30:00.000Z",
        },
      ],
      { weekStart: "2026-08-14", weekEnd: "2026-08-20" },
    );

    expect(result.printedDays).toBe(1);
    expect(result.printedCount).toBe(1);
  });

  it("기본 7일 창도 한국 날짜를 기준으로 끝난다", () => {
    expect(
      // 2026-08-14 00:30 KST = 2026-08-13 15:30 UTC
      defaultWeekWindow(new Date("2026-08-13T15:30:00.000Z")),
    ).toEqual({ weekStart: "2026-08-08", weekEnd: "2026-08-14" });
  });
});
