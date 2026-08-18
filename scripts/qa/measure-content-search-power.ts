/**
 * 「지면에서 읽은 한 구절로 그 문항을 찾을 수 있는가」 — **읽기 전용** 실측.
 *
 * 검토 ②(id-find) 대안 ①(본문 검색)의 값을 재는 자리다. 검색창을 붙이자는 제안은
 * 쉽지만, **그 검색이 원장님이 실제로 가진 것(인쇄된 지면·화면 스크린샷)으로 되는가**는
 * 다른 질문이다. 원장님이 옮겨 적을 수 있는 것은 **화면에 글자로 보이는 부분**뿐이다 —
 * 수식은 KaTeX 가 기호로 그리므로 DB 의 `$...$` 원문과 글자가 다르다.
 *
 * 그래서 세 가지를 잰다.
 *   §1 **옮길 구절이 있기는 한가** — 본문에 수식·LaTeX 이 아닌 한글 덩어리가 있는가.
 *      없으면 본문 검색은 그 문항에 대해 **구조적으로 0점**이다(번호가 필요한 자리).
 *   §2 **그 구절이 문항을 좁히는가** — 표본에서 실제로 뽑은 구절로 ILIKE 를 돌려
 *      맞는 행이 몇 개인지 센다. 1이면 바로 찾은 것, 수십이면 다시 훑어야 한다.
 *   §3 **소단원 필터와 겹쳐 쓰면** 얼마나 더 좁는가 (같은 질의에서 함께 센다).
 *
 * ⚠️ 구절을 **어느 자리에서** 뽑느냐로 결과가 크게 갈린다. 한쪽만 재면 지표가 답을
 *    정해 버리므로 두 방식을 다 잰다 — 기본은 본문 맨 앞(상투구가 걸리는 불리한 쪽),
 *    `--pick-longest` 는 가장 긴 한글 덩어리(사람이 특징적인 구절을 고르는 쪽).
 *
 * ⚠️ 쓰기 없음. 인덱스도 만들지 않는다(공유 DB, D-31).
 *
 *   npx tsx scripts/qa/measure-content-search-power.ts
 *   npx tsx scripts/qa/measure-content-search-power.ts --sample 300 --pick-longest --json out.json
 */
import { PrismaClient } from "@prisma/client";
import { writeFile } from "node:fs/promises";

const prisma = new PrismaClient();

/**
 * 「눈으로 읽어 옮길 수 있는 구절」의 정의 — 한글로 시작하는, 한글·숫자·공백·쉼표만
 * 이어지는 덩어리. LaTeX 명령(`\frac`)·달러 기호·라틴 변수(`f(x)`)가 끼면 끊긴다.
 * 화면에서는 그 자리에 기호가 그려지므로 원장님이 그대로 옮겨 적을 수 없다.
 */
const READABLE_RUN = "[가-힣][가-힣0-9 ,]{9,}";
/** 옮겨 적을 만한 길이 — 너무 길면 사람이 안 옮기고, 너무 짧으면 아무거나 걸린다. */
const SNIPPET_CHARS = 16;
/** 한 질의에 몇 구절을 넣을지 — 구절마다 순차 스캔이 두 번씩 도니 잘게 나눈다. */
const CHUNK = 15;

function arg(name: string, fallback: number): number {
  const at = process.argv.indexOf(name);
  if (at < 0) return fallback;
  const value = Number(process.argv[at + 1]);
  return Number.isFinite(value) ? value : fallback;
}

