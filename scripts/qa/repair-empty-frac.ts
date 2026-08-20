/**
 * **빈 분수 되살리기 적용기** — `\frac{}{b}` 가 지면에서 `\frac{0}{b}` 로
 * 지어내지던 자리를 원래 값으로 되돌린다.
 *
 *   npx tsx scripts/qa/repair-empty-frac.ts                    # 드라이런(기본)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/repair-empty-frac.ts --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/repair-empty-frac.ts --revert --apply
 *
 * 규칙은 `emptyFracRules.ts` 에 있다 — **판정을 여기서 다시 쓰지 않는다.**
 *
 * ⚠️ 공유 DB(D-31). 기본은 드라이런. 되돌리기 원장을 **DB 보다 먼저** 쓴다.
 * ⚠️ 되돌리기는 **지금 값이 우리가 쓴 값일 때만** 한다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { fixEmptyFrac } from "./emptyFracRules";
import { isDirectScript } from "../import/isDirectScript";

const LEDGER = "scripts/qa/reports/empty-frac-repair.json";
const COLUMNS = ["content", "solution"] as const;
type Column = (typeof COLUMNS)[number];

/**
 * 손으로 통째로 고치는 행 — 규칙이 닿지 않는 **다른 결함**이 섞여 있다.
 *
 * `HAL0213-7LEC` 는 빈 분수 말고도 「분모의 뒷곱이 분수 밖에 남은」 자리가
 * 셋 더 있다(`\frac{X}{2}bc` → 실제는 `X/(2bc)`). 코사인법칙이라 옳은 꼴이
 * 정해져 있다: cos A=(b²+c²−a²)/(2bc) · cos B=(a²+c²−b²)/(2ac).
 * 규칙을 넓혀 잡으면 멀쩡한 `\frac{a}{2}b` (진짜로 a/2 곱하기 b) 까지 바꾼다.
 */
const 손수리: Record<string, Record<string, [string, string][]>> = {
  "HAL0213-7LEC": {
    solution: [
      [
        "$b^{2}+c^{2}-a^{2}\\frac{}{2}bc:\\frac{a^{2}+c^{2}-b^{2}}{2}ac=b:a$",
        "$\\frac{b^{2}+c^{2}-a^{2}}{2bc}:\\frac{a^{2}+c^{2}-b^{2}}{2ac}=b:a$",
      ],
      [
        "$\\frac{b(a^{2}+c^{2}-b^{2})}{2}ac=\\frac{a(b^{2}+c^{2}-a^{2})}{2}bc$",
        "$\\frac{b(a^{2}+c^{2}-b^{2})}{2ac}=\\frac{a(b^{2}+c^{2}-a^{2})}{2bc}$",
      ],
    ],
  },
};

interface LedgerRow {
  id: string;
  code: string;
  before: Partial<Record<Column, string>>;
  after: Partial<Record<Column, string>>;
  fixes: string[];
}

/** 수를 잃지 않았는가 — **종류**로 센다(깨진 값은 같은 수를 되풀이한다). */
function 수를잃었나(before: string, after: string): boolean {
  const nums = (s: string) => new Set(s.match(/\d+/g) ?? []);
  const b = nums(before);
  const a = nums(after);
  for (const n of b) if (!a.has(n)) return true;
  return false;
}

/** 한글을 잃지 않았는가 — 수식 밖은 한 글자도 안 건드려야 한다. */
function 한글을잃었나(before: string, after: string): boolean {
  const ko = (s: string) => (s.match(/[가-힣]/g) ?? []).join("");
  return ko(before) !== ko(after);
}

/** 수식 덩어리마다 규칙을 대고, 못 고친 자리가 남으면 그 행은 통째로 건너뛴다. */
function 고친다(text: string): { text: string; fixes: string[]; left: number } {
  const fixes: string[] = [];
  let left = 0;
  const out = text.replace(/\$([^$]*)\$/g, (whole, body: string) => {
    if (!body.includes("\\frac{}")) return whole;
    const got = fixEmptyFrac(body, { wholePrefix: true });
    left += got.left;
    for (const f of got.fixes) fixes.push(`${f.rule}: ${f.from} → ${f.to}`);
    return "$" + got.text + "$";
  });
  return { text: out, fixes, left };
}

async function main(): Promise<void> {
  const APPLY = process.argv.includes("--apply");
  const REVERT = process.argv.includes("--revert");
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
      where: {
        OR: COLUMNS.map((c) => ({ [c]: { contains: "\\frac{}" } })),
      },
      select: {
        id: true,
        problemCode: true,
        content: true,
        solution: true,
        reviewStatus: true,
        directUseAllowed: true,
      },
      orderBy: { problemCode: "asc" },
    });

    const ledger: LedgerRow[] = [];
    const 남은행: string[] = [];
    let 자리 = 0;

    for (const r of rows) {
      const before: LedgerRow["before"] = {};
      const after: LedgerRow["after"] = {};
      const fixes: string[] = [];
      let left = 0;

      for (const col of COLUMNS) {
        const cur = r[col];
        if (typeof cur !== "string" || !cur.includes("\\frac{}")) continue;

        let next = cur;
        for (const [from, to] of 손수리[r.problemCode]?.[col] ?? []) {
          if (!next.includes(from)) {
            console.error(
              `🔴 손수리 대상이 지금 값과 안 맞는다: ${r.problemCode} ${col}`,
            );
            process.exit(1);
          }
          next = next.replace(from, to);
          fixes.push(`손수리: ${from} → ${to}`);
        }

        const got = 고친다(next);
        left += got.left;
        if (got.text === cur) continue;

        if (수를잃었나(cur, got.text)) {
          console.error(`🔴 수를 잃었다 — 멈춘다: ${r.problemCode} ${col}`);
          process.exit(1);
        }
        if (한글을잃었나(cur, got.text)) {
          console.error(`🔴 한글이 달라졌다 — 멈춘다: ${r.problemCode} ${col}`);
          process.exit(1);
        }
        before[col] = cur;
        after[col] = got.text;
        fixes.push(...got.fixes);
        자리 += got.fixes.length;
      }

      if (left > 0)
        남은행.push(
          `${r.problemCode} (출제가능 ${r.reviewStatus === "approved" && r.directUseAllowed}) — 빈 분수 ${left}자리`,
        );
      if (Object.keys(after).length > 0)
        ledger.push({ id: r.id, code: r.problemCode, before, after, fixes });
    }

    console.log(`빈 분수가 있는 문항 ${rows.length} (분모)`);
    console.log(`  고칠 문항 ${ledger.length} · 되살린 자리 ${자리}`);
    console.log(
      `  🔴 못 고친 채 남는 문항 ${남은행.length} — 분자가 DB 에 아예 없다`,
    );
    남은행.forEach((s) => console.log("     " + s));

    if (!APPLY) {
      console.log("\n드라이런이다 — DB 를 한 건도 안 바꿨다.");
      return;
    }
    if (ledger.length === 0) return;

    mkdirSync(path.dirname(LEDGER), { recursive: true });
    writeFileSync(
      LEDGER,
      JSON.stringify(
        {
          note:
            "되돌리기 자료. before 가 고치기 전 값이다. " +
            "되돌리기: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/repair-empty-frac.ts --revert --apply",
          규칙: "scripts/qa/emptyFracRules.ts",
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
      n++;
    }
    console.log(`적용 완료 ${n}건`);
  } finally {
    await prisma.$disconnect();
  }
}

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
      select: { content: true, solution: true },
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
