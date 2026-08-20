/**
 * **DB 가 가리키는 그림이 배포본에 있는가** — 밀기 전에 스스로 알리는 자리.
 *
 * ## 왜 이 검사가 있나
 *
 * 2026-08-20, 원장님이 production 에서 `J10201-NG7U`·`J10201-WLBH` 의 그림이 안
 * 보인다고 하셨다. 파일이 상한 게 아니라 **안 밀어서**였다 — `origin/main` 이 로컬보다
 * 73커밋 뒤라 그림 96장이 배포에 없었다. 걸린 문항 **90건**(전부 출제 가능).
 *
 * 이건 실수가 아니라 **구조**다:
 *
 * ```
 *   공유 DB(D-31)  ──  모든 세션이 같이 쓴다 → 즉시 최신
 *   그림 파일       ──  git 에 있다          → 밀어야 간다
 * ```
 *
 * 그래서 문항을 이관하거나 그림을 회수하면 그 순간 production 의 DB 는 그 URL 을 알고
 * 배포본에는 파일이 없다. **코드를 한 줄도 안 고쳐도 깨진다.** 그리고 이 결함은 스스로
 * 신고하지 않는다 — 500도 아니고 로그도 안 남는다. 그냥 그림 자리가 빈다. 원장님이
 * 화면에서 찾아 줄 때까지 지표는 0이다.
 *
 * ## 무엇과 대조하나 — 참은 **바깥 둘**에서 온다
 *
 * 한쪽은 **공유 DB**, 다른 쪽은 **git 트리**다. 둘 다 이 스크립트가 만들지 않는다.
 * (이 저장소가 여러 번 당한 자리 — 판정의 참이 판정 대상에서 나오면 안 된다.)
 *
 *   npx tsx scripts/qa/checkDeployedFigures.ts              # 지금 배포된 것(origin/main)
 *   npx tsx scripts/qa/checkDeployedFigures.ts --ref HEAD   # 밀 커밋이 충분한가
 *   npx tsx scripts/qa/checkDeployedFigures.ts --local      # 내 작업 트리 (어디서나 깨지나)
 *
 * 그림이 하나라도 빠지면 **0이 아닌 코드로 끝난다** — 훅·CI 가 막을 수 있게.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { isDirectScript } from "../import/isDirectScript";

/**
 * 그림 파일 경로를 담는 컬럼. **손으로 적은 목록이라 샌다** — 그래서
 * `assertFigureColumns` 가 DB 를 훑어 실제와 다르면 멈춘다. 새 컬럼이 생겼는데
 * 여기 안 적히면 그 컬럼의 그림은 검사에서 **구조적으로 0**이 된다.
 */
export const FIGURE_URL_COLUMNS = [
  { table: "problem", column: "figure_urls" },
] as const;

/**
 * DB 의 그림 URL → 저장소 안의 파일 경로. 저장소 파일이 아니면 `null`.
 *
 * ⚠️ 바깥 주소(`https:`·`data:`)에 억지로 경로를 붙이면 「배포에 없다」로 **잘못**
 *    잡는다. 「모른다」와 「없다」를 뭉개지 않는다.
 */
export function figureRepoPath(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed.startsWith("/")) return null; // https: · data: · 상대경로
  return `public/${trimmed.replace(/^\/+/, "")}`;
}

export interface FigureRow {
  code: string;
  figureUrls: readonly string[];
  ok: boolean;
}

export interface BrokenRow {
  code: string;
  ok: boolean;
  missing: string[];
}

/**
 * 배포본에 **없는** 그림을 쓰는 문항. `present` 는 저장소 경로 집합이며,
 * **크기 0인 파일은 넣지 않는다** — 배포돼도 그림이 안 그려지므로 없는 것과 같다.
 */
export function brokenRows(
  rows: readonly FigureRow[],
  present: ReadonlySet<string>,
): BrokenRow[] {
  const out: BrokenRow[] = [];
  for (const row of rows) {
    const missing = row.figureUrls.filter((url) => {
      const repoPath = figureRepoPath(url);
      return repoPath !== null && !present.has(repoPath);
    });
    if (missing.length > 0)
      out.push({ code: row.code, ok: row.ok, missing: [...missing] });
  }
  return out;
}

