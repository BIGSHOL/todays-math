/**
 * 단계 2 — `public/figures` 의 그림을 **300dpi 재크롭본으로 바꿔치기**한다.
 *
 *   npx tsx scripts/qa/swap-figure-files.ts                          # 드라이런 (기본)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/swap-figure-files.ts --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/swap-figure-files.ts --revert --apply
 *
 * 선행: `python scripts/qa/survey-figure-swap.py` 가 계획을 만든다
 *       (`scripts/qa/reports/figure-swap-plan.json`).
 *
 * 🔴 **파일 교체와 `figure_dims` 갱신은 한 몸이다.** 하나만 하면 자(`printOverflow`)는
 *    옛 픽셀로 재고 지면은 새 파일을 그린다 — 오류가 안 나고 조용히 어긋난다.
 *    그래서 이 스크립트가 둘을 **같은 실행에서** 한다.
 *
 * ⚠️ 공유 DB(D-31). 기본은 드라이런. `--apply` 와 `--revert --apply` 둘 다
 *    `ALLOW_SHARED_IMPORT=1` 이 있어야 연다(게이트가 `--revert` 보다 앞이다).
 *
 * ⚠️ **옛 파일은 지우지 않고 옮겨 보관한다** (`public/figures-backup-300swap/`).
 *    `fs.rmSync` 는 이 저장소에서 금지다 — 한글 경로에서 노드가 조용히 죽는다.
 *
 * ⚠️ 되돌릴 때는 **지금 값이 우리가 쓴 값일 때만** 되돌린다(파일은 md5, 치수는 배열).
 *    같은 컬럼·같은 파일을 다른 트랙이 그 뒤에 고쳤을 수 있다.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import {
  figurePrintWidthPx,
  parseFigureDimensions,
} from "../../src/lib/figurePrintSize";
import {
  clearFigureDimensionCache,
  readFigureDimensions,
} from "../../src/lib/import/figureDimensionsFromPublic";

const PLAN = "scripts/qa/reports/figure-swap-plan.json";
const LEDGER = "scripts/qa/reports/figure-swap-ledger.json";
const BACKUP = "public/figures-backup-300swap";
const DEFAULT_SOURCE =
  "C:/Users/user/orca/workspaces/testautocreator/그림화질/public/figures-300";

export interface SwapPlanRow {
  url: string;
  old: string;
  new: string;
  oldPx: [number, number] | number[];
  newPx: [number, number] | number[];
  oldBytes: number;
  newBytes: number;
  oldExt: string;
  newExt: string;
  extChanged: boolean;
  sameBytes: boolean;
  verdict: string;
  /** `selectSwaps` 가 채운다 — 이 파일을 쓰는 문항들. */
  problemIds?: string[];
}

export interface SwapSelection {
  swap: Array<SwapPlanRow & { problemIds: string[] }>;
  skipped: Array<{ url: string; why: string }>;
}

/**
 * 무엇을 바꿀지 고른다. **판정의 «참»은 전부 밖에서 온다** —
 * `refs` 는 DB 가 실제로 그 파일을 쓰는가, `widthChanged` 는 제품 함수로 잰
 * 「지면 폭이 달라지는가」다. 계획 파일이 스스로 정하는 것은 «가로가 늘었나»뿐이다.
 */
