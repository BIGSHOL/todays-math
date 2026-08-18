/**
 * 예측 문제지 생성기 (L6) — 청사진의 칸을 문제은행으로 채우고 배점을 100점으로 보정한다.
 *
 * 설계 SSOT: docs/planning/11-score-predictor.md §3 L6 · §10 · §11.
 * 순수 함수다. DB·네트워크·시간에 의존하지 않는다 — 후보는 호출자가 조회해 넘긴다.
 *
 * ## 왜 배점 보정이 필수인가
 *
 * 청사진의 각 칸(단원 × 난이도 × 유형 × 배점)을 문제은행에서 채우므로 한 장 안에 기출·자작·
 * RPM·AI 변형이 섞인다. 기출만 `Problem.score` 를 갖고 나머지는 NULL 이라 손대지 않으면
 * 만점이 100 이 아닌 시험지가 나간다(11 §10.1). 그래서 마지막에 반드시 `normalizeScores` 를
 * 거쳐 `TestProblem.score` 를 채운다(원장님 지시 D-42).
 *
 * ## 재료 (11 §3 L6 우선순위)
 *
 *   ① 그 학교 과거 출제 문항  ② 같은 단원·난이도 기출  ③ 자작/RPM  ④ AI 변형
 *
 * ①의 근거가 되는 과거 시험지는 **만점 100 신뢰 가드**(11 §11, D-45)를 통과한 편만 쓴다.
 * 잘린 시험지를 그 학교 관행으로 배우면 안 된다.
 *
 * ⚠️ 순서를 하나 뒤집었다 — **칸 일치(②)를 먼저 보고 그 안에서 ①을 우선**한다.
 * 목록은 "한 칸을 무엇으로 채우나"의 순서로 읽는다. 2026-08-16 실측으로 확정했다(D-49).
 *
 *   - 학교가 같은 문항을 다시 내는 일은 **거의 없다**: 시리즈 511개, 첫 편 이후 문항
 *     25,167개 중 앞선 회차와 본문이 같은 것이 **11개(0.04%)**.
 *     숫자만 바꾼 재출제까지 세도 24,378개 중 **13개(0.05%)** 로 같다.
 *   - 게다가 그 드문 재출제의 **9/13 이 다른 회차**에서 온다 — 시험 범위가 다른 문항이다.
 *     ①을 맨 앞에 두면 하필 그 경우에 범위 밖 문항이 맞는 칸을 밀어낸다.
 *
 * 즉 순서를 어느 쪽으로 두든 **2,000자리에 한 자리꼴**로만 달라지지만, ①을 앞에 두면
 * 그 드문 한 자리에서 손해를 본다. 그래서 칸을 앞에 둔다.
 *
 * ⚠️ 이 실측의 한계: 문자열(공백·숫자 제거) 일치로만 셌다. **말을 바꿔 낸 유사 문항은
 * 못 잡는다.** 의미 유사도는 엔진이 없어 아직 재지 못했다 — ①을 "유사"까지 넓히려면
 * 그 엔진을 먼저 만들고 이 판단을 다시 재야 한다.
 *
 * ## 칸 배치 — 문서에 없어서 여기서 정한 것
 *
 * 청사진은 유형·난이도·단원을 각각 **주변 분포**로만 준다. 이걸 문항 자리에 펼치려면 순서를
 * 정해야 하는데, 학교별로 배우지 않는다 — 번호별 난이도 곡선은 학교 고유성이 4.4% 뿐이라
 * 학교별로 학습하면 표본 잡음을 패턴으로 착각한다(11 §2.2, §3 L1). 그래서 전국 공통 경향만 쓴다.
 *
 *   - 유형: 객관식 → 단답형 → 서술형 순으로 지면에 놓는다(실제 내신 배치).
 *   - 난이도: 하 → 중 → 상 순. 라벨 없는 칸(미표기)은 **제약 없음**으로 두고 고르게 흩는다.
 *     빈 라벨을 "중"으로 메우지 않는다 — 없는 정보를 만드는 것이다.
 *   - 단원: 청사진 `unitMix` 순서(= 원본 시험지의 문항 순서 = 진도 순)를 그대로 이어 붙인다.
 *
 * ## 못 채운 칸
 *
 * 아무 문항으로나 메우지 않고 `unfilled` 로 **그대로 보고한다.** 근거 없는 값을 지어내
 * 0문항 0점 청사진을 낸 전례가 있다. 칸이 안 맞아 완화해 고른 문항은 `relaxed` 에 어느 축을
 * 풀었는지 남긴다 — 맞은 척하지 않는다.
 *
 * ## 알려진 한계 (보고서에도 적었다)
 *
 * - 후보 배정은 **탐욕법**이다(정확 일치 1차 → 완화 2차). 이론적으로 최적 이분매칭이 아니라,
 *   드물게 완전 배정이 가능한데도 `unfilled` 이 남을 수 있다. 지금 규모에선 문제가 안 되지만
 *   실데이터에서 결손이 잦으면 헝가리안 매칭으로 바꾸는 것이 다음 단계다.
 * - "유사한 문항"(§L6 ①)을 지금은 **같은 문항 재출제**로만 본다. 문항 유사도 엔진이 아직 없다.
 * - `Problem.questionType` 이 아직 NULL 인 문항은 유형 일치를 확인할 수 없어 `relaxed` 에
 *   `유형` 을 남긴다(T7.6 백필이 끝나면 자연히 줄어든다).
 */