/**
 * `git ls-tree -r -l` 출력을 파일 집합으로. **크기 0인 blob 은 안 넣는다** —
 * 배포돼도 그림이 안 그려지므로 «있다»로 세면 거짓 안심이 된다.
 * (git 을 부르는 쪽과 갈라 두어야 이 규칙을 시험할 수 있다. 시험할 수 없는 가드는
 *  장식이다 — CLAUDE.md 2026-08-18.)
 */
export function presentFilesFromLsTree(raw: string): Set<string> {
  const files = new Set<string>();
  for (const line of raw.split("\n")) {
    // <mode> <type> <sha> <size>\t<path>
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const size = Number(line.slice(0, tab).trim().split(/\s+/)[3]);
    if (!Number.isFinite(size) || size <= 0) continue;
    files.add(line.slice(tab + 1).replace(/\\/g, "/"));
  }
  return files;
}

/**
 * **훑을 뿌리 디렉터리를 DB 의 URL 에서 뽑는다.**
 *
 * 🔴 여기를 손으로 적으면 안 된다. 처음엔 pathspec 을 `public/figures` 하나로
 *    박아 뒀는데, SVG 채택이 `/figures-svg/…` 를 쓰기 시작하자 git 이 그 뿌리를
 *    **아예 안 봐서** 멀쩡한 716문항이 「배포에 없다」로 나왔다(2026-08-20).
 *    git pathspec 은 경로 «조각» 단위라 `public/figures` 는 `public/figures-svg`
 *    를 **안 덮는다** — 접두사처럼 생겨서 덮을 것 같지만 아니다.
 *
 * 그리고 이 부류는 침묵보다 나쁘다. 밀 때마다 716건이 빨갛게 나오면 다음 사람은
 * 훅을 우회하고, 그때부터 진짜 결함도 같이 안 보인다. **거짓 경보는 가드를 끈다.**
 */
export function figureRoots(urls: Iterable<string>): string[] {
  const roots = new Set<string>();
  for (const url of urls) {
    const repoPath = figureRepoPath(url);
    if (!repoPath) continue;
    const seg = repoPath.split("/");
    if (seg.length >= 2 && seg[1]) roots.add(`${seg[0]}/${seg[1]}`);
  }
  return [...roots].sort();
}

/** git 트리에 실제로 들어 있는 그림 파일(크기 0 제외). */
export function treeFigureFiles(
  ref: string,
  roots: readonly string[],
): Set<string> {
  if (roots.length === 0) return new Set();
  let raw: string;
  try {
    raw = execFileSync(
      "git",
      ["ls-tree", "-r", "-l", "--full-name", ref, "--", ...roots],
      { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 },
    );
  } catch {
    throw new Error(
      `git 참조 «${ref}» 를 읽을 수 없다 — origin/main 이면 먼저 ` +
        "`git fetch origin`" +
        ` 하라. 확인 못 한 것을 «괜찮다»로 넘기지 않는다.`,
    );
  }
  return presentFilesFromLsTree(raw);
}

/** 작업 트리에 실제로 있는 그림 파일(크기 0 제외). */
export function localFigureFiles(urls: Iterable<string>): Set<string> {
  const files = new Set<string>();
  for (const url of urls) {
    const repoPath = figureRepoPath(url);
    if (!repoPath) continue;
    const full = path.join(process.cwd(), repoPath);
    if (existsSync(full) && statSync(full).size > 0) files.add(repoPath);
  }
  return files;
}

/**
 * **컬럼 목록이 샜는지 DB 에 물어본다.** 텍스트·텍스트배열 컬럼을 전부 훑어
 * `/figures/…` 값을 담은 컬럼을 찾고, `FIGURE_URL_COLUMNS` 와 다르면 멈춘다.
 * (손으로 쓴 목록은 새 컬럼이 생기면 조용히 눈이 먼다 — CLAUDE.md 2026-08-18.)
 */
