/**
 * 이관 원장 생성 — 이미 DB에 들어온 문항의 "본문 해시"를 기록한다.
 *
 * 왜 본문 해시인가: 기존 problemFingerprint 는 answer/solution 을 포함해서,
 * 정답 백필(2026-08-14)로 지문이 전부 바뀌었다. 같은 원본을 재이관하면
 * 지문이 안 맞아 중복 삽입된다. 본문은 바뀌지 않으므로 중복 판별의 안정적 기준이다.
 *
 * 사용: node scripts/qa/build-import-ledger.mjs
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
const h = (s) => createHash("sha1").update(s, "utf8").digest("hex").slice(0, 16);

const rows = await db.problem.findMany({ select: { content: true, source: true } });
const bySource = {};
const hashes = new Set();
for (const r of rows) {
  hashes.add(h(norm(r.content)));
  bySource[r.source] = (bySource[r.source] ?? 0) + 1;
}

await writeFile(
  "scripts/qa/imported-content.txt",
  `# v1 이관 완료 문항 본문 해시 — 재이관 시 이 해시가 있으면 건너뛴다\n` +
    `# 생성 시점 총 ${rows.length}건 / source별 ${JSON.stringify(bySource)}\n` +
    [...hashes].sort().join("\n") +
    "\n",
  "utf8",
);
console.log(`원장 생성: ${hashes.size}개 고유 본문 (전체 ${rows.length}행)`);
console.log("source별:", JSON.stringify(bySource));
await db.$disconnect();
