/**
 * **비어 있는** RPM 해설·정답을 정답책 원문에서 채운다.
 *
 *   npx tsx scripts/qa/apply-rpm-book-fill.ts                       드라이런
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-rpm-book-fill.ts --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-rpm-book-fill.ts --revert
 *
 * 입력: `rpm-book-fill-verified.json`  (제품 렌더러로 검증한 계획)
 *       `rpm-number-check.json`        (학생용 책에서 번호를 검산한 결과)
 * 원장: `rpm-book-fill-ledger.json`
 *
 * ## **빈 자리만** 채운다
 *
 * 이미 값이 든 칸은 손대지 않는다. 「빈 자리」에는 `(정답 없음)` 자리 표시자도
 * 들어간다 — 값이 아니라 «모른다»는 뜻이라 `count(answer)` 로는 안 보인다.
 * 그 밖의 값이 들어 있으면 계획이 낡은 것이므로 **건너뛰고 보고만** 한다.
 *
 * ## 근거 둘을 **모두** 요구한다
 *
 * ㉠ 화면에 제대로 나오나 (제품 렌더러)
 * ㉡ 이 행의 번호가 이 문항의 번호인가 (학생용 책에서 번호가 찍힌 쪽을 찾아 대조)
 *
 * 빈 정답을 채울 때 ㉡ 이 특히 중요하다 — 그 행은 정답도 해설도 비어 있어
 * **견줄 것이 자기 안에 없다.** 근거는 밖에서 와야 한다.
 */
import { readFile, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";

const VERIFIED = "scripts/qa/reports/rpm-book-fill-verified.json";
const NUMBER = "scripts/qa/reports/rpm-number-check.json";
const LEDGER = "scripts/qa/reports/rpm-book-fill-ledger.json";

type Field = "solution" | "answer";

interface Row {
  id: string;
  field: Field;
  book: string;
  q: number;
  ok: boolean;
  value: string;
  근거?: string;
}

interface LedgerRow {
  id: string;
  field: Field;
  book: string;
  q: number;
  before: string | null;
  after: string;
}

/** 값이 아니라 «모른다»는 뜻인 자리. 빈 칸으로 본다. */
const PLACEHOLDER = /^\(?\s*(정답|답)\s*없음\s*\)?$/u;
const isEmpty = (v: string | null): boolean =>
  v === null || v.trim() === "" || PLACEHOLDER.test(v.trim());

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

    const plan = (
      JSON.parse(await readFile(VERIFIED, "utf-8")) as { 목록: Row[] }
    ).목록;
    const numberCheck = JSON.parse(await readFile(NUMBER, "utf-8")) as Record<
      string,
      { ok?: boolean }
    >;
    const items = plan.filter((r) => r.ok);
    const rows = await prisma.problem.findMany({
      where: { id: { in: [...new Set(items.map((r) => r.id))] } },
      select: { id: true, answer: true, solution: true },
    });
    const cur = new Map(rows.map((r) => [r.id, r]));

    const ready: LedgerRow[] = [];
    const tally = new Map<string, number>();
    const bump = (k: string): void => {
      tally.set(k, (tally.get(k) ?? 0) + 1);
    };
    for (const r of items) {
      if (!numberCheck[r.id]?.ok) {
        bump("번호를 검산하지 못했다");
        continue;
      }
      const row = cur.get(r.id);
      if (!row) {
        bump("DB 에 없다");
        continue;
      }
      const now = (row[r.field] ?? null) as string | null;
      if (!isEmpty(now)) {
        bump("이미 값이 들어 있다 — 안 건드린다");
        continue;
      }
      ready.push({
        id: r.id,
        field: r.field,
        book: r.book,
        q: r.q,
        before: now,
        after: r.value,
      });
    }

    console.log("── 빈 자리 채우기 ──");
    console.log(
      `검증 통과 ${items.length}자리 · 채울 수 있는 것 ${ready.length}`,
    );
    for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1]))
      console.log(`   건너뜀: ${k} ${n}`);
    const bySide = new Map<string, number>();
    for (const r of ready) bySide.set(r.field, (bySide.get(r.field) ?? 0) + 1);
    console.log(`   갈래별 ${JSON.stringify(Object.fromEntries(bySide))}`);

    if (!apply) {
      console.log("\n드라이런 — 변경 없음. 적용하려면 --apply");
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
    // ⚠️ 원장을 **먼저** 쓴다.
    await writeFile(
      LEDGER,
      JSON.stringify({ 만든날: "2026-08-19", 목록: ready }, null, 1),
      "utf-8",
    );
    console.log(`\n되돌리기 원장 → ${LEDGER} (${ready.length}줄)`);
    for (const r of ready)
      await prisma.problem.update({
        where: { id: r.id },
        data: { [r.field]: r.after },
      });
    console.log(`\n채움 완료 — ${ready.length}자리`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
