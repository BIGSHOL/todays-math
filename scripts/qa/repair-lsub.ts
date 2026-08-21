/**
 * **왼쪽 아래첨자(`LSUB`) 순열·조합 표기를 고친다** — 계획 → 가드 → 셈 검산 → 원장 → 적용.
 *
 *   npx tsx scripts/qa/repair-lsub.ts                     # 전량 드라이런
 *   npx tsx scripts/qa/repair-lsub.ts --show              # 바꾼 것을 다 찍는다
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/repair-lsub.ts --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/repair-lsub.ts --revert --apply
 *
 * ⚠️ 공유 DB(D-31). 기본은 드라이런. 되돌리기 원장을 **DB 보다 먼저** 쓰고 **누적**한다.
 *
 * 판정 단위는 **덩어리**다 — 한 덩어리가 걸려도 옆 덩어리는 고친다
 * (`spanGuards.ts` 참조: 행 단위로 걸었다가 107행을 통째로 버린 적이 있다).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { isDirectScript } from "../import/isDirectScript";
import { fixLsub, lsubLeft, verifyLsubArithmetic } from "./lsubRules";
import { 붉은가, 한글, 수 } from "./spanGuards";

const LEDGER = "scripts/qa/reports/lsub-repair.json";
const FIELDS = ["content", "solution", "answer"] as const;
type Field = (typeof FIELDS)[number];

interface LedgerRow {
  id: string;
  code: string;
  field: Field;
  before: string;
  after: string;
  spans: number;
}

/** 되돌리기 원장은 **누적**한다 — 처음 `before` · 마지막 `after`. */
export function mergeLsubLedger(
  prev: readonly LedgerRow[],
  next: readonly LedgerRow[],
): LedgerRow[] {
  const key = (r: LedgerRow) => `${r.id}:${r.field}`;
  const by = new Map<string, LedgerRow>(prev.map((r) => [key(r), r]));
  for (const r of next) {
    const old = by.get(key(r));
    by.set(key(r), old ? { ...r, before: old.before } : r);
  }
  return [...by.values()];
}

/**
 * 한 덩어리를 바꿔도 되는가.
 *
 * 🔴 **셈 검산이 이 트랙의 «본문 밖 근거»다.** 나머지 가드는 「망가뜨리지
 *    않았나」만 보지만, 셈은 「**뜻이 맞나**」를 본다 — `\pi` 가 π 인지 Π 인지는
 *    그것으로만 갈린다.
 */
export function judgeLsubSpan(
  body: string,
): { ok: true; out: string; why: string } | { ok: false; why: string } {
  const { out, hits } = fixLsub(body);
  if (hits.length === 0) return { ok: false, why: "바꿀 것 없음" };
  if (lsubLeft(out) > 0) return { ok: false, why: "LSUB 가 남았다" };
  const 전 = "$" + body + "$";
  const 후 = "$" + out + "$";
  if (한글(후) !== 한글(전)) return { ok: false, why: "🔴 한글이 달라졌다" };
  const 후수 = 수(후);
  for (const [n, c] of 수(전))
    if ((후수.get(n) ?? 0) < c) return { ok: false, why: "🔴 수를 잃었다" };
  // 이중 아래첨자(`_0_{1}`)는 KaTeX 가 에러를 낸다 — 제품 렌더러가 잡아 준다.
  if (붉은가(후) && !붉은가(전)) return { ok: false, why: "🔴 붉어졌다" };
  const a = verifyLsubArithmetic(out);
  if (!a.ok) return { ok: false, why: `🔴 셈이 안 맞는다 — ${a.why}` };
  return { ok: true, out, why: a.checked ? `셈 확인 (${a.why})` : "셈 못 함" };
}

