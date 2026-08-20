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
  /**
   * 탐침 지면에 **덧입힌 배치**(그림 폭 상한·문항번호 서식)의 지문.
   *
   * 왜 필요한가: `inputsHash` 는 **제품 원문**만 본다. 검토용 측정은 제품을 안 고치고
   * 탐침 문서에 `<style>` 을 덧붙여 다른 지면을 그리는데(`d-affordable` 트랙),
   * 그러면 「45mm 로 잰 캐시」와 「70mm 로 잰 캐시」가 지문이 **똑같다.** 조건을
   * 바꿔 놓고 옛 캐시로 채점해도 아무 말이 없다 — 이 저장소가 여러 번 당한 자리다.
   * 덧칠이 없는(제품 그대로) 측정은 `undefined` 라 기존 캐시와 그대로 호환된다.
   */
  overlay?: string;
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

/**
 * 지면 높이를 바꾸는 «그림 크기의 근거». 그림 파일 바이트로는 못 본다 —
 * `figureSourceMm` 은 **DB 컬럼**이라, 다시 적재하면 그림 파일은 한 바이트도 안 바뀌는데
 * 지면 폭이 달라진다. `figureDims` 는 비율이라 높이를 직접 정한다.
 * (2026-08-20: 제품은 mm 로 폭을 못 박는데 탐침은 그 값을 안 넘겨 지면이 갈렸다.)
 */
function figureSizeBasis(row: {
  figureDims?: readonly number[] | null;
  figureSourceMm?: readonly number[] | null;
}): string {
  return `${(row.figureDims ?? []).join(",")}|${(row.figureSourceMm ?? []).join(",")}`;
}

/** 지문이 보는 문항 한 줄. 지면 높이를 바꾸는 것만 담는다. */
export interface DigestRow {
  content: string | null;
  figureUrls: readonly string[];
  figureDims?: readonly number[] | null;
  figureSourceMm?: readonly number[] | null;
  questionType?: string | null;
}

export function measuredRowsHash(
  rows: ReadonlyArray<DigestRow & { id: string }>,
): string {
  const parts: string[] = [];
  for (const row of [...rows].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    parts.push(
      `${row.id}\u0000${row.content ?? ""}\u0000${figureFilesFingerprint(row.figureUrls)}\u0000${figureSizeBasis(row)}\u0000${row.questionType ?? ""}\u0001`,
    );
  }
  return sha256(parts);
}

/** 문항 하나의 본문 지문 — 짧게 자른다(4만 건 × 12자 ≈ 1MB). */
export function rowDigest(row: DigestRow): string {
  return sha256([
    `${row.content ?? ""} ${figureFilesFingerprint(row.figureUrls)} ${figureSizeBasis(row)} ${row.questionType ?? ""}`,
  ]).slice(0, 12);
}

export function rowDigests(
  rows: ReadonlyArray<DigestRow & { id: string }>,
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
  rows: ReadonlyArray<DigestRow & { id: string }>,
): string[] | null {
  const before = manifest?.rowDigests;
  if (!before) return null;
  return rows
    .filter((row) => before[row.id] !== rowDigest(row))
    .map((row) => row.id);
}

/**
 * 재는 **동안** 발밑이 바뀌었는지 보려고 앞뒤로 찍는 지문.
 *
 * ## 왜 «끝난 뒤 한 번»으로는 모자란가
 *
 * `buildHeightCacheManifest` 는 캐시를 **다 쓴 뒤** 지문을 찍는다. 그러면 「지금
 * 상태」는 정확히 적히지만, **재는 28분 사이에 바뀐 것**은 구조적으로 못 본다 —
 * 앞부분은 옛 지면으로, 뒷부분은 새 지면으로 그려 놓고 지문에는 «새 지면»만 적힌다.
 * 캐시는 그대로 «싱싱함»으로 통과한다. 실패가 침묵하는 경로다.
 *
 * 2026-08-20 에 실제로 그랬다: 전수 측정(13:37~14:05) 중 **13:54 에** 다른 세션의
 * 병합이 그림 1,344장을 갈아 끼웠다. 그중 796장은 300dpi 확대가 아니라 **다시 오려서
 * 가로세로 비율이 달라졌고**(296×574 → 1003×153 같은 것), 그러면 mm 를 알아도
 * 높이가 바뀐다(폭을 mm 로 못 박아도 높이는 비율을 따라간다). 걸린 문항 1,218건.
 *
 * 그래서 렌더 **전후로** 같은 지문을 찍고, 다르면 캐시를 **쓰지 않고 멈춘다.**
 */
