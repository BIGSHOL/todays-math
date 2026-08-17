/**
 * 문제 본문 **렌더 결함** 실태 조사 (읽기 전용).
 *
 * 화면에 나가는 것은 JSON 리포트가 아니라 **DB 본문**이다. 그런데 기존 잔재 지표
 * (`measure-hwp-latex-residue.py`)는 `scripts/qa/reports/hwp-latex/*.json` 만 본다.
 * 게다가 그 지표의 키워드 패턴은 `(?![A-Za-z])` 로 끝나서 **`DIVIDE` 를 못 잡는다**
 * (`DIV` 뒤에 `I` 가 오므로). 실제 화면에 `aDIVIDEb` 가 나오는데 지표는 0을 가리킨다 —
 * 10-handoff §8.5 "동어반복 측정"·CLAUDE.md 2026-08-16 교훈과 같은 자리다.
 *
 * 그래서 여기서는 **DB 전수**를 세고, 키워드는 **긴 것부터** 맞춰 본다.
 *
 *   npx tsx scripts/qa/measure-render-defects.ts            요약
 *   npx tsx scripts/qa/measure-render-defects.ts --samples  분류별 표본 출력(눈으로 볼 것)
 *   npx tsx scripts/qa/measure-render-defects.ts --json out.json
 */
import { writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** HWP 수식 스크립트 키워드 — **긴 것부터** 둔다(DIVIDE 가 DIV 에 먹히지 않게). */
const HWP_KEYWORDS = [
  "DIVIDE",
  "TIMES",
  "CDOT",
  "TRIANGLE",
  "ANGLE",
  "SQRT",
  "ROOT",
  "RIGHT",
  "LEFT",
  "OVER",
  "ATOP",
  "PILE",
  "SUM",
  "INT",
  "LIM",
  "over",
  "atop",
  "pile",
  "sqrt",
  "root",
  "bar",
  "hat",
  "vec",
];

/**
 * 맨 키워드 판정 — 백슬래시(정상 LaTeX 명령)에 붙지 않은 것만 잔재로 센다.
 * 대문자 키워드는 앞뒤가 영문자여도 잔재다(`aDIVIDEb` 가 바로 그 모양).
 * 소문자 키워드는 영어 단어의 일부일 수 있어 **양옆이 숫자·기호일 때만** 센다.
 */
function residueHits(expr: string): Map<string, number> {
  const hits = new Map<string, number>();
  for (const kw of HWP_KEYWORDS) {
    const isUpper = kw === kw.toUpperCase();
    const pattern = isUpper
      ? new RegExp(`(?<!\\\\)${kw}`, "g")
      : new RegExp(`(?<![A-Za-z\\\\])${kw}(?![A-Za-z])`, "g");
    const n = expr.match(pattern)?.length ?? 0;
    if (n > 0) hits.set(kw, (hits.get(kw) ?? 0) + n);
  }
  return hits;
}

const MATH_SPAN = /\$([^$]+)\$/g;

/** 서술형 라벨 — `[서술형1]`, `[서술형 3]`, `[서술형]`, `【서술형2】` 등. */
const ESSAY_LABEL = /[[【]\s*서\s*술\s*형\s*\d*\s*[\]】]/g;
/** 다른 지면 라벨도 같이 센다 — 배치 시 시스템이 붙일 것들이다. */
const OTHER_LABEL = /[[【]\s*(객관식|단답형|주관식|선택형)\s*\d*\s*[\]】]/g;

/** 보기/조건 상자 마커 — 사이 공백을 허용한다(`< 보 기 >`). */
const BOX_MARKER = /[<〈［[]\s*(보\s*기|조\s*건)\s*[>〉］\]]/g;

type Row = { id: string; content: string; problemType: string };

type Bucket = {
  count: number;
  samples: Array<{ id: string; excerpt: string }>;
};

function bucket(): Bucket {
  return { count: 0, samples: [] };
}

function push(b: Bucket, id: string, excerpt: string, limit = 6) {
  b.count += 1;
  if (b.samples.length < limit)
    b.samples.push({ id, excerpt: excerpt.slice(0, 220) });
}

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const jsonAt = process.argv.indexOf("--json");
  const jsonPath = jsonAt >= 0 ? process.argv[jsonAt + 1] : null;

  const total = await prisma.problem.count();
  console.log(`문항 총 ${total.toLocaleString()}건 — 전수 조사`);

  const buckets = {
    essayLabel: bucket(),
    otherLabel: bucket(),
    boxMarker: bucket(),
    hwpResidue: bucket(),
    longMathSpan: bucket(),
    unclosedMath: bucket(),
  };
  const keywordCount = new Map<string, number>();
  const boxShapes = new Map<string, number>();
  let mathSpans = 0;
  let scanned = 0;

  const PAGE = 2000;
  for (let skip = 0; skip < total; skip += PAGE) {
    const rows = (await prisma.problem.findMany({
      select: { id: true, content: true, problemType: true },
      orderBy: { id: "asc" },
      skip,
      take: PAGE,
    })) as Row[];
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      const text = row.content ?? "";

      const essay = text.match(ESSAY_LABEL);
      if (essay) push(buckets.essayLabel, row.id, text);

      const other = text.match(OTHER_LABEL);
      if (other) push(buckets.otherLabel, row.id, text);

      const boxes = text.match(BOX_MARKER);
      if (boxes) {
        push(buckets.boxMarker, row.id, text);
        for (const shape of boxes) {
          boxShapes.set(shape, (boxShapes.get(shape) ?? 0) + 1);
        }
      }

      // 달러 기호 홀수 = 수식 구간이 안 닫힘 → 본문이 통째로 수식처럼 보이거나 반대가 된다.
      const dollars = (text.match(/\$/g) ?? []).length;
      if (dollars % 2 === 1) push(buckets.unclosedMath, row.id, text);

      let rowHasResidue = false;
      for (const m of text.matchAll(MATH_SPAN)) {
        mathSpans += 1;
        const expr = m[1] ?? "";
        if (expr.length > 120) push(buckets.longMathSpan, row.id, expr);
        for (const [kw, n] of residueHits(expr)) {
          keywordCount.set(kw, (keywordCount.get(kw) ?? 0) + n);
          rowHasResidue = true;
        }
      }
      if (rowHasResidue) push(buckets.hwpResidue, row.id, text);
    }
  }

  const pct = (n: number) =>
    `${((n * 100) / Math.max(1, scanned)).toFixed(2)}%`;
  console.log(
    `\n조사 완료 — ${scanned.toLocaleString()}건 · 수식 span ${mathSpans.toLocaleString()}개\n`,
  );
  console.log("분류별 결함 문항 수");
  console.log("─".repeat(58));
  const table: Array<[string, Bucket]> = [
    ["서술형 등 라벨이 본문에 박힘", buckets.essayLabel],
    ["기타 유형 라벨", buckets.otherLabel],
    ["<보기>·<조건> 상자 마커", buckets.boxMarker],
    ["HWP 수식 스크립트 잔재", buckets.hwpResidue],
    ["긴 수식 span (120자 초과)", buckets.longMathSpan],
    ["수식 구간 안 닫힘 ($ 홀수)", buckets.unclosedMath],
  ];
  for (const [label, b] of table) {
    console.log(
      `  ${label.padEnd(28)} ${String(b.count).padStart(7)}  ${pct(b.count)}`,
    );
  }

  if (keywordCount.size > 0) {
    console.log("\n잔재 키워드별 출현 수");
    for (const [kw, n] of [...keywordCount].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${kw.padEnd(10)} ${n}`);
    }
  }
  if (boxShapes.size > 0) {
    console.log("\n상자 마커 실제 모양");
    for (const [shape, n] of [...boxShapes]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)) {
      console.log(`  ${JSON.stringify(shape).padEnd(18)} ${n}`);
    }
  }

  if (wantSamples) {
    console.log("\n\n표본 — 규칙은 눈으로 봐야 틀린 게 보인다");
    for (const [label, b] of table) {
      if (b.samples.length === 0) continue;
      console.log(`\n### ${label} (${b.count}건)`);
      for (const s of b.samples)
        console.log(
          `  · ${s.id.slice(0, 8)} ${s.excerpt.replace(/\n/g, " ⏎ ")}`,
        );
    }
  }

  if (jsonPath) {
    await writeFile(
      jsonPath,
      JSON.stringify(
        {
          scanned,
          mathSpans,
          buckets: Object.fromEntries(
            Object.entries(buckets).map(([k, v]) => [
              k,
              { count: v.count, samples: v.samples },
            ]),
          ),
          keywordCount: Object.fromEntries(keywordCount),
          boxShapes: Object.fromEntries(boxShapes),
        },
        null,
        2,
      ),
      "utf-8",
    );
    console.log(`\n저장: ${jsonPath}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
