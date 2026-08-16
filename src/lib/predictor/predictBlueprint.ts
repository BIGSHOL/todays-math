/**
 * 학교 출제 패턴 엔진 v0.1 — 다음 회차 청사진 예측.
 *
 * 설계 원칙 (전부 실측 근거가 있다, 11 §2.2·§2.3·§2.7):
 *
 * 1. **예측하는 항목과 안 하는 항목을 가른다.**
 *    문항 수(52.5%)·유형 배분(51.1%)·배점 눈금(43.3%)은 학교 고유성이 확인됐다 → 학교별로 배운다.
 *    난이도 분포(6.9%)는 학교 고유성이 사실상 없다 → **코호트 값을 그대로 쓴다.**
 *    번호별 난이도 곡선(4.4%)도 학교별로 배우지 않는다 → v0.1은 아예 내지 않는다.
 *
 * 2. **계층 축소(shrinkage).** 근거가 적으면 코호트(학교급×학년×과목) 쪽으로 당긴다.
 *    회차가 쌓일수록 학교 고유값의 비중이 자동으로 커진다 —
 *    "몇 학기 돌리면 정확해진다"는 요구가 이 구조로 충족된다.
 *
 * 3. **작년 같은 회차를 무겁게, 오래된 것은 가볍게.**
 *    같은 학기·같은 회차는 시험 범위와 출제 교사가 같을 확률이 높다.
 *
 * 4. **시간 분리를 코드로 강제한다.** 대상 시점 이후(또는 같은 시점) 자료가 하나라도
 *    섞이면 던진다. backtest 숫자만 좋아 보이고 실전에서 무너지는 것을 막는 유일한 장치다.
 */
import {
  blueprintSchema,
  comparePeriod,
  type Blueprint,
  type ExamPeriod,
  type ExamSeriesKey,
  type PredictorParamsSnapshot,
} from "@/contracts/predictor.contract";
import {
  DIFFICULTY_KEYS,
  QUESTION_TYPES,
  type DifficultyKey,
} from "./blueprint";
import { labeledOnly, normalizeMix, type Mix } from "./distance";
import { isSameRound, periodsBack } from "./series";

export interface PredictorParams {
  /** 회차당 가중 감쇠율. 1이면 감쇠 없음. */
  decay: number;
  /** 같은 학기·같은 회차 가중 배수. */
  sameRoundBoost: number;
  /**
   * 코호트 사전값의 가상 표본 수. 클수록 전국 평균 쪽으로 강하게 당긴다.
   *
   * **총점 전용**이다. 총점은 전국이 사실상 100점이라 코호트가 진짜 정보다 —
   * 당길수록 맞는다. 문항 수·유형은 반대라서 `stylePriorWeight` 로 따로 뗐다.
   */
  priorWeight: number;
  /**
   * 학교 고유성이 확인된 항목(문항 수 52.5%, 유형 배분 51.1%)의 코호트 축소.
   *
   * 실측(연도 홀드아웃 2회, 2026-08-16): `priorWeight` 를 낮추면 문항 수·유형은
   * 뚜렷이 좋아지는데 **총점은 두 분할 모두에서 나빠졌다.** 한 파라미터를 공유하면
   * 어느 쪽이든 손해라서 갈랐다. 배점 눈금이 `gridPriorWeight` 로 이미 그렇게 되어 있다.
   */
  stylePriorWeight: number;
  /**
   * 배점 눈금 전용 축소·감쇠. backtest v0.1 에서 배점 눈금만은
   * "직전 회차를 그대로 쓰는" 편이 나았다(0.354 vs 0.382) — 학교가 쓰는 배점 눈금은
   * 평균낼 대상이 아니라 **가장 최근 관행**이기 때문이다. 그래서 따로 둔다.
   */
  gridPriorWeight: number;
  gridDecay: number;
  /**
   * 단원 배분에서 **자기 학교** 과거가 차지하는 비중(0~1). 나머지는 코호트가 채운다.
   *
   * 실측(scratchpad `unit-cohort.py`, 198쌍): 자기 학교 작년 같은 회차만 쓰면 0.440,
   * **다른 학교들의 같은 회차(코호트)만 쓰면 0.399 로 더 낫다.**
   * 진도는 학교마다 비슷하게 나가므로 여러 편을 합친 코호트가 잡음이 적기 때문이다.
   * 0.15~0.35 구간이 평탄하고 0.25 에서 최소(0.391)였다.
   */
  unitOwnWeight: number;
}

