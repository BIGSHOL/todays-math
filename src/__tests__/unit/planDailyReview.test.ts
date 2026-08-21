/**
 * 🔴 RED → 🟢 — 오늘의 학생별 확인테스트 **계획 로직** (2단계 화면, D-63·D-64).
 *
 * 구현: src/lib/daily/planDailyReview.ts
 *
 * 무엇을 잠그나
 * 1. «오늘» 은 마지막 보고서 날짜로 가른다 — 어제 수업한 학생은 안 나온다.
 * 2. 보고서는 있는데 오늘 진도 행이 없으면 examOrUnread — **표시만**(D-64),
 *    원문 줄이 사유로 그대로 실린다.
 * 3. 같은 범위 학생은 한 묶음 — 묶음의 소단원 목록은 출제와 같은 함수(resolveRange).
 * 4. 직전 확인테스트가 있는 학생은 그 끝 **다음**부터(2회차 동작) —
 *    없는 학생은 대단원 제한(D-63).
 * 5. neededCount 는 구성원 반 기본 문항 수의 최댓값.
 */
import { describe, expect, it } from "vitest";

import {
  planDailyReview,
  type DailyStudent,
} from "@/lib/daily/planDailyReview";

const UNITS = [
  { id: "u1", orderIndex: 100, grade: "중2", chapter: "2. 부등식" },
  { id: "u2", orderIndex: 101, grade: "중2", chapter: "2. 부등식" },
  { id: "u3", orderIndex: 102, grade: "중2", chapter: "3. 방정식" },
  { id: "u4", orderIndex: 103, grade: "중2", chapter: "3. 방정식" },
  { id: "u5", orderIndex: 104, grade: "중2", chapter: "3. 방정식" },
];

const student = (over: Partial<DailyStudent>): DailyStudent => ({
  id: "s1",
  name: "학생가",
  classId: "c1",
  className: "중등M 중2",
  classGrade: "중2",
  defaultProblemCount: 8,
  schoolLevel: "중",
  schoolGrade: 2,
  lastReportDate: "2026-08-21",
  lastReportText: "수학 진도",
  ...over,
});

const row = (studentId: string, unitId: string, recordedAt: string) => ({
  studentId,
  unitId,
  recordedAt,
  createdAt: `${recordedAt}T10:00:00Z`,
});

