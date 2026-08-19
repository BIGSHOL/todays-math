/**
 * **적재한 `Exam`/`ExamQuestion` 으로 「오늘의 시험」이 실제로 도는가.**
 *
 *   npx tsx scripts/qa/verify-exam-corpus.ts
 *
 * 읽기 전용이다. 「행이 몇 개 들어갔다」는 적재의 성적이지 **제품의 성적이 아니다** —
 * 그래서 여기서는 제품이 쓰는 함수를 **실제로 불러** 확인한다:
 *
 *   1. `Exam`/`ExamQuestion` → `ExamPaper` (제품과 같은 변환)
 *   2. `partitionTrusted` — 신뢰 가드가 몇 편을 빼는가
 *   3. `predictBlueprint` — 시리즈마다 청사진이 **정말 나오는가** (예외면 그 사유)
 *
 * ⚠️ 가드가 뺀 편을 «없는 것»으로 세지 않는다. 뺀 수와 사유를 같이 찍는다.
 */
import { writeFileSync } from "node:fs";

import {
  comparePeriod,
  type ExamPaper,
  type ExamPeriod,
  type ExamSeriesKey,
} from "../../src/contracts/predictor.contract";
import { observeBlueprint } from "../../src/lib/predictor/blueprint";
import { partitionTrusted } from "../../src/lib/predictor/paperTrust";
import { predictBlueprint } from "../../src/lib/predictor/predictBlueprint";
import { isDirectScript } from "../import/isDirectScript";

const OUT = "scripts/qa/reports/exam-metadata/corpus-verify.json";

function seriesKey(s: ExamSeriesKey): string {
  return `${s.school}|${s.level}${s.grade}|${s.subject}`;
}

export interface CorpusVerification {
  exams: number;
  questions: number;
  papers: number;
  trusted: number;
  excluded: Record<string, number>;
  series: number;
  seriesWithTrusted: number;
  /** 과거 회차가 2편 이상인 시리즈 — 패턴을 학습할 수 있는 최소치 */
  seriesWithTwoOrMore: number;
  /** 실제로 `predictBlueprint` 가 청사진을 낸 시리즈 */
  blueprintOk: number;
  blueprintFailed: Record<string, number>;
  periods: Record<string, number>;
  sample: Array<{
    series: string;
    target: string;
    history: number;
    cohort: number;
    questionCount: number;
    totalScore: number;
  }>;
}

async function readPapers(): Promise<ExamPaper[]> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const exams = await prisma.exam.findMany();
    const questions = await prisma.examQuestion.findMany();
    const byExam = new Map<string, typeof questions>();
    for (const q of questions) {
      const list = byExam.get(q.examId) ?? [];
      list.push(q);
      byExam.set(q.examId, list);
    }
    return exams.map((e) => ({
      externalExamId: e.externalExamId,
      series: {
        school: e.school,
        level: e.level as ExamSeriesKey["level"],
        grade: e.grade,
        subject: e.subject,
      },
      period: {
        year: e.year,
        semester: e.semester as ExamPeriod["semester"],
        round: e.round as ExamPeriod["round"],
      },
      subjectRaw: e.subjectRaw,
      totalScore: e.totalScore,
      sourceFile: e.sourceFile,
      questions: (byExam.get(e.id) ?? [])
        .sort((a, b) => a.number - b.number)
        .map((q) => ({
          number: q.number,
          score: q.score,
          qtype: q.qtype as "객관식" | "단답형" | "서술형",
          difficultyLabel: q.difficultyLabel as "하" | "중" | "상" | null,
          topicRaw: q.topicRaw,
          unitId: q.unitId,
          answer: q.answer,
          hasFigure: q.hasFigure,
          problemId: q.problemId,
        })),
    }));
  } finally {
    await prisma.$disconnect();
  }
}

