/**
 * 수식 잔재 후보정 **적용기** — 계획 → 표본 육안 확인 → 되돌리기 확보 → 적용.
 *
 * 공유 Supabase 다. 트랙 C 의 `apply-render-postfix.ts` 규율을 그대로 따른다.
 *
 *   1. **드라이런이 기본.** 계획 파일과 표본만 만든다. 아무것도 안 바꾼다.
 *   2. **현재 값이 `before` 와 정확히 같을 때만 바꾼다** (`WHERE p.<col> = v.before`).
 *   3. **되돌리기 로그를 DB 를 건드리기 전에 먼저 쓴다.** 로그 없이는 적용하지 않는다.
 *
 * 규칙 자체는 `renderPostfixRules.fixRenderResidue` 에 있고 단위 테스트가 지킨다.
 * 이 파일은 규칙을 DB 로 옮기는 배관일 뿐이다.
 *
 *   npx tsx scripts/qa/apply-math-residue.ts
 *   npx tsx scripts/qa/apply-math-residue.ts --column answer --samples 40
 *   npx tsx scripts/qa/apply-math-residue.ts --rule le/ge          # 규칙 하나만
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-math-residue.ts --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-math-residue.ts --revert
 */
import { gunzipSync } from "node:zlib";

import { mkdir, readFile, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";
import { fixRenderResidue } from "./renderPostfixRules";

/** 갱신 가능한 컬럼 — SQL 에 문자열로 들어가므로 **화이트리스트로만** 받는다. */
const COLUMNS = {
  content: "content",
  answer: "answer",
  solution: "solution",
} as const;
type Column = keyof typeof COLUMNS;

const REPORT_DIR = "scripts/qa/reports";
const planPath = (c: Column) => `${REPORT_DIR}/math-residue-${c}.json`;
const logPath = (c: Column) => `${REPORT_DIR}/math-residue-${c}-applied.json`;

interface PlanItem {
  id: string;
  before: string;
  after: string;
  /** 걸린 규칙들. 표본을 눈으로 볼 때 이게 있어야 판단이 된다. */
  rules: string[];
}

interface Plan {
  column: Column;
  ruleFilter: string | null;
  scanned: number;
  items: PlanItem[];
  /** 손대지 않은 사유별 행 수. 후속 과제가 여기서 나온다. */
  holds: Record<string, number>;
  holdSamples: Array<{ id: string; reason: string; excerpt: string }>;
}

async function buildPlan(
  prisma: PrismaClient,
  column: Column,
  ruleFilter: string | null,
): Promise<Plan> {
  const total = await prisma.problem.count();
  const items: PlanItem[] = [];
  const holds: Record<string, number> = {};
  const holdSamples: Plan["holdSamples"] = [];
  let scanned = 0;

  const PAGE = 2000;
  for (let skip = 0; skip < total; skip += PAGE) {
    const rows = await prisma.problem.findMany({
      select: { id: true, content: true, answer: true, solution: true },
      orderBy: { id: "asc" },
      skip,
      take: PAGE,
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      const before = (row[column] ?? "") as string;
      if (!before) continue;

      const result = fixRenderResidue(before);
      for (const reason of result.holds) {
        holds[reason] = (holds[reason] ?? 0) + 1;
        if (holdSamples.filter((h) => h.reason === reason).length < 4)
          holdSamples.push({
            id: row.id,
            reason,
            excerpt: before.slice(0, 200),
          });
      }
      if (result.content === before) continue;
      // 규칙 하나만 적용하고 싶을 때 — 그 규칙이 안 걸린 행은 건너뛴다.
      if (ruleFilter && !result.applied.includes(ruleFilter)) continue;
      items.push({
        id: row.id,
        before,
        after: result.content,
        rules: result.applied,
      });
    }
  }
  return { column, ruleFilter, scanned, items, holds, holdSamples };
}

/** 현재 값이 `before` 와 같을 때만 바꾼다 — 그 판정을 SQL 안에 둔다. */
async function applyChunk(
  prisma: PrismaClient,
  column: Column,
  chunk: Array<{ id: string; before: string; after: string }>,
): Promise<number> {
  const col = COLUMNS[column]; // 화이트리스트를 거친 값만 SQL 로 간다.
  const values = chunk
    .map(
      (_, i) =>
        `($${i * 3 + 1}::uuid, $${i * 3 + 2}::text, $${i * 3 + 3}::text)`,
    )
    .join(",");
  const params = chunk.flatMap((c) => [c.id, c.before, c.after]);
  const sql = `UPDATE problem AS p
     SET ${col} = v.after, updated_at = now()
     FROM (VALUES ${values}) AS v(id, before, after)
     WHERE p.id = v.id AND p.${col} = v.before`;
  return prisma.$executeRawUnsafe(sql, ...params);
}

/** 바뀐 자리만 좁혀 보여 준다 — 긴 본문에서 무엇이 달라졌는지 눈으로 보려면 필요하다. */
function diffWindow(before: string, after: string, pad = 45): string {
  let head = 0;
  while (head < before.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail += 1;
  const b = before.slice(Math.max(0, head - pad), before.length - tail + pad);
  const a = after.slice(Math.max(0, head - pad), after.length - tail + pad);
  return `전: …${b.replace(/\n/g, "⏎")}…\n  후: …${a.replace(/\n/g, "⏎")}…`;
}

async function main(): Promise<void> {
  const argv = process.argv;
  const columnArg = (argv[argv.indexOf("--column") + 1] ?? "content") as Column;
  const column = (Object.keys(COLUMNS) as Column[]).includes(columnArg)
    ? columnArg
    : "content";
  if (column !== columnArg && argv.includes("--column")) {
    console.error(
      `--column 은 ${Object.keys(COLUMNS).join(" | ")} 중 하나여야 합니다.`,
    );
    process.exitCode = 1;
    return;
  }
  const apply = argv.includes("--apply");
  const revert = argv.includes("--revert");
  const ruleAt = argv.indexOf("--rule");
  const ruleFilter = ruleAt >= 0 ? (argv[ruleAt + 1] ?? null) : null;
  const sampleAt = argv.indexOf("--samples");
  const sampleCount = sampleAt >= 0 ? Number(argv[sampleAt + 1] ?? 20) : 20;

  const prisma = new PrismaClient();
  try {
    if (revert) {
      const logAt = argv.indexOf("--log");
      await runRevert(prisma, column, logAt >= 0 ? argv[logAt + 1] : undefined);
      return;
    }

    const plan = await buildPlan(prisma, column, ruleFilter);
    await mkdir(REPORT_DIR, { recursive: true });
    await writeFile(planPath(column), JSON.stringify(plan, null, 2), "utf-8");

    console.log(`── 수식 잔재 후보정 계획 [${column}] ──`);
    console.log(
      `전수 ${plan.scanned.toLocaleString()} · 바꿀 행 ${plan.items.length}` +
        (ruleFilter ? `  (규칙 「${ruleFilter}」만)` : ""),
    );

    const ruleRows = new Map<string, number>();
    for (const it of plan.items)
      for (const r of it.rules) ruleRows.set(r, (ruleRows.get(r) ?? 0) + 1);
    console.log("\n  규칙별 행 수");
    for (const [r, c] of [...ruleRows].sort((a, b) => b[1] - a[1]))
      console.log(`   ${r.padEnd(20)} ${c}`);

    console.log("\n  손대지 않은 사유별 행 수");
    for (const [r, c] of Object.entries(plan.holds).sort((a, b) => b[1] - a[1]))
      console.log(`   ${r.padEnd(28)} ${c}`);

    // 표본은 **골고루** 뽑는다. 앞에서 20개만 보면 한 학교만 본 셈이 된다.
    console.log(
      `\n── 전/후 표본 ${Math.min(sampleCount, plan.items.length)}건 ──`,
    );
    const step = Math.max(1, Math.floor(plan.items.length / sampleCount));
    for (
      let i = 0;
      i < plan.items.length && i / step < sampleCount;
      i += step
    ) {
      const it = plan.items[i]!;
      console.log(`\n·${it.id.slice(0, 8)}  [${it.rules.join(", ")}]`);
      console.log(`  ${diffWindow(it.before, it.after)}`);
    }
    console.log(`\n계획 파일: ${planPath(column)}`);

    if (!apply) {
      console.log(
        "드라이런 — 변경 없음. 적용하려면 ALLOW_SHARED_IMPORT=1 … --apply",
      );
      return;
    }

    const inspection = await inspectDatabaseTargets();
    if (
      !inspection.selected.canMigrateOrLoad &&
      !allowSharedImport(inspection.selected)
    ) {
      console.log(
        `\n차단 — ${inspection.selected.reason}\nALLOW_SHARED_IMPORT=1 을 명시하세요.`,
      );
      return;
    }

    // 되돌리기 로그를 **먼저** 쓴다. 로그 없이 DB 를 건드리지 않는다.
    await writeFile(
      logPath(column),
      JSON.stringify(
        {
          column,
          ruleFilter,
          items: plan.items.map(({ id, before, after }) => ({
            id,
            before,
            after,
          })),
        },
        null,
        2,
      ),
      "utf-8",
    );
    console.log(`되돌리기 로그: ${logPath(column)}`);

    let changed = 0;
    const CHUNK = 400;
    for (let i = 0; i < plan.items.length; i += CHUNK) {
      changed += await applyChunk(
        prisma,
        column,
        plan.items.slice(i, i + CHUNK),
      );
      process.stdout.write(
        `\r  적용 ${Math.min(i + CHUNK, plan.items.length)}/${plan.items.length}`,
      );
    }
    console.log(
      `\n적용 완료 — 실제 갱신 ${changed} / 계획 ${plan.items.length}` +
        (changed === plan.items.length
          ? ""
          : `  (현재 값이 달라 건너뛴 행 ${plan.items.length - changed})`),
    );
  } finally {
    await prisma.$disconnect();
  }
}

/** `.gz` 도 읽는다 — 추적 경로의 사본은 본문이 통째로 들어가 커서 압축해 둔다. */
async function readLog(path: string): Promise<string> {
  const bytes = await readFile(path);
  if (path.endsWith(".gz")) return gunzipSync(bytes).toString("utf-8");
  return bytes.toString("utf-8");
}

/**
 * `--log` 로 다른 경로를 줄 수 있다. `scripts/qa/reports/` 는 gitignore 라
 * 워크트리를 지우면 사라지므로, **적용한 로그는 추적되는 경로에 복사해 둔다**
 * (`docs/planning/tracks/reports/h-*.json.gz`). 그 복사본으로도 되돌릴 수 있어야
 * 되돌리기 경로가 진짜로 있는 것이다 — 그래서 `.gz` 를 여기서 직접 푼다.
 *
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-math-residue.ts --revert \
 *     --log docs/planning/tracks/reports/h-content-applied-pass1.json.gz
 */
async function runRevert(
  prisma: PrismaClient,
  column: Column,
  logFile?: string,
): Promise<void> {
  const log = JSON.parse(await readLog(logFile ?? logPath(column))) as {
    column?: Column;
    items: Array<{ id: string; before: string; after: string }>;
  };
  const target = log.column ?? column;
  const inspection = await inspectDatabaseTargets();
  if (
    !inspection.selected.canMigrateOrLoad &&
    !allowSharedImport(inspection.selected)
  ) {
    console.log(`차단 — ${inspection.selected.reason}`);
    return;
  }
  // 되돌리기도 같은 규율 — 지금 값이 `after` 일 때만 `before` 로 돌린다.
  const flipped = log.items.map((i) => ({
    id: i.id,
    before: i.after,
    after: i.before,
  }));
  let changed = 0;
  const CHUNK = 400;
  for (let i = 0; i < flipped.length; i += CHUNK) {
    changed += await applyChunk(prisma, target, flipped.slice(i, i + CHUNK));
  }
  console.log(`되돌림 ${changed} / ${flipped.length}`);
}

void main();