export interface GroundStamp {
  inputsHash: string;
  rowsHash: string;
  rowDigests: Record<string, string>;
}

export function stampGround(
  rows: ReadonlyArray<DigestRow & { id: string }>,
): GroundStamp {
  return {
    inputsHash: pageInputsHash(),
    rowsHash: measuredRowsHash(rows),
    rowDigests: rowDigests(rows),
  };
}

/**
 * 앞뒤 지문이 다르면 **무엇이** 움직였는지 적어서 돌려준다. 안 움직였으면 `null` —
 * 「모른다」와 「안 움직였다」를 뭉개지 않으려고 사유를 문장으로 남긴다.
 */
export function describeGroundMove(
  before: GroundStamp,
  after: GroundStamp,
): string | null {
  const reasons: string[] = [];
  if (before.inputsHash !== after.inputsHash)
    reasons.push("지면 원문(CSS·렌더 컴포넌트·폭 계산)이 바뀌었다");

  const added = Object.keys(after.rowDigests).filter(
    (id) => !(id in before.rowDigests),
  );
  const removed = Object.keys(before.rowDigests).filter(
    (id) => !(id in after.rowDigests),
  );
  if (added.length > 0)
    reasons.push(`문항 ${added.length.toLocaleString()}건이 새로 생겼다`);
  if (removed.length > 0)
    reasons.push(`문항 ${removed.length.toLocaleString()}건이 사라졌다`);

  const moved = Object.keys(before.rowDigests).filter(
    (id) =>
      id in after.rowDigests && before.rowDigests[id] !== after.rowDigests[id],
  );
  if (moved.length > 0)
    reasons.push(
      `문항 ${moved.length.toLocaleString()}건의 본문·그림이 바뀌었다` +
        ` (예: ${moved.slice(0, 3).join(", ")})`,
    );

  /**
   * 위 셋이 다 조용한데 합계만 다르면 그것도 움직인 것이다 — 문항별 지문은 12자로
   * 잘라 쓰므로 합계가 더 예민하다. 「사유를 못 짚겠다」를 «안 움직였다»로 읽지 않는다.
   */
  if (reasons.length === 0 && before.rowsHash !== after.rowsHash)
    reasons.push("문항 지문 합계가 바뀌었다 — 무엇인지는 못 짚었다");

  return reasons.length > 0 ? reasons.join(" · ") : null;
}

export function buildHeightCacheManifest(input: {
  kind: "first" | "continuation";
  rows: number;
  rowsHash: string;
  slotPx: number;
  measuredAt: string;
  rowDigests?: Record<string, string>;
  overlay?: string;
}): HeightCacheManifest {
  return {
    version: 1,
    kind: input.kind,
    rows: input.rows,
    inputsHash: pageInputsHash(),
    rowsHash: input.rowsHash,
    slotPx: input.slotPx,
    measuredAt: input.measuredAt,
    ...(input.overlay ? { overlay: input.overlay } : {}),
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
    overlay?: string;
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
  // 덧칠이 없으면 양쪽 다 `undefined` 라 «(없음)» 끼리 같다 — 기존 캐시와 호환된다.
  add("덧입힌 배치", manifest.overlay ?? "(없음)", now.overlay ?? "(없음)");
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
    overlay?: string;
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