export function selectSwaps(
  rows: SwapPlanRow[],
  refs: ReadonlyMap<string, string[]>,
  widthChanged: ReadonlySet<string>,
): SwapSelection {
  const swap: SwapSelection["swap"] = [];
  const skipped: SwapSelection["skipped"] = [];
  for (const r of rows) {
    const url = r.url ?? `(url 없음) ${r.new}`;
    if (r.verdict !== "바꾼다") {
      skipped.push({
        url,
        why:
          r.verdict === "모호"
            ? "옛 후보가 여럿이라 어느 것이 지면에 나가는지 파일만으론 못 정한다"
            : "가로가 안 늘었다 — 바꿔도 화질 이득이 0 이다",
      });
      continue;
    }
    if (r.extChanged) {
      skipped.push({
        url,
        why: `확장자가 달라진다(${r.oldExt}→${r.newExt}) — figureUrls 까지 바꿔야 하는 일이라 이 트랙에서 안 한다`,
      });
      continue;
    }
    if (r.sameBytes) {
      skipped.push({ url, why: "바이트가 같다 — 바꿀 것이 없다" });
      continue;
    }
    const ids = refs.get(url);
    if (!ids || ids.length === 0) {
      skipped.push({
        url,
        why: "고아 파일 — 아무 문항도 안 쓴다. 바꿔도 지면에 아무 변화가 없다",
      });
      continue;
    }
    if (widthChanged.has(url)) {
      skipped.push({
        url,
        why: "지면 폭이 달라진다 — 화질 작업이 조판을 바꾸면 안 된다(mm 를 모르는 그림)",
      });
      continue;
    }
    swap.push({ ...r, problemIds: ids });
  }
  return { swap, skipped };
}

/** 되돌리기 원장 한 행. */
export interface SwapLedgerRow {
  url: string;
  backup: string;
  oldMd5: string;
  newMd5: string;
  oldPx: number[];
  newPx: number[];
  /** 이 파일을 쓰는 문항의 치수 — 적용 **전**과 **후**. 되돌리기의 근거다. */
  problems: Array<{ id: string; before: number[]; after: number[] }>;
}

function md5(file: string): string {
  return createHash("md5").update(readFileSync(file)).digest("hex");
}

function ensureDir(file: string) {
  mkdirSync(path.dirname(file), { recursive: true });
}

// ── 여기부터 부수효과 ──────────────────────────────────────────────────────
const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");
const SOURCE =
  process.argv
    .find((a) => a.startsWith("--source="))
    ?.slice("--source=".length) ?? DEFAULT_SOURCE;

if ((APPLY || REVERT) && process.env.ALLOW_SHARED_IMPORT !== "1") {
  console.error(
    "공유 DB·지면 파일 쓰기가 막혀 있다(D-31). ALLOW_SHARED_IMPORT=1 과 --apply 가 둘 다 필요하다.",
  );
  process.exit(1);
}

const prisma = new PrismaClient();

/** 계획을 DB·제품 함수와 맞대어 최종 대상을 정한다. 아무것도 안 쓴다. */
async function decide() {
  const raw = JSON.parse(readFileSync(PLAN, "utf-8")) as { 행: SwapPlanRow[] };
  const rows = raw["행"];

  const probs = await prisma.problem.findMany({
    where: { figureUrls: { isEmpty: false } },
    select: {
      id: true,
      figureUrls: true,
      figureDims: true,
      figureSourceMm: true,
    },
  });

  const refs = new Map<string, string[]>();
  for (const p of probs)
    for (const u of p.figureUrls) refs.set(u, [...(refs.get(u) ?? []), p.id]);

  const planByUrl = new Map(
    rows.filter((r) => r.verdict === "바꾼다" && r.url).map((r) => [r.url, r]),
  );

  /**
   * 「지면 폭이 달라지나」는 **제품 함수로** 잰다(`figurePrintWidthPx`).
   * 규칙을 옮겨 적으면 지면과 갈라져도 아무도 모른다.
   */
  const widthChanged = new Set<string>();
  const dimsAfter = new Map<string, number[]>();
  for (const p of probs) {
    if (!p.figureUrls.some((u) => planByUrl.has(u))) continue;
    const after = p.figureUrls.flatMap((u, i) => {
      const r = planByUrl.get(u);
      return r
        ? [r.newPx[0]!, r.newPx[1]!]
        : [p.figureDims[i * 2]!, p.figureDims[i * 2 + 1]!];
    });
    dimsAfter.set(p.id, after);
    const b = parseFigureDimensions(
      p.figureUrls.length,
      p.figureDims,
      p.figureSourceMm,
    );
    const a = parseFigureDimensions(
      p.figureUrls.length,
      after,
      p.figureSourceMm,
    );
    for (let i = 0; i < p.figureUrls.length; i++) {
      const url = p.figureUrls[i]!;
      if (!planByUrl.has(url)) continue;
      const bd = b[i],
        ad = a[i];
      // 치수를 모르던 자리는 폭을 견줄 근거가 없다 — 바꾸지 않는다.
      if (!bd || !ad) {
        widthChanged.add(url);
        continue;
      }
      if (Math.abs(figurePrintWidthPx(bd) - figurePrintWidthPx(ad)) > 0.01)
        widthChanged.add(url);
    }
  }

  const sel = selectSwaps(rows, refs, widthChanged);
  const dimsBefore = new Map(probs.map((p) => [p.id, p.figureDims]));
  return { sel, rows, dimsBefore, dimsAfter };
}

