/**
 * 문항 «정체성» 전수 조사 — 지금 DB 가 문항을 무엇으로 부르고 있는가.
 *
 *   npx tsx scripts/qa/audit-problem-identity.ts            # 집계 요약만 (화면)
 *   npx tsx scripts/qa/audit-problem-identity.ts --json     # scripts/qa/reports/ 에 상세 기록
 *   npx tsx scripts/qa/audit-problem-identity.ts --samples  # 표본을 화면에도 찍는다
 *
 * ## 읽기 전용이다
 * 공유 DB(D-31) 에 **쓰지 않는다.** SELECT 만 한다. 검토용 조사 도구다.
 *
 * ## 무엇이 «잔재»인지 미리 정하지 않는다
 * CLAUDE.md 2026-08-18 「목록을 손으로 쓰면 세는 쪽과 고치는 쪽이 같이 눈이 먼다」.
 * 그래서 `externalId` 의 모양을 **손으로 나열한 정규식으로 분류하지 않는다** —
 * 글자를 부류로 접어(숫자→9, 소문자→a, 대문자→A, 한글→가) **나온 모양을 전부** 세고
 * 빈도순으로 늘어놓는다. 목록에 없는 부류가 조용히 0이 되는 일을 막는다.
 *
 * ## 추측과 확인을 가른다
 * 이 스크립트가 내는 것은 **확인된 값**뿐이다. 해석은 리포트에서 한다
 * (`docs/planning/tracks/reports/id-scheme-review.md`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const OUT_DIR = path.join("scripts", "qa", "reports");
const OUT_FILE = path.join(OUT_DIR, "problem-identity.json");

type Row = {
  id: string;
  externalId: string | null;
  source: string;
  originProblemId: string | null;
  examId: string | null;
  questionNumber: number | null;
  school: string | null;
  subject: string | null;
  sourceFile: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** 글자를 부류로 접는다. 모양 census 의 열쇠. */
function shapeOf(value: string): string {
  return value
    .replace(/[0-9]/g, "9")
    .replace(/[a-z]/g, "a")
    .replace(/[A-Z]/g, "A")
    .replace(/[가-힣]/g, "가")
    .replace(/9{2,}/g, "9+")
    .replace(/a{2,}/g, "a+")
    .replace(/A{2,}/g, "A+")
    .replace(/가{2,}/g, "가+");
}

const flat = (value: string) => value.replace(/\s+/g, " ");

function tally<T extends string | number>(values: Iterable<T>) {
  const map = new Map<T, number>();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return map;
}

function topN<T extends string | number>(map: Map<T, number>, n: number) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function pct(part: number, whole: number) {
  return whole === 0 ? "—" : `${((part / whole) * 100).toFixed(1)}%`;
}

