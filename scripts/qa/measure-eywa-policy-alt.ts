/**
 * 첫 회 범위 정책 대안 실측 — 원장님 질문에 붙일 숫자 (D-07).
 * ①현행(이력 첫 단원부터) ②현재 대단원만 ③현재 소단원만 — 갈래 수 비교.
 * 그리고 최근 7일의 «그날 진도 못 읽음» 학생 수.
 */
import { PrismaClient } from "@prisma/client";
import { fetchViaApi } from "@/lib/eywa/transport";
import { getCurrentProgress } from "@/lib/progressResolver";
import { resolveDefaultReviewRange } from "@/lib/generator/defaultReviewRange";

async function main() {
  const prisma = new PrismaClient();
  const [students, units] = await Promise.all([
    prisma.student.findMany({
      where: { eywaStudentId: { not: null }, eywaWithdrawnAt: null },
      select: {
        id: true,
        eywaStudentId: true,
        name: true,
        useIndividualProgress: true,
      },
    }),
    prisma.unit.findMany({
      select: {
        id: true,
        grade: true,
        chapter: true,
        section: true,
        orderIndex: true,
      },
    }),
  ]);
  const unitById = new Map(units.map((u) => [u.id, u]));
  const byEywaId = new Map(students.map((s) => [s.eywaStudentId!, s]));
  const progressAll = await prisma.progress.findMany({
    where: { eywaReportId: { not: null } },
    select: {
      studentId: true,
      unitId: true,
      recordedAt: true,
      createdAt: true,
    },
  });
  const byStudent = new Map<string, typeof progressAll>();
  for (const r of progressAll) {
    if (!r.studentId) continue;
    const l = byStudent.get(r.studentId) ?? [];
    l.push(r);
    byStudent.set(r.studentId, l);
  }
  const snapshot = await fetchViaApi();
  const days = [...new Set(snapshot.reports.map((r) => r.reportDate))]
    .sort()
    .slice(-7);
  for (const day of days) {
    const attended = [
      ...new Set(
        snapshot.reports
          .filter((r) => r.reportDate === day)
          .map((r) => r.studentId),
      ),
    ];
    const g1 = new Set();
    const g2 = new Set();
    const g3 = new Set();
    let none = 0;
    for (const eid of attended) {
      const st = byEywaId.get(eid);
      if (!st) continue;
      const rows = (byStudent.get(st.id) ?? []).filter(
        (r) => r.recordedAt.toISOString().slice(0, 10) <= day,
      );
      const hasToday = rows.some(
        (r) => r.recordedAt.toISOString().slice(0, 10) === day,
      );
      if (!hasToday) {
        none += 1;
        continue;
      }
      const current = getCurrentProgress({
        classProgress: [],
        studentProgress: rows.map((r) => ({
          id: "",
          classId: "",
          studentId: st.id,
          unitId: r.unitId,
          recordedAt: r.recordedAt.toISOString().slice(0, 10),
          createdAt: r.createdAt.toISOString(),
        })),
        useIndividualProgress: st.useIndividualProgress,
      });
      if (!current) continue;
      const cu = unitById.get(current.unitId);
      if (!cu) continue;
      const range = resolveDefaultReviewRange({
        units,
        currentUnitId: current.unitId,
        lastReviewEndUnitId: null,
        progressUnitIds: rows.map((r) => r.unitId),
      });
      if (range) g1.add(range.startUnitId + "~" + range.endUnitId);
      const chapterUnits = units.filter(
        (u) =>
          u.grade === cu.grade &&
          u.chapter === cu.chapter &&
          u.orderIndex <= cu.orderIndex,
      );
      let chStart: (typeof units)[number] | null = null;
      for (const u of chapterUnits)
        if (!chStart || u.orderIndex < chStart.orderIndex) chStart = u;
      g2.add((chStart ? chStart.id : cu.id) + "~" + cu.id);
      g3.add(cu.id);
    }
    console.log(
      `${day}: 출석 ${attended.length} · 못읽음 ${none} · 갈래 ①현행 ${g1.size} ②대단원 ${g2.size} ③소단원 ${g3.size}`,
    );
  }
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
