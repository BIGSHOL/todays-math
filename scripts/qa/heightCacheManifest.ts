/**
 * 높이 캐시가 **무엇을 보고 잰 것인지**를 같이 적어 둔다 (적대적 리뷰 ④ F).
 *
 * ## 왜 필요한가
 *
 * `.measure/cont.json` 은 지면을 Chromium 으로 그려 뜬 실측 높이다. 판정만 고치는
 * 동안에는 지면이 안 바뀌므로 다시 써도 된다 — **그 전제가 참일 때만** 그렇다.
 * 지면 CSS·`displayWidth`·`fitsTwoColumns` 가 바뀌면 캐시는 통째로 거짓이 되는데,
 * 예전 채점기가 보는 것은 **문항 id 목록과 건수뿐**이라 그걸 못 봤다.
 *
 * 실제로 재현했다: `TWO_COLUMN_WIDTH_LIMIT` 를 24 → 40 으로 바꾸면(보기 열 수가
 * 바뀌어 지면 높이가 진짜로 달라진다) 같은 캐시로 채점해도 아무 말 없이
 * 「재현율 95.2%」를 찍는다. **지표가 그 실패를 셀 수 없는 형태**였다.
 *
 * 그래서 캐시 옆에 지문을 남기고, 채점기는 지문이 어긋나면 **멈춘다.**
 *
 * ## 무엇을 지문에 넣는가
 *
 * 「지면 높이를 바꿀 수 있는 것」 전부다 — 지면 CSS·토큰·렌더 컴포넌트·폭 계산·
 * 본문 파서·측정 하네스·KaTeX 버전. 그리고 **잰 문항 자체**(id·본문·그림·유형)도
 * 해시한다. 본문이 바뀌면 높이가 바뀌는데 id 목록은 그대로이기 때문이다
 * (이 저장소는 실제로 본문을 자주 고친다 — `apply-*` 스크립트들).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/**
 * 지면 높이를 바꿀 수 있는 원문들. **손으로 유지하는 목록이라 샌다** —
 * 그래서 `slotPx`(그때 실측한 칸 높이)와 `rowsHash` 를 같이 둔다. 목록에서
 * 빠진 파일이 지면을 바꿨더라도 칸 높이나 본문이 같이 움직이면 거기서 걸린다.
 * (CLAUDE.md 2026-08-18: 목록을 손으로 쓰면 세는 쪽과 고치는 쪽이 같이 눈이 먼다.)
 */
const PAGE_INPUT_FILES = [
  "src/components/print/TestPrint.module.css",
  "src/components/print/tokens.ts",
  "src/components/math/ProblemContent.tsx",
  "src/components/math/MarkdownRenderer.tsx",
  "src/app/globals.css",
  "src/lib/math/displayWidth.ts",
  "src/lib/problem/parseProblemContent.ts",
  "scripts/qa/paperProbe.tsx",
] as const;

export interface HeightCacheManifest {
  version: 1;
  /** 어느 장으로 쟀는가 — 첫 장과 이어지는 장은 칸이 다르다. */
  kind: "first" | "continuation";
  /** 잰 문항 수. */
  rows: number;
  /** 지면을 만드는 원문들의 지문. */
  inputsHash: string;
  /** 잰 문항들(id·본문·그림·유형)의 지문. */
  rowsHash: string;
  /** 그때 지면에서 **실측한** 문항 칸 높이. 제품 상수와 대조하는 근거다. */
  slotPx: number;
  measuredAt: string;
  /**
   * 문항별 본문 지문(짧게 자른 것). **어느 문항이 바뀌었는지**를 집어내려고 둔다 —
   * 공유 DB(D-31)는 다른 트랙이 `apply-*` 로 본문을 고친다. 실제로 이 작업 중에도
   * 한 행이 바뀌었다. 전체 지문만 있으면 «뭔가 바뀌었다»까지만 알고, 그러면 표본
   * 재측정이 **하필 그 문항을 안 뽑는** 일이 생긴다 — 그건 확인이 아니라 요행이다.
   */
  rowDigests?: Record<string, string>;
}

