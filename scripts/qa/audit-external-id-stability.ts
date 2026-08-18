/**
 * `externalId` 는 **안 바뀌는 값인가** — 실제 이관·재배정 이력으로 확인한다.
 *
 *   npx tsx scripts/qa/audit-external-id-stability.ts            # 요약
 *   npx tsx scripts/qa/audit-external-id-stability.ts --json     # scripts/qa/reports/ 에 기록
 *
 * ## 읽기 전용이다 — SELECT 만 한다 (D-31 공유 DB 쓰기 금지).
 *
 * ## 왜 「안정성」을 따로 재나
 * 원장님 결정(2026-08-18): 문항 식별자는 **숨은 값**이다. 숨은 값은 아무도 눈으로
 * 검산하지 않으므로 **틀려도 조용하다.** 그래서 「무엇이 바뀌면 번호가 바뀌는가」를
 * 문서가 아니라 **이력**으로 물어야 한다.
 *
 * 세 가지를 잰다.
 *  1. **번호의 재료가 바뀐 적이 있나** — 학년·단원 재배정 원장(scripts/classify·qa 의 reports)의
 *     이동 대상이 지금 DB 에서 실제로 옮겨져 있는지 대조한다. 「뜻이 담긴 번호」
 *     후보의 값이 여기서 갈린다.
 *  2. **앞자리(exam_id) 이름공간이 겹치나** — 적재 회차별로 접두어 범위를 재고,
 *     한 접두어가 여러 회차·여러 파일·여러 학교에 걸치는지 본다. 겹치면 다음 이관이
 *     **조용히 건너뛴다**(`selectMissingLoadRows` 는 externalId 가 같으면 삽입하지
 *     않는다 — 오류가 아니라 「이미 있음」으로 센다).
 *  3. **한 문항이 두 이름을 갖나 / 두 문항이 한 이름을 갖나** — 본문이 같은데
 *     externalId 가 갈린 행, examId·문항번호 쌍이 겹치는 행.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const OUT_DIR = path.join("scripts", "qa", "reports");
const OUT_FILE = path.join(OUT_DIR, "external-id-stability.json");

/** 단원·학년이 옮겨 다닌 원장들. 「이동」 목록의 필드 이름이 파일마다 다르다. */
const MOVE_LEDGERS: Array<{
  file: string;
  list: string;
  idKey: string;
  toKey?: string;
  what: string;
}> = [
  {
    file: "scripts/classify/reports/reassign-ledger.json",
    list: "이동",
    idKey: "id",
    toKey: "toUnitId",
    what: "단원 재배정 1차",
  },
  {
    file: "scripts/classify/reports/reassign2-ledger.json",
    list: "이동",
    idKey: "id",
    toKey: "toUnitId",
    what: "단원 재배정 2차 (본문 육안)",
  },
  {
    file: "scripts/classify/reports/reassign3-ledger.json",
    list: "이동",
    idKey: "id",
    toKey: "toUnitId",
    what: "단원 재배정 3차 (덩어리 규칙)",
  },
  {
    file: "scripts/classify/reports/hold-resolve-ledger.json",
    list: "이동",
    idKey: "id",
    toKey: "toUnitId",
    what: "보류 종결",
  },
  {
    file: "scripts/qa/unit-grade-plan.json",
    list: "moves",
    idKey: "problemId",
    toKey: "toUnitId",
    what: "학년 오배정 정정",
  },
];

