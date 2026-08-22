/**
 * 2단계 시안용 실측 — **「그날 수업한 학생」이 몇 명·몇 갈래인가** (D-07 Wire 데이터).
 *
 *   npx tsx --env-file=.env scripts/qa/measure-eywa-daily-groups.ts [YYYY-MM-DD]
 *
 * 시안은 «가장 큰 실데이터»로 세운다(CLAUDE.md 2026-08-19). 기본 기준일은
 * 최근 14일 중 학생이 가장 많던 2026-08-10(92명·진도 갈래 51 실측).
 *
 * 전부 **제품 함수 그대로** 계산한다 — `getCurrentProgress` ·
 * `resolveDefaultReviewRange` · `findEligibleProblems`. 보고서 원문(미분류 예외)은
 * 운영 API(`fetchViaApi`)에서 그대로 가져온다. 흉내 데이터 금지.
 *
 * 산출물: src/app/dev/eywa-daily-wire/data-<기준일>.json
 */
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PrismaClient } from "@prisma/client";

import { buildUnitIndex } from "@/lib/eywa/resolveProgress";
import { planStudentProgress } from "@/lib/eywa/syncPlan";
import { fetchViaApi } from "@/lib/eywa/transport";
import { findEligibleProblems } from "@/lib/findEligibleProblems";
import { resolveDefaultReviewRange } from "@/lib/generator/defaultReviewRange";
import { getCurrentProgress } from "@/lib/progressResolver";

const LEDGER_DIR = join(process.cwd(), "scripts", "sync", "ledgers");
const OUT_DIR = join(process.cwd(), "src", "app", "dev", "eywa-daily-wire");
const DAY = process.argv[2] ?? "2026-08-10";
/**
 * 첫 회 범위 정책 (원장님 확정 2026-08-21): 직전 확인테스트가 없으면 **현재
 * 대단원 처음~현재**. "chapter" 를 세 번째 인자로 주면 그 정책으로 계산한다
 * (Hi-fi 시안용 — 제품 반영은 별도 TDD 트랙).
 */
const FIRST_RUN = process.argv[3] ?? "history";