/**
 * 계약 ↔ 엔진 파라미터 **양방향** 일치 단언.
 *
 * 한쪽에 필드가 늘거나 줄거나 타입이 달라지면 **여기서 컴파일이 깨진다.**
 * 예전에는 계약 쪽에 같은 형태를 한 벌 더 두어서, v0.5 에서 `stylePriorWeight` 가
 * 늘었을 때 표류가 런타임 500(18건)으로만 드러났다. 그 자리를 컴파일로 당겨왔다.
 */
type ExactSame<A, B> = A extends B ? (B extends A ? true : never) : never;
export const PREDICTOR_PARAMS_MATCH_CONTRACT: ExactSame<
  PredictorParams,
  PredictorParamsSnapshot
> = true;

/**
 * 엔진 버전 — **단일 정의**. `PredictionRun.engineVersion` 과 backtest 리포트가 같은 값을 쓴다.
 * 예전에는 서비스와 `scripts/predictor/backtest.ts` 에 문자열이 따로 있어, 한쪽만 올리면
 * 지표와 실행 기록이 조용히 다른 축이 됐다.
 *
 * ⚠️ **`DEFAULT_PARAMS` 를 바꾸면 이 값을 함께 올린다.** 파라미터가 다른 run 을
 *    같은 버전으로 묶으면 보정 비교가 오염된다. 근거는 11 §12.
 */
export const PREDICTOR_ENGINE_VERSION = "0.5.0";

export const DEFAULT_PARAMS: PredictorParams = {
  decay: 0.85,
  // 작년 같은 회차를 4배로 본다(기존 2배). 연도 홀드아웃 2회(2024·2025)에서
  // **모든 항목이 개선**됐고 나빠진 항목이 없었다 — 범위와 출제 교사가 같을 확률이
  // 그만큼 높다는 뜻이다.
  sameRoundBoost: 4,
  priorWeight: 2,
  // 문항 수·유형은 코호트로 거의 당기지 않는다(2 → 0.5). 학교 고유성이 확인된
  // 항목이라 전국 평균으로 당길수록 손해다. 0 이 한 분할에서 더 좋았지만,
  // **과거가 1회차뿐인 학교**를 규제 없이 그대로 믿게 되므로 0.5 로 둔다 —
  // 축소는 바로 그 경우를 위해 있는 장치다.
  stylePriorWeight: 0.5,
  // 배점 눈금은 코호트로 당기지 않는다(0) — 학교가 쓰는 눈금은 전국 평균과 무관한 관행이다.
  // 감쇠도 세게 건다(0.4) — 평균보다 **최근 관행**이 맞는다.
  // 2024년 이전으로 고르고 2025년으로 확인했다(scripts/predictor/tune.ts).
  // 배점 눈금만 좋아지고 나머지 지표는 그대로였다 — 그래서 이것만 채택했다.
  gridPriorWeight: 0,
  gridDecay: 0.4,
  unitOwnWeight: 0.25,
};

export interface PredictInput {
  series: ExamSeriesKey;
  target: ExamPeriod;
  /** 그 학교의 과거 실측 청사진. **대상 시점 이전만.** */
  history: Blueprint[];
  /** 같은 학교급×학년×과목의 다른 학교 실측 청사진(코호트 사전값). */
  cohort: Blueprint[];
  /**
   * 단원 배분 전용 이력 — **시험 범위 단위**(학교,급,학년,**과목**)로 좁힌 것.
   * 과목이 다르면 시험 범위가 아예 다르므로 단원은 절대 섞으면 안 된다(11 §3 L1).
   * 주지 않으면 history 를 그대로 쓴다.
   */
  rangeHistory?: Blueprint[];
  rangeCohort?: Blueprint[];
  params?: Partial<PredictorParams>;
}

