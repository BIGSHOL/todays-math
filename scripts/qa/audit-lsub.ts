/**
 * **적용한 것을 원장으로 되짚어 감사한다** — 「우리가 나쁘게 만들었나」만 묻는다.
 *
 *   npx tsx scripts/qa/audit-lsub.ts
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/audit-lsub.ts --revert --apply
 *
 * 🔴 감사의 질문은 **「완벽한가」가 아니라 「나빠졌나」**다. 덩어리 단위로 고치므로
 *    한 칸이 일부만 고쳐진 채 남는 것이 정상이다 — 「LSUB 가 0인가」를 물으면
 *    멀쩡히 좋아진 칸을 되돌리게 된다(2026-08-21 해설 트랙에서 81행이 그럴 뻔했다).
 *
 * 🔴 그리고 **원장이 아니라 DB** 를 본다. 원장만 보면 되돌린 뒤에도 같은 수를 찍어
 *    「다 고쳤나」를 영영 못 알려 준다.
 */
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { renderMathHtml } from "../../src/lib/math/renderMathHtml";
import { isDirectScript } from "../import/isDirectScript";
import { lsubLeft } from "./lsubRules";
import { 수 } from "./spanGuards";

const LEDGER = "scripts/qa/reports/lsub-repair.json";

const 붉은수 = (s: string) => {
  const html = renderMathHtml(s);
  return (
    (html.match(/katex-error/g) ?? []).length +
    (html.match(/#cc0000/g) ?? []).length
  );
};

interface Row {
  id: string;
  code: string;
  field: "content" | "solution" | "answer";
  before: string;
  after: string;
}

async function main(): Promise<void> {
  const REVERT = process.argv.includes("--revert");
  const APPLY = process.argv.includes("--apply");
  if (REVERT && APPLY && process.env.ALLOW_SHARED_IMPORT !== "1") {
    console.error("공유 DB 쓰기가 막혀 있다(D-31).");
    process.exit(1);
  }
  const l = JSON.parse(readFileSync(LEDGER, "utf-8")) as { rows: Row[] };
  const 나쁜: Record<string, string[]> = {
    "붉은 자리가 늘었다": [],
    "LSUB 가 늘었다": [],
    "수를 잃었다": [],
  };
  const 되돌릴것: Row[] = [];
  for (const r of l.rows) {
    let bad = false;
    if (붉은수(r.after) > 붉은수(r.before)) {
      나쁜["붉은 자리가 늘었다"]!.push(`${r.code}/${r.field}`);
      bad = true;
    }
    if (lsubLeft(r.after) > lsubLeft(r.before)) {
      나쁜["LSUB 가 늘었다"]!.push(`${r.code}/${r.field}`);
      bad = true;
    }
    const 후 = 수(r.after);
    for (const [n, c] of 수(r.before))
      if ((후.get(n) ?? 0) < c) {
        나쁜["수를 잃었다"]!.push(`${r.code}/${r.field} (${n})`);
        bad = true;
        break;
      }
    if (bad) 되돌릴것.push(r);
  }
  console.log(`원장 ${l.rows.length}칸을 되짚었다`);
  for (const [k, v] of Object.entries(나쁜))
    console.log(
      `  ${k}: ${v.length}${v.length ? ` — ${v.slice(0, 10).join(" ")}` : ""}`,
    );

  const prisma = new PrismaClient();
  try {
    const 아직: Row[] = [];
    let 이미 = 0;
    for (const r of 되돌릴것) {
      const cur = (await prisma.problem.findUnique({
        where: { id: r.id },
        select: { content: true, solution: true, answer: true },
      })) as Record<string, string | null> | null;
      if (cur && cur[r.field] === r.after) 아직.push(r);
      else 이미++;
    }
    console.log(
      아직.length === 0
        ? `\n✅ DB 에 남은 나쁜 칸 없음 (원장 기준 ${되돌릴것.length}칸)`
        : `\n🔴 DB 에 아직 나쁜 칸 ${아직.length} · 이미 되돌린 것 ${이미}`,
    );
    if (아직.length === 0 || !REVERT) {
      if (아직.length)
        console.log(
          "   되돌리려면: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/audit-lsub.ts --revert --apply",
        );
      return;
    }
    let done = 0;
    for (const r of 아직) {
      if (APPLY)
        await prisma.problem.update({
          where: { id: r.id },
          data: { [r.field]: r.before },
        });
      done++;
    }
    console.log(`되돌리기${APPLY ? "" : " (드라이런)"}: ${done}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) void main();
