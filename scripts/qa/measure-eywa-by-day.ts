/**
 * 날짜별 실측 — 「그날 수업한 학생」이 몇 명·몇 갈래인가 (2단계 Wire 데이터 ②).
 * 최근 14일의 수업일마다: 보고서 있는 학생 수, 그 학생들의 현재 진도 갈래 수.
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  const rows = await prisma.progress.findMany({
    where: { eywaReportId: { not: null } },
    select: {
      studentId: true,
      unitId: true,
      recordedAt: true,
      createdAt: true,
    },
    orderBy: { recordedAt: "desc" },
  });
  const byDay = new Map<
    string,
    Map<string, { unitId: string; createdAt: string }>
  >();
  for (const r of rows) {
    const day = r.recordedAt.toISOString().slice(0, 10);
    const m = byDay.get(day) ?? new Map();
    const prev = m.get(r.studentId!);
    const ca = r.createdAt.toISOString();
    if (!prev || ca > prev.createdAt)
      m.set(r.studentId!, { unitId: r.unitId, createdAt: ca });
    byDay.set(day, m);
  }
  const days = [...byDay.keys()].sort().slice(-14);
  console.log("날짜별 — 학생 수 · 그날의 «마지막 진도 단원» 종류 수");
  for (const day of days) {
    const m = byDay.get(day)!;
    const units = new Set([...m.values()].map((v) => v.unitId));
    console.log(
      `  ${day}: 학생 ${String(m.size).padStart(3)} · 진도 갈래 ${units.size}`,
    );
  }
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
