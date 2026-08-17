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
 * ## 이 지표도 한 번 틀렸다 (2026-08-17)
 *
 * 라벨을 `[서술형 3]` 모양으로만 세어 **502건**으로 보고했다. 실측 최빈 모양은
 * `[서술형 $2$]`(번호가 수식으로 감싸임)이라 통째로 빠졌고, 넓은 그물로 다시
 * 세니 **8,502건**이었다 — 16배. 같은 함정을 두 번 밟았다.
 * 그래서 지금은 세는 쪽과 고치는 쪽이 **같은 규칙 모듈**(`renderPostfixRules`)을
 * 쓴다. 규칙이 못 보는 것은 지표도 못 보지만, 적어도 **둘이 갈라지지는 않는다**.
 *
 *   npx tsx scripts/qa/measure-render-defects.ts            요약
 *   npx tsx scripts/qa/measure-render-defects.ts --samples  분류별 표본 출력(눈으로 볼 것)
 *   npx tsx scripts/qa/measure-render-defects.ts --json out.json
 */
import { writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import {
  fixHwpResidue,
  fixStrayDollar,
  isWholesaleHwpScript,
  stripQuestionLabel,
  wholesaleMarkers,
} from "./renderPostfixRules";

const prisma = new PrismaClient();

/**
 * HWP 수식 스크립트 키워드 — **긴 것부터** 둔다(DIVIDE 가 DIV 에 먹히지 않게).
 * 소문자 `divide` 가 목록에 있는 이유: `cdivide5` 같은 실측이 있고, 대문자만
 * 세면 그 부류가 조용히 빠진다.
 */
const HWP_KEYWORDS = [
  "DIVIDE",
  "divide",
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
 *
 * ⚠️ **뒤에 `(?![A-Za-z])` 를 붙이지 않는다.** 이 지표가 세 번 틀린 자리가 전부
 * 여기다 — `DIVIDE`(→`DIV` 가 `I` 에 막힘) · `divide` · `veca`/`vecOA`/`1overn`.
 * HWP 잔재는 **글자에 들러붙은 것이 본모습**이라, 뒤에 영문자를 금지하면
 * 지표가 정확히 결함만 골라서 못 본다. 실측 vec 은 15행인데 "1"로 보고됐다.
 * 정상 LaTeX 명령을 지키는 것은 백슬래시 lookbehind 지 영문자 lookahead 가 아니다.
 *
 * 앞쪽 가드만 남긴다: 소문자 키워드는 **앞이 영문자면** 영어 낱말의 꼬리일 수
 * 있으므로 세지 않는다(`overall` 의 `all` 이 아니라 `Rover` 의 `over` 쪽).
 */
function residueHits(expr: string): Map<string, number> {
  const hits = new Map<string, number>();
  for (const kw of HWP_KEYWORDS) {
    const upper = kw === kw.toUpperCase();
    const pattern = upper
      ? new RegExp(`(?<!\\\\)${kw}`, "g")
      : new RegExp(`(?<![A-Za-z\\\\])${kw}`, "g");
    const n = expr.match(pattern)?.length ?? 0;
    if (n > 0) hits.set(kw, (hits.get(kw) ?? 0) + n);
  }
  return hits;
}

const MATH_SPAN = /\$([^$]+)\$/g;

/** 보기/조건 상자 마커 — 사이 공백을 허용한다(`< 보 기 >`). 상자 조판은 다른 트랙 소관. */
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

function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const jsonAt = process.argv.indexOf("--json");
  const jsonPath = jsonAt >= 0 ? process.argv[jsonAt + 1] : null;

  const total = await prisma.problem.count();
  console.log(`문항 총 ${total.toLocaleString()}건 — 전수 조사`);

  const buckets = {
    labelFixable: bucket(),
    labelHold: bucket(),
    boxMarker: bucket(),
    residueFixable: bucket(),
    residueHold: bucket(),
    longMathSpan: bucket(),
    dollarFixable: bucket(),
    dollarHold: bucket(),
  };
  const keywordCount = new Map<string, number>();
  const labelHoldReasons = new Map<string, number>();
  const labelKinds = new Map<string, number>();
  const residueRules = new Map<string, number>();
  const holdMarkers = new Map<string, number>();
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

      // ── 1. 문항 유형 라벨 ──────────────────────────────────────────
      const label = stripQuestionLabel(text);
      if (label.kind) {
        push(buckets.labelFixable, row.id, text);
        bump(labelKinds, label.kind);
      } else if (label.hold) {
        push(buckets.labelHold, row.id, text);
        bump(labelHoldReasons, label.hold);
      }

      // ── 2. 보기/조건 상자 (다른 트랙 소관 — 세기만 한다) ─────────────
      const boxes = text.match(BOX_MARKER);
      if (boxes) {
        push(buckets.boxMarker, row.id, text);
        for (const shape of boxes) bump(boxShapes, shape);
      }

      // ── 3. HWP 수식 스크립트 잔재 ──────────────────────────────────
      let rowHasResidue = false;
      for (const m of text.matchAll(MATH_SPAN)) {
        mathSpans += 1;
        const expr = m[1] ?? "";
        if (expr.length > 120) push(buckets.longMathSpan, row.id, expr);
        for (const [kw, n] of residueHits(expr)) {
          bump(keywordCount, kw, n);
          rowHasResidue = true;
        }
      }
      if (rowHasResidue) {
        const fix = fixHwpResidue(text);
        if (fix.applied.length > 0) {
          push(buckets.residueFixable, row.id, text);
          for (const rule of fix.applied) bump(residueRules, rule);
        } else {
          push(buckets.residueHold, row.id, text);
          for (const marker of wholesaleMarkers(text))
            bump(holdMarkers, marker);
          if (!isWholesaleHwpScript(text)) bump(holdMarkers, "(규칙 없음)");
        }
      }

      // ── 4. 달러 기호 홀수 = 수식 구간이 안 닫힘 ────────────────────
      if ((text.match(/\$/g) ?? []).length % 2 === 1) {
        const fixed = fixStrayDollar(text);
        if (fixed.applied) push(buckets.dollarFixable, row.id, text);
        else push(buckets.dollarHold, row.id, text);
      }
    }
  }

  const pct = (n: number) =>
    `${((n * 100) / Math.max(1, scanned)).toFixed(2)}%`;
  console.log(
    `\n조사 완료 — ${scanned.toLocaleString()}건 · 수식 span ${mathSpans.toLocaleString()}개\n`,
  );
  console.log(
    "분류별 결함 문항 수      (고칠 수 있는 것 / 규칙으로 못 고쳐 보류)",
  );
  console.log("─".repeat(64));
  const table: Array<[string, Bucket]> = [
    ["유형 라벨 — 뗄 수 있음", buckets.labelFixable],
    ["유형 라벨 — 보류", buckets.labelHold],
    ["<보기>·<조건> 상자 마커", buckets.boxMarker],
    ["HWP 잔재 — 옮길 수 있음", buckets.residueFixable],
    ["HWP 잔재 — 보류(통째 미변환)", buckets.residueHold],
    ["긴 수식 span (120자 초과)", buckets.longMathSpan],
    ["$ 홀수 — 고칠 수 있음", buckets.dollarFixable],
    ["$ 홀수 — 보류", buckets.dollarHold],
  ];
  for (const [label, b] of table) {
    console.log(
      `  ${label.padEnd(30)} ${String(b.count).padStart(7)}  ${pct(b.count)}`,
    );
  }

  const dump = (title: string, map: Map<string, number>) => {
    if (map.size === 0) return;
    console.log(`\n${title}`);
    for (const [k, v] of [...map].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(16)} ${v}`);
    }
  };
  dump("뗀 라벨의 유형", labelKinds);
  dump("라벨 보류 사유", labelHoldReasons);
  dump("잔재 키워드별 출현 수 (수식 span 안)", keywordCount);
  dump("적용된 잔재 규칙", residueRules);
  dump("잔재 보류 표지", holdMarkers);

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
          labelKinds: Object.fromEntries(labelKinds),
          labelHoldReasons: Object.fromEntries(labelHoldReasons),
          keywordCount: Object.fromEntries(keywordCount),
          residueRules: Object.fromEntries(residueRules),
          holdMarkers: Object.fromEntries(holdMarkers),
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
