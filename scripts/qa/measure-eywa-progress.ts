/**
 * eywa 진도 판정기를 **실데이터로 잰다.**
 *
 *   npx tsx scripts/qa/measure-eywa-progress.ts [--days 120] [--samples 30]
 *
 * ## 왜 필요한가
 *
 * 단위 테스트는 「우리 코드가 맞나」만 본다. 「eywa 가 실제로 무엇을 주나」는
 * 한 번은 실물로 찍어 봐야 한다(CLAUDE.md 2026-08-19 — AI 를 전부 모킹했다가
 * 실물에서 실패한 그 자리와 같은 성질이다).
 *
 * 🔴 **제품 판정기를 그대로 부른다.** 여기에 규칙을 옮겨 적으면, 제품이 바뀔 때
 *    이 계량기만 옛 규칙을 재고 갈라져도 아무도 모른다.
 *
 * 🔴 **미분류를 반드시 눈에 보이게 찍는다.** 「N% 풀렸다」만 적으면 못 푼 부류가
 *    구조적으로 안 보인다. 이 저장소가 여러 번 겪은 자리다.
 *
 * eywa 는 **읽기만** 한다 — SELECT 뿐이다.
 */
import { PrismaClient } from "@prisma/client";

import {
  buildUnitIndex,
  resolveProgressText,
  type UnitRow,
} from "@/lib/eywa/resolveProgress";
import { createEywaClient, eywaQuery } from "@/lib/eywa/client";

const arg = (name: string, fallback: number) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? Number(process.argv[at + 1]) : fallback;
};
const DAYS = arg("days", 120);
const SAMPLES = arg("samples", 30);

interface ReportRow {
  student_id: string;
  name: string;
  grade: string | null;
  report_date: Date;
  progress: string | null;
}

async function main() {
  const prisma = new PrismaClient();
  const eywa = createEywaClient();

  const units = (await prisma.unit.findMany({
    select: {
      id: true,
      grade: true,
      chapter: true,
      section: true,
      orderIndex: true,
    },
  })) as UnitRow[];
  const index = buildUnitIndex(units);
  console.log(`우리 단원 ${units.length}개로 색인을 만들었다.`);

  const rows = await eywaQuery<ReportRow>(
    eywa,
    `select r.student_id, s.name, s.grade, r.report_date, r.progress
       from lesson_reports r join students s on s.id = r.student_id
      where s.status = 'enrolled' and r.progress is not null
        and r.report_date > current_date - $1::int
      order by r.report_date`,
    DAYS,
  );
  console.log(`eywa 재원생 진도 보고서 ${rows.length}건 (최근 ${DAYS}일)\n`);

  const kinds = new Map<string, number>();
  const unresolved = new Map<string, number>();
  /** 학생 → 마지막으로 «진도»가 잡힌 판정. */
  const byStudent = new Map<
    string,
    {
      name: string;
      grade: string | null;
      near: number | null;
      date: Date;
      kind: string;
      chapters: Set<string>;
    }
  >();
  let 시험기간날 = 0;

  for (const row of rows) {
    const before = byStudent.get(row.student_id);
    const verdict = resolveProgressText(index, row.progress, {
      nearOrderIndex: before?.near ?? null,
    });
    for (const line of verdict.lines)
      kinds.set(line.kind, (kinds.get(line.kind) ?? 0) + 1);
    for (const raw of verdict.unresolved)
      unresolved.set(raw, (unresolved.get(raw) ?? 0) + 1);
    if (verdict.examPeriod && !verdict.current) 시험기간날 += 1;
    if (!verdict.current) continue;
    byStudent.set(row.student_id, {
      name: row.name,
      grade: row.grade,
      near: verdict.furthestOrderIndex,
      date: row.report_date,
      kind: verdict.current.kind,
      chapters: new Set(
        verdict.current.units.map((u) => `${u.grade} ${u.chapter}`),
      ),
    });
  }

  const 총줄 = [...kinds.values()].reduce((a, b) => a + b, 0);
  console.log("=== 진도 원문 한 줄씩의 판정 ===");
  for (const [kind, n] of [...kinds].sort((a, b) => b[1] - a[1]))
    console.log(
      `  ${kind.padEnd(8)} ${String(n).padStart(5)}줄  ${((n / 총줄) * 100).toFixed(1)}%`,
    );
  console.log(`  (합 ${총줄}줄)`);

  const 전체학생 = new Set(rows.map((r) => r.student_id));
  const 애매 = [...byStudent.values()].filter(
    (v) => v.kind === "애매" || v.chapters.size > 1,
  );
  console.log(`\n=== 학생 ===`);
  console.log(`진도 보고서가 있는 재원생        ${전체학생.size}명`);
  console.log(
    `**현재 진도가 잡힌 학생**        ${byStudent.size}명 (${((byStudent.size / 전체학생.size) * 100).toFixed(1)}%)`,
  );
  console.log(
    `그중 대단원이 하나로 정해진 학생 ${byStudent.size - 애매.length}명 · 애매 ${애매.length}명`,
  );
  console.log(`진도 없이 시험기간만 적힌 날     ${시험기간날}건`);

  console.log(
    `\n🔴 미분류 상위 ${SAMPLES} (${unresolved.size}종 / ${[...unresolved.values()].reduce((a, b) => a + b, 0)}줄) — 눈으로 볼 것:`,
  );
  for (const [raw, n] of [...unresolved]
    .sort((a, b) => b[1] - a[1])
    .slice(0, SAMPLES))
    console.log(`  ${String(n).padStart(4)}회  «${raw.slice(0, 68)}»`);

  if (애매.length) {
    console.log(`\n애매 (자동으로 안 고른다):`);
    for (const v of 애매.slice(0, 10))
      console.log(`  ${v.grade} ${v.name} → ${[...v.chapters].join(" | ")}`);
  }

  // 그 단원에 낼 문항이 있는가 — 「연결은 됐는데 못 낸다」를 미리 본다.
  const chapterKeys = new Set(
    [...byStudent.values()].flatMap((v) => [...v.chapters]),
  );
  const unitIds = units
    .filter((u) => chapterKeys.has(`${u.grade} ${u.chapter}`))
    .map((u) => u.id);
  const counts = await prisma.problem.groupBy({
    by: ["unitId"],
    where: {
      unitId: { in: unitIds },
      reviewStatus: "approved",
      directUseAllowed: true,
    },
    _count: { _all: true },
  });
  const perUnit = new Map(counts.map((c) => [c.unitId, c._count._all]));
  const perChapter = new Map<string, number>();
  for (const u of units) {
    const key = `${u.grade} ${u.chapter}`;
    if (!chapterKeys.has(key)) continue;
    perChapter.set(key, (perChapter.get(key) ?? 0) + (perUnit.get(u.id) ?? 0));
  }
  const 학년별 = new Map<string, { 학생: number; 대단원8미만: number }>();
  for (const v of byStudent.values()) {
    const grade = [...v.chapters][0]?.split(" ")[0] ?? "?";
    const row = 학년별.get(grade) ?? { 학생: 0, 대단원8미만: 0 };
    row.학생 += 1;
    const total = [...v.chapters].reduce(
      (a, c) => a + (perChapter.get(c) ?? 0),
      0,
    );
    if (total < 8) row.대단원8미만 += 1;
    학년별.set(grade, row);
  }
  console.log(`\n=== 그 학생의 **대단원 전체**로 낼 수 있는 문항 ===`);
  console.table(
    Object.fromEntries([...학년별].sort((a, b) => b[1].학생 - a[1].학생)),
  );

  await eywa.$disconnect();
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
