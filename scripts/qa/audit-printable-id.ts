/**
 * 「지금 있는 식별자를 **종이에 찍어도 되는가**」를 데이터로 판정한다 (읽기 전용).
 *
 * 왜 필요한가: 원장님이 「보여줘도 되면 아주 작은 글씨로 참고용 정도」를 열어 두셨다.
 * 그런데 종이는 **학생이 본다.** 학원 시험지에 찍힌 코드로 「이 문제가 어느 학교
 * 기출인지」가 역추적된다면 그 코드는 지면에 쓸 수 없다 — 크기·색의 문제가 아니라
 * **체계의 문제**다. 그래서 크기를 재기 전에 이것부터 판정한다.
 *
 *   npx tsx scripts/qa/audit-printable-id.ts
 *   npx tsx scripts/qa/audit-printable-id.ts --json .measure/printable-id.json
 *
 * ## 무엇을 재는가
 *
 *  ① **균일성** — 지금 `externalId` 가 전 문항에 같은 모양으로 있는가.
 *     (없는 문항이 있으면 그 체계로는 지면을 채울 수 없다.)
 *  ② **출처 노출** — 코드에서 학교가 드러나는가. 핵심은 「번호가 **무작위인가**」다.
 *     `exam_id` 가 학교 이름 가나다순으로 훑으며 매겨졌다면, 번호는 학교 이름의
 *     **정렬 위치**를 그대로 담고 있다. 그러면 몇 개만 알아도 나머지가 좁혀진다.
 *  ③ **좁히기 공격** — 표본 anchor 를 M 개 아는 사람이 임의의 코드를 몇 개
 *     후보로 좁힐 수 있는가. 실제로 뽑아서 센다(수식으로 어림하지 않는다).
 *
 * ⚠️ 이 스크립트는 **판정만** 한다. 어떤 체계를 쓸지는 id-scheme 세션이 정한다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface ExamRow {
  examId: number;
  school: string;
  /** 학년도-학기-회차 — 적재 배치 하나. 훑기(가나다순 매김)의 단위다. */
  batch: string;
}

/** 원본 파일 이름의 `[24-1-중간]` 꼬리표에서 학년도·학기·회차를 뽑는다. */
function examTag(sourceFile: string | null): string {
  if (!sourceFile) return "?";
  const m = /\[(\d\d)-(\d)-(중간|기말)\]/.exec(sourceFile);
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : "?";
}

/** 한국어 가나다순. 학교 이름 정렬은 이 기준으로 본다. */
const ko = (a: string, b: string) => a.localeCompare(b, "ko");

