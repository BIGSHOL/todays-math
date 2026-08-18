/**
 * `public/figures` 그림들의 **원본 치수**를 파일 머리에서 읽어 낸다 (읽기 전용).
 *
 * 왜: 넘침 판정이 그림 높이를 보려면 치수를 알아야 하는데, 런타임(브라우저)은
 * 판정 시점에 파일을 못 읽는다. 그래서 적재 때 뽑아 DB 에 넣는다
 * (`backfill-figure-dimensions.ts`). 이 스크립트는 **뽑아서 파일로만** 낸다.
 *
 *   npx tsx scripts/qa/extract-figure-dimensions.ts
 *   npx tsx scripts/qa/extract-figure-dimensions.ts --out .measure/figure-dims.json
 *
 * 산출물: `{ "<figureUrl>": [width, height] }`. **읽지 못한 파일은 넣지 않는다** —
 * 없는 키가 곧 「모른다」다(추측한 치수를 넣으면 판정이 안다고 착각한다).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { readImageDimensions } from "../../src/lib/printImageDimensions";

const prisma = new PrismaClient();
const PUBLIC_ROOT = path.join(process.cwd(), "public");
/** 머리만 읽으면 되므로 앞부분만 읽는다. JPEG 는 EXIF 가 길어 넉넉히 잡는다. */
const HEAD_BYTES = 256 * 1024;

async function main() {
  const argIndex = process.argv.indexOf("--out");
  const outPath =
    argIndex >= 0
      ? process.argv[argIndex + 1]!
      : path.join(".measure", "figure-dims.json");

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT DISTINCT unnest(figure_urls) AS url FROM problem WHERE cardinality(figure_urls) > 0`,
  )) as Array<{ url: string }>;
  console.log(`그림 경로 ${rows.length.toLocaleString()}개`);

  const dims: Record<string, [number, number]> = {};
  const failures: Array<{ url: string; why: string }> = [];
  for (const { url } of rows) {
    if (!url.startsWith("/")) {
      failures.push({ url, why: "public 밖 경로" });
      continue;
    }
    const file = path.join(PUBLIC_ROOT, url);
    let head: Buffer;
    try {
      head = readFileSync(file).subarray(0, HEAD_BYTES);
    } catch {
      failures.push({ url, why: "파일 없음" });
      continue;
    }
    const measured = readImageDimensions(head);
    if (!measured) {
      failures.push({ url, why: "치수를 못 읽음" });
      continue;
    }
    dims[url] = [measured.width, measured.height];
  }

  const known = Object.keys(dims).length;
  console.log(
    `읽음 ${known.toLocaleString()} (${((known * 100) / Math.max(1, rows.length)).toFixed(2)}%) · 못 읽음 ${failures.length}`,
  );
  const byReason = new Map<string, number>();
  for (const f of failures) byReason.set(f.why, (byReason.get(f.why) ?? 0) + 1);
  for (const [why, count] of byReason) console.log(`  · ${why} ${count}`);
  for (const f of failures.slice(0, 10)) console.log(`    ${f.url} — ${f.why}`);

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(dims), "utf8");
  console.log(`→ ${outPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
