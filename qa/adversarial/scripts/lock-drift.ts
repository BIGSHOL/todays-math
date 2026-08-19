/** 그림 유실 원장 446행이 **지금도** 잠겨 있는가 — 공유 boolean 한 칸을 여럿이 쓴다. */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const led = JSON.parse(
    readFileSync("scripts/qa/reports/missing-figure-lock.json", "utf8"),
  ) as { 이전상태: { id: string; directUseAllowed?: boolean }[] };
  const ids = led.이전상태.map((r) => r.id);
  const rows = (await p.$queryRawUnsafe(
    `SELECT id::text AS id, direct_use_allowed AS "d" FROM problem WHERE id = ANY($1::uuid[])`,
    ids,
  )) as { id: string; d: boolean }[];
  const stillLocked = rows.filter((r) => r.d === false).length;
  const unlocked = rows.filter((r) => r.d === true).length;
  const all = (await p.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM problem WHERE direct_use_allowed = false`,
  )) as { n: number }[];
  console.log(`그림 유실 원장 ${ids.length}행 · DB 에 있는 행 ${rows.length}`);
  console.log(`  지금도 잠김 ${stillLocked} · 누가 풀었음 ${unlocked}`);
  console.log(`  DB 전체에서 false 인 행 ${all[0]!.n}`);
  await p.$disconnect();
})();
