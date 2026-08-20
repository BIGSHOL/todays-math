/**
 * **극한 화살표 적용기** — `\lim_{x \Rightarrow 0}` 을 `\lim_{x \to 0}` 으로.
 *
 *   npx tsx scripts/qa/repair-lim-arrow.ts                     # 드라이런(기본)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/repair-lim-arrow.ts --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/repair-lim-arrow.ts --revert --apply
 *
 * 규칙은 `limArrowRules.ts` 에 있다 — **판정을 여기서 다시 쓰지 않는다.**
 * ⚠️ 공유 DB(D-31). 되돌리기 원장을 **DB 보다 먼저** 쓴다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { fixLimArrow } from "./limArrowRules";
import { isDirectScript } from "../import/isDirectScript";

const LEDGER = "scripts/qa/reports/lim-arrow-repair.json";
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
  const sampleN = at >= 0 ? Number(process.argv[at + 1] ?? 6) : 0;
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
        OR: COLUMNS.map((c) => ({ [c]: { contains: "\\Rightarrow" } })),
      },
      select: {
        id: true,
        problemCode: true,
        content: true,
        solution: true,
        answer: true,
      },
      orderBy: { problemCode: "asc" },
    });

    const ledger: LedgerRow[] = [];
    let 자리 = 0;
    let 그대로 = 0;
    const 표본: string[] = [];

    for (const r of rows) {
      const before: LedgerRow["before"] = {};
      const after: LedgerRow["after"] = {};
      for (const col of COLUMNS) {
        const cur = r[col];
        if (typeof cur !== "string" || !cur.includes("\\Rightarrow")) continue;
        const got = fixLimArrow(cur);
        if (got.fixed === 0) {
          그대로++; // ⇒ 는 있는데 극한 밖이다 — 진짜 함의라 안 건드린다
          continue;
        }
        // 🔴 극한 밖의 ⇒ 는 **개수가 그대로**여야 한다.
        const 밖전 = (cur.match(/\\Rightarrow/g) ?? []).length;
        const 밖후 = (got.text.match(/\\Rightarrow/g) ?? []).length;
        if (밖전 - 밖후 !== got.fixed) {
          console.error(
            `🔴 극한 밖의 ⇒ 까지 건드렸다 — 멈춘다: ${r.problemCode} ${col}`,
          );
          process.exit(1);
        }
        if (
          (cur.match(/[가-힣]/g) ?? []).join("") !==
          (got.text.match(/[가-힣]/g) ?? []).join("")
        ) {
          console.error(`🔴 한글이 달라졌다 — 멈춘다: ${r.problemCode} ${col}`);
          process.exit(1);
        }
        before[col] = cur;
        after[col] = got.text;
        자리 += got.fixed;
        if (표본.length < sampleN) {
          const i = cur.indexOf("\\Rightarrow");
          표본.push(
            `${r.problemCode} ${col}\n     전 …${cur.slice(Math.max(0, i - 30), i + 26).replace(/\s+/g, " ")}…` +
              `\n     후 …${got.text.slice(Math.max(0, i - 30), i + 26).replace(/\s+/g, " ")}…`,
          );
        }
      }
      if (Object.keys(after).length > 0)
        ledger.push({ id: r.id, code: r.problemCode, before, after });
    }

    console.log(`⇒ 가 있는 문항 ${rows.length} (분모)`);
    console.log(`  🔴 고칠 문항 ${ledger.length} · 극한 안 자리 ${자리}`);
    console.log(`  손대지 않은 칸 ${그대로} — 극한 밖의 ⇒ 는 **진짜 함의**다`);
    표본.forEach((s) => console.log("   " + s));

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
          note: "되돌리기 자료. 되돌리기: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/repair-lim-arrow.ts --revert --apply",
          규칙: "scripts/qa/limArrowRules.ts",
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
    console.log(`\r적용 완료 ${n}건`);
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
