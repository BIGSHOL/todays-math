/**
 * 단계 3 — 문항의 `figureUrls` 를 **벡터 SVG** 로 갈아 끼운다.
 *
 *   npx tsx scripts/qa/adopt-figure-svg.ts                            # 드라이런 (기본)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/adopt-figure-svg.ts --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/adopt-figure-svg.ts --revert --apply
 *
 *   --blocklist=<파일>  검수가 「결함」으로 판정한 SVG 경로 목록(한 줄에 하나).
 *
 * 왜 `figureUrls` 를 바꾸나: `figureSvg` 컬럼은 **문자열 하나**라 원본 여러 장을
 * 못 담는다(한 문항 최대 6장). 그래서 경로를 바꾸는 쪽이 맞다.
 *
 * 🔴 **비율 대조가 유일한 탐지기다.** 치수를 SVG 의 `viewBox` 에서 받으면 자와
 *    지면이 저절로 일치하므로, 「SVG 가 래스터와 다른 영역을 담고 있다」가
 *    **보이지 않게 된다.** 실측 167자리가 그 부류였고 최대 66% 어긋났다.
 *    이 가드를 끄면 그것들이 조용히 들어와 **자와 지면이 사이좋게 틀린 그림을**
 *    그린다. 끄지 마라.
 *
 * 🔴 **수치가 못 보는 것이 있다.** 테두리가 맞아도 획·글자가 빠질 수 있고, 이
 *    저장소에서 그 부류는 **세 번 다 눈으로만** 나왔다. 그래서 `--blocklist` 로
 *    사람 판정을 받는다 — 그것이 최종이다.
 *
 * ⚠️ 공유 DB(D-31). 기본은 드라이런. `--apply` 와 `--revert --apply` 둘 다
 *    `ALLOW_SHARED_IMPORT=1` 이 있어야 연다.
 *
 * ⚠️ 옛 래스터는 **남긴다.** 지우면 되돌릴 파일이 없다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const LEDGER = "scripts/qa/reports/figure-svg-adopt.json";
const SVG_ROOT = "public/figures-svg";

/** 비율이 이만큼까지 다른 것은 「오려낸 자리가 몇 픽셀 다르다」로 본다. */
export const RATIO_TOLERANCE = 0.02;

export interface FigureSlot {
  /** 지금 `figureUrls` 값 (`/figures/…`). */
  url: string;
  svgPath: string;
  svgUrl: string;
  svgExists: boolean;
  /** SVG 의 `viewBox` 가로·세로. 못 읽으면 null. */
  svgViewBox: [number, number] | null;
  /** 지금 `figure_dims` 의 그 자리. 못 읽으면 null. */
  rasterDims: [number, number] | null;
  /** 지금 `figure_source_mm` 의 그 자리. 모르면 null. */
  sourceMm: number | null;
}

export type Adoption =
  { ok: true; urls: string[]; dims: number[] } | { ok: false; why: string };

/**
 * 이 문항을 SVG 로 바꿀 수 있나. **한 자리라도 안 되면 통째로 안 바꾼다** —
 * `figureUrls` 는 순서가 곧 짝이라, 절반만 바꾸면 어느 그림이 어느 자리인지
 * 어긋난다(그건 「못 쓰는 문항」보다 나쁘다 — 그럴듯해 보이면서 틀린다).
 */
