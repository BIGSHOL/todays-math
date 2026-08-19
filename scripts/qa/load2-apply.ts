/**
 * 트랙 F 2차 — **신규 행 적재.** 코디네이터 승인 후에만 돈다.
 *
 *   npx tsx scripts/qa/load2-apply.ts                        확인만 (아무것도 안 넣는다)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/load2-apply.ts --apply
 *
 * ## 승인 조건 다섯을 코드가 강제한다 (2026-08-17)
 *
 * 1. **넣을 `externalId` 목록과 입력 corpus 지문이 커밋돼 있어야 한다.**
 *    `scripts/qa/handoff/load2-external-ids.json`(커밋본)과 방금 만든
 *    `reports/…`(재생성본)이 **한 건이라도 다르면 넣지 않는다.**
 *    INSERT 는 백업이 아니라 이 목록이 되돌리는 수단이다.
 * 2. **입력 corpus 지문이 다르면 멈춘다.** 1차 때 실제로 승인 직후 트랙 D 가
 *    `hwp-latex/` 를 통째로 다시 써서 5,816 이 6,042 가 됐다. 우회하지 않는다 —
 *    지문이 달라졌으면 목록을 새로 만들고 **재승인**을 받는다.
 * 3. **`unitId` 는 트랙 G 판정 그대로.** 다시 판정하지 않는다. 다만 넣기 직전에
 *    그 `unitId` 가 `Unit` 에 실재하는지, 문항 학년과 단원 학년이 맞는지 다시 본다.
 *    (후보 생성 단계에서도 보지만, 그 사이 `Unit` 이 바뀌었을 수 있다.)
 * 4. **`figureUrls` 는 비워서 넣는다.** 그림은 트랙 A 컬럼이다.
 * 5. **적재 전후로 기존 행이 안 바뀌었는지 컬럼별로 본다.** 총행 증가 == INSERT 도 함께.
 *
 * 멱등: 이미 있는 `externalId` 는 건너뛴다. 두 번 돌리면 신규 0.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { isDirectScript } from "../import/isDirectScript";
import {
  syncExamMetadata,
  type SyncExamResult,
} from "../../src/lib/import/syncExamMetadata";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";
import { corpusFingerprint } from "./load-candidates";

const ROWS = "scripts/qa/reports/load2-rows.json";
const IDS_FRESH = "scripts/qa/reports/load2-external-ids.json";
const IDS_COMMITTED = "scripts/qa/handoff/load2-external-ids.json";
const RESULT = "scripts/qa/reports/load2-apply-result.json";

const IMPORT_USER_EMAIL = "import@todays-math.local";
/** 1차와 **같은 열쇠**를 쓴다 — 두 적재가 겹쳐 돌아도 서로를 기다리게 하려는 것이다. */
const LOAD_LOCK_KEY = "todays-math/load-classified/v1";
const BATCH = 500;

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
      `${file} 이 git 에 없습니다. 넣을 목록을 **커밋한 뒤** 적재해야 합니다(조건 1).`,
    );
  }
  const dirty = spawnSync("git", ["diff", "--quiet", "HEAD", "--", file], {
    encoding: "utf8",
  });
  if (dirty.status !== 0) {
    throw new Error(
      `${file} 이 커밋 이후 바뀌었습니다. 되돌릴 근거가 커밋에 없습니다 — 다시 커밋하세요(조건 1).`,
    );
  }
}

const h8 = (v: unknown): string =>
  createHash("sha1")
    .update(JSON.stringify(v ?? null))
    .digest("hex")
    .slice(0, 8);

export interface RowSnapshot {
  updatedAt: string;
  cols: Record<string, string>;
}