import type { Difficulty } from "@/contracts/common.contract";
import type {
  Blueprint,
  DifficultyLabel,
  ExamPaper,
  QuestionType,
} from "@/contracts/predictor.contract";
import type {
  JudgementUnavailable,
  JudgementUnavailableReason,
  NormalizerQuestion,
  PaperCandidate,
  PaperRelaxation,
  PredictedPaper,
  PredictedPaperQuestion,
  UnfilledSlot,
} from "@/contracts/scoreNormalizer.contract";

import {
  DIFFICULTY_KEYS,
  QUESTION_TYPES,
  type DifficultyKey,
} from "./blueprint";
import { partitionTrusted } from "./paperTrust";
import { largestRemainder, normalizeScores } from "./scoreNormalizer";

/**
 * 두 난이도 축 사이의 다리. 청사진은 시험지 원본 라벨(하/중/상)을 쓰고 문제은행은
 * easy/mid/hard 를 쓴다 — 계약상 **다른 축**이라 섞지 않지만, 칸을 채우려면 대응이 필요하다.
 * 이 대응은 후보 선택에만 쓰고 저장하지 않는다.
 */
const LABEL_TO_DIFFICULTY: Record<DifficultyLabel, Difficulty> = {
  하: "easy",
  중: "mid",
  상: "hard",
};
const DIFFICULTY_TO_LABEL: Record<Difficulty, DifficultyLabel> = {
  easy: "하",
  mid: "중",
  hard: "상",
};

/** 완화 비용 — 범위(단원)가 어긋나는 것이 가장 나쁘다. 시험 범위가 다르면 시험이 아니다. */
const RELAX_COST: Record<PaperRelaxation, number> = {
  단원: 4,
  난이도: 2,
  유형: 1,
};

/**
 * 같은 칸이면 기출을 먼저, AI 변형을 마지막에 (11 §3 L6 우선순위 ②~④):
 * `② 같은 단원·난이도 기출 → ③ 자작/RPM → ④ 부족분만 AI 변형`.
 *
 * ⚠️ **`source` 만으로는 이 순서를 지킬 수 없다.** RPM 교재 이관본과 AI 변형본이
 * 둘 다 `transformed` 로 들어오기 때문이다(`convertRpm.ts` · `ai/transformer.ts:132`).
 * 문서는 앞을 ③, 뒤를 ④ 로 나누므로 열거형 하나로는 표현이 안 된다.
 * 가르는 것은 `originProblemId` — RPM 은 우리 DB 에 원본이 없어 NULL 이다.
 *
 * 문서가 자작과 RPM 을 **같은 ③** 에 두므로 둘의 등급도 같다. 예전에는 자작 1 · RPM 2 로
 * 갈라 4,862건 전량이 한 등급 밀려 있었다.
 */
const BASE_RANK: Record<PaperCandidate["source"], number> = {
  past_exam: 0,
  manual: 1,
  // RPM 교재본이면 1(자작과 같은 ③), AI 변형본이면 2(④). 아래에서 가른다.
  transformed: 2,
  ai_generated: 3,
};

function sourceRank(
  candidate: Pick<PaperCandidate, "source" | "originProblemId">,
): number {
  // 표를 남겨 둔 이유: `ProblemSource` 에 값이 하나 늘면 **컴파일이 깨져** 여기를 보게 된다.
  // `if` 사슬 + 기본값으로 바꿨더니 새 값이 조용히 어느 등급에 끼는지 아무도 모르게 됐다
  // (적대적 리뷰 지적 — 그때 `ai_generated` 가 3 → 2 로 소리 없이 올라갔다).
  const base = BASE_RANK[candidate.source];
  if (
    candidate.source === "transformed" &&
    candidate.originProblemId === null
  ) {
    return BASE_RANK.manual;
  }
  return base;
}

