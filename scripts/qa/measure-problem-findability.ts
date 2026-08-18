/**
 * 「문항을 찾는 일」이 지금 얼마나 드는가 — **읽기 전용** 실측.
 *
 * 검토 ②(id-find)의 근거 수집기다. 화면을 눌러 세는 대신 DB 로 센다 — 클릭 수는
 * 사람이 어디를 누르느냐에 따라 달라지지만, **「필터를 최대로 좁혀도 몇 페이지째에
 * 그 문항이 있는가」는 데이터가 정한다.** 그 값이 곧 걸음 수의 하한이다.
 *
 * 재는 것:
 *   §A 규모·원본키 채움률 — 지금 DB 에 이미 있는 「숨은 번호」 후보가 무엇인가
 *   §B 페이지 깊이     — 화면 필터를 다 걸고도 몇 페이지를 넘겨야 하나 (핵심)
 *   §C 질의 시간       — PK·externalId·무필터 목록·본문 ILIKE 실측 (네트워크 기준선 차감)
 *   §D 전문검색 준비도 — pg_trgm 설치/가용 여부, content 총 바이트(GIN 크기 추정 근거)
 *   §E 번호 안정성     — 같은 원본을 두 행이 가리키는가, 원본키가 없는 행은 몇 건인가
 *
 * ⚠️ 쓰기 없음. `CREATE INDEX` 도 하지 않는다 — 공유 DB(D-31)라 다른 세션의 쓰기를
 *    막는다. GIN 인덱스의 실제 값은 로컬 사본에서 재야 한다(§D 에 근거만 남긴다).
 *
 *   npx tsx scripts/qa/measure-problem-findability.ts
 *   npx tsx scripts/qa/measure-problem-findability.ts --json out.json
 */
import { PrismaClient } from "@prisma/client";
import { writeFile } from "node:fs/promises";

const prisma = new PrismaClient();

/** 화면 목록 한 페이지 크기 — `PROBLEM_PAGE_SIZE`(계약 기본값)와 같아야 한다. */
const PAGE_SIZE = 20;

/** 본문 검색 실측에 쓸 구절. 실제 문항에서 뽑은 것과, 흔한 것 / 드문 것을 섞는다. */
const SEARCH_PHRASES = [
  "다음 그림과 같이",
  "값을 구하시오",
  "옳은 것을 모두 고른 것은",
  "이차함수의 그래프가",
  "확률을 구하시오",
];

type Timing = { label: string; ms: number; rows: number };

async function timeIt(
  label: string,
  fn: () => Promise<unknown>,
  repeats = 3,
): Promise<Timing> {
  // 첫 회는 연결·계획 수립이 섞이므로 버리고, 나머지의 중앙값을 쓴다.
  await fn();
  const samples: number[] = [];
  let rows = 0;
  for (let i = 0; i < repeats; i += 1) {
    const t0 = process.hrtime.bigint();
    const result = await fn();
    const t1 = process.hrtime.bigint();
    samples.push(Number(t1 - t0) / 1e6);
    if (Array.isArray(result)) rows = result.length;
    else if (typeof result === "number") rows = result;
  }
  samples.sort((a, b) => a - b);
  return { label, ms: samples[Math.floor(samples.length / 2)], rows };
}

