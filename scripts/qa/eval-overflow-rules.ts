/**
 * 넘침 **경고 규칙**을 실측 높이와 대조한다 — 재현율·헛것을 한계값별로 훑는다.
 *
 * 왜 따로 있나: 지면을 Chromium 으로 그리는 데 전수 30분이 걸린다. 그런데 판정만
 * 고치는 동안 **지면은 한 글자도 안 바뀐다.** 그래서 높이는 한 번만 재서 파일로 두고
 * (`measure-print-overflow.tsx --json`), 규칙은 여기서 몇 번이고 다시 채점한다.
 *
 *   npx tsx scripts/qa/measure-print-overflow.tsx --json .measure/cont.json
 *   npx tsx scripts/qa/measure-print-overflow.tsx --first-page --json .measure/first.json
 *   npx tsx scripts/qa/eval-overflow-rules.ts --heights .measure/cont.json
 *   npx tsx scripts/qa/eval-overflow-rules.ts --heights .measure/first.json --first-page
 *   npx tsx scripts/qa/eval-overflow-rules.ts --sweep 10,12,14,16,18,20,22,24,26
 *
 * `--dims-file` 은 DB 에 적재하기 **전에** 「치수를 알면 얼마나 좋아지는가」를 미리
 * 재는 자리다(`extract-figure-dimensions.ts` 산출물). 공유 DB 를 건드리기 전에
 * 이득이 실제로 있는지부터 확인한다. `--no-dims` 는 반대쪽 — 전부 «모른다»로 본다.
 *
 * ⚠️ **지면 배치를 바꾸는 수리(예: `displayWidth` → `fitsTwoColumns` → 보기 열 수)를
 *    한 뒤에는 캐시가 거짓이 된다.** 그때는 다시 재야 한다. 이 스크립트는 캐시 파일의
 *    문항 수가 DB 와 어긋나면 멈춘다.
 *
 * ⚠️ 채점기가 제품과 갈라지면 «세는 쪽과 고치는 쪽이 같이 눈이 먼다»(CLAUDE.md
 *    2026-08-18). 그래서 제품 상수값에서 이 스크립트의 판정과
 *    `assessOverflowRisk` 가 **한 건도 다르지 않은지** 매 실행 검산한다.
 */
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import type { TestPrintProblem } from "../../src/components/print/types";
import { displayWidth } from "../../src/lib/math/displayWidth";
import { JASEUP_MEASURED_PX } from "../../src/lib/printGeometry";
import {
  OVERFLOW_FIGURE_LIMIT,
  OVERFLOW_LINE_LIMIT,
  OVERFLOW_WIDTH_LIMIT,
  assessOverflowRisk,
  estimateFigureBlockPx,
  estimateProblemLines,
  parseFigureDimensions,
} from "../../src/lib/printOverflow";

const prisma = new PrismaClient();

interface Height {
  pid: string;
  availPx: number;
  neededPx: number;
  figurePx: number;
  choicePx: number;
  boxPx: number;
}