interface Slot {
  index: number;
  unitId: string | null;
  difficulty: Difficulty | null;
  qtype: QuestionType;
}

function unavailable(
  reason: JudgementUnavailableReason,
  detail: string,
): JudgementUnavailable {
  return { ok: false, judgement: "판단 불가", reason, detail };
}

/** 개수 배열을 값의 나열로 편다. */
function expand<T>(values: readonly T[], counts: readonly number[]): T[] {
  const out: T[] = [];
  values.forEach((value, index) => {
    for (let k = 0; k < counts[index]; k += 1) out.push(value);
  });
  return out;
}

/** 라벨 있는 칸 사이에 라벨 없는 칸(null)을 고르게 흩는다. */
function spreadUnlabeled<T>(
  labeled: readonly T[],
  blanks: number,
): Array<T | null> {
  const total = labeled.length + blanks;
  const out: Array<T | null> = [];
  let used = 0;
  let next = 0;
  for (let i = 0; i < total; i += 1) {
    const want = Math.floor(((i + 1) * blanks) / total);
    if (blanks > 0 && want > used) {
      out.push(null);
      used += 1;
    } else {
      out.push(next < labeled.length ? labeled[next++] : null);
    }
  }
  return out;
}

function buildSlots(blueprint: Blueprint, count: number): Slot[] | null {
  const typeWeights = QUESTION_TYPES.map(
    (qtype) => blueprint.typeMix[qtype]?.count ?? 0,
  );
  if (typeWeights.reduce((acc, w) => acc + Math.max(w, 0), 0) <= 0) return null;
  const typeSequence = expand(
    QUESTION_TYPES,
    largestRemainder(typeWeights, count),
  );

  const labelKeys = DIFFICULTY_KEYS.filter(
    (key): key is Exclude<DifficultyKey, "미표기"> => key !== "미표기",
  );
  const difficultyCounts = largestRemainder(
    DIFFICULTY_KEYS.map((key) => blueprint.difficultyMix[key]?.count ?? 0),
    count,
  );
  const labeled = expand(
    labelKeys,
    labelKeys.map((key) => difficultyCounts[DIFFICULTY_KEYS.indexOf(key)]),
  );
  const difficultySequence = spreadUnlabeled(
    labeled,
    count - labeled.length,
  ).map((label) => (label ? LABEL_TO_DIFFICULTY[label] : null));

  const unitSequence = expand(
    blueprint.unitMix.map((row) => row.unitId),
    largestRemainder(
      blueprint.unitMix.map((row) => row.count),
      count,
    ),
  );

  // 유형 배분이 있으면 largestRemainder 가 정확히 count 칸을 만든다. 아니면 위에서 이미 막았다.
  if (typeSequence.length !== count) return null;

  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    unitId: unitSequence[i] ?? null,
    difficulty: difficultySequence[i] ?? null,
    qtype: typeSequence[i],
  }));
}

function relaxationsFor(
  slot: Slot,
  candidate: PaperCandidate,
): PaperRelaxation[] {
  const out: PaperRelaxation[] = [];
  if (slot.unitId !== null && candidate.unitId !== slot.unitId)
    out.push("단원");
  if (slot.difficulty !== null && candidate.difficulty !== slot.difficulty) {
    out.push("난이도");
  }
  // questionType 이 NULL 이면 일치를 **확인할 수 없다** — 맞았다고 치지 않는다.
  if (candidate.questionType !== slot.qtype) out.push("유형");
  return out;
}

function cost(relaxed: readonly PaperRelaxation[]): number {
  return relaxed.reduce((acc, key) => acc + RELAX_COST[key], 0);
}

export interface ComposePredictedPaperInput {
  blueprint: Blueprint;
  /** 문제은행 후보. 전부 읽기 전용으로 다룬다 — `score` 를 덮어쓰지 않는다. */
  candidates: readonly PaperCandidate[];
  /** 그 학교 과거 시험지. 재출제 우선순위(①)와 신뢰 가드(11 §11)에 쓴다. */
  referencePapers?: readonly ExamPaper[];
}

