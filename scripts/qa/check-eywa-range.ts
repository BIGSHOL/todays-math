/**
 * 동기화된 학생별 진도가 **확인테스트 기본 범위**로 실제로 이어지는가
 * (계획 3판 §7 완료 조건).
 *
 *   npx tsx --env-file=.env scripts/qa/check-eywa-range.ts [학생이름]
 *
 * `/api/tests/default-range` 라우트가 부르는 **바로 그 함수들**
 * (`getCurrentProgress` · `resolveDefaultReviewRange`)에 동기화된 실데이터를
 * 물린다 — 흉내를 두면 라우트가 바뀔 때 이 검사만 옛것을 잰다.
 */
import { PrismaClient } from "@prisma/client";

import { resolveDefaultReviewRange } from "@/lib/generator/defaultReviewRange";
import { getCurrentProgress } from "@/lib/progressResolver";

async function main() {
  const name = process.argv[2] ?? "김태희A";
  const prisma = new PrismaClient();
  const student = await prisma.student.findFirst({
    where: { eywaStudentId: { not: null }, name },
    select: {
      id: true,
      name: true,
      classId: true,
      useIndividualProgress: true,
    },
  });
  if (!student) throw new Error(`연계 학생이 없다: ${name}`);

  const [rows, units] = await Promise.all([
    prisma.progress.findMany({
      where: { studentId: student.id },
      select: {
        id: true,
        classId: true,
        studentId: true,
        unitId: true,
        recordedAt: true,
        createdAt: true,
      },
    }),
    prisma.unit.findMany(),
  ]);
  const current = getCurrentProgress({
    classProgress: [],
    studentProgress: rows.map((r) => ({
      ...r,
      recordedAt: r.recordedAt.toISOString().slice(0, 10),
      createdAt: r.createdAt.toISOString(),
    })),
    useIndividualProgress: student.useIndividualProgress,
  });
  console.log(
    `학생 ${student.name} · useIndividualProgress ${student.useIndividualProgress} · 진도 행 ${rows.length}`,
  );
  if (!current) throw new Error("현재 진도가 없다 — 동기화를 먼저 돌려라.");

  const range = resolveDefaultReviewRange({
    units,
    currentUnitId: current.unitId,
    lastReviewEndUnitId: null,
    progressUnitIds: rows.map((r) => r.unitId),
  });
  if (!range) throw new Error("범위가 안 나온다.");
  const byId = new Map(units.map((u) => [u.id, u]));
  const start = byId.get(range.startUnitId)!;
  const end = byId.get(range.endUnitId)!;
  console.log(
    `✅ 확인테스트 기본 범위: ${start.grade} ${start.chapter} › ${start.section}  ~  ${end.grade} ${end.chapter} › ${end.section}`,
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