function assertNoLeakage(
  items: Blueprint[],
  target: ExamPeriod,
  label: string,
) {
  for (const bp of items) {
    if (comparePeriod(bp.period, target) >= 0) {
      throw new Error(
        `시간 분리 위반: ${label}에 대상 시점(${target.year}-${target.semester}-${target.round}) ` +
          `이후 자료가 들어 있다 (${bp.period.year}-${bp.period.semester}-${bp.period.round}).`,
      );
    }
  }
}

function weightOf(
  bp: Blueprint,
  target: ExamPeriod,
  params: PredictorParams,
  decay = params.decay,
): number {
  const back = Math.max(0, periodsBack(target, bp.period));
  const decayed = decay ** back;
  return decayed * (isSameRound(target, bp.period) ? params.sameRoundBoost : 1);
}

function weightedMean(
  pairs: Array<{ weight: number; value: number }>,
): { value: number; weight: number } | null {
  let num = 0;
  let den = 0;
  for (const { weight, value } of pairs) {
    num += weight * value;
    den += weight;
  }
  return den > 0 ? { value: num / den, weight: den } : null;
}

/** 표본 평균을 사전값 쪽으로 당긴다. 근거 가중이 클수록 표본 쪽에 가까워진다. */
function shrink(
  sample: { value: number; weight: number } | null,
  prior: number | null,
  priorWeight: number,
): number {
  if (!sample) return prior ?? 0;
  if (prior === null) return sample.value;
  return (
    (sample.value * sample.weight + prior * priorWeight) /
    (sample.weight + priorWeight)
  );
}

function meanOf(values: number[]): number | null {
  return values.length
    ? values.reduce((s, v) => s + v, 0) / values.length
    : null;
}

/** 가중 평균 분포(비율). */
function weightedMix(
  entries: Array<{ weight: number; mix: Mix }>,
): { mix: Mix; weight: number } | null {
  const acc: Mix = {};
  let total = 0;
  for (const { weight, mix } of entries) {
    const norm = normalizeMix(mix);
    for (const [k, v] of Object.entries(norm))
      acc[k] = (acc[k] ?? 0) + weight * v;
    total += weight;
  }
  return total > 0 ? { mix: normalizeMix(acc), weight: total } : null;
}

function shrinkMix(
  sample: { mix: Mix; weight: number } | null,
  prior: Mix | null,
  priorWeight: number,
): Mix {
  if (!sample) return prior ? normalizeMix(prior) : {};
  if (!prior || Object.keys(prior).length === 0) return sample.mix;
  const acc: Mix = {};
  const keys = new Set([...Object.keys(sample.mix), ...Object.keys(prior)]);
  for (const k of keys) {
    acc[k] =
      ((sample.mix[k] ?? 0) * sample.weight + (prior[k] ?? 0) * priorWeight) /
      (sample.weight + priorWeight);
  }
  return normalizeMix(acc);
}

/** 두 분포를 고정 비율로 섞는다. 한쪽이 없으면 다른 쪽을 그대로 쓴다. */
function blendMix(
  own: Mix | undefined,
  prior: Mix | undefined,
  ownWeight: number,
): Mix {
  if (!own || Object.keys(own).length === 0)
    return prior ? normalizeMix(prior) : {};
  if (!prior || Object.keys(prior).length === 0) return normalizeMix(own);
  const out: Mix = {};
  for (const k of new Set([...Object.keys(own), ...Object.keys(prior)])) {
    out[k] = ownWeight * (own[k] ?? 0) + (1 - ownWeight) * (prior[k] ?? 0);
  }
  return normalizeMix(out);
}

function countsMix(
  cells: Record<string, { count: number; score: number }>,
): Mix {
  const out: Mix = {};
  for (const [k, v] of Object.entries(cells)) out[k] = v.count;
  return out;
}

function gridMix(bp: Blueprint): Mix {
  const out: Mix = {};
  for (const row of bp.scoreHistogram)
    out[String(row.score)] = (out[String(row.score)] ?? 0) + row.count;
  return out;
}

