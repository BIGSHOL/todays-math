/**
 * 배점 보정기 — 짜깁기 시험지의 문항별 배점을 그 학교 눈금 안에서 조정해 **합계 100** 으로 만든다.
 *
 * 설계 SSOT: docs/planning/11-score-predictor.md §10 (원장님 지시 D-42).
 * 순수 함수다. DB·네트워크·시간에 의존하지 않는다.
 *
 * ## 무엇을 고치는가 (11 §10.1)
 *
 * `gradeAnswers` 는 배점을 `Problem.score ?? (100 / 문항수)` 로 잡는다. 기출 문항은 `score` 가
 * 있고 자작·AI 문항은 NULL 이라, 둘을 섞으면 만점이 100 이 아니게 된다(문서의 예: 5문항 중
 * 2개가 3.5점, 3개가 NULL → 만점 67). 점수 예측기는 100점 만점을 전제로 0~100 clamp 하므로
 * **조용히 왜곡된다.** 예측 문제지는 정의상 짜깁기이므로 반드시 이 경로를 탄다.
 *
 * ## 산식 (11 §10.3 — 임의로 바꾸지 말 것)
 *
 *   1) 각 문항에 눈금 후보를 배정   (유형·난이도 → scoreHistogram 의 눈금)
 *   2) 합계 S 를 구한다
 *   3) 비례 축소:  raw_i = target_i × 100 / S
 *   4) 눈금 스냅:  각 raw_i 를 가장 가까운 눈금으로 내림
 *   5) 최대잉여법: 남은 점수를 잔여(raw_i − 스냅값)가 큰 문항부터 한 눈금씩 올려 100을 채운다
 *
 * 동점이면 **문항 번호가 큰 쪽**에 먼저 준다 — 뒤로 갈수록 어렵다는 전국 공통 경향(11 §2.2).
 *
 * ## 문서에 없어서 여기서 정한 것 (근거를 남긴다)
 *
 * - **부동소수를 쓰지 않는다.** 눈금은 3.2·2.5·3.75 처럼 소수라 실수 덧셈으로는 합이 100.00000000000001
 *   이 된다("0.1+0.2 문제"). 모든 계산을 **0.01점 단위 정수(centi)** 로 하고 마지막에만 나눈다.
 *   0.01 로 떨어지지 않는 눈금(3.333 등)은 정확히 다룰 수 없으므로 `눈금_해상도_초과` 로 돌려준다.
 * - **§10.3-4 의 "내림" 이 최저 눈금보다 아래로 내려갈 때**는 최저 눈금으로 둔다. 그보다 낮은 값은
 *   그 학교 눈금이 아니므로 지어내는 것이 된다.
 * - **1차 배정 합이 100 을 넘는 경우**(그 학교 눈금 평균 × 문항 수 > 100)가 실제로 생긴다.
 *   §10.3-5 를 뒤집어 잔여가 **작은** 문항부터 한 눈금씩 내린다. 동점이면 번호가 작은 쪽부터 —
 *   "큰 번호에 먼저 준다"의 대칭이다.
 * - **최대잉여법이 100 에 정확히 못 닿는 경우가 남는다.** 눈금 간격이 성겨서 마지막 몇 점이
 *   어떤 한 눈금 상승으로도 안 맞는 경우다. 이때는 도달 가능성 DP(`buildReach`)로
 *   ① 애초에 100 이 가능한 조합인지 판정하고 ② 가능하면 §10.3 의 우선순위(잔여 큰 순)를 지키면서
 *   합계를 정확히 100 으로 닫는다. 불가능하면 **값을 지어내지 않고 `합계_100_불가`** 를 돌려준다.
 *   실측(코퍼스 1,448편의 실제 눈금 × 문항수 ±3)으로 **97.9% 가 정확히 100 도달 가능**이었다.
 *   이 보정 단계는 최대잉여법이 이미 100 을 맞췄으면 아무것도 바꾸지 않는다(no-op).
 *
 * ## 절대 하지 않는 것
 *
 * - `Problem.score`(원본 기출 배점)를 쓰지 않는다. 읽지도 않는다 — 사본으로만 들고 다닌다.
 *   조정값은 `TestProblem.score` 에 싣는다(11 §10.2-4). 덮어쓰면 학습 코퍼스가 오염된다.
 * - 눈금 집합에 없는 값을 만들지 않는다. 배점 눈금은 학교 고유성 43.3% 로 강한 신호다(11 §2.2).
 * - 근거가 없으면 판단 불가를 돌려준다. 0문항 0점 청사진을 낸 전례가 있다.
 */