function pct(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const sampleSize = arg("--sample", 200);
  const pickLongest = process.argv.includes("--pick-longest");
  const out: Record<string, unknown> = {};

  // ── §1 옮길 구절이 있기는 한가 (전수) ────────────────────
  const coverage = await prisma.$queryRawUnsafe<
    {
      total: bigint;
      has_run: bigint;
      korean_chars_p50: number;
      dollar_rows: bigint;
    }[]
  >(`
    SELECT count(*)                                                        AS total,
           count(*) FILTER (WHERE content ~ '${READABLE_RUN}')             AS has_run,
           percentile_disc(0.5) WITHIN GROUP (
             ORDER BY length(regexp_replace(content, '[^가-힣]', '', 'g'))
           )::int                                                          AS korean_chars_p50,
           count(*) FILTER (WHERE content LIKE '%$%')                      AS dollar_rows
    FROM problem
  `);
  const total = Number(coverage[0].total);
  const hasRun = Number(coverage[0].has_run);
  out.coverage = {
    total,
    hasReadableRun: hasRun,
    withoutReadableRun: total - hasRun,
    koreanCharsMedian: coverage[0].korean_chars_p50,
    rowsWithMath: Number(coverage[0].dollar_rows),
  };
  console.log("\n§1 본문에 «옮겨 적을 수 있는 한글 구절»이 있는가");
  console.log(`  전체 ${total.toLocaleString("ko-KR")}행`);
  console.log(
    `  10자 이상 한글 덩어리가 있는 행: ${hasRun.toLocaleString("ko-KR")} (${pct(hasRun, total)})`,
  );
  console.log(
    `  없는 행(수식·기호뿐): ${(total - hasRun).toLocaleString("ko-KR")} (${pct(total - hasRun, total)}) — 본문 검색이 구조적으로 못 찾는 몫`,
  );
  console.log(`  본문 한글 글자 수 중앙값: ${coverage[0].korean_chars_p50}자`);
  console.log(
    `  수식(\`$\`)이 든 행: ${Number(coverage[0].dollar_rows).toLocaleString("ko-KR")} (${pct(Number(coverage[0].dollar_rows), total)})`,
  );

  // ── §2·§3 뽑은 구절이 실제로 몇 행을 맞히나 (표본) ────────
  //
  // 표본은 «구절이 있는 행»에서만 뽑는다 — 없는 행의 몫은 §1 이 이미 셌다.
  const snippetExpr = pickLongest
    ? `btrim(left((SELECT m[1] FROM regexp_matches(content, '${READABLE_RUN}', 'g') AS m
                   ORDER BY length(m[1]) DESC LIMIT 1), ${SNIPPET_CHARS}))`
    : `btrim(left(substring(content from '${READABLE_RUN}'), ${SNIPPET_CHARS}))`;
  const samples = await prisma.$queryRawUnsafe<
    { id: string; unit_id: string; snip: string | null }[]
  >(`
    SELECT id, unit_id, ${snippetExpr} AS snip
    FROM problem
    WHERE content ~ '${READABLE_RUN}'
    ORDER BY md5(id::text)
    LIMIT ${sampleSize}
  `);
  const usable = samples.filter((s) => (s.snip ?? "").length >= 6);
  console.log(
    `\n  구절을 뽑은 자리: ${pickLongest ? "가장 긴 한글 덩어리 (--pick-longest)" : "본문 맨 앞 (기본)"}`,
  );

  const hits: { id: string; snip: string; n: number; inUnit: number }[] = [];
  for (let i = 0; i < usable.length; i += CHUNK) {
    const chunk = usable.slice(i, i + CHUNK);
    const values = chunk
      .map(
        (_, j) =>
          `($${j * 3 + 1}::text, $${j * 3 + 2}::uuid, $${j * 3 + 3}::text)`,
      )
      .join(", ");
    // 검색만 쓸 때(n)와 **소단원 필터를 같이 걸 때**(in_unit)를 한 번에 센다.
    // 화면이 이미 가진 필터와 겹쳐 쓰면 검색이 얼마나 더 좁히는지가 여기서 갈린다.
    const rows = await prisma.$queryRawUnsafe<
      { id: string; snip: string; n: bigint; in_unit: bigint }[]
    >(
      `SELECT s.id, s.snip,
              (SELECT count(*) FROM problem p
                WHERE p.content ILIKE '%' || s.snip || '%') AS n,
              (SELECT count(*) FROM problem p
                WHERE p.content ILIKE '%' || s.snip || '%'
                  AND p.unit_id = s.unit_id) AS in_unit
         FROM (VALUES ${values}) AS s(id, unit_id, snip)`,
      ...chunk.flatMap((c) => [c.id, c.unit_id, c.snip as string]),
    );
    for (const r of rows)
      hits.push({
        id: r.id,
        snip: r.snip,
        n: Number(r.n),
        inUnit: Number(r.in_unit),
      });
    process.stdout.write(`\r  표본 진행 ${hits.length}/${usable.length}`);
  }
  process.stdout.write("\r");

  const buckets: Record<string, number> = {
    "1 (바로 찾음)": 0,
    "2–5": 0,
    "6–20 (한 페이지)": 0,
    "21–100": 0,
    "101 이상": 0,
  };
  for (const h of hits) {
    if (h.n <= 1) buckets["1 (바로 찾음)"] += 1;
    else if (h.n <= 5) buckets["2–5"] += 1;
    else if (h.n <= 20) buckets["6–20 (한 페이지)"] += 1;
    else if (h.n <= 100) buckets["21–100"] += 1;
    else buckets["101 이상"] += 1;
  }
  const counts = hits.map((h) => h.n).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)] ?? 0;
  const p90 = counts[Math.floor(counts.length * 0.9)] ?? 0;
  const unitCounts = hits.map((h) => h.inUnit).sort((a, b) => a - b);
  const unitMedian = unitCounts[Math.floor(unitCounts.length / 2)] ?? 0;
  const unitP90 = unitCounts[Math.floor(unitCounts.length * 0.9)] ?? 0;
  const unitUnique = hits.filter((h) => h.inUnit <= 1).length;
  const worst = [...hits].sort((a, b) => b.n - a.n).slice(0, 5);
  out.snippetHits = {
    pick: pickLongest ? "longest" : "first",
    sample: hits.length,
    snippetChars: SNIPPET_CHARS,
    buckets,
    median,
    p90,
    worst: counts[counts.length - 1] ?? 0,
    withUnitFilter: {
      median: unitMedian,
      p90: unitP90,
      unique: unitUnique,
      uniquePct: pct(unitUnique, hits.length),
    },
    examplesWorst: worst,
  };
  console.log(
    `\n§2 그 구절(앞 ${SNIPPET_CHARS}자)로 검색하면 몇 행이 걸리나 — 표본 ${hits.length}건`,
  );
  for (const [label, n] of Object.entries(buckets))
    console.log(
      `  ${label.padEnd(20)}${String(n).padStart(5)} (${pct(n, hits.length)})`,
    );
  console.log(
    `  중앙값 ${median}행 · p90 ${p90}행 · 최악 ${counts[counts.length - 1] ?? 0}행`,
  );
  console.log(
    `\n§3 같은 소단원으로 한 번 더 좁히면 — 중앙값 ${unitMedian}행 · p90 ${unitP90}행 · 유일 ${unitUnique}건 (${pct(unitUnique, hits.length)})`,
  );
  console.log("  많이 걸린 구절 5개:");
  for (const h of worst)
    console.log(`    ${String(h.n).padStart(6)}행  «${h.snip}»`);

  const jsonAt = process.argv.indexOf("--json");
  if (jsonAt >= 0 && process.argv[jsonAt + 1]) {
    await writeFile(
      process.argv[jsonAt + 1],
      JSON.stringify(out, null, 2),
      "utf8",
    );
    console.log(`\n저장: ${process.argv[jsonAt + 1]}`);
  }
  await prisma.$disconnect();
}

void main();
