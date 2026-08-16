/**
 * 트랙 F · F-4 — **신규 행 적재.** 코디네이터 승인 후에만 돈다.
 *
 *   npx tsx scripts/qa/load-apply.ts                        확인만 (아무것도 안 넣는다)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/load-apply.ts --apply
 *
 * ## 승인 조건 넷을 코드가 강제한다 (2026-08-16)
 *
 * 1. **넣을 `externalId` 목록이 커밋돼 있어야 한다.** `scripts/qa/handoff/load-external-ids.json`
 *    (커밋본)과 방금 만든 `reports/…`(재생성본)이 **한 건이라도 다르면 넣지 않는다.**
 *    INSERT 는 백업이 아니라 이 목록이 되돌리는 수단이다.
 * 2. **적재 전후로 기존 행이 안 바뀌었는지 컬럼별로 본다.** B(`answer`)·D(`content`)·
 *    C(`externalId`·`reviewStatus`)가 같은 표에 동시에 쓰고 있어 남의 변경과 내 변경이
 *    섞여 보인다. 그래서 컬럼마다 갈라 세고, 내가 만졌어야 할 기존 행은 **0** 이어야 한다.
 * 3. **보기가 전부 그림인 행은 `pending` 으로 넣는다.** 트랙 A 가 그림을 붙이기 전에는
 *    `findEligibleProblems`(approved 만 본다)에 안 잡힌다.
 * 4. **멱등.** 이미 있는 `externalId` 는 건너뛴다. 두 번 돌리면 신규 0.
 *
 * ## 그리고 입력 corpus 지문을 본다
 *
 * 승인은 숫자에 붙는데 입력은 **남의 워크트리**(트랙 D)라 조용히 움직인다 —
 * 2026-08-16 에 실제로 승인 직후 재추출이 돌아 5,816 이 6,042 가 됐다.
 * 지문이 다르면 숫자가 승인받은 그 숫자가 아니므로 멈춘다.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { isDirectScript } from "../import/isDirectScript";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";
import { corpusFingerprint } from "./load-candidates";

const ROWS = "scripts/qa/reports/load-rows.json";
const IDS_FRESH = "scripts/qa/reports/load-external-ids.json";
const IDS_COMMITTED = "scripts/qa/handoff/load-external-ids.json";
const RESULT = "scripts/qa/reports/load-apply-result.json";

const IMPORT_USER_EMAIL = "import@todays-math.local";
const LOAD_LOCK_KEY = "todays-math/load-classified/v1";
const BATCH = 500;

/** 스냅샷에서 컬럼마다 따로 재는 값. 어떤 트랙이 만졌는지 갈라 보려는 것이다. */
const WATCHED = [
  "content",
  "answer",
  "solution",
  "reviewStatus",
  "figureUrls",
  "figureSource",
  "externalId",
  "questionType",
  "unitId",
  "problemType",
  "difficulty",
  "score",
  "directUseAllowed",
  "pool",
] as const;

/** 어느 트랙이 그 컬럼을 소유하는지 — 보고서에서 남의 변경을 내 것과 안 섞으려고 쓴다. */
const OWNER: Record<string, string> = {
  content: "트랙 D",
  answer: "트랙 B",
  externalId: "트랙 C",
  reviewStatus: "트랙 C",
  figureUrls: "트랙 A",
  figureSource: "트랙 A",
  questionType: "트랙 E",
};

/** 그 파일이 git 에 커밋돼 있고 워크트리와 같은가. 아니면 던진다. */
function assertCommitted(file: string): void {
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", file], {
    encoding: "utf8",
  });
  if (tracked.status !== 0) {
    throw new Error(
      `${file} 이 git 에 없습니다. 넣을 목록을 **커밋한 뒤** 적재해야 합니다(승인 조건 1).`,
    );
  }
  const dirty = spawnSync("git", ["diff", "--quiet", "HEAD", "--", file], {
    encoding: "utf8",
  });
  if (dirty.status !== 0) {
    throw new Error(
      `${file} 이 커밋 이후 바뀌었습니다. 되돌릴 근거가 커밋에 없습니다 — 다시 커밋하세요(승인 조건 1).`,
    );
  }
}

const h8 = (v: unknown): string =>
  createHash("sha1").update(JSON.stringify(v ?? null)).digest("hex").slice(0, 8);

export interface RowSnapshot {
  updatedAt: string;
  cols: Record<string, string>;
}

/** 기존 행 전량의 컬럼별 지문. 본문을 들고 있지 않고 해시만 남긴다. */
async function snapshot(
  prisma: { problem: { findMany: (args: unknown) => Promise<Record<string, unknown>[]> } },
): Promise<Map<string, RowSnapshot>> {
  const out = new Map<string, RowSnapshot>();
  for (let skip = 0; ; skip += 4000) {
    const page = (await prisma.problem.findMany({
      skip,
      take: 4000,
      orderBy: { id: "asc" },
      select: Object.fromEntries([
        ["id", true],
        ["updatedAt", true],
        ...WATCHED.map((c) => [c, true]),
      ]),
    })) as Array<Record<string, unknown>>;
    if (page.length === 0) break;
    for (const row of page) {
      out.set(String(row.id), {
        updatedAt: String(row.updatedAt),
        cols: Object.fromEntries(WATCHED.map((c) => [c, h8(row[c])])),
      });
    }
    if (page.length < 4000) break;
  }
  return out;
}

