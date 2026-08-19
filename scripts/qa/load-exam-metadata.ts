/**
 * 기출 메타데이터 적재 — `Exam` / `ExamQuestion`.
 *
 *   npx tsx scripts/qa/build-exam-metadata.ts                       ① 후보 생성(읽기 전용)
 *   npx tsx scripts/qa/load-exam-metadata.ts                        ② 드라이런 (아무것도 안 넣는다)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/load-exam-metadata.ts --apply
 *
 * ## 규칙
 *
 * 1. **드라이런이 기본이다.** `--apply` 와 `ALLOW_SHARED_IMPORT=1` 이 **둘 다** 있을 때만
 *    공유 DB(D-31)에 쓴다. 게이트 판정은 PrismaClient 를 만들기 **전에** 끝낸다.
 * 2. **되돌리기 자료를 DB 보다 먼저 쓴다.** 넣은 `externalExamId` 목록이 되돌리는 수단이다
 *    (INSERT 는 백업이 아니다). 경로는 **커밋되는 곳**이어야 한다 —
 *    `scripts/qa/reports/` 는 통째로 무시되므로 쓰면 이 컴퓨터에만 남는다
 *    (CLAUDE.md 2026-08-18 「되돌리기가 이 컴퓨터에만 있었다」).
 * 3. **멱등.** `loadExamPaper` 가 `externalExamId` 로 upsert 하고 문항은 편 단위로
 *    지우고 다시 넣는다. 두 번 돌리면 신규 0 · 갱신 N.
 * 4. **적재기를 새로 만들지 않는다.** T7.3 `scripts/predictor/load-exams.ts` 의
 *    `loadExamPaper` 를 그대로 쓴다(계약 검증·트랜잭션·멱등이 이미 테스트돼 있다).
 * 5. ⭐ **후보에서 빠진 편은 지운다.** 판정 규칙이 엄해지면 어제 넣은 편이 오늘 미분류가
 *    된다. 그냥 두면 「우리가 판단할 수 없다고 결론 낸 시험지」로 예측기가 계속 학습한다 —
 *    오류도 안 나고 숫자도 안 줄어 **아무도 모른다**. 그래서 직전 원장에 있었는데 이번
 *    후보에 없는 `externalExamId` 를 지우고 그 수를 보고한다(`exam_question` 은 Cascade).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { ExamPaper } from "../../src/contracts/predictor.contract";
import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { isDirectScript } from "../import/isDirectScript";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";
import { loadExamPaper } from "../predictor/load-exams";

const CANDIDATES = "scripts/qa/reports/exam-metadata/candidates.json";
/** ⚠️ 커밋되는 경로여야 한다 — 되돌리기 자료가 이 컴퓨터에만 있으면 되돌릴 수 없다. */
const LEDGER_DIR = "scripts/qa/handoff";
/**
 * **넣으려는 목록**(계획). 드라이런에서도 쓰므로 DB 를 건드리기 전에 커밋할 수 있다.
 * 되돌리기는 이 목록으로 한다.
 */
const PLAN = `${LEDGER_DIR}/exam-metadata-plan.json`;
/**
 * **지금 DB 에 들어 있는 목록**(원장). `--apply` 로 실제로 쓴 뒤에만 갱신한다.
 *
 * ⚠️ 계획과 원장을 한 파일로 두면 안 된다 — 드라이런이 원장을 덮어써서
 * 「어제 넣었는데 오늘 후보가 아닌 편」을 가려낼 근거가 사라진다(실제로 한 번 그랬다).
 */
const LEDGER = `${LEDGER_DIR}/exam-metadata-loaded.json`;

function writeList(path: string, note: string, papers: ExamPaper[]): void {
  mkdirSync(LEDGER_DIR, { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        note,
        count: papers.length,
        externalExamIds: papers.map((p) => p.externalExamId).sort(),
      },
      null,
      1,
    ),
    "utf-8",
  );
}

const PLAN_NOTE =
  "넣으려는 목록(계획). 되돌리려면 이 externalExamId 로 exam 을 지운다" +
  " (exam_question 은 onDelete: Cascade 로 함께 지워진다).";
const LEDGER_NOTE =
  "지금 DB 에 들어 있는 목록(원장). --apply 로 실제로 쓴 뒤에만 갱신한다.";

function readLoadedLedger(): string[] {
  try {
    const raw = JSON.parse(readFileSync(LEDGER, "utf-8")) as {
      externalExamIds?: string[];
    };
    return raw.externalExamIds ?? [];
  } catch {
    return [];
  }
}