export async function assertFigureColumns(prisma: PrismaClient): Promise<void> {
  const candidates = (await prisma.$queryRawUnsafe(
    `SELECT table_name AS "table", column_name AS "column", data_type AS "type"
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (data_type IN ('text','character varying')
             OR (data_type = 'ARRAY' AND udt_name IN ('_text','_varchar')))
      ORDER BY table_name, column_name`,
  )) as Array<{ table: string; column: string; type: string }>;

  const found: string[] = [];
  for (const c of candidates) {
    const t = `"${c.table}"`;
    const col = `"${c.column}"`;
    const sql =
      c.type === "ARRAY"
        ? `SELECT EXISTS (SELECT 1 FROM ${t}, unnest(${col}) AS v WHERE v LIKE '/figures%') AS hit`
        : `SELECT EXISTS (SELECT 1 FROM ${t} WHERE ${col} LIKE '/figures%') AS hit`;
    const [row] = (await prisma.$queryRawUnsafe(sql)) as Array<{
      hit: boolean;
    }>;
    if (row?.hit) found.push(`${c.table}.${c.column}`);
  }

  const known = FIGURE_URL_COLUMNS.map((c) => `${c.table}.${c.column}`).sort();
  const actual = [...found].sort();
  if (JSON.stringify(known) !== JSON.stringify(actual))
    throw new Error(
      `그림 URL 을 담은 컬럼이 달라졌다 — 아는 것 [${known.join(", ")}] · DB 에 실제로 있는 것 [${actual.join(", ")}]. ` +
        `FIGURE_URL_COLUMNS 와 질의를 같이 고쳐라. 안 고치면 새 컬럼의 그림은 이 검사에서 **구조적으로 0**이 된다.`,
    );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--ref");
  const useLocal = argv.includes("--local");
  const ref = at >= 0 ? argv[at + 1]! : "origin/main";

  const prisma = new PrismaClient();
  try {
    await assertFigureColumns(prisma);

    const rows = (await prisma.$queryRawUnsafe(
      `SELECT problem_code AS code, figure_urls AS "figureUrls",
              direct_use_allowed AS ok
         FROM problem WHERE array_length(figure_urls, 1) > 0`,
    )) as FigureRow[];

    const allUrls = rows.flatMap((r) => r.figureUrls);
    const roots = figureRoots(allUrls);
    const where = useLocal ? "내 작업 트리" : `배포본(${ref})`;
    const present = useLocal
      ? localFigureFiles(allUrls)
      : treeFigureFiles(ref, roots);
    const broken = brokenRows(rows, present);

    console.log(
      `그림을 쓰는 문항 ${rows.length.toLocaleString()}건 · 대조 대상 ${where}`,
    );
    // 무엇을 훑었는지 찍는다 — 뿌리를 놓치면 그 아래가 통째로 «없다»가 된다.
    console.log(`   훑은 뿌리: ${roots.join(" · ")}`);
    if (broken.length === 0) {
      console.log("✅ 빠진 그림 없음.");
      return;
    }

    const files = new Set(broken.flatMap((b) => b.missing));
    const usable = broken.filter((b) => b.ok).length;
    console.log(
      `🔴 그림이 깨지는 문항 ${broken.length.toLocaleString()}건 (출제 가능 ${usable.toLocaleString()}건) · 빠진 파일 ${files.size.toLocaleString()}장`,
    );
    for (const b of broken.slice(0, 10))
      console.log(`   ${b.code}  ${b.missing.join(", ")}`);
    if (broken.length > 10)
      console.log(`   … 그리고 ${(broken.length - 10).toLocaleString()}건 더`);
    console.log(
      useLocal
        ? "\n작업 트리에도 없다 — 이건 배포로 안 고쳐진다. 그림 회수(문서 16)를 봐야 한다."
        : `\n${ref} 에 그 파일이 없다. 밀면 들어간다 — \`git push origin main\`.`,
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  void main();
}