import type {
  Blueprint,
  DifficultyLabel,
  QuestionType,
} from "@/contracts/predictor.contract";
import type {
  JudgementUnavailable,
  JudgementUnavailableReason,
  ManualScoreCheck,
  NormalizedQuestion,
  NormalizerQuestion,
  ScoreNormalization,
} from "@/contracts/scoreNormalizer.contract";

import { EXAM_FULL_MARK } from "./paperTrust";

/** 배점 해상도 — 0.01점. 모든 내부 계산은 이 단위의 정수로 한다. */
export const SCORE_SCALE = 100;

/** 만점(정수 단위). `EXAM_FULL_MARK` 과 한 소스를 쓴다. */
const FULL_MARK = EXAM_FULL_MARK * SCORE_SCALE;

/** 유형 가중 — 서술형이 높은 눈금을 먼저 가져간다(11 §10.2-3). */
const QTYPE_WEIGHT: Record<QuestionType, number> = {
  객관식: 0,
  단답형: 1,
  서술형: 2,
};

/** 난이도 가중 — 상 난이도가 높은 눈금을 먼저 가져간다. */
const LABEL_WEIGHT: Record<DifficultyLabel, number> = { 하: 0, 중: 0.5, 상: 1 };

/**
 * 라벨이 없는 문항(실측 14%)의 **순위**만 가운데로 둔다.
 * 난이도 값을 "중"이라고 기록하지는 않는다 — 없는 정보를 만들지 않는다.
 */
const UNLABELED_RANK = 0.5;

/**
 * 배점을 0.01점 단위 정수로. 그 단위로 떨어지지 않으면 null.
 * 실측 눈금은 3.2·2.5·3.75 처럼 전부 소수 둘째 자리 안이다.
 */
export function toCenti(score: number): number | null {
  const scaled = score * SCORE_SCALE;
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : null;
}

/**
 * 배점 합 — 0.01점 단위 정수로 더한 뒤 되돌린다.
 * 실수로 그냥 더하면 `0.1 + 0.2 + 99.7 = 100.00000000000001` 이 된다.
 */
export function sumScores(scores: readonly number[]): number {
  let total = 0;
  for (const score of scores) total += Math.round(score * SCORE_SCALE);
  return total / SCORE_SCALE;
}

function unavailable(
  reason: JudgementUnavailableReason,
  detail: string,
): JudgementUnavailable {
  return { ok: false, judgement: "판단 불가", reason, detail };
}

/** 점수 표기 — 3.50 은 "3.5", 100.00 은 "100". */
function formatPoints(centi: number): string {
  return String(Number((centi / SCORE_SCALE).toFixed(2)));
}

/**
 * 최대잉여법 — 비율을 정수 개수로 나눈다. 가중치 합이 0보다 크면 결과 합이 반드시 `total` 이다.
 * 동점이면 **뒤 인덱스에 먼저** 준다. 눈금을 오름차순으로 넘기면 곧 "높은 눈금 먼저"가 된다.
 *
 * 가중치가 전부 0이면 **아무 칸도 만들지 않는다**(전부 0). 없는 분포를 균등분포로 지어내면
 * 난이도 라벨 같은 축에서 없는 정보를 만들게 되므로, 균등 분배가 필요한 쪽이 직접 정하게 한다.
 * 예측 문제지 생성기(`composePredictedPaper`)와 이 산식을 한 벌만 쓰려고 export 한다.
 */