export interface LoadExamMetadataSummary {
  applied: boolean;
  reason: string;
  candidates: number;
  inserted: number;
  updated: number;
  invalid: number;
  failed: number;
  /** 직전 원장에 있었는데 이번 후보에서 빠져 **지운** 편. 조용히 남겨 두지 않는다. */
  pruned: number;
  prunedKeys: string[];
  ledger: string;
  plan: string;
}

export async function loadExamMetadata(options: {
  apply: boolean;
}): Promise<LoadExamMetadataSummary> {
  const papers = JSON.parse(readFileSync(CANDIDATES, "utf-8")) as ExamPaper[];
  // 원장을 덮어쓰기 **전에** 읽는다 — 이게 「어제 넣었는데 오늘 후보가 아닌 편」의 근거다.
  const previous = readLoadedLedger();
  const current = new Set(papers.map((p) => p.externalExamId));
  const prunedKeys = previous.filter((k) => !current.has(k));
  const base = {
    candidates: papers.length,
    inserted: 0,
    updated: 0,
    invalid: 0,
    failed: 0,
    pruned: 0,
    prunedKeys,
    ledger: LEDGER,
    plan: PLAN,
  };

  // 되돌리기 자료는 **드라이런에서도** 쓴다 — 그래야 DB 를 건드리기 **전에** 커밋할 수 있다.
  // (공유 DB 를 바꿔 놓고 되돌리기 파일이 이 컴퓨터에만 남은 사고가 있었다,
  //  CLAUDE.md 2026-08-18. `git check-ignore -v` 로 커밋되는 경로인지 확인할 것.)
  writeList(PLAN, PLAN_NOTE, papers);

  if (!options.apply) {
    return {
      ...base,
      applied: false,
      reason:
        `드라이런(--apply 없음) — DB 에 쓰지 않았다. 되돌리기 목록만 갱신했다` +
        (prunedKeys.length
          ? ` · 후보에서 빠져 지울 편 ${prunedKeys.length}`
          : ""),
    };
  }

  const inspection = await inspectDatabaseTargets();
  const sharedAllowed = allowSharedImport(inspection.selected);
  if (!inspection.selected.canMigrateOrLoad && !sharedAllowed) {
    return {
      ...base,
      applied: false,
      reason: `${inspection.selected.reason} — ALLOW_SHARED_IMPORT=1 없이는 공유 DB 에 쓰지 않는다`,
    };
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    let inserted = 0;
    let updated = 0;
    let invalid = 0;
    let failed = 0;
    for (let i = 0; i < papers.length; i += 1) {
      try {
        const r = await loadExamPaper(prisma, papers[i]!);
        if (r.status === "inserted") inserted += 1;
        else if (r.status === "updated") updated += 1;
        else if (r.status === "invalid") {
          invalid += 1;
          console.log(`  [무효] ${r.externalExamId} — ${r.reason ?? ""}`);
        }
      } catch (error) {
        failed += 1;
        console.log(
          `  [실패] ${papers[i]!.externalExamId} — ${String(error).slice(0, 160)}`,
        );
      }
      if ((i + 1) % 200 === 0) {
        console.log(
          `  ${i + 1}/${papers.length} · 신규 ${inserted} · 갱신 ${updated}`,
        );
      }
    }
    // 후보에서 빠진 편을 지운다. `exam_question` 은 onDelete: Cascade 로 함께 지워진다.
    let pruned = 0;
    if (prunedKeys.length > 0) {
      const res = await prisma.exam.deleteMany({
        where: { externalExamId: { in: prunedKeys } },
      });
      pruned = res.count;
      for (const k of prunedKeys) console.log(`  [삭제] ${k}`);
    }
    // 실제로 쓴 뒤에만 원장을 갱신한다 — 원장은 «DB 실태»다.
    writeList(LEDGER, LEDGER_NOTE, papers);
    return {
      ...base,
      applied: true,
      inserted,
      updated,
      invalid,
      failed,
      pruned,
      reason: `적재 완료 — 신규 ${inserted} · 갱신 ${updated} · 무효 ${invalid} · 실패 ${failed} · 삭제 ${pruned}`,
    };
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  loadExamMetadata({ apply: process.argv.includes("--apply") })
    .then((s) => {
      console.log(`[load-exam-metadata] applied=${s.applied} — ${s.reason}`);
      console.log(`  후보 ${s.candidates} · 계획 ${s.plan} · 원장 ${s.ledger}`);
      if (s.prunedKeys.length > 0) {
        console.log(
          `  후보에서 빠진 편 ${s.prunedKeys.length}` +
            (s.applied
              ? ` (지웠다 ${s.pruned})`
              : " (드라이런이라 아직 안 지웠다)"),
        );
      }
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
