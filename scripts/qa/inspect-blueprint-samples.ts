/**
 * **청사진이 «돌아간다»가 아니라 «맞다»인지 눈으로 본다.**
 *
 *   npx tsx scripts/qa/inspect-blueprint-samples.ts [--n 12]
 *
 * `verify-exam-corpus.ts` 는 「563/563 시리즈에서 청사진이 나온다」를 세지만, 그건
 * **예외가 안 났다**는 뜻일 뿐이다. 낸 값이 그 학교의 실제 회차와 닮았는지는 다른 물음이다.
 *
 * 그래서 여기서는 **홀드아웃**으로 잰다: 시리즈의 마지막 회차를 감추고 그 앞만 근거로 줘서
 * 청사진을 낸 뒤, **감춘 그 회차**와 맞대어 본다. 답을 미리 보고 맞히는 것이 아니다
 * (CLAUDE.md 2026-08-18 「지표의 «참»이 제품에서 오면 안 된다」).
 *
 * 읽기 전용이다.
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

const OUT = "scripts/qa/reports/exam-metadata/blueprint-holdout.json";

function seriesKey(s: ExamSeriesKey): string {
  return `${s.school}|${s.level}${s.grade}|${s.subject}`;
}

interface HoldoutRow {
  series: string;
  target: string;
  historyCount: number;
  cohortCount: number;
  predictedQuestionCount: number;
  actualQuestionCount: number;
  predictedTotalScore: number;
  actualTotalScore: number;
  /** 유형 배분 — 예측 vs 실제 (객관식 비율) */
  predictedChoiceRate: number;
  actualChoiceRate: number;
}

export interface HoldoutReport {
  evaluated: number;
  skippedNoHistory: number;
  questionCountMae: number;
  questionCountWithin1: number;
  questionCountWithin2: number;
  totalScoreMae: number;
  choiceRateMae: number;
  rows: HoldoutRow[];
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

/** 유형별 {count,score} 묶음에서 객관식 비율을 낸다. */
function rateOf(mix: Record<string, { count: number }>): number {
  const total = Object.values(mix).reduce((s, c) => s + c.count, 0);
  return total ? (mix["객관식"]?.count ?? 0) / total : 0;
}

const choiceRate = (p: ExamPaper): number =>
  p.questions.length
    ? p.questions.filter((q) => q.qtype === "객관식").length /
      p.questions.length
    : 0;

export async function holdoutBlueprints(limit: number): Promise<HoldoutReport> {
  const papers = await readPapers();
  const { trusted } = partitionTrusted(papers);

  const bySeries = new Map<string, ExamPaper[]>();
  for (const p of trusted) {
    const k = seriesKey(p.series);
    const list = bySeries.get(k) ?? [];
    list.push(p);
    bySeries.set(k, list);
  }

  const rows: HoldoutRow[] = [];
  let skippedNoHistory = 0;
  // 회차가 많은 시리즈부터 본다 — 근거가 있는 자리에서 «맞는가»를 물어야 한다.
  const ordered = [...bySeries.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  for (const [key, list] of ordered) {
    const sorted = [...list].sort((a, b) => comparePeriod(a.period, b.period));
    const actual = sorted[sorted.length - 1]!;
    const history = sorted.slice(0, -1); // ⭐ 마지막 회차는 **감춘다**
    if (history.length === 0) {
      skippedNoHistory += 1;
      continue;
    }
    const cohort = trusted.filter(
      (p) =>
        seriesKey(p.series) !== key &&
        p.series.level === actual.series.level &&
        p.series.grade === actual.series.grade &&
        p.series.subject === actual.series.subject &&
        comparePeriod(p.period, actual.period) < 0,
    );
    let bp;
    try {
      bp = predictBlueprint({
        series: actual.series,
        target: actual.period,
        history: history.map(observeBlueprint),
        cohort: cohort.map(observeBlueprint),
      });
    } catch {
      continue;
    }
    rows.push({
      series: key,
      target: `${actual.period.year}-${actual.period.semester}-${actual.period.round}`,
      historyCount: history.length,
      cohortCount: cohort.length,
      predictedQuestionCount: bp.questionCount,
      actualQuestionCount: actual.questions.length,
      predictedTotalScore: bp.totalScore,
      actualTotalScore: actual.totalScore,
      // `typeMix` 는 유형별 {count, score} 다 — 합으로 나눠 «비율»로 만든다
      //   (절대 개수든 배분값이든 같은 뜻이 된다).
      predictedChoiceRate: rateOf(bp.typeMix),
      actualChoiceRate: choiceRate(actual),
    });
  }

  const mae = (f: (r: HoldoutRow) => number): number =>
    rows.length
      ? rows.reduce((s, r) => s + Math.abs(f(r)), 0) / rows.length
      : 0;

  return {
    evaluated: rows.length,
    skippedNoHistory,
    questionCountMae: mae(
      (r) => r.predictedQuestionCount - r.actualQuestionCount,
    ),
    questionCountWithin1: rows.filter(
      (r) => Math.abs(r.predictedQuestionCount - r.actualQuestionCount) <= 1,
    ).length,
    questionCountWithin2: rows.filter(
      (r) => Math.abs(r.predictedQuestionCount - r.actualQuestionCount) <= 2,
    ).length,
    totalScoreMae: mae((r) => r.predictedTotalScore - r.actualTotalScore),
    choiceRateMae: mae((r) => r.predictedChoiceRate - r.actualChoiceRate),
    rows: rows.slice(0, limit),
  };
}

if (isDirectScript(import.meta.url)) {
  const idx = process.argv.indexOf("--n");
  const limit = idx >= 0 ? Number(process.argv[idx + 1]) : 12;
  holdoutBlueprints(limit)
    .then((r) => {
      writeFileSync(OUT, JSON.stringify(r, null, 1), "utf-8");
      const pct = (n: number) =>
        r.evaluated ? ((n / r.evaluated) * 100).toFixed(1) : "0.0";
      console.log(
        `[holdout] 마지막 회차를 감추고 예측 — 잰 시리즈 ${r.evaluated}` +
          ` (과거 회차가 없어 못 잰 시리즈 ${r.skippedNoHistory})`,
      );
      console.log(
        `  문항 수  평균오차 ${r.questionCountMae.toFixed(2)}개` +
          ` · ±1 안 ${r.questionCountWithin1} (${pct(r.questionCountWithin1)}%)` +
          ` · ±2 안 ${r.questionCountWithin2} (${pct(r.questionCountWithin2)}%)`,
      );
      console.log(`  총점     평균오차 ${r.totalScoreMae.toFixed(2)}점`);
      console.log(
        `  객관식 비율 평균오차 ${(r.choiceRateMae * 100).toFixed(1)}%p`,
      );
      console.log("");
      console.log("  표본 (감춘 회차와 맞댐):");
      for (const s of r.rows) {
        console.log(
          `    ${s.series} → ${s.target}` +
            ` · 근거 과거 ${s.historyCount}·코호트 ${s.cohortCount}` +
            ` | 문항 ${s.predictedQuestionCount.toFixed(1)} vs 실제 ${s.actualQuestionCount}` +
            ` | 총점 ${s.predictedTotalScore.toFixed(1)} vs ${s.actualTotalScore}` +
            ` | 객관식 ${(s.predictedChoiceRate * 100).toFixed(0)}% vs ${(s.actualChoiceRate * 100).toFixed(0)}%`,
        );
      }
      console.log(`  → ${OUT}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