export function decideAdoption(
  slots: readonly FigureSlot[],
  blocklist: ReadonlySet<string> = new Set(),
): Adoption {
  if (slots.length === 0) return { ok: false, why: "그림이 없다" };
  const urls: string[] = [];
  const dims: number[] = [];
  for (const s of slots) {
    if (!s.svgExists) return { ok: false, why: `SVG 가 없다: ${s.url}` };
    if (blocklist.has(s.svgPath))
      return { ok: false, why: `검수에서 결함으로 판정됐다: ${s.svgPath}` };
    if (s.sourceMm == null || !(s.sourceMm > 0))
      return {
        ok: false,
        why: `mm 를 모른다: ${s.url} — SVG 내장 70mm 가 거짓 크기를 만든다`,
      };
    if (!s.rasterDims || !(s.rasterDims[0] > 0) || !(s.rasterDims[1] > 0))
      return { ok: false, why: `래스터 치수를 모른다: ${s.url}` };
    if (!s.svgViewBox || !(s.svgViewBox[0] > 0) || !(s.svgViewBox[1] > 0))
      return { ok: false, why: `viewBox 를 못 읽는다: ${s.svgPath}` };
    const rRas = s.rasterDims[0] / s.rasterDims[1];
    const rSvg = s.svgViewBox[0] / s.svgViewBox[1];
    const diff = Math.abs(rSvg - rRas) / rRas;
    if (diff > RATIO_TOLERANCE)
      return {
        ok: false,
        why: `비율이 어긋난다(${(diff * 100).toFixed(1)}%): ${s.url} — SVG 가 다른 영역을 담고 있다`,
      };
    urls.push(s.svgUrl);
    // 치수는 **SVG 의 viewBox** 에서 온다. 래스터 치수를 그대로 두면 자는 래스터
    // 비율로 재고 브라우저는 SVG 비율로 그려 **높이가 갈라진다.**
    dims.push(Math.round(s.svgViewBox[0]), Math.round(s.svgViewBox[1]));
  }
  return { ok: true, urls, dims };
}

/** SVG 머리에서 `viewBox` 만 읽는다 (파일 전체를 파싱하지 않는다). */
export function readSvgViewBox(file: string): [number, number] | null {
  try {
    const head = readFileSync(file, "utf-8").slice(0, 4000);
    const m = /viewBox="([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)"/.exec(
      head,
    );
    if (!m) return null;
    const w = Number(m[3]),
      h = Number(m[4]);
    return w > 0 && h > 0 ? [w, h] : null;
  } catch {
    return null;
  }
}

// ── 여기부터 부수효과 ──────────────────────────────────────────────────────
const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");
const BLOCKFILE = process.argv
  .find((a) => a.startsWith("--blocklist="))
  ?.slice("--blocklist=".length);

if ((APPLY || REVERT) && process.env.ALLOW_SHARED_IMPORT !== "1") {
  console.error(
    "공유 DB 쓰기가 막혀 있다(D-31). ALLOW_SHARED_IMPORT=1 과 --apply(또는 --revert) 가 둘 다 필요하다.",
  );
  process.exit(1);
}

interface LedgerRow {
  id: string;
  beforeUrls: string[];
  beforeDims: number[];
  afterUrls: string[];
  afterDims: number[];
}