export function composePredictedPaper(
  input: ComposePredictedPaperInput,
): PredictedPaper {
  const { blueprint, candidates, referencePapers = [] } = input;

  const count = Math.round(blueprint.questionCount);
  if (!Number.isFinite(count) || count < 1) {
    return unavailable(
      "청사진_결손",
      "청사진의 문항 수가 없어 시험지를 만들 수 없습니다.",
    );
  }
  if (candidates.length === 0) {
    return unavailable("후보_없음", "문제은행에 쓸 수 있는 문항이 없습니다.");
  }

  const slots = buildSlots(blueprint, count);
  if (slots === null) {
    return unavailable(
      "청사진_결손",
      "청사진에 문항 유형 배분이 없어 시험지를 만들 수 없습니다.",
    );
  }

  // ── 재료가 될 과거 시험지: 만점 100 가드를 통과한 편만 (11 §11, D-45) ──
  const { trusted, excluded } = partitionTrusted([...referencePapers]);
  const reusedIds = new Set<string>();
  for (const paper of trusted) {
    for (const question of paper.questions) {
      if (question.problemId) reusedIds.add(question.problemId);
    }
  }

  // ── 칸 채우기: 정확 일치 1차 → 완화 2차 ──────────────────────
  const used = new Set<string>();
  const picked = new Map<
    number,
    { candidate: PaperCandidate; relaxed: PaperRelaxation[] }
  >();

  const best = (slot: Slot, exactOnly: boolean) => {
    let chosen: {
      candidate: PaperCandidate;
      relaxed: PaperRelaxation[];
      key: number[];
    } | null = null;

    for (const candidate of candidates) {
      if (used.has(candidate.problemId)) continue;
      const relaxed = relaxationsFor(slot, candidate);
      const penalty = cost(relaxed);
      if (exactOnly && penalty > 0) continue;

      // 칸 일치가 먼저(②), 그 다음이 그 학교 재출제(①), 그 다음이 출처(③④).
      const key = [
        penalty,
        reusedIds.has(candidate.problemId) ? 0 : 1,
        sourceRank(candidate),
      ];
      if (
        chosen === null ||
        compareKey(
          key,
          chosen.key,
          candidate.problemId,
          chosen.candidate.problemId,
        ) < 0
      ) {
        chosen = { candidate, relaxed, key };
      }
    }
    return chosen;
  };

  for (const pass of [true, false]) {
    for (const slot of slots) {
      if (picked.has(slot.index)) continue;
      const found = best(slot, pass);
      if (!found) continue;
      used.add(found.candidate.problemId);
      picked.set(slot.index, {
        candidate: found.candidate,
        relaxed: found.relaxed,
      });
    }
  }

  const unfilled: UnfilledSlot[] = slots
    .filter((slot) => !picked.has(slot.index))
    .map((slot) => ({
      slotIndex: slot.index,
      unitId: slot.unitId,
      difficulty: slot.difficulty,
      qtype: slot.qtype,
      detail: "조건에 맞는 문항이 문제은행에 없습니다.",
    }));

  // 못 채운 칸은 건너뛰고 남은 문항에 1번부터 다시 번호를 매긴다 — 빈 번호가 인쇄되면 안 된다.
  const filled = slots.flatMap((slot) => {
    const entry = picked.get(slot.index);
    return entry ? [{ slot, ...entry }] : [];
  });

  if (filled.length === 0) {
    return unavailable("후보_없음", "청사진의 어느 칸도 채우지 못했습니다.");
  }

  // ── 배점 보정 (11 §10) — 여기서만 배점이 정해진다 ─────────────
  const forNormalizer: NormalizerQuestion[] = filled.map((row, index) => ({
    number: index + 1,
    qtype: row.candidate.questionType ?? row.slot.qtype,
    difficultyLabel: DIFFICULTY_TO_LABEL[row.candidate.difficulty],
    originalScore: row.candidate.score,
  }));

  const normalized = normalizeScores({
    questions: forNormalizer,
    histogram: blueprint.scoreHistogram,
  });
  if (!normalized.ok) return normalized;

  const questions: PredictedPaperQuestion[] = filled.map((row, i) => ({
    orderIndex: i + 1,
    problemId: row.candidate.problemId,
    unitId: row.candidate.unitId,
    difficulty: row.candidate.difficulty,
    qtype: row.candidate.questionType ?? row.slot.qtype,
    // 원본 기출 배점은 사본으로만 나른다 — `Problem.score` 를 덮어쓰지 않는다(11 §10.2-4).
    originalScore: row.candidate.score,
    score: normalized.questions[i].score,
    relaxed: row.relaxed,
    schoolReuse: reusedIds.has(row.candidate.problemId),
  }));

  return {
    ok: true,
    series: blueprint.series,
    period: blueprint.period,
    questions,
    totalScore: normalized.totalScore,
    grid: normalized.grid,
    unfilled,
    referenceUsed: trusted.length,
    referenceExcluded: excluded.length,
  };
}

/** (완화비용, 재출제여부, 출처순위, problemId) 사전순 비교. 결과가 입력 순서에 흔들리지 않게 한다. */
function compareKey(
  a: readonly number[],
  b: readonly number[],
  aId: string,
  bId: string,
): number {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}