function pct(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const out: Record<string, unknown> = {};

  // ── §A 규모·원본키 채움률 ────────────────────────────────
  const bySource = await prisma.$queryRawUnsafe<
    {
      source: string;
      total: bigint;
      with_external: bigint;
      with_exam: bigint;
      with_qnum: bigint;
      with_school: bigint;
      with_file: bigint;
    }[]
  >(`
    SELECT source::text AS source,
           count(*)                                        AS total,
           count(*) FILTER (WHERE external_id IS NOT NULL) AS with_external,
           count(*) FILTER (WHERE exam_id IS NOT NULL)     AS with_exam,
           count(*) FILTER (WHERE question_number IS NOT NULL) AS with_qnum,
           count(*) FILTER (WHERE school IS NOT NULL)      AS with_school,
           count(*) FILTER (WHERE source_file IS NOT NULL) AS with_file
    FROM problem GROUP BY 1 ORDER BY 2 DESC
  `);
  const total = bySource.reduce((sum, r) => sum + Number(r.total), 0);
  out.bySource = bySource.map((r) => ({
    source: r.source,
    total: Number(r.total),
    externalId: Number(r.with_external),
    examId: Number(r.with_exam),
    questionNumber: Number(r.with_qnum),
    school: Number(r.with_school),
    sourceFile: Number(r.with_file),
  }));

  console.log("\n§A 규모와 원본키 채움률 — 총 %d행", total);
  console.log(
    `${"source".padEnd(14)}${"행수".padStart(8)}${"externalId".padStart(12)}${"examId".padStart(10)}${"문항번호".padStart(10)}${"학교".padStart(10)}`,
  );
  for (const r of bySource) {
    const t = Number(r.total);
    console.log(
      `${r.source.padEnd(14)}${String(t).padStart(8)}${pct(Number(r.with_external), t).padStart(12)}${pct(Number(r.with_exam), t).padStart(10)}${pct(Number(r.with_qnum), t).padStart(10)}${pct(Number(r.with_school), t).padStart(10)}`,
    );
  }

  // externalId 모양 — 어떤 규칙으로 만들어진 값들인가.
  const shapes = await prisma.$queryRawUnsafe<
    { shape: string; n: bigint; sample: string }[]
  >(`
    SELECT CASE
             WHEN external_id ~ '^[0-9a-f-]{36}$'      THEN 'uuid 형태'
             WHEN external_id ~ '-[0-9]+$'             THEN '…-<숫자> (기출 exam-문항번호)'
             WHEN external_id ~ '^[0-9]+$'             THEN '순수 숫자 (RPM 원본 행 id)'
             ELSE '기타'
           END AS shape,
           count(*) AS n, min(external_id) AS sample
    FROM problem WHERE external_id IS NOT NULL GROUP BY 1 ORDER BY 2 DESC
  `);
  out.externalIdShapes = shapes.map((s) => ({
    shape: s.shape,
    n: Number(s.n),
    sample: s.sample,
  }));
  console.log("\n  externalId 모양별");
  for (const s of shapes)
    console.log(
      `    ${s.shape.padEnd(34)}${String(Number(s.n)).padStart(7)}  예: ${s.sample}`,
    );

  // ── §B 페이지 깊이 — 화면 필터를 다 걸어도 몇 페이지째인가 ────
  //
  // 화면(`ProblemBank`)이 서버로 보내는 가장 좁은 조합은 소단원 + 난이도 + 유형 +
  // 상태 (+ 그림 유무)다. 정렬은 `created_at DESC, id DESC` 고정이라 순위가 유일하다.
  const depth = await prisma.$queryRawUnsafe<
    {
      scope: string;
      p50: number;
      p90: number;
      p99: number;
      worst: number;
      over_one_page: bigint;
      rows: bigint;
    }[]
  >(`
    WITH r AS (
      SELECT
        ceil(row_number() OVER (ORDER BY created_at DESC, id DESC) / ${PAGE_SIZE}.0) AS none,
        ceil(row_number() OVER (PARTITION BY unit_id
                                ORDER BY created_at DESC, id DESC) / ${PAGE_SIZE}.0) AS unit,
        ceil(row_number() OVER (PARTITION BY unit_id, difficulty, problem_type, review_status
                                ORDER BY created_at DESC, id DESC) / ${PAGE_SIZE}.0) AS four,
        ceil(row_number() OVER (PARTITION BY unit_id, difficulty, problem_type, review_status,
                                             (coalesce(array_length(figure_urls,1),0) > 0 OR figure_svg IS NOT NULL)
                                ORDER BY created_at DESC, id DESC) / ${PAGE_SIZE}.0) AS five
      FROM problem
    ), u AS (
      SELECT '필터 없음' AS scope, none AS page FROM r
      UNION ALL SELECT '소단원만', unit FROM r
      UNION ALL SELECT '소단원+난이도+유형+상태', four FROM r
      UNION ALL SELECT '위 넷 + 그림유무', five FROM r
    )
    SELECT scope,
           percentile_disc(0.50) WITHIN GROUP (ORDER BY page)::int AS p50,
           percentile_disc(0.90) WITHIN GROUP (ORDER BY page)::int AS p90,
           percentile_disc(0.99) WITHIN GROUP (ORDER BY page)::int AS p99,
           max(page)::int AS worst,
           count(*) FILTER (WHERE page > 1) AS over_one_page,
           count(*) AS rows
    FROM u GROUP BY scope
  `);
  out.pageDepth = depth.map((d) => ({
    scope: d.scope,
    p50: d.p50,
    p90: d.p90,
    p99: d.p99,
    worst: d.worst,
    overOnePage: Number(d.over_one_page),
    rows: Number(d.rows),
  }));
  console.log(
    "\n§B 목표 문항이 몇 페이지째에 있나 (%d건/페이지, `이전/다음`뿐이라 곧 «다음» 클릭 수)",
    PAGE_SIZE,
  );
  console.log(
    `${"필터".padEnd(26)}${"중앙값".padStart(7)}${"p90".padStart(6)}${"p99".padStart(6)}${"최악".padStart(8)}${"2페이지 이상".padStart(18)}`,
  );
  for (const d of depth) {
    console.log(
      `${d.scope.padEnd(26)}${String(d.p50).padStart(7)}${String(d.p90).padStart(6)}${String(d.p99).padStart(6)}${String(d.worst).padStart(8)}${`${Number(d.over_one_page).toLocaleString("ko-KR")} (${pct(Number(d.over_one_page), Number(d.rows))})`.padStart(18)}`,
    );
  }

  // 소단원 하나에 몇 건이 몰려 있나 — 필터가 좁히지 못하는 구간을 본다.
  const perUnit = await prisma.$queryRawUnsafe<
    { units: bigint; p50: number; p90: number; worst: number }[]
  >(`
    WITH c AS (SELECT unit_id, count(*) AS n FROM problem GROUP BY 1)
    SELECT count(*) AS units,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY n)::int AS p50,
           percentile_disc(0.9) WITHIN GROUP (ORDER BY n)::int AS p90,
           max(n)::int AS worst
    FROM c
  `);
  out.perUnit = {
    units: Number(perUnit[0].units),
    p50: perUnit[0].p50,
    p90: perUnit[0].p90,
    worst: perUnit[0].worst,
  };
  console.log(
    "\n  문항이 있는 소단원 %d개 · 소단원당 행수 중앙 %d · p90 %d · 최다 %d",
    Number(perUnit[0].units),
    perUnit[0].p50,
    perUnit[0].p90,
    perUnit[0].worst,
  );

  // ── §C 질의 시간 실측 ────────────────────────────────────
  const sampleRow = await prisma.problem.findFirst({
    where: { externalId: { not: null } },
    select: { id: true, externalId: true },
  });
  const timings: Timing[] = [];
  timings.push(
    await timeIt("기준선 (select 1) — 왕복 네트워크", () =>
      prisma.$queryRawUnsafe("SELECT 1"),
    ),
  );
  if (sampleRow) {
    timings.push(
      await timeIt("id(PK) 단건 조회", () =>
        prisma.problem.findUnique({ where: { id: sampleRow.id } }),
      ),
    );
    timings.push(
      await timeIt("externalId(UNIQUE) 단건 조회", () =>
        prisma.problem.findUnique({
          where: { externalId: sampleRow.externalId! },
        }),
      ),
    );
  }
  timings.push(
    await timeIt("무필터 목록 1페이지 (화면 기본 진입)", () =>
      prisma.problem.findMany({
        take: PAGE_SIZE,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    ),
  );
  timings.push(
    await timeIt("무필터 count (같은 요청이 함께 돈다)", () =>
      prisma.problem.count(),
    ),
  );
  for (const phrase of SEARCH_PHRASES) {
    timings.push(
      await timeIt(`본문 ILIKE «${phrase}» 1페이지`, () =>
        prisma.$queryRawUnsafe(
          `SELECT id FROM problem WHERE content ILIKE $1
           ORDER BY created_at DESC, id DESC LIMIT ${PAGE_SIZE}`,
          `%${phrase}%`,
        ),
      ),
    );
    timings.push(
      await timeIt(`본문 ILIKE «${phrase}» count`, () =>
        prisma.$queryRawUnsafe(
          `SELECT count(*)::int AS n FROM problem WHERE content ILIKE $1`,
          `%${phrase}%`,
        ),
      ),
    );
  }
  out.timings = timings;
  console.log("\n§C 질의 시간 (중앙값, 3회. 네트워크 왕복 포함)");
  for (const t of timings)
    console.log(`  ${t.label.padEnd(46)}${t.ms.toFixed(1).padStart(8)} ms`);

  // ILIKE 가 실제로 몇 건을 맞히는지 — 「검색이 쓸모 있는가」의 다른 반쪽.
  const hits = await prisma.$queryRawUnsafe<{ phrase: string; n: bigint }[]>(
    SEARCH_PHRASES.map(
      (p) =>
        `SELECT ${quote(p)} AS phrase, count(*) AS n FROM problem WHERE content ILIKE ${quote(`%${p}%`)}`,
    ).join(" UNION ALL "),
  );
  out.searchHits = hits.map((h) => ({ phrase: h.phrase, n: Number(h.n) }));
  console.log("\n  구절별 적중 행수");
  for (const h of hits)
    console.log(
      `    ${h.phrase.padEnd(24)}${String(Number(h.n)).padStart(6)} (${pct(Number(h.n), total)})`,
    );

  // ── §D 전문검색 준비도 ───────────────────────────────────
  const ext = await prisma.$queryRawUnsafe<
    { name: string; installed: string | null; available: string | null }[]
  >(`
    SELECT a.name,
           (SELECT extversion FROM pg_extension e WHERE e.extname = a.name) AS installed,
           a.default_version AS available
    FROM pg_available_extensions a
    WHERE a.name IN ('pg_trgm','btree_gin','unaccent')
  `);
  const size = await prisma.$queryRawUnsafe<
    { content_bytes: bigint; avg_len: number; table_bytes: bigint }[]
  >(`
    SELECT sum(octet_length(content))::bigint AS content_bytes,
           avg(length(content))::numeric(10,1) AS avg_len,
           pg_total_relation_size('problem')::bigint AS table_bytes
    FROM problem
  `);
  out.fullTextReadiness = {
    extensions: ext,
    contentBytes: Number(size[0].content_bytes),
    avgContentChars: Number(size[0].avg_len),
    tableBytes: Number(size[0].table_bytes),
  };
  console.log("\n§D 전문검색 준비도");
  for (const e of ext)
    console.log(
      `  ${e.name.padEnd(10)} 설치됨=${e.installed ?? "아니오"}  제공버전=${e.available ?? "—"}`,
    );
  console.log(
    `  content 총 ${(Number(size[0].content_bytes) / 1048576).toFixed(1)} MB · 평균 ${Number(size[0].avg_len).toFixed(1)}자 · problem 테이블 전체 ${(Number(size[0].table_bytes) / 1048576).toFixed(1)} MB`,
  );

  // ── §E 번호가 «한 문항»을 가리키는가 ─────────────────────
  const dup = await prisma.$queryRawUnsafe<
    { kind: string; groups: bigint; rows: bigint }[]
  >(`
    WITH c AS (SELECT md5(content) AS h, count(*) AS n FROM problem GROUP BY 1 HAVING count(*) > 1),
         e AS (SELECT exam_id, question_number, count(*) AS n FROM problem
               WHERE exam_id IS NOT NULL AND question_number IS NOT NULL
               GROUP BY 1,2 HAVING count(*) > 1)
    SELECT '본문이 완전히 같은 행' AS kind, count(*) AS groups, coalesce(sum(n),0) AS rows FROM c
    UNION ALL
    SELECT '(examId, 문항번호)가 같은 행', count(*), coalesce(sum(n),0) FROM e
  `);
  const noKey = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`
    SELECT count(*) AS n FROM problem WHERE external_id IS NULL
  `);
  out.identity = {
    duplicates: dup.map((d) => ({
      kind: d.kind,
      groups: Number(d.groups),
      rows: Number(d.rows),
    })),
    withoutExternalId: Number(noKey[0].n),
  };
  console.log("\n§E 번호가 한 문항을 유일하게 가리키는가");
  for (const d of dup)
    console.log(
      `  ${d.kind.padEnd(28)}${String(Number(d.groups)).padStart(5)}그룹 ${String(Number(d.rows)).padStart(6)}행`,
    );
  console.log(
    `  externalId 가 아예 없는 행: ${Number(noKey[0].n)} (${pct(Number(noKey[0].n), total)})`,
  );

  const jsonAt = process.argv.indexOf("--json");
  if (jsonAt >= 0 && process.argv[jsonAt + 1]) {
    await writeFile(
      process.argv[jsonAt + 1],
      JSON.stringify(out, null, 2),
      "utf8",
    );
    console.log("\n저장: %s", process.argv[jsonAt + 1]);
  }
  await prisma.$disconnect();
}

/** 리터럴만 넣는 자리 — 이 파일이 만드는 문자열은 전부 위 상수에서 온다. */
function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

void main();