/** 기존 행 전량의 컬럼별 지문. 본문을 들고 있지 않고 해시만 남긴다. */
async function snapshot(prisma: {
  problem: { findMany: (args: unknown) => Promise<Record<string, unknown>[]> };
}): Promise<Map<string, RowSnapshot>> {
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

interface LoadRow2 {
  externalId: string;
  unitId: string;
  reviewStatus: string;
  figureUrls: string[];
  examId: string | null;
  school: string | null;
  subject: string | null;
  sourceFile: string | null;
}

export async function runApply2(apply: boolean): Promise<void> {
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
  console.log(
    `대상 DB — ${target.kind} (${target.host ?? "?"}) · ${inspection.selectedSource}`,
  );

  // ── 조건 1: 커밋된 목록과 재생성본이 같은가 ─────────────────────────────────
  const fresh = JSON.parse(await readFile(IDS_FRESH, "utf8")) as {
    총: number;
    externalIds: string[];
    출제보류_pending: string[];
    입력corpus: { fingerprint: string };
    판정: Array<{ externalId: string; unitId: string; 학년?: string | null }>;
  };
  let committed: typeof fresh;
  try {
    committed = JSON.parse(
      await readFile(IDS_COMMITTED, "utf8"),
    ) as typeof fresh;
  } catch {
    throw new Error(
      `${IDS_COMMITTED} 가 없습니다. 넣을 externalId 목록을 **먼저 커밋**해야 합니다(조건 1).`,
    );
  }
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

  // 판정(외부ID → unitId)이 커밋본과 같은가. 목록은 같은데 단원만 바뀌면 조용히 틀린다.
  const commitUnit = new Map(
    committed.판정.map((p) => [p.externalId, p.unitId]),
  );
  const unitDrift = fresh.판정.filter(
    (p) => commitUnit.get(p.externalId) !== p.unitId,
  );
  if (unitDrift.length > 0) {
    throw new Error(
      `판정 unitId 가 커밋본과 다릅니다 — ${unitDrift.length}건.\n` +
        `트랙 G 판정 파일이 다시 쓰였습니다. 드라이런부터 다시 돌리고 재승인을 받으세요.\n` +
        `  표본: ${unitDrift
          .slice(0, 5)
          .map((p) => p.externalId)
          .join(", ")}`,
    );
  }

  // ── 조건 2: 입력 corpus 지문 ────────────────────────────────────────────────
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

  const rows = JSON.parse(await readFile(ROWS, "utf8")) as LoadRow2[];
  if (
    rows.length !== fresh.총 ||
    rows.some((r) => !freshSet.has(r.externalId))
  ) {
    throw new Error(
      `${ROWS} 가 목록과 맞지 않습니다 (행 ${rows.length} vs 목록 ${fresh.총}).`,
    );
  }
  const pendingCount = rows.filter((r) => r.reviewStatus === "pending").length;
  if (pendingCount !== committed.출제보류_pending.length) {
    throw new Error(
      `출제보류 행 수가 목록과 다릅니다 — 행 ${pendingCount} vs 목록 ${committed.출제보류_pending.length}.`,
    );
  }
  // 조건 4 — 그림은 트랙 A 컬럼이다. 비어 있지 않으면 넣지 않는다.
  const withFigures = rows.filter((r) => (r.figureUrls ?? []).length > 0);
  if (withFigures.length > 0) {
    throw new Error(
      `figureUrls 가 채워진 행이 ${withFigures.length} 있습니다. 그림은 트랙 A 컬럼입니다(조건 4).`,
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
    // ── 조건 3: unitId 가 실재하고 학년이 맞는가 (넣기 직전 다시 본다) ────────
    const units = await prisma.unit.findMany({
      select: { id: true, grade: true, chapter: true, section: true },
    });
    const unitById = new Map(units.map((u) => [u.id, u]));
    const badUnit = rows.filter((r) => !unitById.has(r.unitId));
    if (badUnit.length > 0) {
      throw new Error(
        `Unit 에 없는 unitId 를 쓰는 행이 ${badUnit.length} 있습니다(조건 3). ` +
          `표본: ${badUnit
            .slice(0, 5)
            .map((r) => r.externalId)
            .join(", ")}`,
      );
    }
    // 커밋본에 박아 둔 «시험지 학년» 과 배정 단원의 학년이 맞는가. 후보 생성 때도 봤지만
    // 그 사이 `Unit` 이 바뀌었을 수 있으므로 넣기 직전에 다시 본다.
    const gradeOf = new Map(
      committed.판정.map((p) => [p.externalId, p.학년 ?? null]),
    );
    const badGrade = rows.filter((r) => {
      const g = gradeOf.get(r.externalId) ?? null;
      return g !== null && g !== unitById.get(r.unitId)!.grade;
    });
    if (badGrade.length > 0) {
      throw new Error(
        `문항 학년과 단원 학년이 어긋나는 행이 ${badGrade.length} 있습니다(조건 3). ` +
          `표본: ${badGrade
            .slice(0, 5)
            .map((r) => r.externalId)
            .join(", ")}`,
      );
    }

    const user = await prisma.user.upsert({
      where: { email: IMPORT_USER_EMAIL },
      update: {},
      create: { email: IMPORT_USER_EMAIL, name: "이관 계정" },
      select: { id: true },
    });

    // ── 조건 5: 적재 **전** 스냅샷 ────────────────────────────────────────────
    console.log("적재 전 스냅샷…");
    const before = await snapshot(prisma as never);
    const totalBefore = before.size;

    // 이미 있는 externalId 는 건너뛴다 (멱등).
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
    // 콜백 안에서만 채워지므로 홀더에 담는다(그러지 않으면 TS 가 null 로 좁힌다).
    const examState: { result: SyncExamResult | null } = { result: null };
    if (toInsert.length > 0) {
      await prisma.$transaction(
        async (tx) => {
          // ⚠️ `$queryRaw` 로 부르면 반환형 void 를 역직렬화하다 죽는다(원장 §7).
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOAD_LOCK_KEY}))`;
          for (let i = 0; i < toInsert.length; i += BATCH) {
            const chunk = toInsert
              .slice(i, i + BATCH)
              .map((r) => ({ ...r, userId: user.id }));
            // exam-wiring: 기출·배선됨 — 적재 직후 syncExamMetadata 로 그 편의 Exam 을 세운다
            const res = await tx.problem.createMany({
              data: chunk as never,
              skipDuplicates: true,
            });
            inserted += res.count;
          }
          // 기출이 들어왔으면 그 **시험지**(Exam/ExamQuestion)도 함께 세운다.
          // 이 스크립트는 재실행 가능하므로 배선이 여기에도 있어야 한다 —
          // 없으면 이 경로로 들어온 편만 조용히 Exam 없이 남는다.
          const examIds = [
            ...new Set(
              toInsert
                .map((r) => (r as { examId?: string | null }).examId)
                .filter(
                  (id): id is string => typeof id === "string" && id.length > 0,
                ),
            ),
          ];
          examState.result = await syncExamMetadata(
            tx as unknown as Parameters<typeof syncExamMetadata>[0],
            examIds,
          );
        },
        { maxWait: 15_000, timeout: 600_000 },
      );
    }

    const examSync = examState.result;
    if (examSync) {
      // 조용히 넘어가지 않는다 — 확정 못 한 편을 수와 사유로 남긴다.
      console.log(
        `기출 시험지(Exam): 신규 ${examSync.inserted} · 갱신 ${examSync.updated}` +
          ` · 미분류 ${examSync.unclassified.length} · 제외(대비) ${examSync.excluded.length}` +
          ` · 자연키충돌 ${examSync.collided.length}`,
      );
      for (const u of examSync.unclassified.slice(0, 10)) {
        console.log(`  [미분류] examId=${u.examId} — ${u.reason}`);
      }
    }

    // ── 조건 5: 적재 **후** 스냅샷 + 컬럼별 대조 ──────────────────────────────
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
      차수: "2차 (트랙 G 소단원 판정분 · A안)",
      입력corpus: corpus,
      대상DB: { kind: target.kind, host: target.host },
      넣을행: rows.length,
      이미있어건너뜀: present.size,
      실제INSERT: inserted,
      pending으로넣은행: rows
        .filter((r) => r.reviewStatus === "pending")
        .map((r) => r.externalId),
      총행: { 전: totalBefore, 후: totalAfter, 증가: delta },
      기존행_사라짐: vanished,
      기존행_updatedAt바뀜: updatedAtChanged,
      기존행_컬럼바뀜: Object.fromEntries(
        Object.entries(changedByCol).map(([c, n]) => [
          c,
          { 행: n, 소유: OWNER[c] ?? "(공용)" },
        ]),
      ),
      기존행_하나라도바뀜: touchedRows,
      판정: {
        "총행 증가 == INSERT": delta === inserted,
        "기존 행 사라짐 0": vanished === 0,
        "기존 행 안 바뀜": touchedRows === 0,
      },
    };
    await writeFile(RESULT, JSON.stringify(result, null, 1), "utf8");

    console.log("\n── 2차 적재 결과 ──");
    console.log(`실제 INSERT ${inserted} · 이미 있어 건너뜀 ${present.size}`);
    console.log(`총행 ${totalBefore} → ${totalAfter} (증가 ${delta})`);
    console.log(
      `총행 증가 == INSERT ? ${delta === inserted ? "예" : `아니오 (${delta} vs ${inserted})`}`,
    );
    console.log(`기존 행 사라짐 ${vanished}`);
    console.log(
      `\n기존 행 변경 — updatedAt 바뀐 행 ${updatedAtChanged} · 컬럼별:`,
    );
    if (Object.keys(changedByCol).length === 0) {
      console.log("  없음 — 기존 행은 한 컬럼도 안 바뀌었다.");
    } else {
      for (const [col, n] of Object.entries(changedByCol).sort(
        (a, b) => b[1] - a[1],
      )) {
        console.log(
          `  ${col.padEnd(16)} ${String(n).padStart(6)}  ← ${OWNER[col] ?? "(공용)"}`,
        );
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
  runApply2(process.argv.includes("--apply")).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
