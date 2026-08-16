/**
 * 트랙 E 가 찾은 결함 점검 — 본문에 **base64 덩어리**가 섞여 들어간 행.
 *
 * **읽기만 한다.**
 *
 * 세 가지를 따로 센다. 섞으면 "내가 씻어냈는지 / 내가 집어넣었는지" 를 못 가른다.
 *
 *   ① DB 전량        — 코디네이터 수치(연속 60자 49행 · 100자 2행 · 150자 0행)를
 *                      재현해 **탐지기를 교정**한다. 안 맞으면 기준이 다른 것이다.
 *   ② 내 백업(교체 전) — 내가 덮기 **전** 본문의 오염. 트랙 E 는 10행이라고 했다.
 *   ③ 지금 내 4,069행  — 교체 **후** 상태. 씻겼는지, 남았는지, **새로 들어갔는지**.
 *
 * ③ 이 핵심이다. HWP 원본에 base64 가 있으므로 **내 교체가 오염을 새로 집어넣었을**
 * 가능성이 있다. 씻어냈다는 결론만 보고 끝내면 그 반대 방향을 놓친다.
 *
 *   npx tsx scripts/qa/audit-base64-contamination.ts
 */
import { readFile } from "node:fs/promises";

/** 코디네이터·트랙 E 와 같은 기준: base64 문자만 연속으로 N자 이상. */
const runRe = (n: number) => new RegExp(`[A-Za-z0-9+/]{${n},}={0,2}`);
const DATA_URI = /data:image/i;

type Row = { id: string; content: string; externalId: string | null; source?: string };

function tally(rows: Row[]) {
  const t = { "60자+": 0, "100자+": 0, "150자+": 0, "data:image": 0 };
  const hits: Row[] = [];
  for (const r of rows) {
    const c = r.content ?? "";
    if (runRe(60).test(c)) {
      t["60자+"] += 1;
      hits.push(r);
    }
    if (runRe(100).test(c)) t["100자+"] += 1;
    if (runRe(150).test(c)) t["150자+"] += 1;
    if (DATA_URI.test(c)) t["data:image"] += 1;
  }
  return { t, hits };
}

async function main(): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    // ── ① DB 전량 (탐지기 교정) ──────────────────────────────────────
    const all: Row[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await prisma.problem.findMany({
        select: { id: true, content: true, externalId: true, source: true },
        orderBy: { id: "asc" },
        take: 2000,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (page.length === 0) break;
      all.push(...page);
      cursor = page[page.length - 1].id;
    }
    const dbAll = tally(all);
    console.log("── ① DB 전량 (탐지기 교정) ──");
    console.log(`행 ${all.length} · ${JSON.stringify(dbAll.t)}`);
    const bySource: Record<string, number> = {};
    for (const h of dbAll.hits) {
      bySource[h.source ?? "?"] = (bySource[h.source ?? "?"] ?? 0) + 1;
    }
    console.log(`60자+ 오염 행의 source: ${JSON.stringify(bySource)}`);
    console.log(
      "  (코디네이터 실측: 60자 49 · 100자 2 · 150자 0 · data:image 0 —" +
        " 위와 같아야 같은 기준으로 센 것이다)",
    );

    // ── ② 내 백업 = 교체 **전** 본문 ────────────────────────────────
    const backup = JSON.parse(
      await readFile("scripts/qa/reports/hwp-replace-backup.json", "utf-8"),
    ) as { rows: Array<{ id: string; content: string; externalId: string | null }> };
    const before = tally(backup.rows);
    const beforeIds = new Set(before.hits.map((r) => r.id));
    console.log("\n── ② 내 백업 (교체 전 본문) ──");
    console.log(`행 ${backup.rows.length} · ${JSON.stringify(before.t)}`);
    console.log("  (트랙 E 실측: 교체 전 오염 10행)");

    // ── ③ 지금 내 4,069행 ──────────────────────────────────────────
    const mine = new Map(all.map((r) => [r.id, r]));
    const nowRows = backup.rows
      .map((b) => mine.get(b.id))
      .filter((r): r is Row => Boolean(r));
    const after = tally(nowRows);
    const afterIds = new Set(after.hits.map((r) => r.id));
    console.log("\n── ③ 지금 내 4,069행 (교체 후) ──");
    console.log(`조회 ${nowRows.length}행 · ${JSON.stringify(after.t)}`);

    const washed = [...beforeIds].filter((id) => !afterIds.has(id));
    const stayed = [...beforeIds].filter((id) => afterIds.has(id));
    const introduced = [...afterIds].filter((id) => !beforeIds.has(id));
    console.log(`  씻겨 나감 ${washed.length} · 그대로 남음 ${stayed.length}`);
    console.log(
      `  **내 교체가 새로 집어넣음 ${introduced.length}**` +
        (introduced.length === 0 ? " ← 없어야 정상" : " ← 확인 필요"),
    );

    // ── 교집합: 코디네이터가 센 DB 전량 오염 중 내 몫 ────────────────
    const dbHitIds = new Set(dbAll.hits.map((r) => r.id));
    const mineInDb = backup.rows.filter((b) => dbHitIds.has(b.id));
    console.log(
      `\n**DB 전량 60자+ 오염 ${dbAll.t["60자+"]}행 중 내 4,069행에 속한 것: ${mineInDb.length}행**`,
    );
    if (mineInDb.length > 0) {
      console.log("  " + mineInDb.map((r) => r.externalId).join(", "));
    }
    if (introduced.length > 0) {
      const ex = introduced
        .map((id) => mine.get(id)?.externalId)
        .filter(Boolean)
        .slice(0, 20);
      console.log("  새로 들어간 행: " + ex.join(", "));
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