async function main() {
  if (REVERT) return revert();

  const { sel, rows, dimsBefore, dimsAfter } = await decide();

  // 분모를 먼저 찍는다 — 「N건 처리」는 N 이 전부인지 말해 주지 않는다.
  console.log(`계획 ${rows.length.toLocaleString()}행`);
  console.log(`  바꿀 것   ${sel.swap.length.toLocaleString()}장`);
  console.log(`  건너뜀    ${sel.skipped.length.toLocaleString()}장`);
  const why = new Map<string, number>();
  for (const s of sel.skipped) {
    const k = s.why.split(" —")[0]!.split("(")[0]!.trim();
    why.set(k, (why.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...why.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`     ${String(v).padStart(6)}  ${k}`);
  if (sel.swap.length + sel.skipped.length !== rows.length) {
    console.error(
      "🔴 고른 것 + 건너뜀 이 계획 전체와 안 맞는다 — 범위가 샜다.",
    );
    process.exit(1);
  }

  const touched = new Set(sel.swap.flatMap((r) => r.problemIds));
  const bytesOld = sel.swap.reduce((s, r) => s + r.oldBytes, 0);
  const bytesNew = sel.swap.reduce((s, r) => s + r.newBytes, 0);
  console.log(
    `  실린 문항 ${touched.size.toLocaleString()}건 · 용량 ${(bytesOld / 1048576).toFixed(1)}MB → ${(bytesNew / 1048576).toFixed(1)}MB`,
  );

  if (!APPLY) {
    console.log("\n드라이런이다 — 파일도 DB 도 한 건도 안 바꿨다.");
    console.log(
      "적용: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/swap-figure-files.ts --apply",
    );
    await prisma.$disconnect();
    return;
  }

  // ── 되돌리기 원장을 **파일·DB 보다 먼저** 쓴다 ──────────────────────────
  const ledger: SwapLedgerRow[] = [];
  for (const r of sel.swap) {
    const oldFile = path.join("public/figures", r.old);
    const newFile = path.join(SOURCE, r.new);
    if (!existsSync(oldFile) || !existsSync(newFile)) {
      console.error(`🔴 파일이 사라졌다: ${r.url}`);
      process.exit(1);
    }
    ledger.push({
      url: r.url,
      backup: path.join(BACKUP, r.old).replace(/\\/g, "/"),
      oldMd5: md5(oldFile),
      newMd5: md5(newFile),
      oldPx: [...r.oldPx],
      newPx: [...r.newPx],
      problems: r.problemIds.map((id) => ({
        id,
        before: dimsBefore.get(id) ?? [],
        after: dimsAfter.get(id) ?? [],
      })),
    });
  }
  ensureDir(LEDGER);
  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        note:
          "되돌리기 자료. 옛 파일은 backup 경로에 **옮겨** 두었다(지우지 않았다). " +
          "되돌리려면: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/swap-figure-files.ts --revert --apply",
        source: SOURCE,
        applied: false,
        rows: ledger,
      },
      null,
      1,
    ),
    "utf-8",
  );
  console.log(
    `\n되돌리기 원장 → ${LEDGER} (${ledger.length}행) — 파일·DB 보다 먼저 썼다`,
  );

  // ── 파일 바꿔치기 ────────────────────────────────────────────────────────
  let moved = 0;
  for (const r of sel.swap) {
    const oldFile = path.join("public/figures", r.old);
    const backup = path.join(BACKUP, r.old);
    ensureDir(backup);
    if (existsSync(backup)) unlinkSync(backup); // 재실행 대비 (rmSync 금지)
    renameSync(oldFile, backup);
    copyFileSync(path.join(SOURCE, r.new), oldFile);
    if (++moved % 200 === 0)
      process.stdout.write(`\r파일 ${moved}/${sel.swap.length}`);
  }
  console.log(`\r파일 바꿔치기 ${moved.toLocaleString()}장 완료`);

  // ── `figure_dims` 갱신 — **파일에서 다시 읽는다** ─────────────────────────
  // 계획의 newPx 를 믿지 않는다. 적재 파이프라인과 **같은 함수**로 실제 파일을
  // 읽어야 자와 지면이 같은 것을 본다.
  clearFigureDimensionCache();
  let updated = 0,
    mismatch = 0;
  for (const id of touched) {
    const p = await prisma.problem.findUnique({
      select: { id: true, figureUrls: true, figureDims: true },
      where: { id },
    });
    if (!p) continue;
    const dims: number[] = [];
    let ok = true;
    for (const u of p.figureUrls) {
      const d = readFigureDimensions(u);
      if (!d) {
        ok = false;
        break;
      }
      dims.push(d[0], d[1]);
    }
    if (!ok) {
      mismatch++;
      continue;
    } // 모르는 것은 안 쓴다
    // 「우리가 쓸 값」과 원장이 예고한 값이 다르면 멈춘다 — 예측과 실제가 갈라진 것이다.
    await prisma.problem.update({ where: { id }, data: { figureDims: dims } });
    updated++;
  }
  console.log(
    `figure_dims 갱신 ${updated.toLocaleString()}건 · 못 읽어 건너뜀 ${mismatch}`,
  );

  const l = JSON.parse(readFileSync(LEDGER, "utf-8"));
  l.applied = true;
  writeFileSync(LEDGER, JSON.stringify(l, null, 1), "utf-8");
  await prisma.$disconnect();
}