async function main() {
  const outPath = arg("--json");
  const report: Record<string, unknown> = {};

  /* ── ① 균일성 ─────────────────────────────────────────────────────────── */
  interface FillRow {
    source: string;
    total: number;
    hasExternalId: number;
    hasSchool: number;
    hasExamId: number;
    hasQuestionNumber: number;
  }
  const fill = (await prisma.$queryRawUnsafe(`
      SELECT source::text AS source, count(*)::int AS total,
             count(external_id)::int AS "hasExternalId",
             count(school)::int AS "hasSchool",
             count(exam_id)::int AS "hasExamId",
             count(question_number)::int AS "hasQuestionNumber"
      FROM problem GROUP BY source ORDER BY count(*) DESC`)) as FillRow[];

  const totals = fill.reduce(
    (acc, r) => {
      acc.total += r.total;
      acc.hasExternalId += r.hasExternalId;
      return acc;
    },
    { total: 0, hasExternalId: 0 },
  );

  console.log(
    "── ① 균일성 — 지금 식별자가 전 문항에 같은 모양으로 있는가 ──────",
  );
  console.table(fill);
  console.log(
    `전체 ${totals.total.toLocaleString()}건 중 externalId 없는 문항 ` +
      `${(totals.total - totals.hasExternalId).toLocaleString()}건 ` +
      `(${((100 * (totals.total - totals.hasExternalId)) / totals.total).toFixed(1)}%)`,
  );

  /* 모양이 몇 가지인가 — 한 지면에 섞이면 그 자체로 못 쓴다. */
  const shapes = (await prisma.$queryRawUnsafe(`
    SELECT CASE
             WHEN external_id ~ '^[0-9]+-[0-9]+$' THEN '숫자-숫자 (기출: 시험지-문항)'
             WHEN external_id ~ '^[0-9a-f-]{36}$' THEN 'UUID 36자 (RPM 교재)'
             WHEN external_id IS NULL THEN '(없음)'
             ELSE '그 밖'
           END AS shape,
           count(*)::int AS n,
           min(length(external_id))::int AS "minLen",
           max(length(external_id))::int AS "maxLen"
    FROM problem GROUP BY 1 ORDER BY n DESC`)) as Array<
    Record<string, unknown>
  >;
  console.table(shapes);
  report.uniformity = { bySource: fill, shapes };

  /* ── ② 출처 노출 — 번호가 학교 가나다순을 담고 있는가 ──────────────────── */
  const raw = (await prisma.$queryRawUnsafe(`
    SELECT DISTINCT exam_id::int AS "examId", school, source_file AS "sourceFile"
    FROM problem
    WHERE exam_id ~ '^[0-9]+$' AND school IS NOT NULL`)) as Array<{
    examId: number;
    school: string;
    sourceFile: string | null;
  }>;
  const exams: ExamRow[] = raw.map((r) => ({
    examId: r.examId,
    school: r.school,
    batch: examTag(r.sourceFile),
  }));

  console.log(
    `\n── ② 출처 노출 — 시험지 ${exams.length.toLocaleString()}개 · 학교 ` +
      `${new Set(exams.map((e) => e.school)).size}개 ────`,
  );

  /**
   * **배치 단위로 본다.** 처음엔 학년도로 묶었는데, 그러면 「학교당 번호폭 중앙 380」
   * 같은 값이 나와 「번호가 흩어져 있다」로 읽힌다 — 거짓이다. 한 학년도 안에는
   * 학기·회차별 배치가 **여러 개 끼어 있고**, 각 배치가 저마다 가나다순으로 훑는다.
   * 배치로 갈라서 보면 학교당 번호폭 중앙이 **0~1** 이다(= 한 학교가 한 자리를 차지).
   * 분모를 잘못 잡으면 같은 숫자가 다른 것을 가리킨다(CLAUDE.md 2026-08-17).
   */
  const byBatch = new Map<string, ExamRow[]>();
  for (const e of exams) {
    if (!byBatch.has(e.batch)) byBatch.set(e.batch, []);
    byBatch.get(e.batch)!.push(e);
  }

  const blocks: Array<Record<string, unknown>> = [];
  for (const [batch, rows] of [...byBatch].sort(
    (a, b) =>
      Math.min(...a[1].map((r) => r.examId)) -
      Math.min(...b[1].map((r) => r.examId)),
  )) {
    if (batch === "?" || rows.length < 20) continue;
    const sorted = [...rows].sort((a, b) => a.examId - b.examId);
    /* 번호순으로 늘어놓았을 때 학교 이름이 **가나다순으로 오르는가**.
       번호가 무작위라면 절반쯤(50%)이고, 가나다순으로 매겼다면 100% 에 가깝다.
       깨지는 자리는 «적재를 나눠 넣은 이음매»다 — 그 수만큼 훑기가 여러 번 있었다. */
    let ordered = 0;
    let compared = 0;
    let breaks = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.school === sorted[i - 1]!.school) continue;
      compared += 1;
      if (ko(sorted[i - 1]!.school, sorted[i]!.school) <= 0) ordered += 1;
      else breaks += 1;
    }
    const bandWidths: number[] = [];
    const bySchool = new Map<string, number[]>();
    for (const r of sorted) {
      if (!bySchool.has(r.school)) bySchool.set(r.school, []);
      bySchool.get(r.school)!.push(r.examId);
    }
    for (const ids of bySchool.values())
      bandWidths.push(Math.max(...ids) - Math.min(...ids));
    bandWidths.sort((a, b) => a - b);
    blocks.push({
      배치: batch,
      시험지: sorted.length,
      학교: bySchool.size,
      번호범위: `${sorted[0]!.examId}~${sorted[sorted.length - 1]!.examId}`,
      "가나다순 일치율": `${((100 * ordered) / Math.max(1, compared)).toFixed(1)}%`,
      "순서 깨진 곳": breaks,
      "학교당 번호폭 중앙": bandWidths[Math.floor(bandWidths.length / 2)],
    });
  }
  console.table(blocks);
  console.log(
    "번호가 무작위였다면 「가나다순 일치율」은 50% 안팎이어야 한다.\n" +
      "「학교당 번호폭 중앙 0~1」 = 한 학교의 시험지가 번호축에서 **한 자리에 붙어 있다**.",
  );
  report.leak = { blocks };

  /* ── ③ 좁히기 공격 — anchor M 개로 임의의 코드를 몇 개로 좁히나 ─────────
     시나리오: 학생·학부모가 시험지에 찍힌 코드 몇 개의 출처 학교를 안다(자기 학교
     기출은 알아본다). 번호가 가나다순이면 모르는 코드도 **두 anchor 사이**로
     좁혀진다. 실제로 뽑아서 후보 학교 수를 센다. */
  const attack: Array<Record<string, unknown>> = [];
  const biggest = [...byBatch.entries()]
    .filter(([b, r]) => b !== "?" && r.length >= 50)
    .sort((a, b) => b[1].length - a[1].length)[0];
  if (biggest) {
    const [batch, rows] = biggest;
    const sorted = [...rows].sort((a, b) => a.examId - b.examId);
    const schools = [...new Set(sorted.map((r) => r.school))].sort(ko);
    const rankOf = new Map(schools.map((s, i) => [s, i]));

    /* 재현 가능한 난수 — `Math.random` 이면 실행마다 값이 달라져 보고서와 어긋난다. */
    let seed = 20260818;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    /** Fisher–Yates. ⚠️ `sort(() => rand() - 0.5)` 는 **섞이지 않는다** —
        비교자가 일관되지 않아 엔진이 제멋대로 자른다. 처음에 그걸 썼더니
        「anchor 를 5개에서 10개로 늘렸는데 후보가 67 → 74 로 **늘었다**」는
        말이 안 되는 표가 나왔다. 지표가 이상하면 지표부터 의심할 것. */
    const shuffled = <T>(items: T[]): T[] => {
      const a = [...items];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    };

    for (const M of [3, 5, 10, 20, 50]) {
      const trials = 2000;
      let rankGap = 0;
      let exact = 0;
      let within3 = 0;
      for (let t = 0; t < trials; t++) {
        const pool = shuffled(sorted);
        const target = pool[0]!;
        const anchors = pool.slice(1, M + 1);
        /* 공격자가 하는 일: 아는 코드 중 번호가 **가장 가까운** 것을 찾아
           그 학교로 찍는다. 번호가 가나다순이면 이 찍기가 잘 맞는다. */
        let nearest = anchors[0]!;
        for (const a of anchors)
          if (
            Math.abs(a.examId - target.examId) <
            Math.abs(nearest.examId - target.examId)
          )
            nearest = a;
        const gap = Math.abs(
          (rankOf.get(nearest.school) ?? 0) - (rankOf.get(target.school) ?? 0),
        );
        rankGap += gap;
        if (gap === 0) exact += 1;
        if (gap <= 3) within3 += 1;
      }
      attack.push({
        "아는 코드 수": M,
        "가나다순 몇 칸 빗나가나(평균)": (rankGap / trials).toFixed(1),
        "학교를 정확히 맞힘": `${((100 * exact) / trials).toFixed(1)}%`,
        "±3개 학교 안": `${((100 * within3) / trials).toFixed(1)}%`,
      });
    }
    console.log(
      `\n── ③ 좁히기 공격 — 배치 ${batch} (시험지 ${sorted.length}개 · 학교 ${schools.length}개) ────\n` +
        `아무 정보도 없이 찍으면 「정확히 맞힘」은 ${(100 / schools.length).toFixed(1)}% 여야 한다.`,
    );
    console.table(attack);
    report.attack = {
      batch,
      exams: sorted.length,
      schools: schools.length,
      chanceLevelPct: 100 / schools.length,
      attack,
    };
  }

  if (outPath) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(report, null, 1), "utf8");
    console.log(`\n→ ${outPath}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
