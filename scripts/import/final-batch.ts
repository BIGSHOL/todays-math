/**
 * 완료본 배치 추출물 → 단원 분류 → (선택) 적재.  **LLM 토큰 0**
 *
 * 선행: python scripts/qa/extract-final-batch.py --limit 30
 *       → scripts/qa/reports/final-batch/<examId>.json
 *
 *   npx tsx scripts/import/final-batch.ts            분류만(드라이런). 화면엔 집계만.
 *   npx tsx scripts/import/final-batch.ts --apply    공유 풀에 적재(ALLOW_SHARED_IMPORT=1 필요)
 *   npx tsx scripts/import/final-batch.ts --figures  그림 포함 문항도 분류 대상에 넣는다
 *
 * 화면에 문항 본문을 찍지 않는다 — 상세는 reports/final-batch-report.json 으로 나간다
 * (docs/planning/08-import-ledger.md §4 토큰 절약 원칙).
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { classifyDrafts } from "../../src/lib/import/buildReport";
import {
  convertPastExamPaper,
  type PastExamAnswer,
  type PastExamPaper,
} from "../../src/lib/import/convertPastExam";
import type { ImportDraft, UnitLike } from "../../src/lib/import/types";
import { isDirectScript } from "./isDirectScript";

const FIGURE_MANIFEST = "scripts/figure/figure-manifest.json";

type FigureManifest = Record<string, Record<string, string[]>>;

/** 없으면 빈 지도 — 그림 산출물이 아직 없는 컴퓨터에서도 이관은 돌아야 한다. */
async function loadFigureManifest(): Promise<FigureManifest> {
  try {
    return JSON.parse(
      await readFile(FIGURE_MANIFEST, "utf-8"),
    ) as FigureManifest;
  } catch {
    return {};
  }
}

const IN_DIR = process.env.FINAL_BATCH_DIR ?? "scripts/qa/reports/final-batch";
const REPORT = "scripts/qa/reports/final-batch-report.json";
const CLASSIFIED = "scripts/qa/reports/final-batch-classified.json";

type BatchPaper = PastExamPaper & {
  _answers?: PastExamAnswer[];
  meta?: PastExamPaper["meta"] & { level?: string; raw_grade?: number };
};