async function main(): Promise<void> {
  const APPLY = process.argv.includes("--apply");
  const REVERT = process.argv.includes("--revert");
  const SHOW = process.argv.includes("--show");
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
      orderBy: { problemCode: "asc" },
    });

    const ledger: LedgerRow[] = [];
    const 버린이유: Record<string, number> = {};
    let 바꾼덩어리 = 0;
    let 셈확인 = 0;
    let 셈못함 = 0;
    const 남은자리: string[] = [];

    for (const r of rows)
      for (const f of FIELDS) {
        const before = (r as Record<string, unknown>)[f] as string | null;
        if (!before || !/LSUB|RSUB|LSUP|RSUP/i.test(before)) continue;
        // 뒤에서부터 갈아 끼워야 앞 자리 오프셋이 안 흔들린다.
        const ms = [...before.matchAll(/\$([^$]*)\$/g)].reverse();
        let after = before;
        let n = 0;
        for (const m of ms) {
          const body = m[1]!;
          if (!/LSUB|RSUB|LSUP|RSUP/i.test(body)) continue;
          const v = judgeLsubSpan(body);
          if (!v.ok) {
            버린이유[v.why] = (버린이유[v.why] ?? 0) + 1;
            if (v.why === "LSUB 가 남았다")
              남은자리.push(
                `${r.problemCode} ${f}  ${body.replace(/\s+/g, " ").slice(0, 110)}`,
              );
            continue;
          }
          if (v.why.startsWith("셈 확인")) 셈확인++;
          else 셈못함++;
          after =
            after.slice(0, m.index) +
            "$" +
            v.out +
            "$" +
            after.slice(m.index + m[0].length);
          n++;
          if (SHOW)
            console.log(
              `${r.problemCode} ${f} [${v.why}]\n   전 ${body.replace(/\s+/g, " ").slice(0, 120)}\n   후 ${v.out.replace(/\s+/g, " ").slice(0, 120)}`,
            );
        }
        if (n === 0) continue;
        바꾼덩어리 += n;
        ledger.push({
          id: r.id,
          code: r.problemCode,
          field: f,
          before,
          after,
          spans: n,
        });
      }

    const 문항 = new Set(ledger.map((l) => l.code)).size;
    console.log(
      `\n🔴 고칠 칸 ${ledger.length} (문항 ${문항}) · 바꾼 덩어리 ${바꾼덩어리}` +
        `\n   셈으로 확인한 덩어리 ${셈확인} · 셈을 못 한 덩어리 ${셈못함}`,
    );
    for (const [k, v] of Object.entries(버린이유).sort((a, b) => b[1] - a[1]))
      console.log(`   버림 — ${k}: ${v}`);
    if (남은자리.length)
      console.log(
        `\n[손으로 봐야 할 자리 ${남은자리.length}]\n` +
          남은자리.map((s) => "   " + s).join("\n"),
      );

    if (!APPLY) {
      console.log("\n드라이런이다 — DB 를 한 건도 안 바꿨다.");
      return;
    }
    if (ledger.length === 0) return;

    const 옛행: LedgerRow[] = existsSync(LEDGER)
      ? ((JSON.parse(readFileSync(LEDGER, "utf-8")) as { rows?: LedgerRow[] })
          .rows ?? [])
      : [];
    const merged = mergeLsubLedger(옛행, ledger);
    if (merged.length < 옛행.length) {
      console.error(`🔴 원장이 줄어든다 (${옛행.length} → ${merged.length})`);
      process.exit(1);
    }
    mkdirSync(path.dirname(LEDGER), { recursive: true });
    writeFileSync(
      LEDGER,
      JSON.stringify(
        {
          note:
            "되돌리기 자료. before 가 **처음** 고치기 전 값이다(회차를 누적한다). " +
            "되돌리기: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/repair-lsub.ts --revert --apply",
          규칙: "scripts/qa/lsubRules.ts — 셈으로 검산한다(verifyLsubArithmetic)",
          rows: merged,
        },
        null,
        1,
      ),
      "utf-8",
    );
    console.log(
      `\n되돌리기 원장 → ${LEDGER} (이번 ${ledger.length} · 이어받은 ${merged.length - ledger.length} · 합 ${merged.length}) — DB 보다 먼저 썼다`,
    );

    let done = 0;
    for (const l of ledger) {
      await prisma.problem.update({
        where: { id: l.id },
        data: { [l.field]: l.after },
      });
      done++;
    }
    console.log(`적용 완료 ${done}칸`);
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
    const cur = (await prisma.problem.findUnique({
      where: { id: r.id },
      select: { content: true, solution: true, answer: true },
    })) as Record<string, string | null> | null;
    // **지금 값이 우리가 쓴 값일 때만** 되돌린다 — 남의 값을 덮지 않는다.
    if (!cur || cur[r.field] !== r.after) {
      skipped++;
      continue;
    }
    if (apply)
      await prisma.problem.update({
        where: { id: r.id },
        data: { [r.field]: r.before },
      });
    done++;
  }
  console.log(
    `되돌리기${apply ? "" : " (드라이런)"}: ${done} · 건너뜀 ${skipped}`,
  );
}

if (isDirectScript(import.meta.url)) void main();
