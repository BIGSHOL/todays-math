/**
 * HWP 글자 오독(`≠`→`%` · `≅`→`°` · `↔`→`θ`)을 **본문·해설·정답에서** 되돌린다.
 *
 *   npx tsx scripts/qa/apply-glyph-misdecode.ts                 # 드라이런(기본)
 *   npx tsx scripts/qa/apply-glyph-misdecode.ts --sample 12     # 바뀌는 자리 보기
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-glyph-misdecode.ts --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-glyph-misdecode.ts --revert --apply
 *
 * 규칙과 근거는 `src/lib/problem/glyphMisdecode.ts` 에 있다 — **판정을 여기서
 * 다시 쓰지 않는다.** 두 벌로 적으면 한쪽만 고쳐도 아무도 모른다.
 *
 * ⚠️ 공유 DB(D-31). 기본은 드라이런.
 * ⚠️ 되돌리기는 **지금 값이 우리가 쓴 값일 때만** 한다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { FIXES, fixGlyphs } from "../../src/lib/problem/glyphMisdecode";
import { isDirectScript } from "../import/isDirectScript";

const LEDGER = "scripts/qa/reports/glyph-misdecode.json";

/** 손대는 칸 — 셋 다 지면·채점에 나간다. */
const COLUMNS = ["content", "solution", "answer"] as const;
type Column = (typeof COLUMNS)[number];

interface LedgerRow {
  id: string;
  code: string;
  before: Partial<Record<Column, string>>;
  after: Partial<Record<Column, string>>;
}

async function main(): Promise<void> {
  const APPLY = process.argv.includes("--apply");
  const REVERT = process.argv.includes("--revert");
  const at = process.argv.indexOf("--sample");
  const sampleN = at >= 0 ? Number(process.argv[at + 1] ?? 8) : 0;
  if ((APPLY || REVERT) && process.env.ALLOW_SHARED_IMPORT !== "1") {
    console.error(
      "공유 DB 쓰기가 막혀 있다(D-31). ALLOW_SHARED_IMPORT=1 이 필요하다.",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    if (REVERT) return await revert(prisma, APPLY);

    const rows = await prisma.problem.findMany({
      select: {
        id: true,
        problemCode: true,
        content: true,
        solution: true,
        answer: true,
      },
    });

    const ledger: LedgerRow[] = [];
    const perGlyph: Record<string, number> = {};
    const perColumn: Record<string, number> = {};
    let skippedGenuine = 0;
    const samples: string[] = [];

    for (const r of rows) {
      const before: LedgerRow["before"] = {};
      const after: LedgerRow["after"] = {};
      for (const col of COLUMNS) {
        const cur = r[col];
        if (typeof cur !== "string" || cur === "") continue;
        const got = fixGlyphs(cur);
        if (got.text === cur) {
          // 고칠 글자가 **있는데** 안 바뀌었으면 「진짜 기호라 건너뛴 것」이다.
          if (FIXES.some((f) => cur.includes(f.from))) skippedGenuine++;
          continue;
        }
        before[col] = cur;
        after[col] = got.text;
        perColumn[col] = (perColumn[col] ?? 0) + 1;
        for (const [g, n] of Object.entries(got.counts))
          perGlyph[g] = (perGlyph[g] ?? 0) + n;
        if (samples.length < sampleN) {
          const i = [...cur].findIndex((c, k) => c !== got.text[k]);
          samples.push(
            `${r.problemCode} ${col}\n     전: …${cur.slice(Math.max(0, i - 34), i + 26).replace(/\s+/g, " ")}…` +
              `\n     후: …${got.text.slice(Math.max(0, i - 34), i + 26).replace(/\s+/g, " ")}…`,
          );
        }
      }
      if (Object.keys(after).length > 0)
        ledger.push({ id: r.id, code: r.problemCode, before, after });
    }

    // 분모를 먼저 찍는다.
    console.log(`전체 문항 ${rows.length.toLocaleString()} (분모)`);
    console.log(`  🔴 고칠 문항 ${ledger.length.toLocaleString()}`);
    console.log(`  칸별 : ${JSON.stringify(perColumn)}`);
    console.log(`  글자별: ${JSON.stringify(perGlyph)}`);
    console.log(`  진짜 기호라 건너뛴 칸 ${skippedGenuine.toLocaleString()}`);
    for (const s of samples) console.log("   " + s);

    if (!APPLY) {
      console.log("\n드라이런이다 — DB 를 한 건도 안 바꿨다.");
      return;
    }
    if (ledger.length === 0) return;

    // 되돌리기 원장을 **DB 보다 먼저** 쓴다.
    mkdirSync(path.dirname(LEDGER), { recursive: true });
    writeFileSync(
      LEDGER,
      JSON.stringify(
        {
          note:
            "되돌리기 자료. before 가 고치기 전 값이다. " +
            "되돌리기: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-glyph-misdecode.ts --revert --apply",
          rules: FIXES,
          perGlyph,
          rows: ledger,
        },
        null,
        1,
      ),
      "utf-8",
    );
    console.log(
      `\n되돌리기 원장 → ${LEDGER} (${ledger.length}행) — DB 보다 먼저 썼다`,
    );

    let n = 0;
    for (const l of ledger) {
      await prisma.problem.update({ where: { id: l.id }, data: l.after });
      if (++n % 100 === 0) process.stdout.write(`\r적용 ${n}/${ledger.length}`);
    }
    console.log(`\r적용 완료 ${n.toLocaleString()}건`);
  } finally {
    await prisma.$disconnect();
  }
}

/** 되돌리기 — **지금 값이 우리가 쓴 값일 때만** 되돌린다. */
async function revert(prisma: PrismaClient, apply: boolean): Promise<void> {
  if (!existsSync(LEDGER)) {
    console.error(`되돌릴 원장이 없다: ${LEDGER}`);
    process.exit(1);
  }
  const l = JSON.parse(readFileSync(LEDGER, "utf-8")) as { rows: LedgerRow[] };
  let done = 0;
  let skipped = 0;
  for (const r of l.rows) {
    const cur = await prisma.problem.findUnique({
      where: { id: r.id },
      select: { content: true, solution: true, answer: true },
    });
    if (!cur) {
      skipped++;
      continue;
    }
    const mine = COLUMNS.every(
      (c) => r.after[c] === undefined || cur[c] === r.after[c],
    );
    if (!mine) {
      skipped++;
      continue;
    }
    if (apply)
      await prisma.problem.update({ where: { id: r.id }, data: r.before });
    done++;
  }
  console.log(
    `되돌리기${apply ? "" : " (드라이런)"}: ${done} · 건너뜀 ${skipped}` +
      (skipped
        ? " — 그 뒤 다른 트랙이 바꾼 것이다. 남의 값을 덮지 않는다."
        : ""),
  );
}

if (isDirectScript(import.meta.url)) void main();