describe("[planDailyReview] 오늘의 학생별 확인테스트 계획", () => {
  it("오늘 보고서가 없는 학생은 아예 안 나온다 — 어제 수업한 학생 제외", () => {
    const plan = planDailyReview({
      day: "2026-08-21",
      students: [
        student({ id: "s1", lastReportDate: "2026-08-21" }),
        student({ id: "s2", name: "학생나", lastReportDate: "2026-08-20" }),
      ],
      progressRows: [row("s1", "u3", "2026-08-21")],
      lastReviews: [],
      units: UNITS,
    });
    expect(plan.attended).toBe(1);
    expect(plan.groups.flatMap((g) => g.students.map((s) => s.id))).toEqual([
      "s1",
    ]);
  });

  /** 🔴 D-64 — 시험기간(내신대비)만 적힌 날: 표시만, 원문 줄이 사유로 실린다. */
  it("오늘 진도 행이 없으면 examOrUnread — 원문 줄 그대로, 중복 제거", () => {
    const plan = planDailyReview({
      day: "2026-08-21",
      students: [
        student({
          id: "s1",
          lastReportText: "수학 내신대비\n수학 내신대비\n수학 모의고사",
        }),
      ],
      progressRows: [row("s1", "u3", "2026-08-20")], // 어제 것만 있다
      lastReviews: [],
      units: UNITS,
    });
    expect(plan.groups).toEqual([]);
    expect(plan.examOrUnread).toEqual([
      {
        id: "s1",
        name: "학생가",
        classId: "c1",
        grade: "중2",
        className: "중등M 중2",
        lines: ["수학 내신대비", "수학 모의고사"],
      },
    ]);
  });

  it("같은 범위 학생은 한 묶음 — 소단원 목록·neededCount 최댓값", () => {
    const plan = planDailyReview({
      day: "2026-08-21",
      students: [
        student({ id: "s1", name: "학생가", defaultProblemCount: 8 }),
        student({ id: "s2", name: "학생나", defaultProblemCount: 12 }),
      ],
      progressRows: [
        row("s1", "u3", "2026-08-20"),
        row("s1", "u4", "2026-08-21"),
        row("s2", "u3", "2026-08-20"),
        row("s2", "u4", "2026-08-21"),
      ],
      lastReviews: [],
      units: UNITS,
    });
    expect(plan.groups).toHaveLength(1);
    const g = plan.groups[0]!;
    expect(g.rangeStartUnitId).toBe("u3");
    expect(g.rangeEndUnitId).toBe("u4");
    expect(g.unitIds).toEqual(["u3", "u4"]);
    expect(g.neededCount).toBe(12);
    expect(g.students.map((s) => s.name)).toEqual(["학생가", "학생나"]);
  });

  /**
   * 🔴 2회차 동작 — 직전 확인테스트가 u3 까지면 시작은 u4 (대단원 제한 미적용).
   *    같은 현재 진도(u5)라도 직전 시험이 없는 학생은 D-63 으로 u3 부터 —
   *    **두 학생이 다른 묶음**이 된다.
   */
  it("직전 확인테스트 있으면 그 다음부터, 없으면 대단원 처음부터 — 묶음이 갈린다", () => {
    const plan = planDailyReview({
      day: "2026-08-21",
      students: [
        student({ id: "s1", name: "학생가" }),
        student({ id: "s2", name: "학생나" }),
      ],
      progressRows: [
        // 둘 다 이력이 u1(앞 대단원)부터 u5 까지
        ...["u1", "u3", "u4"].map((u) => row("s1", u, "2026-08-19")),
        row("s1", "u5", "2026-08-21"),
        ...["u1", "u3", "u4"].map((u) => row("s2", u, "2026-08-19")),
        row("s2", "u5", "2026-08-21"),
      ],
      lastReviews: [{ studentId: "s1", rangeEndUnitId: "u3" }],
      units: UNITS,
    });
    expect(plan.groups).toHaveLength(2);
    const byStudent = new Map(
      plan.groups.flatMap((g) => g.students.map((s) => [s.id, g] as const)),
    );
    expect(byStudent.get("s1")!.rangeStartUnitId).toBe("u4");
    expect(byStudent.get("s1")!.startedFrom).toBe("last-review");
    expect(byStudent.get("s2")!.rangeStartUnitId).toBe("u3"); // D-63 대단원 처음
    expect(byStudent.get("s2")!.startedFrom).toBe("chapter-start");
  });

  it("학년 표기는 학교 학년 우선, 없으면 반 학년", () => {
    const plan = planDailyReview({
      day: "2026-08-21",
      students: [
        student({
          id: "s1",
          schoolLevel: null,
          schoolGrade: null,
          classGrade: "초4",
        }),
      ],
      progressRows: [row("s1", "u3", "2026-08-21")],
      lastReviews: [],
      units: UNITS,
    });
    expect(plan.groups[0]!.students[0]!.grade).toBe("초4");
  });

  it("진도 행은 있는데 단원 목록에 없으면 noRange 로 센다 — 조용히 버리지 않는다", () => {
    const plan = planDailyReview({
      day: "2026-08-21",
      students: [student({ id: "s1" })],
      progressRows: [row("s1", "ghost-unit", "2026-08-21")],
      lastReviews: [],
      units: UNITS,
    });
    expect(plan.groups).toEqual([]);
    expect(plan.noRange.map((s) => s.id)).toEqual(["s1"]);
  });
});
