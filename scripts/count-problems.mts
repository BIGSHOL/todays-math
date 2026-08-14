import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const total = await prisma.problem.count();
const byPool = await prisma.problem.groupBy({ by: ["pool"], _count: true });
const bySource = await prisma.problem.groupBy({
  by: ["source"],
  _count: true,
});
const byReview = await prisma.problem.groupBy({
  by: ["reviewStatus"],
  _count: true,
});
const byDirect = await prisma.problem.groupBy({
  by: ["directUseAllowed"],
  _count: true,
});
const byGrade = await prisma.problem.groupBy({
  by: ["unitId"],
  _count: true,
});
const units = await prisma.unit.findMany({
  select: { id: true, grade: true, chapter: true, section: true },
});
const umap = new Map(units.map((unit) => [unit.id, unit]));
const gradeCounts: Record<string, number> = {};
const chapterCounts: Array<{
  grade: string;
  chapter: string | undefined;
  section: string | undefined;
  n: number;
}> = [];
for (const row of byGrade) {
  const unit = umap.get(row.unitId);
  const grade = unit?.grade ?? "unknown";
  gradeCounts[grade] = (gradeCounts[grade] ?? 0) + row._count;
  chapterCounts.push({
    grade,
    chapter: unit?.chapter,
    section: unit?.section,
    n: row._count,
  });
}
chapterCounts.sort((a, b) => b.n - a.n);
const unitsWith = new Set(byGrade.map((row) => row.unitId));
const emptyByGrade: Record<string, number> = {};
for (const unit of units) {
  if (unitsWith.has(unit.id)) continue;
  emptyByGrade[unit.grade] = (emptyByGrade[unit.grade] ?? 0) + 1;
}

console.log(
  JSON.stringify(
    {
      total,
      byPool,
      bySource,
      byReview,
      byDirect,
      gradeCounts,
      top20: chapterCounts.slice(0, 20),
      unitsTotal: units.length,
      unitsWithProblems: byGrade.length,
      unitsEmpty: units.length - byGrade.length,
      emptyByGrade,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
