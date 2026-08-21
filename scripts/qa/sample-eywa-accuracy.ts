/**
 * 동기화 정확도 표본 (계획 3판 §7, codex #23).
 *
 *   npx tsx --env-file=.env scripts/qa/sample-eywa-accuracy.ts [--n 30] [--seed 21]
 *
 * «현재 진도가 잡혔다»(처리율 100%)는 «맞는 단원이 잡혔다»가 아니다. 그래서
 * 무작위 N명에 대해 **제품이 실제로 읽는 값**(getCurrentProgress — 최신 Progress
 * 행)과 eywa 의 최근 진도 원문을 나란히 찍는다. 판정은 눈이 한다 — 이 스크립트는
 * 대조표만 만든다(스스로 채점하면 지표의 «참»이 제품에서 나온다).
 *
 * 무작위는 seed 로 재현 가능 — 다시 돌려도 같은 표본이 나와야 «고치기 전에 본
 * 것»을 다시 볼 수 있다(CLAUDE.md 2026-08-18).
 */
import { PrismaClient } from "@prisma/client";

import { createEywaClient, eywaQuery } from "@/lib/eywa/client";
import { getCurrentProgress } from "@/lib/progressResolver";

const arg = (name: string, fallback: number) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? Number(process.argv[at + 1]) : fallback;
};
const N = arg("n", 30);
const SEED = arg("seed", 21);

/** mulberry32 — 표준 라이브러리에 seeded RNG 가 없어서. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const prisma = new PrismaClient();
  const students = await prisma.student.findMany({
    where: { eywaStudentId: { not: null }, eywaWithdrawnAt: null },
    select: { id: true, eywaStudentId: true, name: true, classId: true },
    orderBy: { eywaStudentId: "asc" },
  });
  const random = rng(SEED);
  const sample = [...students].sort(() => random() - 0.5).slice(0, N);

  const eywa = createEywaClient();
  console.log(
    `표본 ${sample.length}명 (seed ${SEED}) — 왼쪽이 제품이 읽는 값, 오른쪽이 eywa 원문\n`,
  );

  let 자리 = 0;
  for (const student of sample) {
    const rows = await prisma.progress.findMany({
      where: { studentId: student.id },
      select: {
        id: true,
        classId: true,
        studentId: true,
        unitId: true,
        recordedAt: true,
        createdAt: true,
      },
    });
    const current = getCurrentProgress({
      classProgress: [],
      studentProgress: rows.map((r) => ({
        ...r,
        recordedAt: r.recordedAt.toISOString().slice(0, 10),
        createdAt: r.createdAt.toISOString(),
      })),
      useIndividualProgress: true,
    });
    const unit = current
      ? await prisma.unit.findUnique({
          where: { id: current.unitId },
          select: { grade: true, chapter: true, section: true },
        })
      : null;

    const raw = await eywaQuery<{ report_date: string; progress: string }>(
      eywa,
      `select report_date::text, progress from lesson_reports
        where student_id = $1::uuid and progress is not null
        order by report_date desc, created_at desc limit 3`,
      student.eywaStudentId,
    );

    자리 += 1;
    console.log(`── ${String(자리).padStart(2)} ${student.name} ──`);
    console.log(
      `  제품: ${current ? `[${current.recordedAt}] ${unit?.grade} ${unit?.chapter} › ${unit?.section}` : "(진도 없음)"}`,
    );
    for (const r of raw)
      console.log(
        `  eywa [${r.report_date}] ${r.progress.replace(/\n/g, " / ").slice(0, 90)}`,
      );
  }

  await eywa.$disconnect();
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
