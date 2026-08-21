/**
 * 소문항 번호 이중 출력 수리 — `⑴ (1) …` 처럼 원문자 바로 뒤에 **같은 숫자**의
 * `(n)` 이 겹친 부류 (원장님 검수 지적 2026-08-21, 접시 문항).
 *
 *   npx tsx --env-file=.env scripts/qa/fix-subnum-dup.ts              # dry-run(전량 열거)
 *   ALLOW_SUBNUM_FIX=1 npx tsx --env-file=.env scripts/qa/fix-subnum-dup.ts
 *
 * ⚠️ `⑵ (2)(1) 의 내용을 이용하여` — 뒤의 `(1)` 은 소문항 ⑴ 을 가리키는 **진짜
 *    참조**다. 그래서 원문자와 숫자가 **일치할 때만** 지운다. 숫자가 다르면 안 지운다.
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const APPLY = process.env.ALLOW_SUBNUM_FIX === "1";
const LEDGER = path.join(
  "scripts",
  "qa",
  "reports",
  "subnum-dup-2026-08-21.json",
);
const p = new PrismaClient();

const CIRCLED: Record<string, string> = {
  "⑴": "1",
  "⑵": "2",
  "⑶": "3",
  "⑷": "4",
  "⑸": "5",
  "⑹": "6",
  "⑺": "7",
  "⑻": "8",
};

function convert(s: string): string {
  return s.replace(
    /([⑴⑵⑶⑷⑸⑹⑺⑻])\s*\((\d)\)\s?/g,
    (m, circ: string, d: string) => (CIRCLED[circ] === d ? `${circ} ` : m),
  );
}

const digitsOutsideFix = (s: string) =>
  s.replace(/([⑴⑵⑶⑷⑸⑹⑺⑻])\s*\(\d\)\s?/g, "$1").replace(/[^0-9]/g, "");

async function main() {
  if (existsSync(LEDGER)) throw new Error("원장이 이미 있다: " + LEDGER);
  const rows = await p.$queryRawUnsafe<
    Array<{ id: string; problem_code: string | null; content: string }>
  >(
    `SELECT id, problem_code, content FROM problem
     WHERE content ~ '[⑴⑵⑶⑷⑸⑹⑺⑻]\\s*\\([0-9]\\)'`,
  );
  console.log("후보 행:", rows.length);
  const changed: Array<{
    id: string;
    code: string | null;
    before: string;
    after: string;
  }> = [];
  for (const r of rows) {
    const after = convert(r.content);
    if (after === r.content) continue;
    changed.push({ id: r.id, code: r.problem_code, before: r.content, after });
  }
  console.log("바꿀 행:", changed.length);
  for (const c of changed) {
    const i = c.before.search(/[⑴⑵⑶⑷⑸⑹⑺⑻]\s*\(\d\)/);
    console.log(
      `  ${c.code}: …${c.before.slice(Math.max(0, i - 6), i + 26).replace(/\n/g, "⏎")}… → …${c.after.slice(Math.max(0, i - 6), i + 20).replace(/\n/g, "⏎")}…`,
    );
  }
  if (!APPLY) {
    console.log("[dry-run] 실쓰기는 ALLOW_SUBNUM_FIX=1");
    return;
  }
  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        note: "소문항 번호 이중 (⑴ (1)) 제거 — 같은 숫자일 때만. fix-subnum-dup.ts",
        rows: changed.map(({ id, before, after }) => ({ id, before, after })),
      },
      null,
      1,
    ),
    "utf8",
  );
  for (const c of changed)
    await p.problem.update({ where: { id: c.id }, data: { content: c.after } });
  const left = await p.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*) n FROM problem WHERE content ~ '⑴\\s*\\(1\\)|⑵\\s*\\(2\\)|⑶\\s*\\(3\\)'`,
  );
  console.log("적용:", changed.length, "· 사후 잔재:", Number(left[0]!.n));
}
main().finally(() => p.$disconnect());
