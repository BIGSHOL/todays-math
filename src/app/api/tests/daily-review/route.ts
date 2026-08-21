/**
 * GET /api/tests/daily-review — 오늘의 학생별 확인테스트 (2단계 화면, D-63·D-64).
 *
 * 대응 계약: src/contracts/test.contract.ts (dailyReviewResponseSchema)
 * 계획 자체는 순수 함수 `planDailyReview` 한 곳에 있다 — 여기서는 조회와 풀 세기만.
 *
 * 무엇을 주나: 오늘(KST) 보고서가 있는 연계 학생을 「자동 / 문항 부족 / 시험기간·
 * 미분류 / 범위 못 냄」으로 갈라 준다. 문항 수는 출제 조회와 **같은 where**
 * (`eligibleProblemsWhere`)로 센다 — 갈리면 화면의 「부족 아님」이 출제에서 422 로
 * 죽는다.
 *
 * 소유권: 연계 반은 이관 계정 소유라(«소유 이관은 수동», sync 주석) 여기서는
 * 반 소유를 묻지 않는다 — eywa 연계 자체가 단일 학원 데이터다. 세션(director)만
 * 요구한다. 출제(POST /api/tests/generate)는 기존 소유권 규칙 그대로다.
 */
import type { NextRequest } from "next/server";

import { dailyReviewResponseSchema } from "@/contracts/test.contract";
import { jsonOk, unauthorizedError } from "@/lib/apiResponse";
import { planDailyReview } from "@/lib/daily/planDailyReview";
import { db } from "@/lib/db";
import { countEligibleProblems } from "@/lib/findEligibleProblems";
import { getSessionUser } from "@/lib/session";

/** 「오늘」은 학원 시간(KST)이다 — 서버 시계의 UTC 자정이 아니다. */
function kstToday(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  // ?day=YYYY-MM-DD — 지난 날을 되짚어 볼 때(검증·시연). 기본은 오늘(KST).
  const dayParam = new URL(request.url).searchParams.get("day");
  const day =
    dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : kstToday();

  // 연계 학생 먼저 — 진도·직전 시험은 그 id 목록으로 좁혀 묻는다(관계 where 없이,
  // 테스트 더블도 같은 질의를 그대로 소화한다).
  const students = await db.student.findMany({
    where: { eywaStudentId: { not: null }, eywaWithdrawnAt: null },
    select: {
      id: true,
      name: true,
      classId: true,
      schoolLevel: true,
      schoolGrade: true,
      eywaLastReportDate: true,
      eywaLastReportText: true,
      class: {
        select: { name: true, grade: true, defaultProblemCount: true },
      },
    },
  });
  const linkedIds = students.map((s) => s.id);

  const [syncRun, progressRows, units, reviews] = await Promise.all([
    db.eywaSyncRun.findFirst({ orderBy: { ranAt: "desc" } }),
    db.progress.findMany({
      where: { studentId: { in: linkedIds } },
      select: {
        studentId: true,
        unitId: true,
        recordedAt: true,
        createdAt: true,
      },
    }),
    db.unit.findMany({
      select: {
        id: true,
        grade: true,
        chapter: true,
        section: true,
        orderIndex: true,
      },
    }),
    // 직전 확인테스트 — **실제로 낸 것만**(confirmed·printed, default-range 와 같은
    // 규칙). 학생별 최신 한 건이면 된다.
    db.test.findMany({
      where: {
        studentId: { in: linkedIds },
        testType: "review",
        status: { in: ["confirmed", "printed"] },
      },
      orderBy: [{ testDate: "desc" }, { createdAt: "desc" }],
      select: { studentId: true, rangeEndUnitId: true },
    }),
  ]);

  // 오늘 이미 만든 학생별 시험 — 「모두 출제」 재클릭이 중복 초안을 만들지 않게
  // 화면이 이 학생을 건너뛴다. draft 포함(초안도 «이미 출제됨»이다).
  const todayTestRows = await db.test.findMany({
    where: {
      studentId: { in: linkedIds },
      testType: "review",
      testDate: new Date(`${day}T00:00:00Z`),
    },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, studentId: true, status: true },
  });
  const todayTestByStudent = new Map<
    string,
    {
      studentId: string;
      testId: string;
      status: "draft" | "confirmed" | "printed";
    }
  >();
  for (const t of todayTestRows)
    if (t.studentId && !todayTestByStudent.has(t.studentId))
      todayTestByStudent.set(t.studentId, {
        studentId: t.studentId,
        testId: t.id,
        status: t.status as "draft" | "confirmed" | "printed",
      });
  const lastReviewByStudent = new Map<string, string | null>();
  for (const r of reviews)
    if (r.studentId && !lastReviewByStudent.has(r.studentId))
      lastReviewByStudent.set(r.studentId, r.rangeEndUnitId);

  const plan = planDailyReview({
    day,
    students: students.map((s) => ({
      id: s.id,
      name: s.name,
      classId: s.classId,
      className: s.class.name,
      classGrade: s.class.grade,
      defaultProblemCount: s.class.defaultProblemCount,
      schoolLevel: s.schoolLevel,
      schoolGrade: s.schoolGrade,
      lastReportDate: s.eywaLastReportDate
        ? s.eywaLastReportDate.toISOString().slice(0, 10)
        : null,
      lastReportText: s.eywaLastReportText,
    })),
    progressRows: progressRows
      .filter(
        (r): r is typeof r & { studentId: string } => r.studentId !== null,
      )
      .map((r) => ({
        studentId: r.studentId,
        unitId: r.unitId,
        recordedAt: r.recordedAt.toISOString().slice(0, 10),
        createdAt: r.createdAt.toISOString(),
      })),
    lastReviews: [...lastReviewByStudent].map(
      ([studentId, rangeEndUnitId]) => ({
        studentId,
        rangeEndUnitId,
      }),
    ),
    units,
  });

  // 묶음마다 출제 자격 문항 수 — 출제와 같은 where(D-22·D-31 포함).
  const counted = await Promise.all(
    plan.groups.map(async (g) => ({
      key: g.key,
      rangeStartUnitId: g.rangeStartUnitId,
      rangeEndUnitId: g.rangeEndUnitId,
      startedFrom: g.startedFrom,
      unitCount: g.unitIds.length,
      neededCount: g.neededCount,
      poolTotal: await countEligibleProblems({
        userId: session.id,
        unitIds: g.unitIds,
      }),
      students: g.students,
    })),
  );

  return jsonOk(dailyReviewResponseSchema, {
    data: {
      day,
      sync: syncRun
        ? {
            ranAt: syncRun.ranAt.toISOString(),
            students: syncRun.students,
            progressRows: syncRun.progressRows,
            unresolvedLines: syncRun.unresolvedLines,
            ambiguous: syncRun.ambiguous,
          }
        : null,
      attended: plan.attended,
      auto: counted.filter((g) => g.poolTotal >= g.neededCount),
      lacking: counted.filter((g) => g.poolTotal < g.neededCount),
      examOrUnread: plan.examOrUnread,
      noRange: plan.noRange,
      todayTests: [...todayTestByStudent.values()],
    },
  });
}