export async function verifyExamCorpus(): Promise<CorpusVerification> {
  const papers = await readPapers();
  const { trusted, excluded } = partitionTrusted(papers);

  const excludedBy: Record<string, number> = {};
  for (const e of excluded) {
    if (e.trust.trusted) continue;
    const key = `${e.trust.reason}${e.trust.shortfall ? `(${e.trust.shortfall})` : ""}`;
    excludedBy[key] = (excludedBy[key] ?? 0) + 1;
  }

  const periods: Record<string, number> = {};
  for (const p of papers) {
    const k = `${p.period.year}-${p.period.semester}-${p.period.round}`;
    periods[k] = (periods[k] ?? 0) + 1;
  }

  const allSeries = new Set(papers.map((p) => seriesKey(p.series)));
  const bySeries = new Map<string, ExamPaper[]>();
  for (const p of trusted) {
    const k = seriesKey(p.series);
    const list = bySeries.get(k) ?? [];
    list.push(p);
    bySeries.set(k, list);
  }

  // 각 시리즈의 **가장 최근 회차 다음**을 대상으로 잡고, 그 앞의 회차만 근거로 준다.
  let blueprintOk = 0;
  const blueprintFailed: Record<string, number> = {};
  const sample: CorpusVerification["sample"] = [];
  for (const [key, list] of bySeries) {
    const sorted = [...list].sort((a, b) => comparePeriod(a.period, b.period));
    const last = sorted[sorted.length - 1]!;
    const target: ExamPeriod = {
      year:
        last.period.round === "기말" ? last.period.year + 1 : last.period.year,
      semester: last.period.round === "기말" ? 1 : 2,
      round: last.period.round === "기말" ? "중간" : "기말",
    };
    const history = sorted.filter((p) => comparePeriod(p.period, target) < 0);
    // 코호트는 같은 학교급·학년·과목의 **다른 학교** 회차다.
    const cohort = trusted.filter(
      (p) =>
        seriesKey(p.series) !== key &&
        p.series.level === last.series.level &&
        p.series.grade === last.series.grade &&
        p.series.subject === last.series.subject &&
        comparePeriod(p.period, target) < 0,
    );
    try {
      const bp = predictBlueprint({
        series: last.series,
        target,
        history: history.map(observeBlueprint),
        cohort: cohort.map(observeBlueprint),
      });
      blueprintOk += 1;
      if (sample.length < 8) {
        sample.push({
          series: key,
          target: `${target.year}-${target.semester}-${target.round}`,
          history: history.length,
          cohort: cohort.length,
          questionCount: bp.questionCount,
          totalScore: bp.totalScore,
        });
      }
    } catch (error) {
      const reason = String(error).split("\n")[0]!.slice(0, 80);
      blueprintFailed[reason] = (blueprintFailed[reason] ?? 0) + 1;
    }
  }

  return {
    exams: papers.length,
    questions: papers.reduce((s, p) => s + p.questions.length, 0),
    papers: papers.length,
    trusted: trusted.length,
    excluded: excludedBy,
    series: allSeries.size,
    seriesWithTrusted: bySeries.size,
    seriesWithTwoOrMore: [...bySeries.values()].filter((v) => v.length >= 2)
      .length,
    blueprintOk,
    blueprintFailed,
    periods,
    sample,
  };
}

if (isDirectScript(import.meta.url)) {
  verifyExamCorpus()
    .then((v) => {
      writeFileSync(OUT, JSON.stringify(v, null, 1), "utf-8");
      const pct = (n: number, d: number) =>
        d ? ((n / d) * 100).toFixed(1) : "0.0";
      console.log(
        `[verify] Exam ${v.exams}편 · ExamQuestion ${v.questions}문항`,
      );
      console.log(
        `  신뢰 가드 통과 ${v.trusted}/${v.papers} (${pct(v.trusted, v.papers)}%)`,
      );
      for (const [k, n] of Object.entries(v.excluded).sort(
        (a, b) => b[1] - a[1],
      )) {
        console.log(`    제외 ${n.toString().padStart(5)}  ${k}`);
      }
      console.log(
        `  시리즈 ${v.series} · 통과분이 있는 시리즈 ${v.seriesWithTrusted}` +
          ` · 2회차 이상 ${v.seriesWithTwoOrMore}`,
      );
      console.log(
        `  ⭐ predictBlueprint 가 청사진을 낸 시리즈 ${v.blueprintOk}/${v.seriesWithTrusted}`,
      );
      for (const [k, n] of Object.entries(v.blueprintFailed)) {
        console.log(`    실패 ${n.toString().padStart(5)}  ${k}`);
      }
      console.log("  표본:");
      for (const s of v.sample) {
        console.log(
          `    ${s.series} → ${s.target}: 과거 ${s.history} · 코호트 ${s.cohort}` +
            ` → ${s.questionCount}문항 ${s.totalScore}점`,
        );
      }
      console.log(`  → ${OUT}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