export async function runFinalBatch(options: {
  apply: boolean;
  includeFigures: boolean;
}): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const units: UnitLike[] = await prisma.unit.findMany({
      select: { id: true, grade: true, chapter: true, section: true },
    });

    const files = (await readdir(IN_DIR)).filter((f) => f.endsWith(".json"));
    const drafts: ImportDraft[] = [];
    const perExam: Array<{ examId: string; questions: number }> = [];

    for (const file of files) {
      const paper = JSON.parse(
        await readFile(path.join(IN_DIR, file), "utf8"),
      ) as BatchPaper;
      const converted = convertPastExamPaper(paper, paper._answers ?? []);
      drafts.push(...converted);
      perExam.push({
        examId: file.replace(/\.json$/, ""),
        questions: converted.length,
      });
    }

    // 완료본 PDF 에는 그림이 이미지로 심겨 있다. phase/figures 가 오려 둔
    // 것을 붙일 수 있는 문항만 그림 문항으로 이관한다(못 붙이면 종전대로 제외).
    const figures = await loadFigureManifest();
    const { classified, report } = classifyDrafts(
      "past_exam(완료본)",
      drafts,
      units,
      undefined,
      {
        includeFigures: options.includeFigures,
        // 기출만 대장을 본다. `externalId` 형식(`<examId>-<번호>`)은 출처마다
        // 다르므로 `source` 로 먼저 거른다(2026-08-16 코디네이터 공유 사고).
        // 역추적 컬럼이 있으면 그것을 쓰고, 없을 때만 externalId 를 쪼갠다.
        resolveFigures: (draft) => {
          if (draft.source !== "past_exam") return undefined;
          let exam = draft.examId ?? undefined;
          let number = draft.questionNumber ?? undefined;
          if (exam == null || number == null) {
            const cut = draft.externalId.lastIndexOf("-");
            if (cut < 0) return undefined;
            exam = draft.externalId.slice(0, cut);
            number = Number(draft.externalId.slice(cut + 1));
          }
          if (!Number.isFinite(number)) return undefined;
          return figures[exam]?.[String(number)];
        },
      },
    );

    const withAnswer = classified.filter(
      (d) => d.answer && d.answer !== "(정답 없음)",
    );

    // 단원 미매핑 사유를 힌트별로 묶어 본다 — 어떤 소단원명이 트리에 없는지 보려는 것.
    const missHints = new Map<string, number>();
    for (const item of report.items) {
      if (item.status !== "unclassified") continue;
      const key = item.unitHint || "(힌트 없음)";
      missHints.set(key, (missHints.get(key) ?? 0) + 1);
    }
    const topMiss = [...missHints.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    await writeFile(
      REPORT,
      JSON.stringify({ perExam, report, topMiss }, null, 1),
      "utf8",
    );
    await writeFile(CLASSIFIED, JSON.stringify(classified), "utf8");

    console.log("── 완료본 배치 분류 ──");
    console.log(
      `편 ${files.length} · 문항 ${drafts.length} · 단원매핑 ${report.ok}` +
        ` (${((report.ok * 100) / Math.max(1, drafts.length)).toFixed(1)}%)`,
    );
    console.log(
      `  미분류 ${report.unclassified} · 그림제외 ${report.skippedFigure}` +
        ` · 분류분 중 정답보유 ${withAnswer.length}`,
    );
    // 학년을 모르면 초1~고3 전체 풀에서 단원을 고른다 — 중3 문항이 초4 단원에
    // 실렸던 사고(513건)가 조용히 지나갔던 자리다. 크면 멈추고 원인을 볼 것.
    if (report.unresolvedGrade) {
      const share = (report.unresolvedGrade * 100) / Math.max(1, drafts.length);
      console.log(
        `  ⚠️ 학년 미해석 ${report.unresolvedGrade} (${share.toFixed(1)}%)` +
          " — 이 문항들은 전 학년 풀에서 단원을 고릅니다. meta.grade 를 확인하세요.",
      );
    }
    if (topMiss.length > 0) {
      console.log("  미매핑 상위 힌트:");
      for (const [hint, n] of topMiss) {
        console.log(`    ${n.toString().padStart(4)}  ${hint.slice(0, 40)}`);
      }
    }

    if (!options.apply) {
      console.log(`\n드라이런 — 적재 없음. 상세 → ${REPORT}`);
      return;
    }

    // 공유 Supabase 는 기본 차단이다. `runLoadIfLocal` 과 같은 관문을 여기서도 지킨다
    // — 이 스크립트는 loadClassifiedAtomically 를 직접 부르므로 그냥 두면 관문을 우회한다.
    const { inspectDatabaseTargets } = await import("./resolveDbTarget");
    const { allowSharedImport } =
      await import("../../src/lib/import/classifyDatabaseUrl");
    const inspection = await inspectDatabaseTargets();
    if (
      !inspection.selected.canMigrateOrLoad &&
      !allowSharedImport(inspection.selected)
    ) {
      console.log(
        `\n적재 차단 — ${inspection.selected.reason}` +
          "\n공유 풀에 넣으려면 ALLOW_SHARED_IMPORT=1 을 명시하세요.",
      );
      return;
    }

    const { loadClassifiedAtomically } = await import("./load-classified");
    const result = await loadClassifiedAtomically(prisma, classified);
    console.log(
      `\n적재 완료 — 신규 ${result.inserted} · 기존 ${result.alreadyPresent}` +
        ` · 초과길이제외 ${result.skippedOversized}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  runFinalBatch({
    apply: process.argv.includes("--apply"),
    includeFigures: process.argv.includes("--figures"),
  }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