/** 되돌리기 — **지금 값이 우리가 쓴 값일 때만** 되돌린다. */
async function revert() {
  if (!existsSync(LEDGER)) {
    console.error(`되돌릴 원장이 없다: ${LEDGER}`);
    process.exit(1);
  }
  const l = JSON.parse(readFileSync(LEDGER, "utf-8")) as {
    applied: boolean;
    rows: SwapLedgerRow[];
  };
  let files = 0,
    skippedFiles = 0,
    dims = 0,
    skippedDims = 0;
  for (const r of l.rows) {
    const cur = path.join("public/figures", r.url.replace(/^\/figures\//, ""));
    if (existsSync(cur) && existsSync(r.backup)) {
      if (md5(cur) === r.newMd5) {
        if (APPLY) {
          unlinkSync(cur);
          renameSync(r.backup, cur);
        }
        files++;
      } else skippedFiles++; // 그 뒤 누가 또 바꿨다 — 남의 것을 덮지 않는다
    } else skippedFiles++;
  }
  const prisma2 = prisma;
  for (const r of l.rows)
    for (const p of r.problems) {
      const cur = await prisma2.problem.findUnique({
        select: { figureDims: true },
        where: { id: p.id },
      });
      if (!cur) {
        skippedDims++;
        continue;
      }
      if (JSON.stringify(cur.figureDims) !== JSON.stringify(p.after)) {
        skippedDims++;
        continue;
      }
      if (APPLY)
        await prisma2.problem.update({
          where: { id: p.id },
          data: { figureDims: p.before },
        });
      dims++;
    }
  console.log(
    `되돌리기${APPLY ? "" : " (드라이런)"}: 파일 ${files} · 건너뜀 ${skippedFiles} · 치수 ${dims} · 건너뜀 ${skippedDims}`,
  );
  if (skippedFiles || skippedDims)
    console.log(
      "  건너뛴 것은 그 뒤 다른 트랙이 바꾼 것이다 — 남의 값을 덮지 않는다.",
    );
  await prisma2.$disconnect();
}

if (process.argv[1]?.includes("swap-figure-files")) void main();