export function largestRemainder(
  weights: readonly number[],
  total: number,
): number[] {
  const base = weights.map(() => 0);
  const sum = weights.reduce((acc, w) => acc + Math.max(w, 0), 0);
  if (total <= 0 || weights.length === 0 || sum <= 0) return base;

  const exact = weights.map((w) => (Math.max(w, 0) * total) / sum);
  exact.forEach((value, index) => {
    base[index] = Math.floor(value);
  });

  let left = total - base.reduce((acc, v) => acc + v, 0);
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || b.index - a.index);

  for (const item of order) {
    if (left <= 0) break;
    base[item.index] += 1;
    left -= 1;
  }
  return base;
}

/** 오름차순 눈금에서 `raw` 이하의 가장 큰 눈금. 최저 눈금보다 작으면 최저 눈금. */
function floorToGrid(raw: number, grid: readonly number[]): number {
  let out = grid[0];
  for (const value of grid) {
    if (value <= raw + 1e-9) out = value;
    else break;
  }
  return out;
}

/** `k` 개의 눈금으로 만들 수 있는 합의 집합. `reach[k][s]` 가 1이면 가능. */
function buildReach(
  grid: readonly number[],
  count: number,
  target: number,
): Uint8Array[] {
  const reach: Uint8Array[] = [new Uint8Array(target + 1)];
  reach[0][0] = 1;
  for (let k = 1; k <= count; k += 1) {
    const prev = reach[k - 1];
    const cur = new Uint8Array(target + 1);
    for (let s = 0; s <= target; s += 1) {
      if (!prev[s]) continue;
      for (const value of grid) {
        const next = s + value;
        if (next <= target) cur[next] = 1;
      }
    }
    reach[k] = cur;
  }
  return reach;
}

export interface NormalizeScoresInput {
  questions: readonly NormalizerQuestion[];
  /** 청사진 `scoreHistogram` — 그 학교가 쓰는 배점 눈금과 빈도. */
  histogram: Blueprint["scoreHistogram"];
}

