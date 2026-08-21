/**
 * eywa 학생별 진도 → 우리 DB 동기화 (계획 3판 §4).
 *
 *   npx tsx --env-file=.env scripts/sync/sync-eywa.ts            # dry-run (기본)
 *   ALLOW_EYWA_SYNC=1 npx tsx --env-file=.env scripts/sync/sync-eywa.ts   # 실쓰기
 *
 * ## 구조 — 리뷰 3인이 정한 모양
 *
 * ① 수집: `EYWA_TRANSPORT`(db|api, 폴백 없음 — codex #12)로 전량을 메모리에 받고
 *    zod·total 을 검증한다. 비-200 은 «빈 것»이 아니라 실패다(grok #5).
 * ② 계획: 순수 함수(`syncPlan.ts`)가 반·학생·진도 행을 계산한다.
 * ③ 원장: 적용 **전에** 이번 실행이 바꿀 행의 before 를 회차별 파일로 남긴다
 *    (파일 = runId 단위라 덮어쓰기가 구조적으로 없다 — 2026-08-20 교훈).
 * ④ 적용: advisory lock(동시 실행 금지 — codex #14) + **한 트랜잭션**
 *    (부분 적용 없음 — codex #13). 죽으면 다음 실행이 처음부터.
 *
 * 미분류·애매·수학반 밖 진도는 **건수+원문**으로 찍는다. 조용히 버리지 않는다.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { createEywaClient } from "@/lib/eywa/client";
import { buildUnitIndex, type UnitRow } from "@/lib/eywa/resolveProgress";
import {
  classGradeOf,
  planStudentProgress,
  primaryClassOf,
  schoolFieldsOf,
  type EywaReport,
} from "@/lib/eywa/syncPlan";
import {
  fetchViaApi,
  fetchViaDb,
  requiredTransport,
  type EywaSnapshot,
} from "@/lib/eywa/transport";

const APPLY = process.env.ALLOW_EYWA_SYNC === "1";
const LEDGER_DIR = path.join(process.cwd(), "scripts", "sync", "ledgers");
/** 우리 DB advisory lock 키 — 'eywa-sync' 의 해시 앞 15자리(안정적 상수). */
const LOCK_KEY = BigInt.asIntN(
  63,
  BigInt(
    "0x" + createHash("sha256").update("eywa-sync").digest("hex").slice(0, 15),
  ),
);

async function collect(): Promise<EywaSnapshot> {
  const transport = requiredTransport();
  if (transport === "api") return fetchViaApi();
  const eywa = createEywaClient();
  try {
    return await fetchViaDb(eywa);
  } finally {
    await eywa.$disconnect();
  }
}

