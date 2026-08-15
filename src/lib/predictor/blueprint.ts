/**
 * 시험지 1편 → 실측 청사진(observed Blueprint).
 *
 * 예측값과 실측값이 같은 형태를 쓰기 때문에 backtest 에서 그대로 대조된다.
 *
 * 참조: docs/planning/11-score-predictor.md §1-A
 */
import type {
  Blueprint,
  DifficultyLabel,
  ExamPaper,
  QuestionType,
} from "@/contracts/predictor.contract";

export const QUESTION_TYPES: QuestionType[] = ["객관식", "단답형", "서술형"];
export const DIFFICULTY_KEYS = ["하", "중", "상", "미표기"] as const;
export type DifficultyKey = (typeof DIFFICULTY_KEYS)[number];

/** 난이도 라벨 → 0(하)~1(상) 연속값. 번호별 곡선과 난이도 지수에 쓴다. */
export const DIFFICULTY_VALUE: Record<DifficultyLabel, number> = {
  하: 0,
  중: 0.5,
  상: 1,
};

function emptyCells<K extends string>(keys: readonly K[]) {
  return Object.fromEntries(keys.map((k) => [k, { count: 0, score: 0 }])) as Record<
    K,
    { count: number; score: number }
  >;
}

export function observeBlueprint(paper: ExamPaper): Blueprint {
  const typeMix = emptyCells(QUESTION_TYPES);
  const difficultyMix = emptyCells(DIFFICULTY_KEYS);
  const grid = new Map<number, number>();
  const units = new Map<string, { unitId: string | null; topicRaw: string | null; count: number; score: number }>();
  const positionCurve: Blueprint["positionCurve"] = [];

  let totalScore = 0;
  for (const q of paper.questions) {
    totalScore += q.score;

    typeMix[q.qtype].count += 1;
    typeMix[q.qtype].score += q.score;

    const dk: DifficultyKey = q.difficultyLabel ?? "미표기";
    difficultyMix[dk].count += 1;
    difficultyMix[dk].score += q.score;

    grid.set(q.score, (grid.get(q.score) ?? 0) + 1);

    // 단원 표기가 아예 없는 문항은 단원 배분에서 뺀다.
    // "(없음)"을 한 칸으로 세면 시험지마다 그 크기가 달라 비교가 오염된다.
    const unitKey = q.unitId ?? (q.topicRaw ? `raw:${q.topicRaw}` : null);
    if (unitKey) {
      const row = units.get(unitKey);
      if (row) {
        row.count += 1;
        row.score += q.score;
      } else {
        units.set(unitKey, {
          unitId: q.unitId,
          topicRaw: q.topicRaw,
          count: 1,
          score: q.score,
        });
      }
    }

    // 라벨이 없는 문항은 곡선에 넣지 않는다 — 0.5로 채우면 없는 정보를 지어내는 것이다.
    if (q.difficultyLabel) {
      positionCurve.push({
        number: q.number,
        difficulty: DIFFICULTY_VALUE[q.difficultyLabel],
        score: q.score,
        qtype: q.qtype,
      });
    }
  }

  return {
    kind: "observed",
    series: paper.series,
    period: paper.period,
    questionCount: paper.questions.length,
    totalScore: Number(totalScore.toFixed(4)),
    typeMix,
    difficultyMix,
    scoreHistogram: [...grid.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([score, count]) => ({ score, count })),
    positionCurve: positionCurve.sort((a, b) => a.number - b.number),
    unitMix: [...units.values()],
    expectedMean: null,
    expectedMeanInterval: null,
    evidenceCount: 1,
    confidence: 1,
  };
}

/**
 * 난이도 지수 — 배점가중 평균 난이도(0=전부 하, 1=전부 상).
 * 라벨 없는 문항은 제외한다(§2.3에서 이 방식으로 잡음을 측정했다).
 * 라벨된 문항이 없으면 null.
 */
export function difficultyIndex(blueprint: Blueprint): number | null {
  let num = 0;
  let den = 0;
  for (const key of ["하", "중", "상"] as const) {
    const cell = blueprint.difficultyMix[key];
    num += DIFFICULTY_VALUE[key] * cell.score;
    den += cell.score;
  }
  return den > 0 ? num / den : null;
}