export function normalizeScores(
  input: NormalizeScoresInput,
): ScoreNormalization {
  const { questions, histogram } = input;
  const n = questions.length;

  if (n === 0) {
    return unavailable("문항_없음", "보정할 문항이 없습니다.");
  }

  // ── 눈금 집합 ────────────────────────────────────────────────
  const weightByValue = new Map<number, number>();
  for (const row of histogram) {
    if (row.score <= 0) continue;
    const centi = toCenti(row.score);
    if (centi === null) {
      return unavailable(
        "눈금_해상도_초과",
        `배점 눈금 ${row.score} 은 0.01점 단위가 아닙니다.`,
      );
    }
    weightByValue.set(centi, (weightByValue.get(centi) ?? 0) + Math.max(row.count, 0));
  }

  if (weightByValue.size === 0) {
    return unavailable(
      "눈금_없음",
      "그 학교의 배점 눈금 이력이 없어 배점을 정할 수 없습니다.",
    );
  }

  const grid = [...weightByValue.keys()].sort((a, b) => a - b);

  // ── 1) 유형·난이도 순으로 눈금 후보 배정 ────────────────────────
  // 예측 청사진은 빈도가 전부 0 인 눈금 집합을 낼 수 있다. 그때만 눈금을 고르게 쓴다 —
  // 눈금 값 자체는 실측이고 빈도만 없는 것이라, 집합 안에서의 균등이 가장 덜 지어내는 선택이다.
  const gridWeights = grid.map((value) => weightByValue.get(value) ?? 0);
  const slotCounts = largestRemainder(
    gridWeights.some((w) => w > 0) ? gridWeights : grid.map(() => 1),
    n,
  );
  const slotValues: number[] = [];
  grid.forEach((value, index) => {
    for (let k = 0; k < slotCounts[index]; k += 1) slotValues.push(value);
  });

  const rank = (q: NormalizerQuestion): number =>
    QTYPE_WEIGHT[q.qtype] +
    (q.difficultyLabel === null
      ? UNLABELED_RANK
      : LABEL_WEIGHT[q.difficultyLabel]);

  // 낮은 순위 → 낮은 눈금. 동점이면 번호가 큰 쪽이 뒤로 가 높은 눈금을 받는다.
  const byRank = questions
    .map((q, index) => ({ index, rank: rank(q), number: q.number }))
    .sort((a, b) => a.rank - b.rank || a.number - b.number);

  const target = new Array<number>(n);
  byRank.forEach((item, position) => {
    target[item.index] = slotValues[position];
  });

  // ── 2~4) 비례 축소 후 눈금으로 내림 ──────────────────────────
  const targetSum = target.reduce((acc, value) => acc + value, 0);
  const value = new Array<number>(n);
  const residual = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    const raw = (target[i] * FULL_MARK) / targetSum;
    value[i] = floorToGrid(raw, grid);
    residual[i] = raw - value[i];
  }

  // ── 5) 최대잉여법으로 100 을 채운다 ──────────────────────────
  const indices = Array.from({ length: n }, (_, i) => i);
  const upOrder = [...indices].sort(
    (a, b) =>
      residual[b] - residual[a] || questions[b].number - questions[a].number,
  );
  // 1차 배정 합이 100 을 넘으면 반대로 내린다 — 잔여가 작은 문항부터, 동점이면 번호가 작은 쪽부터.
  const downOrder = [...upOrder].reverse();
  const descGrid = [...grid].reverse();

  let sum = value.reduce((acc, v) => acc + v, 0);

  for (let pass = 0; sum !== FULL_MARK && pass < n + 1; pass += 1) {
    let changed = false;
    if (sum < FULL_MARK) {
      for (const i of upOrder) {
        const next = grid.find((g) => g > value[i]);
        if (next === undefined) continue;
        if (next - value[i] > FULL_MARK - sum) continue;
        sum += next - value[i];
        value[i] = next;
        changed = true;
        if (sum === FULL_MARK) break;
      }
    } else {
      for (const i of downOrder) {
        const lower = descGrid.find((g) => g < value[i]);
        if (lower === undefined) continue;
        if (value[i] - lower > sum - FULL_MARK) continue;
        sum -= value[i] - lower;
        value[i] = lower;
        changed = true;
        if (sum === FULL_MARK) break;
      }
    }
    if (!changed) break;
  }

  // ── 정확히 100 으로 닫는다 (위 최대잉여법이 이미 맞췄으면 no-op) ──
  if (sum !== FULL_MARK) {
    const reach = buildReach(grid, n, FULL_MARK);
    if (!reach[n][FULL_MARK]) {
      return unavailable(
        "합계_100_불가",
        `배점 눈금 ${grid.map((g) => formatPoints(g)).join("·")} 로는 ${n}문항 합계 ${EXAM_FULL_MARK}점을 만들 수 없습니다.`,
      );
    }

    let remaining = FULL_MARK;
    let left = n;
    for (const i of upOrder) {
      left -= 1;
      const preferred = value[i];
      // 최대잉여법이 정한 값에 가장 가까운 눈금부터. 같으면 높은 쪽을 먼저 준다.
      const options = [...grid].sort(
        (a, b) =>
          Math.abs(a - preferred) - Math.abs(b - preferred) || b - a,
      );
      const picked = options.find(
        (option) => remaining - option >= 0 && reach[left][remaining - option],
      );
      if (picked === undefined) {
        return unavailable(
          "합계_100_불가",
          `배점 눈금 ${grid.map((g) => formatPoints(g)).join("·")} 로는 ${n}문항 합계 ${EXAM_FULL_MARK}점을 만들 수 없습니다.`,
        );
      }
      value[i] = picked;
      remaining -= picked;
    }
  }

  const normalized: NormalizedQuestion[] = questions.map((q, i) => ({
    number: q.number,
    qtype: q.qtype,
    difficultyLabel: q.difficultyLabel,
    // 원본 기출 배점은 사본으로만 나른다 — 보정에 쓰지 않고 덮어쓰지도 않는다.
    originalScore: q.originalScore,
    score: value[i] / SCORE_SCALE,
  }));

  return {
    ok: true,
    questions: normalized,
    totalScore: EXAM_FULL_MARK,
    grid: grid.map((g) => g / SCORE_SCALE),
  };
}

