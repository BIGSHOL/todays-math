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
  /**
   * 주어지면 **이 목록에 있는 자리만** 채택한다. 빈 집합은 「아무것도 안 본다」는
   * 뜻이지 「목록이 없다」가 아니다 — 목록이 없으면 `undefined` 다.
   *
   * 🔴 왜 뒤집었나: 전량 검수가 중간에 끊겼다. 그때 「결함만 뺀다」로 두면
   *    **안 본 자리가 조용히 들어온다.** 안 본 자리에 무엇이 있는지는 정의상
   *    모르고, 실제로 본 구간에서 「전혀 다른 그림」이 나왔다 — 수치 가드를
   *    전부 통과한 채로. 그러니 「못 본 것」은 결함이 아니라 **아직 근거가
   *    없는 것**이고, 근거 없이 지면에 내보내지 않는다.
   */
  whitelist?: ReadonlySet<string>,
): Adoption {
  if (slots.length === 0) return { ok: false, why: "그림이 없다" };
  const urls: string[] = [];
  const dims: number[] = [];
  for (const s of slots) {
    if (!s.svgExists) return { ok: false, why: `SVG 가 없다: ${s.url}` };
    if (blocklist.has(s.svgPath))
      return { ok: false, why: `검수에서 결함으로 판정됐다: ${s.svgPath}` };
    if (whitelist && !whitelist.has(s.svgPath))
      return { ok: false, why: `눈으로 안 본 자리다: ${s.svgPath}` };
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
    // 🔴 **저장할 값**으로 잰다. `figure_dims` 는 Int[] 라 반올림해서 들어가는데,
    //    viewBox 가 74×29 처럼 작으면 반올림만으로 비율이 3% 흔들린다. 반올림 전
    //    값으로 재면 「2% 안」이라는 보장이 지면에서는 거짓이 된다 — 세는 쪽과
    //    쓰는 쪽이 다른 값을 보는 그 자리다.
    const w = Math.round(s.svgViewBox[0]);
    const h = Math.round(s.svgViewBox[1]);
    if (!(w > 0) || !(h > 0))
      return { ok: false, why: `반올림하면 0 이 된다: ${s.svgPath}` };
    const rSvg = w / h;
    const diff = Math.abs(rSvg - rRas) / rRas;
    if (diff > RATIO_TOLERANCE)
      return {
        ok: false,
        why: `비율이 어긋난다(${(diff * 100).toFixed(1)}%): ${s.url} — SVG 가 다른 영역을 담고 있다`,
      };
    urls.push(s.svgUrl);
    // 치수는 **SVG 의 viewBox** 에서 온다. 래스터 치수를 그대로 두면 자는 래스터
    // 비율로 재고 브라우저는 SVG 비율로 그려 **높이가 갈라진다.**
    dims.push(w, h);
  }
  return { ok: true, urls, dims };
}

/**
 * 경로 목록 파일을 읽는다 — 차단 목록·허용 목록이 **같은 함수**를 쓴다.
 *
 * 🔴 줄 끝 주석(`경로  # 1390`)을 반드시 떼야 한다. 안 떼면 그 줄은 어떤
 *    경로와도 안 맞아 **가드가 조용히 안 먹는다** — 차단 목록이었으면
 *    결함 SVG 가 그대로 지면에 나간다(에러가 아니라 숫자만 달라진다).
 *    실제로 허용 목록에서 「바꿀 것 0」으로 드러났다.
 */
export function readPathList(text: string): Set<string> {
  const BSLASH = String.fromCharCode(92);
  const out = new Set<string>();
  for (const line of text.split(/[\r\n]+/)) {
    const t = line.replace(/[ \t]+#.*$/, "").trim();
    if (!t || t.startsWith("#")) continue;
    out.add(t.split(BSLASH).join("/"));
  }
  return out;
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
/** 주면 **이 목록에 있는 자리만** 채택한다 (눈으로 본 것만). */
const ALLOWFILE = process.argv
  .find((a) => a.startsWith("--whitelist="))
  ?.slice("--whitelist=".length);

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
    for (const v of readPathList(readFileSync(BLOCKFILE, "utf-8")))
      blocklist.add(v);
  }
  console.log(
    BLOCKFILE
      ? `검수 차단 목록 ${blocklist.size}장 (${BLOCKFILE})`
      : "🔴 검수 차단 목록이 **없다** — 눈으로 본 판정 없이 도는 중이다.",
  );

  // 허용 목록: 있으면 「본 것만」. `undefined` 여야 «목록 없음» 이다 —
  // 빈 Set 은 「아무것도 안 본다」는 뜻이라 전량이 막힌다.
  let whitelist: Set<string> | undefined;
  if (ALLOWFILE) {
    if (!existsSync(ALLOWFILE)) {
      console.error(`허용 목록이 없다: ${ALLOWFILE}`);
      process.exit(1);
    }
    whitelist = readPathList(readFileSync(ALLOWFILE, "utf-8"));
    if (whitelist.size === 0) {
      console.error(`🔴 허용 목록이 비었다: ${ALLOWFILE} — 전량이 막힌다.`);
      process.exit(1);
    }
    console.log(
      `검수 허용 목록 ${whitelist.size}장 (${ALLOWFILE}) — 이 밖은 안 바꾼다`,
    );
  }

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
    const d = decideAdoption(slots, blocklist, whitelist);
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
    if (!BLOCKFILE && !ALLOWFILE)
      console.log(
        "🔴 적용하기 전에 **눈으로 본 검수 결과**(--blocklist 또는 --whitelist)를 반드시 넣어라.",
      );
    await prisma.$disconnect();
    return;
  }
  if (!BLOCKFILE && !ALLOWFILE) {
    console.error(
      "🔴 --blocklist 도 --whitelist 도 없이 적용할 수 없다. 수치 검사는 획·글자가 빠진 SVG 를 구조적으로 못 본다.",
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
        whitelist: ALLOWFILE,
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
