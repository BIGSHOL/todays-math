/**
 * 분석 리포트 집계 — 순수 함수. gradeAnswers()의 결과만으로 계산한다(06-tasks.md T7.1).
 *
 * - unitScores: 단원별 정답률(0~100) — (해당 단원 획득 점수 합) / (해당 단원 배점 합) × 100.
 * - difficultyDistribution: 난이도별 정답/전체 문항 수.
 * - recommendedUnits: 정답률이 RECOMMEND_THRESHOLD(60%) 미만인 단원을 낮은 순으로 최대
 *   RECOMMEND_LIMIT(3)개 추천한다. 전부 임계값 이상이면 빈 배열.
 */
import type { Difficulty } from "@/contracts/common.contract";

import type { GradedAnswer } from "./gradeAnswers";

export const RECOMMEND_THRESHOLD = 0.6;
export const RECOMMEND_LIMIT = 3;

const DIFFICULTY_KEYS: Difficulty[] = ["easy", "mid", "hard"];

export interface AnalysisReportData {
  unitScores: Record<string, number>;
  difficultyDistribution: Record<Difficulty, { correct: number; total: number }>;
  recommendedUnits: string[];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function buildAnalysisReport(graded: GradedAnswer[]): AnalysisReportData {
  const unitAgg = new Map<string, { earned: number; possible: number }>();
  const difficultyDistribution = Object.fromEntries(
    DIFFICULTY_KEYS.map((d) => [d, { correct: 0, total: 0 }]),
  ) as Record<Difficulty, { correct: number; total: number }>;

  for (const g of graded) {
    const agg = unitAgg.get(g.unitId) ?? { earned: 0, possible: 0 };
    agg.earned += g.pointsEarned;
    agg.possible += g.maxPoints;
    unitAgg.set(g.unitId, agg);

    difficultyDistribution[g.difficulty].total += 1;
    if (g.isCorrect) difficultyDistribution[g.difficulty].correct += 1;
  }

  const unitScores: Record<string, number> = {};
  const unitRatios: Array<{ unitId: string; ratio: number }> = [];
  for (const [unitId, { earned, possible }] of unitAgg) {
    const ratio = possible > 0 ? earned / possible : 0;
    unitScores[unitId] = round1(ratio * 100);
    unitRatios.push({ unitId, ratio });
  }

  const recommendedUnits = unitRatios
    .filter((u) => u.ratio < RECOMMEND_THRESHOLD)
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, RECOMMEND_LIMIT)
    .map((u) => u.unitId);

  return { unitScores, difficultyDistribution, recommendedUnits };
}