/**
 * 원장 수동 조정 검증 (11 §10.4).
 *
 * 합계가 100 이 아니면 **저장을 거부하고 남은 점수를 알린다.**
 * 자동으로 다른 문항을 건드려 사용자를 놀라게 하지 않는다 — 고칠 곳은 원장이 정한다.
 * 눈금 밖 배점은 막지 않고 알리기만 한다(수동 조정은 원장의 권한이다).
 *
 * ⚠️ **문항 번호가 중복되면 합계를 세기 전에 거부한다.** 번호를 보지 않고 배점만 더하면
 *    같은 문항을 여러 번 세어 합계 100 을 만들 수 있고, 저장은 번호로 되짚어 덮어쓰므로
 *    실제 만점은 100 이 아니게 된다(2026-08-16 적대적 리뷰 재현: 응답 100 / 실제 148).
 *    이 검사는 **여기 한 곳에만 둔다.** 호출자(`saveManualScores`)에 같은 검사를 겹쳐 두면
 *    한쪽을 지워도 테스트가 빨개지지 않아 가드가 살아 있는지 확인할 수 없다.
 */
export function validateManualScores(
  questions: ReadonlyArray<{ number: number; score: number }>,
  grid?: readonly number[],
): ManualScoreCheck {
  const gridCenti = new Set<number>();
  for (const value of grid ?? []) {
    const centi = toCenti(value);
    if (centi !== null) gridCenti.add(centi);
  }

  const offGrid: number[] = [];
  let total = 0;
  let malformed = false;
  const seen = new Set<number>();
  const duplicated: number[] = [];

  for (const q of questions) {
    if (seen.has(q.number)) duplicated.push(q.number);
    else seen.add(q.number);

    const centi = toCenti(q.score);
    if (centi === null || centi <= 0) {
      malformed = true;
      continue;
    }
    total += centi;
    if (gridCenti.size > 0 && !gridCenti.has(centi)) offGrid.push(q.number);
  }

  const remaining = FULL_MARK - total;

  // 합계보다 먼저 본다 — 중복으로 채운 합계 100 은 100 이 아니다.
  if (duplicated.length > 0) {
    const numbers = [...new Set(duplicated)].sort((a, b) => a - b);
    return {
      ok: false,
      issue: "문항_중복",
      total: total / SCORE_SCALE,
      remaining: remaining / SCORE_SCALE,
      message: `${numbers.join("·")}번 문항의 배점이 여러 번 들어왔습니다.`,
      offGrid,
    };
  }

  if (malformed) {
    return {
      ok: false,
      issue: "배점_형식오류",
      total: total / SCORE_SCALE,
      remaining: remaining / SCORE_SCALE,
      message: "배점은 0보다 큰 0.01점 단위여야 합니다.",
      offGrid,
    };
  }

  if (remaining !== 0) {
    const shortage = remaining > 0;
    return {
      ok: false,
      issue: "합계_불일치",
      total: total / SCORE_SCALE,
      remaining: remaining / SCORE_SCALE,
      message: `합계 ${formatPoints(total)} — ${formatPoints(Math.abs(remaining))}점 ${shortage ? "남음" : "초과"}`,
      offGrid,
    };
  }

  return { ok: true, total: EXAM_FULL_MARK, offGrid };
}
