/**
 * T7.3 — 추출 JSON 코퍼스(`loadCorpus`) → `Exam`/`ExamQuestion` DB 적재기.
 *
 * ⚠️ 새로 파싱하지 않는다. `scripts/predictor/loadCorpus.ts`(파일 IO·메타 정규화·배점
 *    중앙값 보정·난이도 라벨 정규화가 이미 있다)를 그대로 쓰고, 여기서는 DB 적재만 한다
 *    (11-score-predictor.md §2.4, 지시문 "다시 만들지 마라").
 *
 * 원칙:
 * - **멱등**: `externalExamId` 로 upsert. 문항은 편 단위로 지우고 다시 넣는다(트랜잭션 안).
 *   같은 파일을 여러 번 적재해도 exam 1행·question N행 그대로다.
 * - **부분 실패 없음**: 편 하나가 스키마에 안 맞으면(문항 하나라도) 그 편 전체를 건너뛰고
 *   DB에 아무것도 쓰지 않는다. DB 쓰기 자체도 `$transaction` 으로 묶어 중간에 실패하면
 *   그 편의 exam/examQuestion 이 함께 롤백된다.
 * - **topicRaw 원문 보존**: 우리 트리 매핑이 없어도(`unitId` 는 이 태스크에서 항상 null)
 *   시험지 원문 소단원 표기를 그대로 싣는다(11 §5).
 * - **공유 DB 쓰기는 게이트 뒤에서만** — dry-run 이 기본이고, `--apply` 플래그와
 *   `ALLOW_SHARED_IMPORT=1` 둘 다 있을 때만 쓴다. 게이트 판정은 PrismaClient 를
 *   생성하기 **전에** 끝낸다(트랙 공통 규칙 2).
 */
import type { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import {
  examPaperSchema,
  type ExamPaper,
} from "../../src/contracts/predictor.contract";
import { isDirectScript } from "../import/isDirectScript";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";
import { loadCorpus, type LoadStats } from "./loadCorpus";

export type LoadPaperStatus = "inserted" | "updated" | "invalid" | "failed";

export interface LoadPaperResult {
  externalExamId: string;
  status: LoadPaperStatus;
  questionCount: number;
  /** invalid/failed 일 때만 채운다 — 문항 본문은 절대 담지 않는다. */
  reason?: string;
}

function examFields(paper: ExamPaper) {
  return {
    school: paper.series.school,
    level: paper.series.level,
    grade: paper.series.grade,
    subject: paper.series.subject,
    subjectRaw: paper.subjectRaw,
    year: paper.period.year,
    semester: paper.period.semester,
    round: paper.period.round,
    totalScore: paper.totalScore,
    questionCount: paper.questions.length,
    sourceFile: paper.sourceFile,
  };
}

/**
 * ⚠️ `unitId`·`problemId` 를 **계약이 준 값 그대로** 싣는다.
 *
 * T7.3 때는 둘을 `null` 로 못박아 두었다(매핑·연결이 그 태스크 범위 밖이었다). 그런데
 * `ExamQuestion.problemId` 는 「이 시험지 7번 문항이 우리 문제은행의 어느 행인가」를
 * 잇는 **유일한 길**이다 — 못박아 두면 `Exam` 을 채워도 그 연결이 영영 안 생긴다.
 * 이제 exam-metadata 적재가 그 값을 채워 넘기므로 여기서 버리지 않는다.
 * 채울 값이 없으면 호출자가 `null` 을 넘기므로 예전 동작과 같다.
 */
function questionFields(examId: string, q: ExamPaper["questions"][number]) {
  return {
    examId,
    number: q.number,
    score: q.score,
    qtype: q.qtype,
    difficultyLabel: q.difficultyLabel,
    topicRaw: q.topicRaw,
    unitId: q.unitId,
    answer: q.answer,
    hasFigure: q.hasFigure,
    problemId: q.problemId,
  };
}

/**
 * 시험지 1편을 적재한다. 스키마 검증 실패 시 DB 를 건드리지 않고 "invalid" 를 반환한다.
 * DB 쓰기는 `$transaction` 안에서 upsert + (기존 문항 삭제 → 재삽입)으로 원자적으로 한다.
 */
export async function loadExamPaper(
  prisma: PrismaClient,
  paper: ExamPaper,
): Promise<LoadPaperResult> {
  const parsed = examPaperSchema.safeParse(paper);
  if (!parsed.success) {
    return {
      externalExamId:
        typeof (paper as { externalExamId?: unknown })?.externalExamId ===
        "string"
          ? (paper as { externalExamId: string }).externalExamId
          : "unknown",
      status: "invalid",
      questionCount: 0,
      reason: parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    };
  }
  const data = parsed.data;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.exam.findUnique({
      where: { externalExamId: data.externalExamId },
    });

    const exam = await tx.exam.upsert({
      where: { externalExamId: data.externalExamId },
      update: examFields(data),
      create: { externalExamId: data.externalExamId, ...examFields(data) },
    });

    // 편 단위로 지우고 다시 넣는다 — (examId, number) UNIQUE 위반 없이 멱등을 보장한다.
    await tx.examQuestion.deleteMany({ where: { examId: exam.id } });
    if (data.questions.length > 0) {
      await tx.examQuestion.createMany({
        data: data.questions.map((q) => questionFields(exam.id, q)),
      });
    }

    const result: LoadPaperResult = {
      externalExamId: data.externalExamId,
      status: existing ? "updated" : "inserted",
      questionCount: data.questions.length,
    };
    return result;
  });
}