function readLedger(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

function numericPrefix(externalId: string): number | null {
  const cut = externalId.lastIndexOf("-");
  if (cut <= 0) return null;
  const head = externalId.slice(0, cut);
  return /^\d+$/.test(head) ? Number(head) : null;
}

async function main() {
  const wantJson = process.argv.includes("--json");

  const rows = await prisma.problem.findMany({
    select: {
      id: true,
      externalId: true,
      source: true,
      unitId: true,
      examId: true,
      questionNumber: true,
      school: true,
      sourceFile: true,
      createdAt: true,
    },
    orderBy: { id: "asc" },
  });
  const units = await prisma.unit.findMany({
    select: { id: true, grade: true, chapter: true, section: true },
  });
  const unitById = new Map(units.map((u) => [u.id, u]));

  // ── 1. 번호의 «재료»가 바뀐 적이 있나 ────────────────────────────────
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const churn: Array<Record<string, unknown>> = [];
  let movedTotal = 0;
  let movedGradeChanged = 0;
  for (const ledger of MOVE_LEDGERS) {
    const json = readLedger(ledger.file);
    if (!json) {
      churn.push({ what: ledger.what, file: ledger.file, status: "없음" });
      continue;
    }
    const list = (json[ledger.list] ?? []) as Array<Record<string, string>>;
    let stillMoved = 0;
    let gradeChanged = 0;
    const examples: string[] = [];
    for (const move of list) {
      const row = rowById.get(move[ledger.idKey]);
      if (!row) continue;
      const to = ledger.toKey ? move[ledger.toKey] : undefined;
      if (to && row.unitId === to) stillMoved += 1;
      const fromUnit = unitById.get(move.fromUnitId ?? "");
      const nowUnit = unitById.get(row.unitId);
      if (fromUnit && nowUnit && fromUnit.grade !== nowUnit.grade) {
        gradeChanged += 1;
        if (examples.length < 3 && row.externalId)
          examples.push(
            `${row.externalId}: ${fromUnit.grade}/${fromUnit.section} → ${nowUnit.grade}/${nowUnit.section}`,
          );
      }
    }
    movedTotal += stillMoved;
    movedGradeChanged += gradeChanged;
    churn.push({
      what: ledger.what,
      계획: list.length,
      지금도이동상태: stillMoved,
      학년까지바뀜: gradeChanged,
      examples,
    });
  }

  // 아직 옮기지 못한 «틀린 것으로 판정된» 행 — 앞으로 더 움직인다는 뜻이다.
  const holdFile = readLedger("scripts/qa/unit-grade-hold.json");
  const holdCount = Array.isArray(holdFile?.rows)
    ? (holdFile.rows as unknown[]).length
    : 0;

  // ── 2. exam_id 이름공간 ──────────────────────────────────────────────
  const withId = rows.filter(
    (r): r is (typeof rows)[number] & { externalId: string } =>
      r.externalId != null,
  );
  const byDay = new Map<
    string,
    { n: number; min: number; max: number; nonNumeric: number }
  >();
  for (const row of withId) {
    if (row.source !== "past_exam") continue;
    const day = row.createdAt.toISOString().slice(0, 10);
    const prefix = numericPrefix(row.externalId);
    const bucket = byDay.get(day) ?? {
      n: 0,
      min: Infinity,
      max: -Infinity,
      nonNumeric: 0,
    };
    bucket.n += 1;
    if (prefix == null) bucket.nonNumeric += 1;
    else {
      bucket.min = Math.min(bucket.min, prefix);
      bucket.max = Math.max(bucket.max, prefix);
    }
    byDay.set(day, bucket);
  }

  // 한 접두어가 여러 회차 / 여러 파일 / 여러 학교에 걸치나.
  const prefixDays = new Map<string, Set<string>>();
  const prefixFiles = new Map<string, Set<string>>();
  const prefixSchools = new Map<string, Set<string>>();
  for (const row of withId) {
    const cut = row.externalId.lastIndexOf("-");
    if (cut <= 0) continue;
    const prefix = row.externalId.slice(0, cut);
    const day = row.createdAt.toISOString().slice(0, 10);
    (
      prefixDays.get(prefix) ?? prefixDays.set(prefix, new Set()).get(prefix)!
    ).add(day);
    if (row.sourceFile)
      (
        prefixFiles.get(prefix) ??
        prefixFiles.set(prefix, new Set()).get(prefix)!
      ).add(row.sourceFile);
    if (row.school)
      (
        prefixSchools.get(prefix) ??
        prefixSchools.set(prefix, new Set()).get(prefix)!
      ).add(row.school);
  }
  const prefixMultiDay = [...prefixDays.entries()].filter(
    ([, set]) => set.size > 1,
  );
  const prefixMultiFile = [...prefixFiles.entries()].filter(
    ([, set]) => set.size > 1,
  );
  const prefixMultiSchool = [...prefixSchools.entries()].filter(
    ([, set]) => set.size > 1,
  );

  // 같은 파일이 여러 접두어를 갖나 (한 시험지가 두 번호를 받았나).
  const fileToPrefixes = new Map<string, Set<string>>();
  for (const row of withId) {
    if (!row.sourceFile) continue;
    const cut = row.externalId.lastIndexOf("-");
    if (cut <= 0) continue;
    const set =
      fileToPrefixes.get(row.sourceFile) ??
      fileToPrefixes.set(row.sourceFile, new Set()).get(row.sourceFile)!;
    set.add(row.externalId.slice(0, cut));
  }
  const filesWithManyPrefixes = [...fileToPrefixes.entries()].filter(
    ([, set]) => set.size > 1,
  );

  // Exam(시험지 테이블)의 키와 Problem.examId 가 같은 이름공간인가.
  const exams = await prisma.exam.findMany({
    select: { externalExamId: true, school: true, year: true },
    take: 5000,
  });
  const examKeyShapes = new Map<string, number>();
  for (const exam of exams) {
    const shape = exam.externalExamId
      .replace(/[0-9]/g, "9")
      .replace(/[a-z]/g, "a")
      .replace(/9{2,}/g, "9+")
      .replace(/a{2,}/g, "a+");
    examKeyShapes.set(shape, (examKeyShapes.get(shape) ?? 0) + 1);
  }
  const problemExamIds = new Set(
    rows.map((r) => r.examId).filter((v): v is string => Boolean(v)),
  );
  const examExternalIds = new Set(exams.map((e) => e.externalExamId));
  const sharedKeys = [...problemExamIds].filter((id) =>
    examExternalIds.has(id),
  );

  // ── 3. 한 문항 두 이름 / 두 문항 한 이름 ──────────────────────────────
  const dupContent = (await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS groups, sum(n)::int AS rows FROM (
      SELECT count(*) AS n,
             count(DISTINCT external_id) AS ids
      FROM problem GROUP BY md5(regexp_replace(content, '\\s+', '', 'g'))
    ) t WHERE n > 1 AND ids > 1
  `)) as Array<{ groups: number; rows: number }>;

  const report = {
    총행: rows.length,
    단원_학년_이동: {
      원장별: churn,
      지금도이동상태_합: movedTotal,
      학년까지바뀐_합: movedGradeChanged,
      아직못옮긴_보류: holdCount,
    },
    이름공간: {
      적재회차별_접두어범위: Object.fromEntries(
        [...byDay.entries()].map(([day, b]) => [
          day,
          {
            행: b.n,
            접두어최소: b.min,
            접두어최대: b.max,
            숫자아님: b.nonNumeric,
          },
        ]),
      ),
      접두어_여러회차: prefixMultiDay.length,
      접두어_여러파일: prefixMultiFile.length,
      접두어_여러학교: prefixMultiSchool.length,
      한파일_여러접두어: {
        count: filesWithManyPrefixes.length,
        samples: filesWithManyPrefixes
          .slice(0, 5)
          .map(([file, set]) => ({ file, prefixes: [...set].slice(0, 5) })),
      },
      Exam테이블_키모양: Object.fromEntries(examKeyShapes),
      Exam테이블_행: exams.length,
      Problem_examId와_겹치는_Exam키: sharedKeys.length,
    },
    중복: {
      본문같고_externalId갈림_그룹: dupContent[0]?.groups ?? 0,
      그행수: dupContent[0]?.rows ?? 0,
    },
  };

  console.log("[단원·학년 이동 원장]");
  for (const entry of churn) console.log(" ", JSON.stringify(entry));
  console.log(
    `  합계 — 지금도 옮겨진 상태 ${movedTotal}행 · 그중 학년까지 바뀜 ${movedGradeChanged}행 · 아직 못 옮긴 보류 ${holdCount}행`,
  );
  console.log("\n[적재 회차별 접두어 범위]");
  for (const [day, b] of byDay)
    console.log(
      `  ${day}  행 ${String(b.n).padStart(6)}  접두어 ${b.min}~${b.max}  숫자아님 ${b.nonNumeric}`,
    );
  console.log(
    `\n[접두어] 여러 회차에 걸침 ${prefixMultiDay.length} · 여러 파일 ${prefixMultiFile.length} · 여러 학교 ${prefixMultiSchool.length} · 한 파일이 여러 접두어 ${filesWithManyPrefixes.length}`,
  );
  console.log(
    `[Exam 테이블] 행 ${exams.length} · 키 모양 ${JSON.stringify(Object.fromEntries(examKeyShapes))} · Problem.examId 와 겹치는 키 ${sharedKeys.length}`,
  );
  console.log(
    `[본문 같고 externalId 갈린 그룹] ${report.중복.본문같고_externalId갈림_그룹}그룹 ${report.중복.그행수}행`,
  );

  if (wantJson) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), "utf8");
    console.log(`\n기록: ${OUT_FILE}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