async function main() {
  const runId = `eywa-sync-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const prisma = new PrismaClient();

  // ── ① 수집·검증 ─────────────────────────────────────────────
  const snapshot = await collect();
  const { roster, reports, progressTotal } = snapshot;
  if (roster.students.length !== roster.total)
    throw new Error(
      `roster 불변식 위반: students ${roster.students.length} != total ${roster.total}`,
    );
  // 🔴 «빈 가드»의 축(grok #5): roster 가 통째로 비면 정상일 수 없다 — 멈춘다.
  //    progress 는 받은 수 < total 이면 경고만(스캔 중 삽입 — 다음 실행이 수렴).
  if (roster.total === 0)
    throw new Error("roster 가 비었다 — eywa 쪽 장애로 보고 중단한다.");
  const progressGap = progressTotal - reports.length;
  if (Math.abs(progressGap) > 0)
    console.warn(
      `⚠️ progress 받은 수 ${reports.length} != total ${progressTotal} (차이 ${progressGap}) — 다음 전량 실행이 수렴시킨다`,
    );

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

  const owner = await prisma.user.findUnique({
    where: { email: process.env.EYWA_SYNC_OWNER_EMAIL ?? "" },
    select: { id: true, email: true },
  });
  if (!owner)
    throw new Error(
      `EYWA_SYNC_OWNER_EMAIL 계정이 없다: ${process.env.EYWA_SYNC_OWNER_EMAIL}`,
    );

  // ── ② 계획 ──────────────────────────────────────────────────
  // 반: roster 에 나온 활성 수학반 전부. 학년은 소속 학생 학년의 최빈값.
  const classMembers = new Map<
    string,
    { name: string; grades: (string | null)[] }
  >();
  for (const student of roster.students)
    for (const cls of student.classes) {
      const entry = classMembers.get(cls.id) ?? { name: cls.name, grades: [] };
      entry.name = cls.name;
      entry.grades.push(student.grade);
      classMembers.set(cls.id, entry);
    }

  const rosterIds = new Set(roster.students.map((s) => s.id));
  const byStudentReports = new Map<string, EywaReport[]>();
  let 명단밖진도 = 0;
  const 명단밖학생 = new Set<string>();
  for (const report of reports) {
    if (!rosterIds.has(report.studentId)) {
      // 진도는 있는데 활성 수학반 밖(실측 5명) — 건너뛰되 센다(codex #6).
      명단밖진도 += 1;
      명단밖학생.add(report.studentId);
      continue;
    }
    const list = byStudentReports.get(report.studentId) ?? [];
    list.push(report);
    byStudentReports.set(report.studentId, list);
  }

  const progressPlans = new Map<
    string,
    ReturnType<typeof planStudentProgress>
  >();
  let 애매 = 0;
  let 시험기간만 = 0;
  const 미분류 = new Map<string, number>();
  for (const [studentId, list] of byStudentReports) {
    const plan = planStudentProgress(index, list);
    progressPlans.set(studentId, plan);
    애매 += plan.ambiguous;
    시험기간만 += plan.examOnly;
    for (const raw of plan.unresolved)
      미분류.set(raw, (미분류.get(raw) ?? 0) + 1);
  }

  // ── 요약 (dry-run 의 산출물이자 실쓰기의 전조) ────────────────
  const plannedRows = [...progressPlans.values()].reduce(
    (a, p) => a + p.rows.length,
    0,
  );
  const 진도있는학생 = [...progressPlans.values()].filter(
    (p) => p.rows.length > 0,
  ).length;
  console.log(
    `\n=== eywa 동기화 ${APPLY ? "(실쓰기)" : "(dry-run)"} · ${runId} ===`,
  );
  console.log(
    `분모 셋(grok #6): 수학 재원 ${roster.total}명 · 진도 보고서 있는 학생 ${byStudentReports.size}명 · 진도 행이 생기는 학생 ${진도있는학생}명`,
  );
  console.log(
    `반 ${classMembers.size}개 · 진도 보고서 ${reports.length}건 → 진도 행 ${plannedRows}개`,
  );
  console.log(
    `애매(자동 선택 안 함) ${애매}건 · 시험기간만 적힌 보고서 ${시험기간만}건 · 명단 밖 진도 ${명단밖진도}건(학생 ${명단밖학생.size}명)`,
  );
  console.log(
    `미분류 ${[...미분류.values()].reduce((a, b) => a + b, 0)}줄 / ${미분류.size}종 — 상위 10:`,
  );
  for (const [raw, n] of [...미분류].sort((a, b) => b[1] - a[1]).slice(0, 10))
    console.log(`  ${String(n).padStart(4)}회  «${raw.slice(0, 64)}»`);

  if (!APPLY) {
    console.log(
      "\ndry-run — 아무것도 쓰지 않았다. 실쓰기는 ALLOW_EYWA_SYNC=1.",
    );
    await prisma.$disconnect();
    return;
  }

  // ── ③ 원장 (적용 전에, 회차별 파일로) ─────────────────────────
  const beforeStudents = await prisma.student.findMany({
    where: { eywaStudentId: { not: null } },
    select: {
      id: true,
      eywaStudentId: true,
      name: true,
      classId: true,
      eywaWithdrawnAt: true,
    },
  });
  const beforeClasses = await prisma.class.findMany({
    where: { eywaClassId: { not: null } },
    select: { id: true, eywaClassId: true, name: true, grade: true },
  });
  // 진도는 «전체 삭제 → createMany»로 적용하므로(행별 upsert 13,571번은 원격
  // 왕복 ~17분 — 트랜잭션 타임아웃을 넘는다) 원장에 **행 전체**를 남긴다.
  const beforeProgressRows = await prisma.progress.findMany({
    where: { eywaReportId: { not: null } },
    select: {
      eywaReportId: true,
      unitId: true,
      classId: true,
      studentId: true,
      recordedAt: true,
      createdAt: true,
    },
  });
  mkdirSync(LEDGER_DIR, { recursive: true });
  const ledgerPath = path.join(LEDGER_DIR, `${runId}.json`);
  writeFileSync(
    ledgerPath,
    JSON.stringify(
      {
        runId,
        transport: requiredTransport(),
        before: {
          students: beforeStudents,
          classes: beforeClasses,
          progressRows: beforeProgressRows,
        },
        planned: {
          classes: classMembers.size,
          students: roster.total,
          progressRows: plannedRows,
        },
      },
      null,
      1,
    ),
    "utf8",
  );
  console.log(`\n원장: ${ledgerPath}`);

  // ── ④ 적용 — advisory lock + 한 트랜잭션 ─────────────────────
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`select pg_advisory_xact_lock(${LOCK_KEY})`);

      // 반 upsert — grade 는 최빈값. userId 는 생성 때만(소유 이관은 수동).
      const ourClassId = new Map<string, string>();
      for (const [eywaClassId, info] of classMembers) {
        const grade = classGradeOf(info.grades) ?? "중1";
        const row = await tx.class.upsert({
          where: { eywaClassId },
          create: {
            eywaClassId,
            name: info.name,
            grade,
            userId: owner.id,
            difficultyRatio: { easy: 3, mid: 4, hard: 1 },
          },
          update: { name: info.name, grade },
          select: { id: true },
        });
        ourClassId.set(eywaClassId, row.id);
      }

      // 학생 upsert — 주반 규칙 + 학교 필드 + 개별 진도 켜기.
      const ourStudentId = new Map<string, string>();
      for (const student of roster.students) {
        const primary = primaryClassOf(student.classes);
        if (!primary) continue; // 활성 수학반이 없으면 이 연계의 대상이 아니다
        const school = schoolFieldsOf(student.grade);
        const row = await tx.student.upsert({
          where: { eywaStudentId: student.id },
          create: {
            eywaStudentId: student.id,
            name: student.name,
            classId: ourClassId.get(primary.id)!,
            useIndividualProgress: true,
            schoolName: student.school?.slice(0, 50) ?? null,
            schoolLevel: school.schoolLevel,
            schoolGrade: school.schoolGrade,
          },
          update: {
            name: student.name,
            classId: ourClassId.get(primary.id)!,
            useIndividualProgress: true,
            schoolName: student.school?.slice(0, 50) ?? null,
            schoolLevel: school.schoolLevel,
            schoolGrade: school.schoolGrade,
            eywaWithdrawnAt: null, // 돌아온 학생은 표시를 푼다
          },
          select: { id: true },
        });
        ourStudentId.set(student.id, row.id);
      }

      // 대사 ①: roster 에 없는 연계 학생 → 퇴원 표시(삭제 아님 — 이력 보존).
      const withdrawn = await tx.student.updateMany({
        where: {
          eywaStudentId: { not: null, notIn: [...rosterIds] },
          eywaWithdrawnAt: null,
        },
        data: { eywaWithdrawnAt: new Date() },
      });

      // 진도 — **연계 행 전체 삭제 → createMany.** 행별 upsert 는 원격 왕복
      // 13,571번(~17분)이라 못 쓴다. Progress 를 가리키는 FK 는 없고(스키마 확인)
      // 소비자는 살아 있는 행만 읽으므로 행 id 가 갈려도 안전하다. 지워진·바뀐
      // 보고서의 대사(grok #9)도 전체 교체가 자동으로 해결한다.
      const deleted = await tx.progress.deleteMany({
        where: { eywaReportId: { not: null } },
      });
      const rowsToCreate: Array<{
        eywaReportId: string;
        unitId: string;
        classId: string;
        studentId: string;
        recordedAt: Date;
        createdAt: Date;
      }> = [];
      for (const [eywaStudentId, plan] of progressPlans) {
        const studentId = ourStudentId.get(eywaStudentId);
        if (!studentId) continue;
        const primary = primaryClassOf(
          roster.students.find((s) => s.id === eywaStudentId)!.classes,
        )!;
        const classId = ourClassId.get(primary.id)!;
        for (const row of plan.rows)
          rowsToCreate.push({
            eywaReportId: row.eywaReportId,
            unitId: row.unitId,
            classId,
            studentId,
            recordedAt: new Date(`${row.recordedAt}T00:00:00Z`),
            createdAt: row.createdAt,
          });
      }
      for (let at = 0; at < rowsToCreate.length; at += 2000)
        await tx.progress.createMany({
          data: rowsToCreate.slice(at, at + 2000),
        });

      console.log(
        `적용: 반 ${ourClassId.size} · 학생 ${ourStudentId.size} · 퇴원 표시 ${withdrawn.count} · 진도 삭제 ${deleted.count} → 생성 ${rowsToCreate.length}`,
      );
    },
    { timeout: 300_000 },
  );

  // 검산 — 완료 조건 §7: 연계 학생 수 == roster.
  const linked = await prisma.student.count({
    where: { eywaStudentId: { not: null }, eywaWithdrawnAt: null },
  });
  console.log(
    `\n검산: 연계 학생(활성) ${linked}명 == roster ${roster.total}명 → ${linked === roster.total ? "✅" : "❌"}`,
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
