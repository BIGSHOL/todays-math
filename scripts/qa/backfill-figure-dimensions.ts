/**
 * `problem.figure_dims` 적재 — 그림 원본 치수를 파일에서 읽어 DB 에 넣는다.
 *
 * 왜: 넘침 판정은 브라우저에서 돌아 이미지 파일을 못 읽는다. 치수를 모르면
 * 그림 문항이 전부 «보수적 상수»로 뭉개지고, 실제로 넘치는 2,109건과 멀쩡한
 * 5,821건이 갈리지 않는다(적대적 리뷰 ③ §2).
 *
 *   npx tsx scripts/qa/backfill-figure-dimensions.ts             # 드라이런 (기본)
 *   npx tsx scripts/qa/backfill-figure-dimensions.ts --apply     # 실제 적재
 *   npx tsx scripts/qa/backfill-figure-dimensions.ts --revert    # 전량 되돌리기
 *
 * ⚠️ 공유 DB(D-31)다. 기본은 **드라이런**이고, `--apply` 는 `ALLOW_SHARED_IMPORT=1`
 *    이 있어야만 연다(2026-08-14 적재 사고 뒤 굳은 규칙).
 *
 * ⚠️ **모르는 것은 안 쓴다.** 파일이 없거나 머리를 못 읽으면 그 문항은 건너뛴다 —
 *    빈 배열이 곧 「모른다」이고, 판정은 그때 보수적 상수를 쓴다. 추측한 치수를
 *    넣으면 판정이 «안다»고 착각한다(CLAUDE.md 2026-08-16).
 *
 * 되돌리기: `--revert` 는 `figure_dims` 를 전량 빈 배열로 되돌린다. 컬럼 자체를
 *    없애려면 `ALTER TABLE "problem" DROP COLUMN "figure_dims";`.
 *    **이 컬럼은 순수 추가라 기존 데이터를 한 바이트도 안 건드린다.**
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { readImageDimensions } from "../../src/lib/printImageDimensions";

const prisma = new PrismaClient();
const PUBLIC_ROOT = path.join(process.cwd(), "public");
const HEAD_BYTES = 256 * 1024;

interface Row {
  id: string;
  figureUrls: string[];
  figureDims: number[];
}

const dimensionCache = new Map<string, [number, number] | null>();

function dimensionsFor(url: string): [number, number] | null {
  const cached = dimensionCache.get(url);
  if (cached !== undefined) return cached;
  let result: [number, number] | null = null;
  if (url.startsWith("/")) {
    try {
      const head = readFileSync(path.join(PUBLIC_ROOT, url)).subarray(
        0,
        HEAD_BYTES,
      );
      const measured = readImageDimensions(head);
      if (measured) result = [measured.width, measured.height];
    } catch {
      result = null;
    }
  }
  dimensionCache.set(url, result);
  return result;
}

async function revert(apply: boolean) {
  const [{ count }] = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS count FROM problem WHERE cardinality(figure_dims) > 0`,
  )) as Array<{ count: number }>;
  console.log(`치수가 들어 있는 문항 ${count.toLocaleString()}건`);
  if (!apply) {
    console.log("드라이런 — `--revert --apply` 라야 실제로 지운다.");
    return;
  }
  const affected = await prisma.$executeRawUnsafe(
    `UPDATE problem SET figure_dims = ARRAY[]::INTEGER[] WHERE cardinality(figure_dims) > 0`,
  );
  console.log(`되돌림 ${affected.toLocaleString()}건`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (process.argv.includes("--revert")) return revert(apply);

  if (apply && process.env.ALLOW_SHARED_IMPORT !== "1")
    throw new Error(
      "공유 DB 쓰기는 ALLOW_SHARED_IMPORT=1 없이는 열지 않는다 (D-31).",
    );

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, figure_urls AS "figureUrls", figure_dims AS "figureDims"
       FROM problem WHERE cardinality(figure_urls) > 0 ORDER BY id`,
  )) as Row[];
  console.log(`그림 있는 문항 ${rows.length.toLocaleString()}건`);

  const updates: Array<{ id: string; dims: number[] }> = [];
  let alreadyOk = 0;
  let partial = 0;
  const unreadable = new Set<string>();

  for (const row of rows) {
    const pairs = row.figureUrls.map((url) => dimensionsFor(url));
    const missing = pairs.filter((p) => p === null).length;
    if (missing > 0) {
      partial += 1;
      for (const [i, p] of pairs.entries())
        if (p === null) unreadable.add(row.figureUrls[i]!);
      // 한 장이라도 모르면 **아무것도 안 쓴다** — 짝이 어긋난 배열은 판정이
      // 통째로 «모른다»로 받으므로, 반쪽 값을 넣어 봐야 쓰이지 않는다.
      continue;
    }
    const dims = pairs.flatMap((p) => p!);
    if (
      row.figureDims.length === dims.length &&
      row.figureDims.every((v, i) => v === dims[i])
    ) {
      alreadyOk += 1;
      continue;
    }
    updates.push({ id: row.id, dims });
  }

  console.log(
    `쓸 것 ${updates.length.toLocaleString()} · 이미 같음 ${alreadyOk.toLocaleString()} · 못 읽은 그림이 낀 문항 ${partial.toLocaleString()} (그림 ${unreadable.size}장)`,
  );
  for (const url of [...unreadable].slice(0, 10)) console.log(`  · ${url}`);
  for (const u of updates.slice(0, 5))
    console.log(`  예시 ${u.id} → [${u.dims.join(", ")}]`);

  if (!apply) {
    console.log("\n드라이런 — `--apply` 를 붙여야 실제로 쓴다.");
    return;
  }

  let written = 0;
  const BATCH = 200;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    await prisma.$transaction(
      chunk.map((u) =>
        prisma.$executeRawUnsafe(
          `UPDATE problem SET figure_dims = $1::int[] WHERE id = $2::uuid`,
          u.dims,
          u.id,
        ),
      ),
    );
    written += chunk.length;
    process.stdout.write(`\r적재 ${written}/${updates.length}`);
  }
  console.log(`\n적재 완료 ${written.toLocaleString()}건`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