function sha256(parts: (string | Buffer)[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

/** 지면을 만드는 원문들의 지문. 파일이 없으면 그 사실 자체를 해시에 넣는다. */
export function pageInputsHash(): string {
  const parts: (string | Buffer)[] = [];
  for (const file of PAGE_INPUT_FILES) {
    const full = path.join(ROOT, file);
    parts.push(`${file}\u0000`);
    parts.push(existsSync(full) ? readFileSync(full) : "<없음>");
  }
  const katex = path.join(ROOT, "node_modules/katex/package.json");
  if (existsSync(katex)) {
    const pkg = JSON.parse(readFileSync(katex, "utf8")) as { version?: string };
    parts.push(`katex@${pkg.version ?? "?"}`);
  }
  return sha256(parts);
}

/** 잰 문항들의 지문 — 본문이 바뀌면 높이가 바뀐다. id 목록만으로는 못 본다. */
/**
 * 그림 **파일 자체**의 지문 — `존재 여부 + 바이트 수`.
 *
 * 왜 URL 문자열로는 모자라나 (검수 2026-08-18 이 실제로 당한 것):
 * main 이 `public/figures/` 에 그림 3,365장을 새로 넣었다. `figureUrls` 는 원래부터
 * 그 경로를 가리키고 있어서 **DB 는 한 글자도 안 바뀌었다.** 그런데 그림이 실제로
 * 그려지기 시작해 지면이 최대 380.95px 높아졌다(표본 3,000건 중 33건). 지문은
 * 조용히 통과했고, 낡은 캐시로 잰 재현율이 그대로 보고될 뻔했다.
 *
 * 높이를 바꾸는 것은 «URL 이 무엇인가»가 아니라 «그 URL 뒤에 무엇이 있는가»다.
 * 바이트 수까지 세는 이유는 같은 경로의 그림이 **교체**될 수 있기 때문이다.
 */
function figureFilesFingerprint(urls: readonly string[]): string {
  const parts: string[] = [];
  for (const url of urls) {
    // `/figures/4729/q03.png` → `public/figures/4729/q03.png`
    const rel = url.replace(/^[\\/]+/, "");
    const full = path.join(ROOT, "public", rel);
    let stamp = "<없음>";
    try {
      stamp = String(statSync(full).size);
    } catch {
      // 파일이 없다 — 그 사실 자체가 지문의 일부다. 있다가 없어져도 높이가 바뀐다.
    }
    parts.push(`${url}:${stamp}`);
  }
  return parts.join(",");
}

export function measuredRowsHash(
  rows: ReadonlyArray<{
    id: string;
    content: string | null;
    figureUrls: readonly string[];
    questionType?: string | null;
  }>,
): string {
  const parts: string[] = [];
  for (const row of [...rows].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    parts.push(
      `${row.id}\u0000${row.content ?? ""}\u0000${figureFilesFingerprint(row.figureUrls)}\u0000${row.questionType ?? ""}\u0001`,
    );
  }
  return sha256(parts);
}

/** 문항 하나의 본문 지문 — 짧게 자른다(4만 건 × 12자 ≈ 1MB). */
export function rowDigest(row: {
  content: string | null;
  figureUrls: readonly string[];
  questionType?: string | null;
}): string {
  return sha256([
    `${row.content ?? ""} ${figureFilesFingerprint(row.figureUrls)} ${row.questionType ?? ""}`,
  ]).slice(0, 12);
}

export function rowDigests(
  rows: ReadonlyArray<{
    id: string;
    content: string | null;
    figureUrls: readonly string[];
    questionType?: string | null;
  }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) out[row.id] = rowDigest(row);
  return out;
}

/**
 * 캐시를 뜬 뒤 **본문이 바뀐 문항**을 집어낸다. 지문이 없으면 `null` —
 * 「모른다」와 「없다」는 다른 말이라 빈 배열로 뭉개지 않는다.
 */
export function changedRowIds(
  manifest: HeightCacheManifest | null,
  rows: ReadonlyArray<{
    id: string;
    content: string | null;
    figureUrls: readonly string[];
    questionType?: string | null;
  }>,
): string[] | null {
  const before = manifest?.rowDigests;
  if (!before) return null;
  return rows
    .filter((row) => before[row.id] !== rowDigest(row))
    .map((row) => row.id);
}

export function buildHeightCacheManifest(input: {
  kind: "first" | "continuation";
  rows: number;
  rowsHash: string;
  slotPx: number;
  measuredAt: string;
  rowDigests?: Record<string, string>;
}): HeightCacheManifest {
  return {
    version: 1,
    kind: input.kind,
    rows: input.rows,
    inputsHash: pageInputsHash(),
    rowsHash: input.rowsHash,
    slotPx: input.slotPx,
    measuredAt: input.measuredAt,
    ...(input.rowDigests ? { rowDigests: input.rowDigests } : {}),
  };
}

/** 캐시 파일 옆에 두는 지문 파일 경로 (`x.json` → `x.manifest.json`). */
export function manifestPathFor(cachePath: string): string {
  return cachePath.replace(/\.json$/i, "") + ".manifest.json";
}

export function writeHeightCacheManifest(
  cachePath: string,
  manifest: HeightCacheManifest,
): string {
  const out = manifestPathFor(cachePath);
  writeFileSync(out, JSON.stringify(manifest, null, 2), "utf8");
  return out;
}

export function readHeightCacheManifest(
  cachePath: string,
): HeightCacheManifest | null {
  const file = manifestPathFor(cachePath);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as HeightCacheManifest;
}

export interface FreshnessProblem {
  what: string;
  cached: string;
  now: string;
}

/**
 * 캐시가 지금 지면과 같은 것을 보고 잰 것인지 본다.
 * **어긋난 항목을 전부** 돌려준다 — 하나만 알려 주면 다시 재고 또 걸린다.
 */
export function heightCacheProblems(
  manifest: HeightCacheManifest | null,
  now: {
    kind: "first" | "continuation";
    rows: number;
    rowsHash: string;
    slotPx: number;
  },
): FreshnessProblem[] {
  if (!manifest)
    return [
      {
        what: "지문 파일이 없다",
        cached: "(없음)",
        now: manifestPathFor("<캐시>.json"),
      },
    ];
  const problems: FreshnessProblem[] = [];
  const add = (what: string, cached: unknown, value: unknown) => {
    if (String(cached) !== String(value))
      problems.push({ what, cached: String(cached), now: String(value) });
  };
  add("장 종류", manifest.kind, now.kind);
  add("문항 수", manifest.rows, now.rows);
  add(
    "지면 원문 지문",
    manifest.inputsHash.slice(0, 12),
    pageInputsHash().slice(0, 12),
  );
  add(
    "문항 본문 지문",
    manifest.rowsHash.slice(0, 12),
    now.rowsHash.slice(0, 12),
  );
  add("실측 문항 칸", manifest.slotPx, now.slotPx);
  return problems;
}

/** 어긋나면 멈춘다 — 「다시 재라」가 유일한 답이다. */
export function assertHeightCacheFresh(
  cachePath: string,
  now: {
    kind: "first" | "continuation";
    rows: number;
    rowsHash: string;
    slotPx: number;
  },
): void {
  const problems = heightCacheProblems(readHeightCacheManifest(cachePath), now);
  if (problems.length === 0) return;
  const lines = problems.map(
    (p) => `  · ${p.what}: 캐시 ${p.cached} ≠ 지금 ${p.now}`,
  );
  throw new Error(
    `높이 캐시 ${cachePath} 가 지금 지면과 다른 것을 보고 잰 것이다 — 이 숫자는 거짓이다.\n` +
      lines.join("\n") +
      `\n다시 재라: npx tsx scripts/qa/measure-print-overflow.tsx ${now.kind === "first" ? "--first-page " : ""}--json ${cachePath}` +
      `\n(캐시가 아직 맞다고 믿으면 표본으로 확인하고 도장을 찍어라: --verify ${cachePath} --take 2000)`,
  );
}