async function main() {
  const prisma = new PrismaClient();
  if (REVERT) return revert(prisma);

  const blocklist = new Set<string>();
  if (BLOCKFILE) {
    if (!existsSync(BLOCKFILE)) {
      console.error(`차단 목록이 없다: ${BLOCKFILE}`);
      process.exit(1);
    }
    for (const line of readFileSync(BLOCKFILE, "utf-8").split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith("#")) blocklist.add(t.replace(/\\/g, "/"));
    }
  }
  console.log(
    BLOCKFILE
      ? `검수 차단 목록 ${blocklist.size}장 (${BLOCKFILE})`
      : "🔴 검수 차단 목록이 **없다** — 눈으로 본 판정 없이 도는 중이다.",
  );

  const probs = await prisma.problem.findMany({
    where: { figureUrls: { isEmpty: false } },
    select: {
      id: true,
      figureUrls: true,
      figureDims: true,
      figureSourceMm: true,
    },
  });

  const rows: LedgerRow[] = [];
  const why = new Map<string, number>();
  for (const p of probs) {
    // 이미 SVG 로 바뀐 문항은 건드리지 않는다 (멱등).
    if (p.figureUrls.every((u) => u.startsWith("/figures-svg/"))) {
      why.set("이미 SVG 다", (why.get("이미 SVG 다") ?? 0) + 1);
      continue;
    }
    const slots: FigureSlot[] = p.figureUrls.map((u, i) => {
      const rel = u.replace(/^\/figures\//, "").replace(/\.[^./]+$/, ".svg");
      const svgPath = `${SVG_ROOT}/${rel}`;
      const exists = existsSync(svgPath);
      const w = p.figureDims?.[i * 2],
        h = p.figureDims?.[i * 2 + 1];
      return {
        url: u,
        svgPath,
        svgUrl: `/figures-svg/${rel}`,
        svgExists: exists,
        svgViewBox: exists ? readSvgViewBox(svgPath) : null,
        rasterDims: w && h ? [w, h] : null,
        sourceMm: p.figureSourceMm?.[i] ?? null,
      };
    });
    const d = decideAdoption(slots, blocklist);
    if (!d.ok) {
      const k = d.why.split(":")[0]!.split("(")[0]!.trim();
      why.set(k, (why.get(k) ?? 0) + 1);
      continue;
    }
    rows.push({
      id: p.id,
      beforeUrls: p.figureUrls,
      beforeDims: p.figureDims,
      afterUrls: d.urls,
      afterDims: d.dims,
    });
  }

  // 분모를 먼저 찍는다.
  console.log(`그림 있는 문항 ${probs.length.toLocaleString()} (분모)`);
  console.log(`  바꿀 것 ${rows.length.toLocaleString()}`);
  const skipped = probs.length - rows.length;
  console.log(`  건너뜀 ${skipped.toLocaleString()}`);
  for (const [k, v] of [...why.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`     ${String(v).padStart(6)}  ${k}`);
  const sum = [...why.values()].reduce((a, b) => a + b, 0);
  if (sum !== skipped) {
    console.error(
      `🔴 사유 합 ${sum} 이 건너뜀 ${skipped} 과 안 맞는다 — 범위가 샜다.`,
    );
    process.exit(1);
  }

  if (!APPLY) {
    console.log("\n드라이런이다 — DB 를 한 건도 안 바꿨다.");
    if (!BLOCKFILE)
      console.log(
        "🔴 적용하기 전에 **눈으로 본 검수 결과**(--blocklist)를 반드시 넣어라.",
      );
    await prisma.$disconnect();
    return;
  }
  if (!BLOCKFILE) {
    console.error(
      "🔴 --blocklist 없이 적용할 수 없다. 수치 검사는 획·글자가 빠진 SVG 를 구조적으로 못 본다.",
    );
    process.exit(1);
  }

  // 되돌리기 원장을 **DB 보다 먼저** 쓴다.
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        note:
          "되돌리기 자료. before* 가 적용 전 값이다. " +
          "되돌리기: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/adopt-figure-svg.ts --revert --apply",
        blocklist: BLOCKFILE,
        applied: false,
        rows,
      },
      null,
      1,
    ),
    "utf-8",
  );
  console.log(
    `\n되돌리기 원장 → ${LEDGER} (${rows.length}행) — DB 보다 먼저 썼다`,
  );

  let n = 0;
  for (const r of rows) {
    await prisma.problem.update({
      where: { id: r.id },
      data: { figureUrls: r.afterUrls, figureDims: r.afterDims },
    });
    if (++n % 200 === 0) process.stdout.write(`\r적용 ${n}/${rows.length}`);
  }
  console.log(`\r적용 완료 ${n.toLocaleString()}건`);
  const l = JSON.parse(readFileSync(LEDGER, "utf-8"));
  l.applied = true;
  writeFileSync(LEDGER, JSON.stringify(l, null, 1), "utf-8");
  await prisma.$disconnect();
}

/** 되돌리기 — **지금 값이 우리가 쓴 값일 때만** 되돌린다. */
async function revert(prisma: PrismaClient) {
  if (!existsSync(LEDGER)) {
    console.error(`되돌릴 원장이 없다: ${LEDGER}`);
    process.exit(1);
  }
  const l = JSON.parse(readFileSync(LEDGER, "utf-8")) as { rows: LedgerRow[] };
  let done = 0,
    skipped = 0;
  for (const r of l.rows) {
    const cur = await prisma.problem.findUnique({
      where: { id: r.id },
      select: { figureUrls: true, figureDims: true },
    });
    if (
      !cur ||
      JSON.stringify(cur.figureUrls) !== JSON.stringify(r.afterUrls) ||
      JSON.stringify(cur.figureDims) !== JSON.stringify(r.afterDims)
    ) {
      skipped++;
      continue;
    }
    if (APPLY)
      await prisma.problem.update({
        where: { id: r.id },
        data: { figureUrls: r.beforeUrls, figureDims: r.beforeDims },
      });
    done++;
  }
  console.log(
    `되돌리기${APPLY ? "" : " (드라이런)"}: ${done} · 건너뜀 ${skipped}` +
      (skipped
        ? " — 그 뒤 다른 트랙이 바꾼 것이다. 남의 값을 덮지 않는다."
        : ""),
  );
  await prisma.$disconnect();
}

if (process.argv[1]?.includes("adopt-figure-svg")) void main();
