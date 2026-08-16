/**
 * 청사진 사이 거리 — backtest 지표의 바탕.
 *
 * 분포 비교는 전부 **총변동거리**(0=일치, 1=완전 불일치)로 통일한다.
 * 항목마다 다른 척도를 쓰면 엔진 버전 간 비교가 불가능해진다.
 *
 * 참조: docs/planning/11-score-predictor.md §3 L5
 */
import type { Blueprint } from "@/contracts/predictor.contract";

export type Mix = Record<string, number>;

/** 합이 1이 되게 정규화. 전부 0이면 빈 분포(비교 시 거리 1이 되도록). */
export function normalizeMix(mix: Mix): Mix {
  const total = Object.values(mix).reduce((s, v) => s + (v || 0), 0);
  if (total <= 0) return {};
  const out: Mix = {};
  for (const [k, v] of Object.entries(mix)) out[k] = (v || 0) / total;
  return out;
}

/**
 * 분포 사이 거리. 채점용이라 **빈 분포를 특별 취급한다.**
 *
 * 빈 분포는 "예측 안 함" 이지 분포가 아니다. 그런데 총변동거리는 빈 쪽을 0 벡터로 봐서
 * 최대 0.5 까지만 벌어진다 — 완전히 틀린 예측(1.0)보다 **점수가 좋아진다.**
 * 그대로 두면 엔진이 망가져 빈 청사진을 낼수록 backtest 가 좋아 보인다(2026-08-16 재현).
 * 그래서 한쪽만 비면 최대 거리로 친다.
 */
export function mixDistance(a: Mix, b: Mix): number {
  const aEmpty = Object.keys(a).length === 0;
  const bEmpty = Object.keys(b).length === 0;
  if (aEmpty !== bEmpty) return 1;
  if (aEmpty && bEmpty) return 0;
  return totalVariationDistance(a, b);
}

/** 총변동거리. 한쪽에만 있는 키도 센다. 채점에는 `mixDistance` 를 쓴다. */
export function totalVariationDistance(a: Mix, b: Mix): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let sum = 0;
  for (const k of keys) sum += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
  return sum / 2;
}

function countsOf(
  cells: Record<string, { count: number; score: number }>,
): Mix {
  const out: Mix = {};
  for (const [k, v] of Object.entries(cells)) out[k] = v.count;
  return out;
}

/** 난이도 분포에서 라벨된 칸(하·중·상)만 남긴다. */
export function labeledOnly(
  cells: Record<string, { count: number; score: number }>,
): Mix {
  const out: Mix = {};
  for (const key of ["하", "중", "상"]) out[key] = cells[key]?.count ?? 0;
  return out;
}

function unitCounts(blueprint: Blueprint): Mix {
  const out: Mix = {};
  for (const row of blueprint.unitMix) {
    const key = row.unitId ?? `raw:${row.topicRaw ?? "(없음)"}`;
    out[key] = (out[key] ?? 0) + row.count;
  }
  return out;
}

function gridCounts(blueprint: Blueprint): Mix {
  const out: Mix = {};
  for (const row of blueprint.scoreHistogram) {
    const key = String(row.score);
    out[key] = (out[key] ?? 0) + row.count;
  }
  return out;
}

export interface BlueprintDistances {
  questionCountAbsError: number;
  totalScoreAbsError: number;
  typeMixDistance: number;
  difficultyMixDistance: number;
  unitMixDistance: number;
  scoreGridDistance: number;
}

/**
 * 예측 청사진과 실측 청사진의 거리.
 * 인자 순서는 (예측, 실측)이지만 모든 지표가 대칭이라 뒤바뀌어도 값은 같다.
 */
export function blueprintDistances(
  predicted: Blueprint,
  observed: Blueprint,
): BlueprintDistances {
  return {
    questionCountAbsError: Math.abs(
      predicted.questionCount - observed.questionCount,
    ),
    totalScoreAbsError: Math.abs(predicted.totalScore - observed.totalScore),
    typeMixDistance: mixDistance(
      normalizeMix(countsOf(predicted.typeMix)),
      normalizeMix(countsOf(observed.typeMix)),
    ),
    // '미표기'는 난이도가 아니라 **잴 수 없음**이다. 한 칸으로 세면
    // 라벨이 없는 시험지가 지표를 통째로 오염시킨다(단원과 같은 문제).
    difficultyMixDistance: mixDistance(
      normalizeMix(labeledOnly(predicted.difficultyMix)),
      normalizeMix(labeledOnly(observed.difficultyMix)),
    ),
    unitMixDistance: mixDistance(
      normalizeMix(unitCounts(predicted)),
      normalizeMix(unitCounts(observed)),
    ),
    scoreGridDistance: mixDistance(
      normalizeMix(gridCounts(predicted)),
      normalizeMix(gridCounts(observed)),
    ),
  };
}