async function main() {
  const prisma = new PrismaClient();

  // ── 마지막 동기화 — 화면의 「마지막 동기화」 표시용 (원장 파일 mtime) ────────
  const ledgerFile = readdirSync(LEDGER_DIR)
    .filter((f) => f.startsWith("eywa-sync-"))
    .sort()
    .at(-1)!;
  const syncedAt = statSync(join(LEDGER_DIR, ledgerFile)).mtime.toISOString();

  const owner = await prisma.user.findFirst({
    where: {
      email: process.env.EYWA_SYNC_OWNER_EMAIL ?? "import@todays-math.local",
    },
    select: { id: true },
  });
  if (!owner) throw new Error("동기화 소유 계정이 없다.");

  const [students, units] = await Promise.all([
    prisma.student.findMany({
      where: { eywaStudentId: { not: null }, eywaWithdrawnAt: null },
      select: {
        id: true,
        eywaStudentId: true,
        name: true,
        schoolLevel: true,
        schoolGrade: true,
        useIndividualProgress: true,
        class: { select: { id: true, name: true, grade: true } },
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

  // ── 가명화 — 저장소에 실명을 남기지 않는다(eywaContract 픽스처와 같은 규칙).
  // 실제 화면에는 실명이 나온다. 매핑은 이름 사전순이라 같은 입력이면 결정적이다.
  const SUR = "김이박최정강조윤장임한오서신권황안송전홍".split("");
  const GIV = [
    "민준",
    "서연",
    "도윤",
    "하은",
    "시우",
    "지우",
    "주원",
    "서준",
    "예린",
    "지호",
    "수아",
    "은우",
    "다은",
    "건우",
    "유나",
    "현우",
    "소율",
    "지안",
    "태윤",
    "가은",
    "선우",
    "리안",
    "윤서",
    "이준",
    "채원",
    "시현",
    "나윤",
    "정우",
    "하린",
    "준서",
  ];
  const realNames = [...new Set(students.map((s) => s.name))].sort((a, b) =>
    a.localeCompare(b, "ko"),
  );
  const alias = new Map<string, string>();
  realNames.forEach((real, i) => {
    const base =
      SUR[i % SUR.length] + GIV[Math.floor(i / SUR.length) % GIV.length];
    const nth = Math.floor(i / (SUR.length * GIV.length));
    alias.set(real, nth === 0 ? base : base + String.fromCharCode(65 + nth));
  });
  const anon = (name: string) => alias.get(name) ?? name;
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
  const progressByStudent = new Map<string, typeof progressAll>();
  for (const row of progressAll) {
    if (!row.studentId) continue;
    const list = progressByStudent.get(row.studentId) ?? [];
    list.push(row);
    progressByStudent.set(row.studentId, list);
  }

  // ── 운영 API 에서 보고서 원문 — 그날 «보고서는 있는데 진도를 못 읽은» 학생 ──
  console.log("운영 API 에서 보고서를 받는 중…");
  const snapshot = await fetchViaApi();
  const reportsByEywaStudent = new Map<string, typeof snapshot.reports>();
  for (const r of snapshot.reports) {
    const list = reportsByEywaStudent.get(r.studentId) ?? [];
    list.push(r);
    reportsByEywaStudent.set(r.studentId, list);
  }
  const dayReports = snapshot.reports.filter((r) => r.reportDate === DAY);
  const attendedEywaIds = [...new Set(dayReports.map((r) => r.studentId))];

  // ── 전체 미분류·애매 — 동기화 보고 스트립용 (제품 계획 함수 그대로) ─────────
  const index = buildUnitIndex(units);
  let unresolvedLines = 0;
  const unresolvedKinds = new Set<string>();
  let ambiguous = 0;
  for (const [eywaId, reports] of reportsByEywaStudent) {
    if (!byEywaId.has(eywaId)) continue;
    const plan = planStudentProgress(index, reports);
    unresolvedLines += plan.unresolved.length;
    for (const u of plan.unresolved) unresolvedKinds.add(u);
    ambiguous += plan.ambiguous;
  }

  // ── 그날 출석 학생별: 기준일까지의 진도로 현재·기본 범위 계산 ───────────────
  interface StudentEntry {
    name: string;
    grade: string;
    className: string;
  }
  interface Group {
    key: string;
    startUnitId: string;
    endUnitId: string;
    students: StudentEntry[];
    schoolLevels: Set<string>;
  }
  const groups = new Map<string, Group>();
  const noProgressToday: Array<{
    name: string;
    grade: string;
    className: string;
    rawLines: string[];
  }> = [];
  const notLinked: string[] = [];

  for (const eywaId of attendedEywaIds) {
    const st = byEywaId.get(eywaId);
    if (!st) {
      notLinked.push(eywaId);
      continue;
    }
    const grade =
      st.schoolLevel && st.schoolGrade
        ? `${st.schoolLevel}${st.schoolGrade}`
        : (st.class?.grade ?? "?");
    const className = st.class?.name ?? "(반 없음)";
    const rows = (progressByStudent.get(st.id) ?? []).filter(
      (r) => r.recordedAt.toISOString().slice(0, 10) <= DAY,
    );
    const hasToday = rows.some(
      (r) => r.recordedAt.toISOString().slice(0, 10) === DAY,
    );
    if (!hasToday) {
      // 보고서는 있는데 그날 진도 행이 없다 — 미분류·시험기간·애매뿐이었던 날.
      const raw = dayReports
        .filter((r) => r.studentId === eywaId)
        .flatMap((r) => r.progress.split("\n"))
        .map((l) => l.trim())
        .filter(Boolean);
      noProgressToday.push({
        name: anon(st.name),
        grade,
        className,
        rawLines: raw,
      });
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
    let range = resolveDefaultReviewRange({
      units,
      currentUnitId: current.unitId,
      lastReviewEndUnitId: null,
      progressUnitIds: rows.map((r) => r.unitId),
    });
    if (!range) continue;
    if (FIRST_RUN === "chapter") {
      // 첫 회 = 현재 대단원 처음~현재 (원장님 확정). 직전 시험이 생기면
      // resolveDefaultReviewRange 의 확정 규칙이 그대로 이어받는다.
      const cu = unitById.get(current.unitId)!;
      let chStart = cu;
      for (const u of units)
        if (
          u.grade === cu.grade &&
          u.chapter === cu.chapter &&
          u.orderIndex < chStart.orderIndex
        )
          chStart = u;
      range = {
        startUnitId: chStart.id,
        endUnitId: cu.id,
        startedFrom: "progress-start",
      };
    }
    const key = `${range.startUnitId}~${range.endUnitId}`;
    const g = groups.get(key) ?? {
      key,
      startUnitId: range.startUnitId,
      endUnitId: range.endUnitId,
      students: [],
      schoolLevels: new Set<string>(),
    };
    g.students.push({ name: anon(st.name), grade, className });
    g.schoolLevels.add(st.schoolLevel ?? (/^초/.test(grade) ? "초" : "?"));
    groups.set(key, g);
  }

  // ── 갈래마다 승인 문항 수 (제품과 같은 자격 필터) ──────────────────────────
  const out = [] as Array<Record<string, unknown>>;
  for (const g of [...groups.values()]) {
    const start = unitById.get(g.startUnitId)!;
    const end = unitById.get(g.endUnitId)!;
    const rangeUnits = units.filter(
      (u) => u.orderIndex >= start.orderIndex && u.orderIndex <= end.orderIndex,
    );
    const pool = await findEligibleProblems({
      userId: owner.id,
      unitIds: rangeUnits.map((u) => u.id),
    });
    out.push({
      key: g.key,
      start: {
        grade: start.grade,
        chapter: start.chapter,
        section: start.section,
      },
      end: { grade: end.grade, chapter: end.chapter, section: end.section },
      unitCount: rangeUnits.length,
      students: g.students.sort((a, b) => a.name.localeCompare(b.name, "ko")),
      schoolLevels: [...g.schoolLevels].sort(),
      poolTotal: pool.length,
    });
    process.stdout.write(".");
  }
  console.log();
  out.sort(
    (a, b) =>
      (b.students as StudentEntry[]).length -
      (a.students as StudentEntry[]).length,
  );

  const summary = {
    measuredAt: new Date().toISOString(),
    day: DAY,
    sync: {
      ledger: ledgerFile,
      syncedAt,
      students: students.length,
      progressRows: progressAll.length,
      unresolvedLines,
      unresolvedKinds: unresolvedKinds.size,
      ambiguous,
    },
    totals: {
      attended: attendedEywaIds.length - notLinked.length,
      withRange: out.reduce(
        (n, o) => n + (o.students as StudentEntry[]).length,
        0,
      ),
      groups: out.length,
      groupsLackingPool: out.filter((o) => (o.poolTotal as number) < 8).length,
      wideRangeGroups: out.filter((o) => (o.unitCount as number) > 30).length,
      noProgressToday: noProgressToday.length,
    },
    noProgressToday: noProgressToday.sort((a, b) =>
      a.name.localeCompare(b.name, "ko"),
    ),
    groups: out,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(
      OUT_DIR,
      FIRST_RUN === "chapter" ? `data-chapter-${DAY}.json` : `data-${DAY}.json`,
    ),
    JSON.stringify(summary, null, 1),
  );

  console.log(`기준일 ${DAY} — 시안 데이터 (${ledgerFile})`);
  console.log(
    `출석(보고서 있음) ${summary.totals.attended} · 범위 나옴 ${summary.totals.withRange} · 갈래 ${out.length}`,
  );
  console.log(
    `그날 진도 못 읽음 ${noProgressToday.length}명 · 문항 8개 미만 갈래 ${summary.totals.groupsLackingPool} · 30단원 넘는 갈래 ${summary.totals.wideRangeGroups}`,
  );
  console.log(
    `전체 미분류 ${unresolvedLines}줄(${unresolvedKinds.size}종) · 애매 ${ambiguous}`,
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
