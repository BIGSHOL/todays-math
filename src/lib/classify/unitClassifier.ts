/**
 * 힌트 없는 문항의 소단원 판정기 (트랙 G).
 *
 * 두 층으로 판정한다.
 *  1) **범위** — (학년, 학기, 중간/기말) 이 정해지면 출제 범위가 좁아진다.
 *     교육과정 문서를 해석하지 않고 **이미 분류된 문항의 실측 분포**로 만든다.
 *     실측: 735개 후보가 조합당 9~27개로 줄고, 정답 단원이 그 안에 있을 확률 99.1%.
 *  2) **본문** — 범위 안 후보끼리 다항 나이브베이즈로 고른다.
 *
 * 확신이 낮으면 **붙이지 않는다**. 틀린 단원은 엉뚱한 진도의 시험지에 조용히 섞여
 * 들어가므로, 미분류로 남기는 편이 낫다(브리프 §5.5).
 */
import { extractFeatures } from "./features";

export type LabeledDoc = {
  externalId: string;
  examId: string;
  unitId: string;
  gradeKey: string;
  semester: number | null;
  round: string | null;
  text: string;
};

export type Query = {
  gradeKey: string;
  semester: number | null;
  round: string | null;
  text: string;
};

export type Prediction =
  | { status: "unclassified"; reason: string }
  | { status: "mapped"; unitId: string; confidence: number; runnerUpId: string | null; candidateCount: number };

export type Model = {
  /** 특징 → (단원 → 등장 문항 수) */
  posting: Map<string, Map<string, number>>;
  /** 단원 → 특징 총량 */
  featureTotal: Map<string, number>;
  /** 범위키 → (단원 → 문항 수) */
  rangePrior: Map<string, Map<string, number>>;
  /** 학년키 → (단원 → 문항 수) — 범위가 안 잡힐 때의 대체 */
  gradePrior: Map<string, Map<string, number>>;
  vocabularySize: number;
};

/** 라플라스 평활 계수. 실측으로 0.15 가 가장 좋았다(0.05·0.4·1.0 대비). */
const ALPHA = 0.15;

export const rangeKey = (gradeKey: string, semester: number | null, round: string | null): string =>
  `${gradeKey}|${semester ?? "?"}|${round ?? "?"}`;

export function train(docs: LabeledDoc[]): Model {
  const posting = new Map<string, Map<string, number>>();
  const featureTotal = new Map<string, number>();
  const rangePrior = new Map<string, Map<string, number>>();
  const gradePrior = new Map<string, Map<string, number>>();
  const vocabulary = new Set<string>();

  const bump = (table: Map<string, Map<string, number>>, key: string, unitId: string) => {
    let inner = table.get(key);
    if (!inner) { inner = new Map(); table.set(key, inner); }
    inner.set(unitId, (inner.get(unitId) ?? 0) + 1);
  };

  for (const doc of docs) {
    const features = extractFeatures(doc.text);
    featureTotal.set(doc.unitId, (featureTotal.get(doc.unitId) ?? 0) + features.length);
    for (const feature of features) {
      vocabulary.add(feature);
      bump(posting, feature, doc.unitId);
    }
    bump(rangePrior, rangeKey(doc.gradeKey, doc.semester, doc.round), doc.unitId);
    bump(gradePrior, doc.gradeKey, doc.unitId);
  }
  return { posting, featureTotal, rangePrior, gradePrior, vocabularySize: vocabulary.size };
}

/**
 * 후보 단원별 점수. 반환값은 내림차순이며 각 항목의 `score` 는
 * **특징 개수로 나눈** 로그점수다 — 문항 길이에 따라 확신이 부풀지 않게 한다.
 */
export function scoreCandidates(model: Model, query: Query): { unitId: string; score: number }[] {
  const prior =
    model.rangePrior.get(rangeKey(query.gradeKey, query.semester, query.round)) ??
    model.gradePrior.get(query.gradeKey);
  if (!prior || prior.size === 0) return [];

  const priorTotal = [...prior.values()].reduce((a, b) => a + b, 0);
  const features = extractFeatures(query.text);
  const length = Math.max(features.length, 1);

  const scores = new Map<string, number>();
  for (const [unitId, count] of prior) {
    const total = model.featureTotal.get(unitId) ?? 0;
    // 결석 특징의 기여를 미리 한 번에 더해 둔다(희소 합산을 위한 표준 변형).
    scores.set(
      unitId,
      Math.log(count / priorTotal) +
        features.length * Math.log(ALPHA / (total + ALPHA * model.vocabularySize)),
    );
  }
  for (const feature of features) {
    const inner = model.posting.get(feature);
    if (!inner) continue;
    for (const [unitId, count] of inner) {
      const current = scores.get(unitId);
      if (current !== undefined) scores.set(unitId, current + Math.log((count + ALPHA) / ALPHA));
    }
  }
  return [...scores.entries()]
    .map(([unitId, score]) => ({ unitId, score: score / length }))
    .sort((a, b) => b.score - a.score);
}

/**
 * 판정. `minConfidence` 미만이면 미분류로 남긴다.
 * 정확도-채택률 곡선은 `scripts/classify/evaluate-classifier.ts` 가 실측한다.
 */
export function classify(model: Model, query: Query, minConfidence: number): Prediction {
  const ranked = scoreCandidates(model, query);
  if (ranked.length === 0) {
    return { status: "unclassified", reason: "학년·학기·회차로 후보 범위를 만들지 못했습니다." };
  }
  const top = ranked[0].score;
  let partition = 0;
  for (const item of ranked) partition += Math.exp(item.score - top);
  const confidence = 1 / partition;

  if (confidence < minConfidence) {
    return { status: "unclassified", reason: `확신 ${confidence.toFixed(3)} < 기준 ${minConfidence}` };
  }
  return {
    status: "mapped",
    unitId: ranked[0].unitId,
    confidence,
    runnerUpId: ranked[1]?.unitId ?? null,
    candidateCount: ranked.length,
  };
}