function unitMixOf(bp: Blueprint): Mix {
  const out: Mix = {};
  for (const row of bp.unitMix) {
    const key = row.unitId ?? `raw:${row.topicRaw ?? "(없음)"}`;
    out[key] = (out[key] ?? 0) + row.count;
  }
  return out;
}

/** 근거가 하나도 없을 때 던진다. 없는 예측을 지어내는 것보다 못 한다고 말하는 편이 낫다. */
export class PredictorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PredictorUnavailableError";
  }
}

export function predictBlueprint(input: PredictInput): Blueprint {
  const params = { ...DEFAULT_PARAMS, ...input.params };
  const { series, target, history, cohort } = input;

  // 🔴 근거가 하나도 없으면 청사진을 만들지 않는다.
  //    예전에는 questionCount=0 · totalScore=0 인 계약 위반 청사진을 조용히 냈고,
  //    화면에는 "0문항 0점짜리 시험이 예상됩니다" 로 나갔다(2026-08-16 재현).
  if (history.length === 0 && cohort.length === 0) {
    throw new PredictorUnavailableError(
      `근거 없음 — ${series.school} ${series.level}${series.grade} ${series.subject} ` +
        `${target.year}-${target.semester}-${target.round}: 과거 회차도 코호트도 없다.`,
    );
  }

  assertNoLeakage(history, target, "history");
  assertNoLeakage(cohort, target, "cohort");
  if (input.rangeHistory)
    assertNoLeakage(input.rangeHistory, target, "rangeHistory");
  if (input.rangeCohort)
    assertNoLeakage(input.rangeCohort, target, "rangeCohort");

  const weighted = history.map((bp) => ({
    bp,
    weight: weightOf(bp, target, params),
  }));
  const evidenceWeight = weighted.reduce((s, w) => s + w.weight, 0);

  // ── 문항 수 · 총점 — 학교 고유값 + 코호트 축소 ──
  const questionCount = shrink(
    weightedMean(
      weighted.map((w) => ({ weight: w.weight, value: w.bp.questionCount })),
    ),
    meanOf(cohort.map((c) => c.questionCount)),
    params.stylePriorWeight,
  );
  const totalScore = shrink(
    weightedMean(
      weighted.map((w) => ({ weight: w.weight, value: w.bp.totalScore })),
    ),
    meanOf(cohort.map((c) => c.totalScore)),
    params.priorWeight,
  );

  // ── 유형 배분 — 학교 고유성이 확인된 항목(51.1%) ──
  const typeMixRatio = shrinkMix(
    weightedMix(
      weighted.map((w) => ({ weight: w.weight, mix: countsMix(w.bp.typeMix) })),
    ),
    weightedMix(cohort.map((c) => ({ weight: 1, mix: countsMix(c.typeMix) })))
      ?.mix ?? null,
    params.stylePriorWeight,
  );

  // ── 난이도 분포 — 학교별로 배우지 않는다(§2.3·§2.7). 코호트 값을 쓴다. ──
  // '미표기'는 난이도가 아니므로 사전값에서 뺀다. 라벨이 하나도 없는 편은
  // 정규화 결과가 빈 분포가 되어 자동으로 사전값 계산에서 빠진다.
  const labeledMix = (bp: Blueprint) => labeledOnly(bp.difficultyMix);
  const cohortDifficulty = weightedMix(
    cohort.map((c) => ({ weight: 1, mix: labeledMix(c) })),
  )?.mix;
  const difficultyRatio =
    cohortDifficulty ??
    // 코호트가 아예 없을 때만 어쩔 수 없이 학교 과거를 쓴다(근거 없음보다는 낫다).
    weightedMix(
      weighted.map((w) => ({ weight: w.weight, mix: labeledMix(w.bp) })),
    )?.mix ??
    {};

  // ── 배점 눈금 (43.3%) · 단원 배분 ──
  const gridRatio = shrinkMix(
    weightedMix(
      history.map((bp) => ({
        weight: weightOf(bp, target, params, params.gridDecay),
        mix: gridMix(bp),
      })),
    ),
    weightedMix(cohort.map((c) => ({ weight: 1, mix: gridMix(c) })))?.mix ??
      null,
    params.gridPriorWeight,
  );
  // ── 단원 배분 ──
  // 단원은 학교 성향이 아니라 **그 학기 진도**가 정한다. 그래서 두 가지를 지킨다:
  //   (1) 같은 회차(같은 학기·같은 중간/기말)로 좁힌다 — 직전 회차는 범위가 아예 다르다
  //       (실측 Jaccard 0.055 vs 작년 같은 회차 0.551).
  //   (2) 자기 학교보다 코호트를 무겁게 본다 — 진도는 공통이고 코호트가 표본이 많다.
  const sameRound = (list: Blueprint[]) =>
    list.filter((bp) => isSameRound(target, bp.period));
  const sameRoundOrAll = (list: Blueprint[]) => {
    const sr = sameRound(list);
    return sr.length ? sr : list;
  };
  // ⚠️ 자기 학교는 **같은 회차가 있을 때만** 쓴다. 없으면 아예 안 쓴다 —
  //    다른 회차를 대신 넣으면 범위가 달라 오히려 나빠진다(실측 Jaccard 0.055).
  const unitOwn = weightedMix(
    sameRound(input.rangeHistory ?? history).map((bp) => ({
      weight: weightOf(bp, target, params),
      mix: unitMixOf(bp),
    })),
  )?.mix;
  const unitPrior = weightedMix(
    sameRoundOrAll(input.rangeCohort ?? cohort).map((bp) => ({
      weight: 1,
      mix: unitMixOf(bp),
    })),
  )?.mix;
  const unitRatio = blendMix(unitOwn, unitPrior, params.unitOwnWeight);

  const scale = questionCount;
  const perQuestionScore = questionCount > 0 ? totalScore / questionCount : 0;

  const typeMix = Object.fromEntries(
    QUESTION_TYPES.map((t) => [
      t,
      {
        count: (typeMixRatio[t] ?? 0) * scale,
        score: (typeMixRatio[t] ?? 0) * scale * perQuestionScore,
      },
    ]),
  ) as Blueprint["typeMix"];

  const difficultyMix = Object.fromEntries(
    DIFFICULTY_KEYS.map((d: DifficultyKey) => [
      d,
      {
        count: (difficultyRatio[d] ?? 0) * scale,
        score: (difficultyRatio[d] ?? 0) * scale * perQuestionScore,
      },
    ]),
  ) as Blueprint["difficultyMix"];

  // 단원 키는 uuid 또는 `raw:원문표기` 다 — 되돌려 담는다.
  const unitMix = Object.entries(unitRatio)
    .filter(([, v]) => v > 0)
    .map(([key, ratio]) => {
      const isRaw = key.startsWith("raw:");
      return {
        unitId: isRaw ? null : key,
        topicRaw: isRaw ? key.slice(4) : null,
        count: ratio * scale,
        score: ratio * scale * perQuestionScore,
      };
    });

  const blueprint: Blueprint = {
    kind: "predicted",
    series,
    period: target,
    questionCount,
    totalScore,
    typeMix,
    difficultyMix,
    scoreHistogram: Object.entries(gridRatio)
      .filter(([, v]) => v > 0)
      .map(([score, ratio]) => ({ score: Number(score), count: ratio * scale }))
      .sort((a, b) => a.score - b.score),
    // 번호별 난이도 곡선은 학교 고유성이 4.4%뿐이라 v0.1은 내지 않는다(§2.2).
    positionCurve: [],
    unitMix,
    // 난이도 지수 → 점수 환산 계수가 아직 없다(§2.7-3). 학생 데이터가 쌓이면 채운다.
    expectedMean: null,
    expectedMeanInterval: null,
    evidenceCount: history.length,
    confidence: evidenceWeight / (evidenceWeight + params.priorWeight),
  };

  // 자기 출력을 계약으로 검증한다. 안 하면 위반이 조용히 하류로 샌다.
  const checked = blueprintSchema.safeParse(blueprint);
  if (!checked.success) {
    throw new PredictorUnavailableError(
      `청사진이 계약을 위반한다 — ${checked.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .slice(0, 3)
        .join(" / ")}`,
    );
  }
  return blueprint;
}
