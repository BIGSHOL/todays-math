/**
 * □ 로 무너진 RPM 해설·정답을 **정답책 원문으로 되살린다.**
 *
 *   npx tsx scripts/qa/apply-rpm-square-repair.ts                       드라이런
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-rpm-square-repair.ts --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-rpm-square-repair.ts --revert
 *
 * 입력: `scripts/qa/reports/rpm-square-verified.json` (제품 렌더러로 검증된 것만)
 * 원장: `scripts/qa/reports/rpm-square-repair-ledger.json`
 *
 * ## 되돌리기 원장을 **DB 보다 먼저** 쓴다
 *
 * 공유 DB(D-31)를 바꾸는 작업이라 되돌릴 길이 없으면 안 된다. 원장을 먼저 쓰고,
 * 그 파일이 **커밋되는지**까지 확인한다 — `scripts/qa/reports/` 는 디렉터리째
 * 무시돼 있어 `!` 예외를 안 넣으면 이 컴퓨터에만 남는다(CLAUDE.md 2026-08-18).
 *
 * ## 지금 값이 계획이 본 값일 때만 바꾼다
 *
 * 오르카 다중 세션이 같은 칸을 건드릴 수 있다. 계획을 세운 뒤 값이 달라졌으면
 * **건드리지 않고 보고만** 한다. 되돌릴 때도 같다 — 지금 값이 «내가 쓴 값»일
 * 때만 되돌린다. 그래야 남의 수정을 밟지 않는다.
 */
import { readFile, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";

const VERIFIED = "scripts/qa/reports/rpm-square-verified.json";
const LEDGER = "scripts/qa/reports/rpm-square-repair-ledger.json";

type Field = "solution" | "answer";

interface Verified {
  id: string;
  field: Field;
  book: string;
  q: number;
  ok: boolean;
  current: string | null;
  value: string;
  nowSquare: number;
}

interface LedgerRow {
  id: string;
  field: Field;
  book: string;
  q: number;
  before: string | null;
  after: string;
}

async function gate(): Promise<boolean> {
  const inspection = await inspectDatabaseTargets();
  if (
    !inspection.selected.canMigrateOrLoad &&
    !allowSharedImport(inspection.selected)
  ) {
    console.log(
      `\n차단 — ${inspection.selected.reason}\nALLOW_SHARED_IMPORT=1 을 명시하세요.`,
    );
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const revert = process.argv.includes("--revert");
  const prisma = new PrismaClient();
  try {
    if (revert) {
      const ledger = JSON.parse(await readFile(LEDGER, "utf-8")) as {
        목록: LedgerRow[];
      };
      const rows = await prisma.problem.findMany({
        where: { id: { in: [...new Set(ledger.목록.map((r) => r.id))] } },
        select: { id: true, answer: true, solution: true },
      });
      const now = new Map(rows.map((r) => [r.id, r]));
      let back = 0;
      let drift = 0;
      for (const r of ledger.목록) {
        const cur = now.get(r.id);
        // ⚠️ **내가 쓴 값일 때만** 되돌린다. 아니면 남의 수정을 지우는 것이다.
        if (!cur || (cur[r.field] ?? null) !== r.after) {
          drift += 1;
          continue;
        }
        if (apply)
          await prisma.problem.update({
            where: { id: r.id },
            data: { [r.field]: r.before },
          });
        back += 1;
      }
      console.log(
        `되돌리기 — 대상 ${ledger.목록.length} · 되돌릴 수 있는 것 ${back} · 값이 달라 건너뜀 ${drift}`,
      );
      if (!apply)
        console.log("드라이런 — 변경 없음. 적용하려면 --apply 를 같이");
      return;
    }

    const verified = JSON.parse(await readFile(VERIFIED, "utf-8")) as {
      목록: Verified[];
    };
    const items = verified.목록.filter((v) => v.ok);
    const ids = [...new Set(items.map((v) => v.id))];
    const rows = await prisma.problem.findMany({
      where: { id: { in: ids } },
      select: { id: true, answer: true, solution: true },
    });
    const cur = new Map(rows.map((r) => [r.id, r]));

    const ready: LedgerRow[] = [];
    const drifted: Verified[] = [];
    const missing: Verified[] = [];
    for (const v of items) {
      const row = cur.get(v.id);
      if (!row) {
        missing.push(v);
        continue;
      }
      const nowValue = (row[v.field] ?? null) as string | null;
      if ((nowValue ?? "") !== (v.current ?? "")) {
        drifted.push(v);
        continue;
      }
      ready.push({
        id: v.id,
        field: v.field,
        book: v.book,
        q: v.q,
        before: nowValue,
        after: v.value,
      });
    }

    console.log("── □ 되살리기 ──");
    console.log(
      `검증 통과 ${items.length}자리 · 바꿀 수 있는 것 ${ready.length}` +
        ` · 그 사이 값이 달라져 건너뜀 ${drifted.length} · DB 에 없음 ${missing.length}`,
    );
    const bySide = new Map<string, number>();
    for (const r of ready) bySide.set(r.field, (bySide.get(r.field) ?? 0) + 1);
    console.log(`  갈래별 ${JSON.stringify(Object.fromEntries(bySide))}`);
    console.log(
      `  되살아나는 □ ${items
        .filter((v) => ready.some((r) => r.id === v.id && r.field === v.field))
        .reduce((s, v) => s + v.nowSquare, 0)}자리`,
    );
    for (const v of drifted.slice(0, 10))
      console.log(
        `  건너뜀 ${v.book.slice(7, 10)} #${v.q} [${v.field}] — 지금 값이 다르다`,
      );

    if (!apply) {
      console.log("\n드라이런 — 변경 없음. 적용하려면 --apply");
      return;
    }
    if (!(await gate())) return;

    // ⚠️ 원장을 **먼저** 쓴다. DB 를 먼저 바꾸면 중간에 죽었을 때 되돌릴 길이 없다.
    await writeFile(
      LEDGER,
      JSON.stringify({ 만든날: "2026-08-19", 목록: ready }, null, 1),
      "utf-8",
    );
    console.log(`\n되돌리기 원장 → ${LEDGER} (${ready.length}줄)`);

    let done = 0;
    for (const r of ready) {
      await prisma.problem.update({
        where: { id: r.id },
        data: { [r.field]: r.after },
      });
      done += 1;
      if (done % 50 === 0) console.log(`  ${done}/${ready.length}`);
    }
    console.log(`\n되살림 완료 — ${done}자리`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