async function main() {
  const wantJson = process.argv.includes("--json");
  const wantSamples = process.argv.includes("--samples");

  const rows = (await prisma.problem.findMany({
    select: {
      id: true,
      externalId: true,
      source: true,
      originProblemId: true,
      examId: true,
      questionNumber: true,
      school: true,
      subject: true,
      sourceFile: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { id: "asc" },
  })) as Row[];

  const total = rows.length;

  // ── §1 이미 있는 것 — 부류별 채움 ───────────────────────────────────────
  const sources = [...new Set(rows.map((r) => r.source))].sort();
  const fillBySource: Record<string, Record<string, number>> = {};
  for (const source of sources) {
    const subset = rows.filter((r) => r.source === source);
    fillBySource[source] = {
      rows: subset.length,
      externalId: subset.filter((r) => r.externalId).length,
      examId: subset.filter((r) => r.examId).length,
      questionNumber: subset.filter((r) => r.questionNumber != null).length,
      school: subset.filter((r) => r.school).length,
      subject: subset.filter((r) => r.subject).length,
      sourceFile: subset.filter((r) => r.sourceFile).length,
      originProblemId: subset.filter((r) => r.originProblemId).length,
    };
  }

  // 「없는 것」의 부류 — externalId 가 빈 행은 무엇을 갖고 있나.
  const empty = rows.filter((r) => !r.externalId);
  const emptyProfile = empty.map((r) => ({
    source: r.source,
    hasExamId: Boolean(r.examId),
    hasQuestionNumber: r.questionNumber != null,
    hasSchool: Boolean(r.school),
    hasSourceFile: Boolean(r.sourceFile),
    day: r.createdAt.toISOString().slice(0, 10),
  }));
  const emptyBySource = tally(emptyProfile.map((p) => p.source));
  const emptyByShape = tally(
    emptyProfile.map(
      (p) =>
        `${p.source} exam=${p.hasExamId ? 1 : 0} qnum=${p.hasQuestionNumber ? 1 : 0} school=${p.hasSchool ? 1 : 0} file=${p.hasSourceFile ? 1 : 0}`,
    ),
  );
  const emptyByDay = tally(emptyProfile.map((p) => `${p.source} ${p.day}`));
  // 채워진 쪽의 적재일 — 「언제부터 붙었나」를 같은 축으로 본다.
  const filledByDay = tally(
    rows
      .filter((r) => r.externalId)
      .map((r) => `${r.source} ${r.createdAt.toISOString().slice(0, 10)}`),
  );

  // ── §2 externalId 의 모양 — 손으로 나열하지 않는다 ────────────────────
  const withId = rows.filter(
    (r): r is Row & { externalId: string } => r.externalId != null,
  );
  const shapeCensus = tally(withId.map((r) => shapeOf(r.externalId)));
  const shapeSamples = new Map<string, string[]>();
  for (const row of withId) {
    const shape = shapeOf(row.externalId);
    const bucket = shapeSamples.get(shape) ?? [];
    if (bucket.length < 4) bucket.push(row.externalId);
    shapeSamples.set(shape, bucket);
  }
  const shapeBySource = new Map<string, Map<string, number>>();
  for (const row of withId) {
    const shape = shapeOf(row.externalId);
    const inner = shapeBySource.get(shape) ?? new Map<string, number>();
    inner.set(row.source, (inner.get(row.source) ?? 0) + 1);
    shapeBySource.set(shape, inner);
  }

  const lengths = withId.map((r) => r.externalId.length);
  lengths.sort((a, b) => a - b);
  const lengthStats = {
    min: lengths[0],
    p50: lengths[Math.floor(lengths.length * 0.5)],
    p90: lengths[Math.floor(lengths.length * 0.9)],
    p99: lengths[Math.floor(lengths.length * 0.99)],
    max: lengths[lengths.length - 1],
  };

  // 말로 옮길 수 있나 — 헷갈리는 글자가 섞이나.
  const confusable = {
    // 0/O, 1/l/I 가 **같은 값 안에** 섞여 있으면 받아 적을 때 갈린다.
    hasZeroAndOh: withId.filter(
      (r) => /0/.test(r.externalId) && /[Oo]/.test(r.externalId),
    ).length,
    hasOneAndEll: withId.filter(
      (r) => /1/.test(r.externalId) && /[lI]/.test(r.externalId),
    ).length,
    anyLetter: withId.filter((r) => /[A-Za-z]/.test(r.externalId)).length,
    anyHangul: withId.filter((r) => /[가-힣]/.test(r.externalId)).length,
    digitsAndHyphenOnly: withId.filter((r) => /^[0-9-]+$/.test(r.externalId))
      .length,
    caseCollisions: 0 as number,
  };
  // 대소문자를 무시하면 겹치나 — 전화로 불러 줄 때 갈리지 않는지 본다.
  const lowerTally = tally(withId.map((r) => r.externalId.toLowerCase()));
  confusable.caseCollisions = [...lowerTally.values()].filter(
    (n) => n > 1,
  ).length;

  // ── §3 조합 가능한가 — externalId 가 다른 컬럼에서 유도되나 ────────────
  const pastExam = withId.filter((r) => r.source === "past_exam");
  const composed = pastExam.map((r) => ({
    row: r,
    expected:
      r.examId != null && r.questionNumber != null
        ? `${r.examId}-${r.questionNumber}`
        : null,
  }));
  const composeStats = {
    pastExamWithId: pastExam.length,
    bothPartsPresent: composed.filter((c) => c.expected != null).length,
    matches: composed.filter((c) => c.expected === c.row.externalId).length,
    mismatches: composed.filter(
      (c) => c.expected != null && c.expected !== c.row.externalId,
    ).length,
  };
  const mismatchSamples = composed
    .filter((c) => c.expected != null && c.expected !== c.row.externalId)
    .slice(0, 10)
    .map((c) => ({ externalId: c.row.externalId, composed: c.expected }));

  // examId 하나가 여러 학교를 가리키나 (앞 숫자가 시험지를 유일하게 가리키는가).
  const schoolsByExam = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.examId) continue;
    const set = schoolsByExam.get(row.examId) ?? new Set<string>();
    if (row.school) set.add(row.school);
    schoolsByExam.set(row.examId, set);
  }
  const examWithManySchools = [...schoolsByExam.entries()].filter(
    ([, set]) => set.size > 1,
  );

  // externalId 앞자리(마지막 하이픈 앞)가 여러 학교를 가리키나.
  const schoolsByPrefix = new Map<string, Set<string>>();
  for (const row of withId) {
    const cut = row.externalId.lastIndexOf("-");
    if (cut <= 0) continue;
    const prefix = row.externalId.slice(0, cut);
    const set = schoolsByPrefix.get(prefix) ?? new Set<string>();
    if (row.school) set.add(row.school);
    schoolsByPrefix.set(prefix, set);
  }
  const prefixWithManySchools = [...schoolsByPrefix.entries()].filter(
    ([, set]) => set.size > 1,
  );

  // (examId, questionNumber) 쌍이 겹치는가 — 그 조합으로 표시 번호를 만들 수 있나.
  const pairTally = tally(
    rows
      .filter((r) => r.examId && r.questionNumber != null)
      .map((r) => `${r.examId}-${r.questionNumber}`),
  );
  const dupPairs = [...pairTally.entries()].filter(([, n]) => n > 1);

  // 폴백 접두어 — `convertPastExam` 은 exam_id 가 없으면 문자열 "exam" 을 쓴다.
  const fallbackPrefix = withId.filter((r) => /^exam-/.test(r.externalId));

  // ── §4 uuid 앞자리를 표시용으로 쓸 수 있나 — 실제 충돌을 센다 ──────────
  const uuidPrefixCollisions: Record<string, number> = {};
  for (const n of [4, 6, 8, 10]) {
    const t = tally(rows.map((r) => r.id.replace(/-/g, "").slice(0, n)));
    uuidPrefixCollisions[`len${n}`] = [...t.values()].filter(
      (count) => count > 1,
    ).length;
  }

  // ── §5 일련번호를 매긴다면 순서가 있나 — createdAt 동률 ────────────────
  const createdTally = tally(rows.map((r) => r.createdAt.toISOString()));
  const createdDistinct = createdTally.size;
  const createdMaxTie = Math.max(...createdTally.values());
  const createdTiedRows = [...createdTally.values()]
    .filter((n) => n > 1)
    .reduce((a, b) => a + b, 0);

  // 값이 나중에 «붙은» 흔적 — 적재 뒤에 externalId 가 채워진 행 (updatedAt > createdAt).
  const updatedAfterCreate = rows.filter(
    (r) => r.updatedAt.getTime() - r.createdAt.getTime() > 1000,
  ).length;
  const updatedAfterCreateWithId = withId.filter(
    (r) => r.updatedAt.getTime() - r.createdAt.getTime() > 1000,
  ).length;

  // ── §6 본문이 같은데 externalId 가 다른 행 — 재이관이 갈라졌나 ─────────
  // 「한 문항이 두 이름을 갖나」 — 본문이 글자까지 같은데 externalId 가 갈린 무리.
  // 전량을 센다(표본이 아니다). 출처 조합별로 갈라 두어야 «다른 학교가 같은 문제를
  // 낸 것»과 «같은 원본이 두 번 들어온 것»을 섞어 세지 않는다.
  const dupContent = (await prisma.$queryRawUnsafe(`
    SELECT n, idn, sources, ids FROM (
      SELECT count(*)::int AS n,
             count(DISTINCT external_id)::int AS idn,
             count(DISTINCT answer)::int AS answers,
             count(DISTINCT figure_urls::text)::int AS figures,
             array_agg(DISTINCT source::text) AS sources,
             array_agg(coalesce(external_id, '(null)')) AS ids
      FROM problem GROUP BY md5(regexp_replace(content, '\\s+', '', 'g'))
    ) t WHERE n > 1 AND idn > 1 ORDER BY n DESC
  `)) as Array<{
    n: number;
    idn: number;
    answers: number;
    figures: number;
    sources: string[];
    ids: string[];
  }>;
  const dupContentGroups = dupContent.length;
  const dupContentAcrossIds = dupContent;
  const dupBySource = tally(
    dupContent.map((g) => [...g.sources].sort().join("+")),
  );
  const dupRows = dupContent.reduce((a, g) => a + g.n, 0);
  // 본문만 같은 것과 «정답·그림까지 같은 것»은 다르다 — 08-import-ledger §1.5 의 교훈:
  // 그림이 빠진 문항끼리는 글자가 같아진다. 축을 하나 더 두고 갈라 센다.
  const dupSameAnswer = dupContent.filter((g) => g.answers === 1).length;
  const dupSameAnswerAndFigure = dupContent.filter(
    (g) => g.answers === 1 && g.figures === 1,
  ).length;

  const report = {
    generatedFrom: "shared Supabase (read-only)",
    total,
    fillBySource,
    empty: {
      total: empty.length,
      bySource: Object.fromEntries(emptyBySource),
      byShape: Object.fromEntries(topN(emptyByShape, 20)),
      byDay: Object.fromEntries(topN(emptyByDay, 20)),
      samples: empty.slice(0, 12).map((r) => ({
        id: r.id,
        source: r.source,
        examId: r.examId,
        questionNumber: r.questionNumber,
        school: r.school,
        sourceFile: r.sourceFile,
        createdAt: r.createdAt.toISOString(),
      })),
    },
    filledByDay: Object.fromEntries(topN(filledByDay, 20)),
    shapeCensus: topN(shapeCensus, 30).map(([shape, n]) => ({
      shape,
      n,
      samples: shapeSamples.get(shape),
      bySource: Object.fromEntries(shapeBySource.get(shape) ?? []),
    })),
    lengthStats,
    confusable,
    composeStats,
    mismatchSamples,
    examWithManySchools: {
      count: examWithManySchools.length,
      samples: examWithManySchools
        .slice(0, 10)
        .map(([examId, set]) => ({ examId, schools: [...set] })),
    },
    prefixWithManySchools: {
      count: prefixWithManySchools.length,
      samples: prefixWithManySchools
        .slice(0, 10)
        .map(([prefix, set]) => ({ prefix, schools: [...set] })),
    },
    duplicateExamQuestionPairs: {
      count: dupPairs.length,
      rows: dupPairs.reduce((a, [, n]) => a + n, 0),
      samples: dupPairs.slice(0, 10),
    },
    fallbackPrefix: {
      count: fallbackPrefix.length,
      samples: fallbackPrefix.slice(0, 5).map((r) => r.externalId),
    },
    uuidPrefixCollisions,
    ordering: {
      createdDistinct,
      createdMaxTie,
      createdTiedRows,
      updatedAfterCreate,
      updatedAfterCreateWithId,
    },
    duplicateContent: {
      groupsWithDifferentExternalIds: dupContentGroups,
      rows: dupRows,
      bySourceCombo: Object.fromEntries(dupBySource),
      정답까지같음: dupSameAnswer,
      정답과그림까지같음: dupSameAnswerAndFigure,
      samples: dupContentAcrossIds.slice(0, 10).map((g) => ({
        n: g.n,
        sources: g.sources,
        ids: g.ids.slice(0, 6),
      })),
    },
  };

  // ── 화면 요약 (수십 줄) ────────────────────────────────────────────────
  console.log(`전체 ${total}건`);
  console.log("\n[부류별 채움]");
  for (const source of sources) {
    const f = fillBySource[source];
    console.log(
      `  ${source.padEnd(12)} ${String(f.rows).padStart(6)}행 | externalId ${String(f.externalId).padStart(6)} (${pct(f.externalId, f.rows)}) | examId ${String(f.examId).padStart(6)} | qNum ${String(f.questionNumber).padStart(6)} | school ${String(f.school).padStart(6)} | sourceFile ${String(f.sourceFile).padStart(6)} | originProblemId ${f.originProblemId}`,
    );
  }
  console.log(
    `\n[externalId 빈 행] ${empty.length}건 (${pct(empty.length, total)})`,
  );
  for (const [key, n] of topN(emptyByShape, 12)) console.log(`  ${key} → ${n}`);
  console.log("\n[externalId 모양 census] (상위)");
  for (const [shape, n] of topN(shapeCensus, 12)) {
    console.log(
      `  ${shape.padEnd(16)} ${String(n).padStart(6)}  ex ${(shapeSamples.get(shape) ?? []).join(" ")}  ${JSON.stringify(Object.fromEntries(shapeBySource.get(shape) ?? []))}`,
    );
  }
  console.log(`\n[길이] ${JSON.stringify(lengthStats)}`);
  console.log(`[글자] ${JSON.stringify(confusable)}`);
  console.log(
    `\n[examId-문항번호 로 유도되나] ${JSON.stringify(composeStats)}`,
  );
  if (mismatchSamples.length)
    console.log(`  어긋난 표본 ${JSON.stringify(mismatchSamples.slice(0, 5))}`);
  console.log(
    `[한 examId 가 여러 학교] ${examWithManySchools.length} · [한 접두어가 여러 학교] ${prefixWithManySchools.length}`,
  );
  console.log(
    `[(examId,문항번호) 겹침] 조합 ${dupPairs.length} · 행 ${report.duplicateExamQuestionPairs.rows}`,
  );
  console.log(`[폴백 "exam-" 접두어] ${fallbackPrefix.length}`);
  console.log(`\n[uuid 앞자리 충돌] ${JSON.stringify(uuidPrefixCollisions)}`);
  console.log(`[순서] ${JSON.stringify(report.ordering)}`);
  console.log(
    `[본문이 같은데 externalId 가 갈린 무리] ${dupContentGroups}무리 ${dupRows}행 · 출처조합 ${JSON.stringify(Object.fromEntries(dupBySource))} · 정답까지 같음 ${dupSameAnswer} · 정답+그림까지 같음 ${dupSameAnswerAndFigure}`,
  );

  if (wantSamples) {
    // 표본은 **눈으로** 본다 — 이 저장소에서 문서·리뷰로 찾은 결함은 하나도 없다.
    // 부류마다 본문 앞머리까지 같이 찍어 「이 값이 무엇을 가리키는가」를 사람이 확인한다.
    console.log("\n[부류별 표본 — 본문 앞머리 포함]");
    const classes: Array<{ label: string; where: object }> = [
      {
        label: "past_exam · externalId 있음",
        where: { source: "past_exam", externalId: { not: null } },
      },
      {
        label: "past_exam · externalId 없음",
        where: { source: "past_exam", externalId: null },
      },
      {
        label: "transformed(RPM) · externalId 있음",
        where: { source: "transformed", externalId: { not: null } },
      },
      {
        label: "transformed(RPM) · externalId 없음",
        where: { source: "transformed", externalId: null },
      },
      { label: "manual(자작)", where: { source: "manual" } },
    ];
    for (const cls of classes) {
      const picked = await prisma.problem.findMany({
        where: cls.where,
        select: {
          id: true,
          externalId: true,
          school: true,
          examId: true,
          questionNumber: true,
          sourceFile: true,
          content: true,
          originProblemId: true,
        },
        orderBy: { id: "asc" },
        take: 3,
      });
      console.log(`\n  ── ${cls.label}`);
      for (const p of picked) {
        console.log(
          `    uuid=${p.id.slice(0, 8)} externalId=${p.externalId ?? "(없음)"} school=${p.school ?? "-"} exam=${p.examId ?? "-"}/${p.questionNumber ?? "-"} origin=${p.originProblemId ?? "-"}`,
        );
        console.log(`      file=${p.sourceFile ?? "-"}`);
        console.log(`      본문: ${flat(p.content).slice(0, 90)}`);
      }
    }
  }

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