export interface CoverageStats {
  papers: number;
  questions: number;
  answerRate: number;
  topicRate: number;
  difficultyLabelRate: number;
}

export function summarizeCoverage(papers: ExamPaper[]): CoverageStats {
  let questions = 0;
  let withAnswer = 0;
  let withTopic = 0;
  let withDifficulty = 0;
  for (const paper of papers) {
    for (const q of paper.questions) {
      questions += 1;
      if (q.answer) withAnswer += 1;
      if (q.topicRaw) withTopic += 1;
      if (q.difficultyLabel) withDifficulty += 1;
    }
  }
  return {
    papers: papers.length,
    questions,
    answerRate: questions ? withAnswer / questions : 0,
    topicRate: questions ? withTopic / questions : 0,
    difficultyLabelRate: questions ? withDifficulty / questions : 0,
  };
}

export interface LoadExamsSummary extends CoverageStats {
  applied: boolean;
  inserted: number;
  updated: number;
  invalid: number;
  failed: number;
  reason: string;
  corpusStats?: LoadStats;
}

/**
 * 오케스트레이터. dry-run(기본)이면 코퍼스 커버리지만 낸다. `apply=true` 일 때만
 * DB 접근을 시도하되, 그 앞에서 공유 DB 쓰기 게이트(`allowSharedImport`)를 확인한다 —
 * 게이트가 DB 접근보다 앞이다.
 */
export async function loadExams(options: {
  apply: boolean;
}): Promise<LoadExamsSummary> {
  const { papers, stats } = loadCorpus();
  const coverage = summarizeCoverage(papers);

  if (!options.apply) {
    return {
      ...coverage,
      applied: false,
      inserted: 0,
      updated: 0,
      invalid: 0,
      failed: 0,
      reason: "dry-run (--apply 없음) — DB에 쓰지 않았습니다.",
      corpusStats: stats,
    };
  }

  const inspection = await inspectDatabaseTargets();
  const sharedAllowed = allowSharedImport(inspection.selected);
  if (!inspection.selected.canMigrateOrLoad && !sharedAllowed) {
    return {
      ...coverage,
      applied: false,
      inserted: 0,
      updated: 0,
      invalid: 0,
      failed: 0,
      reason: `${inspection.selected.reason} — ALLOW_SHARED_IMPORT=1 이 없으면 공유 DB에 쓰지 않습니다.`,
      corpusStats: stats,
    };
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    let inserted = 0;
    let updated = 0;
    let invalid = 0;
    let failed = 0;
    for (const paper of papers) {
      try {
        const result = await loadExamPaper(prisma, paper);
        if (result.status === "inserted") inserted += 1;
        else if (result.status === "updated") updated += 1;
        else if (result.status === "invalid") invalid += 1;
      } catch {
        failed += 1;
      }
    }
    return {
      ...coverage,
      applied: true,
      inserted,
      updated,
      invalid,
      failed,
      reason: `적재 완료 — 신규 ${inserted} · 갱신 ${updated} · 무효 ${invalid} · 실패 ${failed}`,
      corpusStats: stats,
    };
  } finally {
    await prisma.$disconnect();
  }
}

function printSummary(summary: LoadExamsSummary): void {
  console.log(
    `[load-exams] applied=${summary.applied} reason=${summary.reason}`,
  );
  console.log(
    `[load-exams] papers=${summary.papers} questions=${summary.questions}`,
  );
  console.log(
    `[load-exams] answerRate=${(summary.answerRate * 100).toFixed(1)}% ` +
      `topicRate=${(summary.topicRate * 100).toFixed(1)}% ` +
      `difficultyLabelRate=${(summary.difficultyLabelRate * 100).toFixed(1)}%`,
  );
  if (summary.applied) {
    console.log(
      `[load-exams] inserted=${summary.inserted} updated=${summary.updated} ` +
        `invalid=${summary.invalid} failed=${summary.failed}`,
    );
  }
  if (summary.corpusStats) {
    const s = summary.corpusStats;
    console.log(
      `[load-exams] corpus files=${s.files} droppedNoPeriod=${s.droppedNoPeriod} ` +
        `droppedNoMeta=${s.droppedNoMeta} droppedTooFew=${s.droppedTooFew} scoreFilled=${s.scoreFilled}`,
    );
  }
}

if (isDirectScript(import.meta.url)) {
  const apply = process.argv.includes("--apply");
  loadExams({ apply })
    .then(printSummary)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