export async function runApply(apply: boolean): Promise<void> {
  // ── 관문은 네트워크·DB 접근 **앞**에 둔다 (tracks/README 공통규칙 2) ──────────
  const inspection = await inspectDatabaseTargets();
  const target = inspection.selected;
  const shared = allowSharedImport(target);
  if (apply && !target.canMigrateOrLoad && !shared) {
    console.log(
      `적재 차단 — ${target.reason}\n` +
        "공유 풀에 넣으려면 ALLOW_SHARED_IMPORT=1 을 명시하세요.",
    );
    return;
  }
  console.log(`대상 DB — ${target.kind} (${target.host ?? "?"}) · ${inspection.selectedSource}`);

  // ── 조건 1: 커밋된 목록과 재생성본이 같은가 ─────────────────────────────────
  const fresh = JSON.parse(await readFile(IDS_FRESH, "utf8")) as {
    총: number;
    externalIds: string[];
    출제보류_pending: string[];
    입력corpus: { fingerprint: string };
  };
  let committed: typeof fresh;
  try {
    committed = JSON.parse(await readFile(IDS_COMMITTED, "utf8")) as typeof fresh;
  } catch {
    throw new Error(
      `${IDS_COMMITTED} 가 없습니다. 넣을 externalId 목록을 **먼저 커밋**해야 합니다(승인 조건 1).`,
    );
  }
  // 조건은 "파일로 먼저 **커밋**" 이다. 파일만 있고 커밋이 안 됐으면 되돌릴 근거가
  // 워크트리에만 있다는 뜻이라 사고가 나면 같이 날아간다. git 에 물어본다.
  assertCommitted(IDS_COMMITTED);

  const freshSet = new Set(fresh.externalIds);
  const commitSet = new Set(committed.externalIds);
  const onlyFresh = fresh.externalIds.filter((id) => !commitSet.has(id));
  const onlyCommitted = committed.externalIds.filter((id) => !freshSet.has(id));
  if (onlyFresh.length > 0 || onlyCommitted.length > 0) {
    throw new Error(
      `커밋된 목록과 재생성본이 다릅니다 — 재생성에만 ${onlyFresh.length}건, 커밋본에만 ${onlyCommitted.length}건.\n` +
        `승인은 커밋된 목록에 붙는다. 드라이런을 다시 돌려 목록을 커밋하고 재승인을 받으세요.\n` +
        `  재생성 표본: ${onlyFresh.slice(0, 5).join(", ")}\n` +
        `  커밋본 표본: ${onlyCommitted.slice(0, 5).join(", ")}`,
    );
  }

  // ── 입력 corpus 지문 ────────────────────────────────────────────────────────
  const corpus = await corpusFingerprint();
  if (committed.입력corpus?.fingerprint !== corpus.fingerprint) {
    throw new Error(
      `입력 corpus 가 바뀌었습니다 — 커밋본 ${committed.입력corpus?.fingerprint} ≠ 현재 ${corpus.fingerprint}.\n` +
        "트랙 D 산출물이 다시 쓰였습니다. 드라이런부터 다시 돌리고 재승인을 받으세요.",
    );
  }
  console.log(
    `목록 대조 통과 — ${fresh.총}행 · corpus ${corpus.fingerprint} (${corpus.files}편)`,
  );

  const rows = JSON.parse(await readFile(ROWS, "utf8")) as Array<
    Record<string, unknown> & { externalId: string; reviewStatus: string }
  >;
  if (rows.length !== fresh.총 || rows.some((r) => !freshSet.has(r.externalId))) {
    throw new Error(`${ROWS} 가 목록과 맞지 않습니다 (행 ${rows.length} vs 목록 ${fresh.총}).`);
  }
  const pendingCount = rows.filter((r) => r.reviewStatus === "pending").length;
  if (pendingCount !== committed.출제보류_pending.length) {
    throw new Error(
      `출제보류 행 수가 목록과 다릅니다 — 행 ${pendingCount} vs 목록 ${committed.출제보류_pending.length} (승인 조건 3).`,
    );
  }

  if (!apply) {
    console.log(
      `\n확인만 했습니다. 넣지 않았습니다.\n` +
        `  넣을 행 ${rows.length} (그중 pending ${pendingCount})\n` +
        `  적재하려면 ALLOW_SHARED_IMPORT=1 ... --apply`,
    );
    return;
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.upsert({
      where: { email: IMPORT_USER_EMAIL },
      update: {},
      create: { email: IMPORT_USER_EMAIL, name: "이관 계정" },
      select: { id: true },
    });

    // ── 조건 2: 적재 **전** 스냅샷 ────────────────────────────────────────────
    console.log("적재 전 스냅샷…");
    const before = await snapshot(prisma as never);
    const totalBefore = before.size;

    // 이미 있는 externalId 는 건너뛴다 (조건 4 멱등).
    const present = new Set<string>();
    const ids = rows.map((r) => r.externalId);
    for (let i = 0; i < ids.length; i += 1000) {
      const found = await prisma.problem.findMany({
        where: { externalId: { in: ids.slice(i, i + 1000) } },
        select: { externalId: true },
      });
      for (const f of found) if (f.externalId) present.add(f.externalId);
    }
    const toInsert = rows.filter((r) => !present.has(r.externalId));
    console.log(
      `기존 ${totalBefore}행 · 넣을 후보 ${rows.length} · 이미 있음 ${present.size} → 실제 INSERT ${toInsert.length}`,
    );

    let inserted = 0;
    if (toInsert.length > 0) {
      await prisma.$transaction(
        async (tx) => {
          // 다른 프로세스가 같이 돌아도 둘 다 "없음" 을 보고 중복 삽입하지 않게 한다.
          // ⚠️ `$queryRaw` 로 부르면 반환형 void 를 역직렬화하다 죽는다(원장 §7).
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOAD_LOCK_KEY}))`;
          for (let i = 0; i < toInsert.length; i += BATCH) {
            const chunk = toInsert.slice(i, i + BATCH).map((r) => ({ ...r, userId: user.id }));
            const res = await tx.problem.createMany({
              data: chunk as never,
              skipDuplicates: true,
            });
            inserted += res.count;
          }
        },
        { maxWait: 15_000, timeout: 600_000 },
      );
    }

    // ── 조건 2: 적재 **후** 스냅샷 + 컬럼별 대조 ──────────────────────────────
    console.log("적재 후 스냅샷…");
    const after = await snapshot(prisma as never);

    const changedByCol: Record<string, number> = {};
    let touchedRows = 0;
    let updatedAtChanged = 0;
    let vanished = 0;
    for (const [id, b] of before) {
      const a = after.get(id);
      if (!a) {
        vanished += 1;
        continue;
      }
      if (a.updatedAt !== b.updatedAt) updatedAtChanged += 1;
      let touched = false;
      for (const col of WATCHED) {
        if (a.cols[col] !== b.cols[col]) {
          changedByCol[col] = (changedByCol[col] ?? 0) + 1;
          touched = true;
        }
      }
      if (touched) touchedRows += 1;
    }
    const totalAfter = after.size;
    const delta = totalAfter - totalBefore;

    const result = {
      생성시각: new Date().toISOString(),
      입력corpus: corpus,
      대상DB: { kind: target.kind, host: target.host },
      넣을행: rows.length,
      이미있어건너뜀: present.size,
      실제INSERT: inserted,
      pending으로넣은행: rows.filter((r) => r.reviewStatus === "pending").map((r) => r.externalId),
      총행: { 전: totalBefore, 후: totalAfter, 증가: delta },
      기존행_사라짐: vanished,
      기존행_updatedAt바뀜: updatedAtChanged,
      기존행_컬럼바뀜: Object.fromEntries(
        Object.entries(changedByCol).map(([c, n]) => [c, { 행: n, 소유: OWNER[c] ?? "(공용)" }]),
      ),
      기존행_하나라도바뀜: touchedRows,
      판정: {
        "총행 증가 == INSERT": delta === inserted,
        "기존 행 사라짐 0": vanished === 0,
      },
    };
    await writeFile(RESULT, JSON.stringify(result, null, 1), "utf8");

    console.log("\n── F-4 적재 결과 ──");
    console.log(`실제 INSERT ${inserted} · 이미 있어 건너뜀 ${present.size}`);
    console.log(`총행 ${totalBefore} → ${totalAfter} (증가 ${delta})`);
    console.log(
      `총행 증가 == INSERT ? ${delta === inserted ? "예" : `아니오 (${delta} vs ${inserted})`}`,
    );
    console.log(`기존 행 사라짐 ${vanished}`);
    console.log(`\n기존 행 변경 — updatedAt 바뀐 행 ${updatedAtChanged} · 컬럼별:`);
    if (Object.keys(changedByCol).length === 0) {
      console.log("  없음 — 기존 행은 한 컬럼도 안 바뀌었다.");
    } else {
      for (const [col, n] of Object.entries(changedByCol).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${col.padEnd(16)} ${String(n).padStart(6)}  ← ${OWNER[col] ?? "(공용)"}`);
      }
      console.log(
        "  ↑ 트랙 F 는 기존 행을 UPDATE 하지 않는다. 여기 잡힌 것은 동시에 도는 다른 트랙의 변경이다.",
      );
    }
    console.log(`\n상세 → ${RESULT}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  runApply(process.argv.includes("--apply")).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
