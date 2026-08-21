/**
 * 단위 위첨자 유실 수리 — `$60$ ⏎ cm ⏎ $2$` 처럼 `cm²`·`cm³` 의 지수가 낱개
 * `$2$`/`$3$` 조각으로 떨어진 부류 (원장님 검수 지적 2026-08-21, J30602-ZBYY).
 *
 *   npx tsx --env-file=.env scripts/qa/fix-cm-sup.ts              # dry-run(전량 열거)
 *   ALLOW_CMSUP_FIX=1 npx tsx --env-file=.env scripts/qa/fix-cm-sup.ts
 *
 * 열쇠: 「숫자 수식 → cm/m/km → 낱개 $2$|$3$ → 줄 끝」 네 조각이 붙은 자리만.
 * `cm` 뒤에 진짜 «2개» 같은 글이 오는 경우와 갈라야 하므로, 낱개 지수 조각
 * 바로 뒤가 줄 끝(개행 또는 문자열 끝)일 때만 고친다.
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const APPLY = process.env.ALLOW_CMSUP_FIX === "1";
const LEDGER = path.join("scripts", "qa", "reports", "cm-sup-2026-08-21.json");
const p = new PrismaClient();

const RE = /(\$[^$\n]*\d\$\s*\n\s*)(cm|km|m)(\s*\n\s*)\$([23])\$(?=\s*(\n|$))/g;

function convert(s: string): string {
  return s.replace(
    RE,
    (_m, pre: string, unit: string, _mid: string, exp: string) =>
      `${pre}${unit}$^{${exp}}$`,
  );
}

async function main() {
  if (existsSync(LEDGER)) throw new Error("원장이 이미 있다: " + LEDGER);
  const rows = await p.$queryRawUnsafe<
    Array<{ id: string; problem_code: string | null; content: string }>
  >(
    `SELECT id, problem_code, content FROM problem WHERE content ~ '(cm|km|m)\\s*\\n\\s*\\$[23]\\$'`,
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
    const i = c.before.search(RE);
    console.log(
      `  ${c.code}: …${c.before.slice(Math.max(0, i), i + 40).replace(/\n/g, "⏎")}… → …${c.after.slice(Math.max(0, i), i + 40).replace(/\n/g, "⏎")}…`,
    );
  }
  if (!APPLY) {
    console.log("[dry-run] 실쓰기는 ALLOW_CMSUP_FIX=1");
    return;
  }
  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        note: "단위 위첨자 유실 (cm + 낱개 $2$) — fix-cm-sup.ts",
        rows: changed.map(({ id, before, after }) => ({ id, before, after })),
      },
      null,
      1,
    ),
    "utf8",
  );
  for (const c of changed)
    await p.problem.update({ where: { id: c.id }, data: { content: c.after } });
  console.log("적용:", changed.length);
}
main().finally(() => p.$disconnect());
