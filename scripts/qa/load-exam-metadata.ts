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
const LEDGER = `${LEDGER_DIR}/exam-metadata-loaded.json`;

function writeLedger(papers: ExamPaper[]): void {
  mkdirSync(LEDGER_DIR, { recursive: true });
  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        note:
          "이 목록이 되돌리는 수단이다. 되돌리려면 이 externalExamId 로 exam 을 지운다" +
          " (exam_question 은 onDelete: Cascade 로 함께 지워진다).",
        count: papers.length,
        externalExamIds: papers.map((p) => p.externalExamId).sort(),
      },
      null,
      1,
    ),
    "utf-8",
  );
}

export interface LoadExamMetadataSummary {
  applied: boolean;
  reason: string;
  candidates: number;
  inserted: number;
  updated: number;
  invalid: number;
  failed: number;
  ledger: string;
}

export async function loadExamMetadata(options: {
  apply: boolean;
}): Promise<LoadExamMetadataSummary> {
  const papers = JSON.parse(readFileSync(CANDIDATES, "utf-8")) as ExamPaper[];
  const base = {
    candidates: papers.length,
    inserted: 0,
    updated: 0,
    invalid: 0,
    failed: 0,
    ledger: LEDGER,
  };

  // 되돌리기 자료는 **드라이런에서도** 쓴다 — 그래야 DB 를 건드리기 **전에** 커밋할 수 있다.
  // (공유 DB 를 바꿔 놓고 되돌리기 파일이 이 컴퓨터에만 남은 사고가 있었다,
  //  CLAUDE.md 2026-08-18. `git check-ignore -v` 로 커밋되는 경로인지 확인할 것.)
  writeLedger(papers);

  if (!options.apply) {
    return {
      ...base,
      applied: false,
      reason:
        "드라이런(--apply 없음) — DB 에 쓰지 않았다. 되돌리기 목록만 갱신했다",
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
    return {
      ...base,
      applied: true,
      inserted,
      updated,
      invalid,
      failed,
      reason: `적재 완료 — 신규 ${inserted} · 갱신 ${updated} · 무효 ${invalid} · 실패 ${failed}`,
    };
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  loadExamMetadata({ apply: process.argv.includes("--apply") })
    .then((s) => {
      console.log(`[load-exam-metadata] applied=${s.applied} — ${s.reason}`);
      console.log(`  후보 ${s.candidates} · 되돌리기 목록 ${s.ledger}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