interface Row {
  id: string;
  content: string;
  figureUrls: string[];
  figureDims: number[] | null;
  solution: string | null;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 한계값 하나로 채점한 결과. */
interface Score {
  warned: number;
  hit: number;
  falseAlarm: number;
  missed: number;
}

function score(rows: Array<{ overflows: boolean; warned: boolean }>): Score {
  let warned = 0;
  let hit = 0;
  let falseAlarm = 0;
  let missed = 0;
  for (const r of rows) {
    if (r.warned) warned += 1;
    if (r.overflows && r.warned) hit += 1;
    if (!r.overflows && r.warned) falseAlarm += 1;
    if (r.overflows && !r.warned) missed += 1;
  }
  return { warned, hit, falseAlarm, missed };
}

async function main() {
  const heightsPath = arg("--heights") ?? ".measure/cont.json";
  const firstPage = process.argv.includes("--first-page");
  const sweep = (arg("--sweep") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  /**
   * 그림 치수의 출처. 기본은 DB 컬럼이고, `--dims-file` 이면 추출 파일에서 가져온다
   * (적재 전 이득 측정). `--no-dims` 는 전부 «모른다»로 두는 반대편 대조군이다.
   */
  const dimsFile = arg("--dims-file");
  const noDims = process.argv.includes("--no-dims");
  const fileDims: Record<string, [number, number]> = dimsFile
    ? (JSON.parse(readFileSync(dimsFile, "utf8")) as Record<
        string,
        [number, number]
      >)
    : {};

  const heights = JSON.parse(readFileSync(heightsPath, "utf8")) as Height[];
  const rows = (await prisma
    .$queryRawUnsafe(
      `SELECT id, content, figure_urls AS "figureUrls", figure_dims AS "figureDims", solution
       FROM problem ORDER BY id`,
    )
    .catch(
      async () =>
        // figure_dims 컬럼이 아직 없는 시점에도 돌아야 한다 (마이그레이션 전 측정).
        (await prisma.$queryRawUnsafe(
          `SELECT id, content, figure_urls AS "figureUrls", NULL::int[] AS "figureDims", solution
         FROM problem ORDER BY id`,
        )) as Row[],
    )) as Row[];

  /** 이 문항의 그림 치수 평탄 배열 — 출처 선택을 한 곳에 모은다. */
  const flatDimsFor = (row: Row): number[] | undefined => {
    if (noDims) return undefined;
    if (!dimsFile) return row.figureDims ?? undefined;
    const pairs = row.figureUrls.map((url) => fileDims[url]);
    if (pairs.some((p) => !p)) return undefined; // 한 장이라도 모르면 통째로 모른다
    return pairs.flatMap((p) => p!);
  };

  const byId = new Map(rows.map((r) => [r.id, r]));
  const missingRows = heights.filter((h) => !byId.has(h.pid)).length;
  if (missingRows > 0)
    throw new Error(
      `캐시에 있는 문항 ${missingRows}건이 DB 에 없다 — 캐시가 낡았다. 다시 재라.`,
    );
  if (heights.length !== rows.length)
    console.warn(
      `⚠️ 캐시 ${heights.length}건 vs DB ${rows.length}건 — 캐시가 낡았을 수 있다.`,
    );

  const slot = firstPage
    ? JASEUP_MEASURED_PX.firstPageSlot
    : JASEUP_MEASURED_PX.continuationSlot;
  const dimsSource = noDims
    ? "없음(전부 모른다)"
    : (dimsFile ?? "DB figure_dims");
  console.log(
    `캐시 ${heightsPath} · ${heights.length.toLocaleString()}건 · 문항 칸 ${slot}px · 치수 ${dimsSource}`,
  );

  /* ── 자 검산 ① 그림 모형이 실측 그림 높이와 맞는가 ───────────────────────── */
  const figureErrors: number[] = [];
  let withDims = 0;
  for (const h of heights) {
    const row = byId.get(h.pid)!;
    if (row.figureUrls.length === 0) continue;
    const dims = parseFigureDimensions(row.figureUrls.length, flatDimsFor(row));
    if (dims.some((d) => d === null)) continue;
    withDims += 1;
    // 실측 rect 는 `mt-3` 마진을 뺀 값이다 — 모형에서도 빼고 견준다.
    figureErrors.push(
      estimateFigureBlockPx(dims) -
        JASEUP_MEASURED_PX.figureBlockTop -
        h.figurePx,
    );
  }
  if (withDims > 0) {
    const sorted = [...figureErrors].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.floor(sorted.length * p)]!;
    console.log(
      `\n그림 모형 검산 — 치수를 아는 ${withDims.toLocaleString()}건\n` +
        `  오차(모형−실측) p05 ${q(0.05).toFixed(1)}px · 중앙 ${q(0.5).toFixed(1)}px · p95 ${q(0.95).toFixed(1)}px\n` +
        `  |오차| ≤ 2px ${((100 * figureErrors.filter((e) => Math.abs(e) <= 2).length) / figureErrors.length).toFixed(1)}%`,
    );
  } else {
    console.log("\n그림 모형 검산 — 치수가 적재되지 않았다(전부 «모른다»).");
  }

  /* ── 채점 ────────────────────────────────────────────────────────────────── */
  const graded = heights.map((h) => {
    const row = byId.get(h.pid)!;
    const content = row.content ?? "";
    const flat = flatDimsFor(row);
    const dims = parseFigureDimensions(row.figureUrls.length, flat);
    const problem: TestPrintProblem = {
      id: row.id,
      orderIndex: 0,
      content,
      answer: "",
      solution: row.solution,
      figureUrls: row.figureUrls,
      figureDims: flat,
    };
    return {
      pid: h.pid,
      overflows: h.neededPx > slot,
      excess: h.neededPx - slot,
      width: displayWidth(content),
      lines: estimateProblemLines(content, dims),
      figures: row.figureUrls.length,
      // 장수 규칙은 **치수를 모를 때만** 켜진다 — 제품과 같은 조건이어야 한다.
      countRule:
        row.figureUrls.length >= OVERFLOW_FIGURE_LIMIT &&
        dims.some((d) => d === null),
      product: assessOverflowRisk([problem]).length > 0,
    };
  });

  const warnedAt = (limit: number) => (g: (typeof graded)[number]) =>
    g.width > OVERFLOW_WIDTH_LIMIT || g.lines > limit || g.countRule;

  /* ── 자 검산 ② 채점기가 제품과 한 건도 다르지 않은가 ─────────────────────── */
  const drift = graded.filter(
    (g) => warnedAt(OVERFLOW_LINE_LIMIT)(g) !== g.product,
  );
  if (drift.length > 0)
    throw new Error(
      `채점기가 제품과 ${drift.length}건 다르다 — 규칙을 옮겨 적었다는 뜻이다. 예: ${drift[0]!.pid}`,
    );
  console.log("채점기 ↔ 제품 일치 확인 (0건 불일치)");

  const over = graded.filter((g) => g.overflows).length;
  const report = (label: string, s: Score) =>
    console.log(
      `  ${label.padEnd(12)} 경고 ${String(s.warned).padStart(6)}` +
        ` 맞음 ${String(s.hit).padStart(5)}` +
        ` 헛것 ${String(s.falseAlarm).padStart(5)}` +
        ` 놓침 ${String(s.missed).padStart(5)}` +
        ` 재현율 ${((100 * s.hit) / Math.max(1, over)).toFixed(1)}%` +
        ` 정밀도 ${((100 * s.hit) / Math.max(1, s.warned)).toFixed(1)}%`,
    );

  console.log(
    `\n실측 넘침 ${over.toLocaleString()} (${((over * 100) / graded.length).toFixed(2)}%)`,
  );
  console.log("현행 제품 규칙");
  report(
    `한계 ${OVERFLOW_LINE_LIMIT}`,
    score(graded.map((g) => ({ overflows: g.overflows, warned: g.product }))),
  );

  if (sweep.length > 0) {
    console.log("\n한계값 훑기 (폭·그림 장수 규칙은 그대로)");
    for (const limit of sweep) {
      const w = warnedAt(limit);
      report(
        `한계 ${limit}`,
        score(graded.map((g) => ({ overflows: g.overflows, warned: w(g) }))),
      );
    }
  }

  /* ── 규칙별 기여 — «이 규칙이 없으면 무엇을 놓치나» ─────────────────────── */
  const limit = Number(arg("--at") ?? OVERFLOW_LINE_LIMIT);
  const byRule = (g: (typeof graded)[number]) => ({
    width: g.width > OVERFLOW_WIDTH_LIMIT,
    lines: g.lines > limit,
    count: g.countRule,
  });
  console.log(`
규칙별 기여 (줄 수 한계 ${limit})`);
  for (const name of ["width", "lines", "count"] as const) {
    const only = graded.filter((g) => {
      const r = byRule(g);
      return r[name] && !Object.entries(r).some(([k, v]) => k !== name && v);
    });
    const alone = only.filter((g) => g.overflows).length;
    console.log(
      `  ${name.padEnd(6)} 이 규칙만 걸리는 문항 ${String(only.length).padStart(5)}` +
        ` — 그중 실제 넘침 ${String(alone).padStart(5)}` +
        ` (${((100 * alone) / Math.max(1, only.length)).toFixed(1)}%)`,
    );
  }

  const missed = graded
    .filter((g) => g.overflows && !g.product)
    .sort((a, b) => b.excess - a.excess);
  console.log(`\n놓친 표본 — 넘친 양이 큰 순 (${missed.length}건)`);
  for (const m of missed.slice(0, 10))
    console.log(
      `· ${m.pid} 넘침 ${m.excess.toFixed(0)}px 추정 ${m.lines}줄 폭 ${m.width} 그림 ${m.figures}`,
    );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
