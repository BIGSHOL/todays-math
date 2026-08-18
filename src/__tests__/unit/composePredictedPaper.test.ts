/**
 * 왜 이 테스트가 있는가 — 예측 문제지는 **정의상 짜깁기**다.
 *
 * 청사진의 각 칸(단원 × 난이도 × 유형 × 배점)을 문제은행에서 채우므로 한 장 안에 기출·자작·
 * RPM·AI 변형이 섞인다(11 §3 L6). 기출만 `Problem.score` 를 갖고 나머지는 NULL 이라, 배점을
 * 손대지 않으면 만점이 100 이 아닌 시험지가 나가고 점수 예측기가 조용히 왜곡된다(11 §10.1).
 * 그래서 문제지 생성기는 **반드시** 배점 보정기를 거쳐 `TestProblem.score` 를 채운다(D-42).
 *
 * 이 테스트가 지키는 것은 네 가지다.
 *  1. 청사진대로 칸을 채우고 **만점이 정확히 100**, 배점은 전부 그 학교 눈금 안.
 *  2. `Problem.score`(원본 기출 배점)를 **한 글자도 바꾸지 않는다** — 후보를 Object.freeze 해서
 *     쓰기를 시도하면 그 자리에서 터지게 했다. 덮어쓰면 학습 코퍼스가 오염된다.
 *  3. **못 채운 칸은 지어내지 않고 그대로 보고한다.** 근거 없는 값을 만들어 넣는 실수를
 *     이 프로젝트는 이미 한 번 했다(0문항 0점 청사진).
 *  4. 재료로 쓰는 과거 시험지는 **만점 100 신뢰 가드**(11 §11, D-45)를 통과한 편만이다.
 *     잘린 시험지를 그 학교의 출제 관행으로 배우면 안 된다.
 */
import { describe, expect, it } from "vitest";

import type { Blueprint, ExamPaper } from "@/contracts/predictor.contract";
import {
  predictedPaperSchema,
  type PaperCandidate,
} from "@/contracts/scoreNormalizer.contract";
import { observeBlueprint } from "@/lib/predictor/blueprint";
import { composePredictedPaper } from "@/lib/predictor/composePredictedPaper";

const UNIT_A = "11111111-1111-4111-8111-111111111111";
const UNIT_B = "22222222-2222-4222-8222-222222222222";

const SERIES = {
  school: "대구여고",
  level: "고" as const,
  grade: 2,
  subject: "수2",
};
const PERIOD = { year: 2025, semester: 2 as const, round: "기말" as const };

function pid(n: number): string {
  return `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;
}

/**
 * 과거 회차 1편 — 객관식 8(하4·중4) + 서술형 2(상), 단원 A 5문항 · B 5문항, 총 100점.
 * 여기서 뽑은 실측 청사진이 예측 문제지의 설계도가 된다.
 */
function pastPaper(overrides: Partial<ExamPaper> = {}): ExamPaper {
  const rows: Array<
    [number, number, "객관식" | "서술형", "하" | "중" | "상", string]
  > = [
    [1, 8, "객관식", "하", UNIT_A],
    [2, 8, "객관식", "하", UNIT_A],
    [3, 8, "객관식", "하", UNIT_A],
    [4, 8, "객관식", "하", UNIT_A],
    [5, 10, "객관식", "중", UNIT_A],
    [6, 10, "객관식", "중", UNIT_B],
    [7, 10, "객관식", "중", UNIT_B],
    [8, 10, "객관식", "중", UNIT_B],
    [9, 12, "서술형", "상", UNIT_B],
    [10, 12, "서술형", "상", UNIT_B],
  ];
  return {
    externalExamId: "past-1",
    series: SERIES,
    period: { year: 2025, semester: 1, round: "기말" },
    subjectRaw: "수2",
    totalScore: 100,
    sourceFile: null,
    questions: rows.map(([number, score, qtype, difficultyLabel, unitId]) => ({
      number,
      score,
      qtype,
      difficultyLabel,
      topicRaw: null,
      unitId,
      answer: null,
      hasFigure: false,
      problemId: null,
    })),
    ...overrides,
  };
}

function blueprint(): Blueprint {
  return {
    ...observeBlueprint(pastPaper()),
    kind: "predicted",
    period: PERIOD,
  };
}

function candidate(
  n: number,
  unitId: string,
  difficulty: PaperCandidate["difficulty"],
  questionType: PaperCandidate["questionType"],
  extra: Partial<PaperCandidate> = {},
): PaperCandidate {
  return Object.freeze({
    problemId: pid(n),
    unitId,
    difficulty,
    questionType,
    source: "past_exam" as const,
    originProblemId: null,
    score: null,
    ...extra,
  });
}

/** 청사진의 10칸에 정확히 대응하는 후보들. */
function exactCandidates(): PaperCandidate[] {
  return [
    candidate(1, UNIT_A, "easy", "객관식", { score: 3.5 }),
    candidate(2, UNIT_A, "easy", "객관식", { score: 3.5 }),
    candidate(3, UNIT_A, "easy", "객관식"),
    candidate(4, UNIT_A, "easy", "객관식"),
    candidate(5, UNIT_A, "mid", "객관식", { score: 4.2 }),
    candidate(6, UNIT_B, "mid", "객관식"),
    candidate(7, UNIT_B, "mid", "객관식"),
    candidate(8, UNIT_B, "mid", "객관식"),
    candidate(9, UNIT_B, "hard", "서술형", { score: 10 }),
    candidate(10, UNIT_B, "hard", "서술형"),
  ];
}

describe("[T7.9] 예측 문제지 생성기 (11 §3 L6 + §10)", () => {
  it("청사진대로 채운 시험지의 만점이 정확히 100 이다", () => {
    const paper = composePredictedPaper({
      blueprint: blueprint(),
      candidates: exactCandidates(),
    });

    expect(paper.ok).toBe(true);
    if (!paper.ok) return;

    expect(paper.questions).toHaveLength(10);
    expect(paper.totalScore).toBe(100);
    expect(paper.unfilled).toEqual([]);
    expect(paper.questions.map((q) => q.score)).toEqual([
      8, 8, 8, 8, 10, 10, 12, 12, 12, 12,
    ]);
  });

  it("조정 배점이 전부 그 학교 눈금 집합에 속한다", () => {
    const paper = composePredictedPaper({
      blueprint: blueprint(),
      candidates: exactCandidates(),
    });

    expect(paper.ok).toBe(true);
    if (!paper.ok) return;

    expect(paper.grid).toEqual([8, 10, 12]);
    for (const q of paper.questions) {
      expect(paper.grid).toContain(q.score);
    }
  });

  it("`Problem.score` 원본을 건드리지 않고 사본으로만 들고 다닌다", () => {
    const candidates = exactCandidates();
    const before = candidates.map((c) => c.score);

    const paper = composePredictedPaper({
      blueprint: blueprint(),
      candidates,
    });

    expect(paper.ok).toBe(true);
    if (!paper.ok) return;

    // 후보는 Object.freeze 상태다 — 보정값을 되쓰려 했으면 여기 오기 전에 터진다.
    expect(candidates.map((c) => c.score)).toEqual(before);

    const byId = new Map(candidates.map((c) => [c.problemId, c.score]));
    for (const q of paper.questions) {
      expect(q.originalScore).toBe(byId.get(q.problemId));
    }
    // 3.5점짜리 기출도 시험지에서는 눈금대로 조정된 배점을 쓴다.
    const reused = paper.questions.find((q) => q.originalScore === 3.5);
    expect(reused).toBeDefined();
    expect(reused?.score).not.toBe(3.5);
  });

  it("단원·난이도·유형이 맞는 후보를 고르면 완화 표시가 비어 있다", () => {
    const paper = composePredictedPaper({
      blueprint: blueprint(),
      candidates: exactCandidates(),
    });

    expect(paper.ok).toBe(true);
    if (!paper.ok) return;

    for (const q of paper.questions) expect(q.relaxed).toEqual([]);
    expect(paper.questions.filter((q) => q.qtype === "서술형")).toHaveLength(2);
    expect(paper.questions.filter((q) => q.difficulty === "easy")).toHaveLength(
      4,
    );
  });

  it("그 학교가 과거에 낸 문항을 먼저 고른다 (11 §3 L6 우선순위 ①)", () => {
    const reused = candidate(90, UNIT_A, "easy", "객관식");
    const reference = pastPaper({
      externalExamId: "past-reuse",
      questions: pastPaper().questions.map((q) =>
        q.number === 1 ? { ...q, problemId: reused.problemId } : q,
      ),
    });

    const paper = composePredictedPaper({
      blueprint: blueprint(),
      // 재출제 후보를 맨 뒤에 둔다 — 순서가 아니라 우선순위로 뽑혀야 한다.
      candidates: [...exactCandidates(), reused],
      referencePapers: [reference],
    });

    expect(paper.ok).toBe(true);
    if (!paper.ok) return;

    expect(paper.referenceUsed).toBe(1);
    expect(paper.referenceExcluded).toBe(0);
    expect(paper.questions[0].problemId).toBe(reused.problemId);
    expect(paper.questions[0].schoolReuse).toBe(true);
  });

  it("만점 100 가드에 걸린 과거 시험지는 재료에서 뺀다 (11 §11, D-45)", () => {
    const reused = candidate(90, UNIT_A, "easy", "객관식");
    // 배점이 잘려 총점 67 인 편 — 그 학교 관행으로 배우면 안 된다.
    const broken = pastPaper({
      externalExamId: "past-broken",
      totalScore: 67,
      questions: pastPaper().questions.map((q) =>
        q.number === 1 ? { ...q, problemId: reused.problemId } : q,
      ),
    });

    const paper = composePredictedPaper({
      blueprint: blueprint(),
      candidates: [...exactCandidates(), reused],
      referencePapers: [broken],
    });

    expect(paper.ok).toBe(true);
    if (!paper.ok) return;

    expect(paper.referenceUsed).toBe(0);
    expect(paper.referenceExcluded).toBe(1);
    expect(paper.questions.every((q) => !q.schoolReuse)).toBe(true);
  });

  it("후보가 모자라면 지어내지 않고 못 채운 칸을 보고한다", () => {
    const paper = composePredictedPaper({
      blueprint: blueprint(),
      candidates: exactCandidates().slice(0, 9),
    });

    expect(paper.ok).toBe(true);
    if (!paper.ok) return;

    expect(paper.questions).toHaveLength(9);
    expect(paper.unfilled).toHaveLength(1);
    expect(paper.unfilled[0].slotIndex).toBe(10);
    expect(paper.unfilled[0].qtype).toBe("서술형");
    // 문항이 줄어도 만점은 여전히 정확히 100 이다.
    expect(paper.totalScore).toBe(100);
    expect(paper.questions.map((q) => q.score)).toEqual([
      8, 10, 10, 12, 12, 12, 12, 12, 12,
    ]);
  });

  it("문항이 모자라 그 눈금으로 100 을 못 만들면 판단 불가", () => {
    // 8문항 × 최고 눈금 12점 = 96점. 어떤 배정으로도 100 이 안 된다 —
    // 억지로 눈금 밖 배점을 지어내는 대신 못 만든다고 말한다.
    const paper = composePredictedPaper({
      blueprint: blueprint(),
      candidates: exactCandidates().slice(0, 8),
    });

    expect(paper.ok).toBe(false);
    if (paper.ok) return;
    expect(paper.reason).toBe("합계_100_불가");
  });

  it("칸이 안 맞으면 완화 축을 기록한다 — 맞은 척하지 않는다", () => {
    const paper = composePredictedPaper({
      blueprint: blueprint(),
      candidates: [
        ...exactCandidates().slice(0, 9),
        // 마지막 서술형 칸에 단원·난이도가 다른 객관식만 남았다.
        candidate(50, UNIT_A, "easy", "객관식"),
      ],
    });

    expect(paper.ok).toBe(true);
    if (!paper.ok) return;

    const last = paper.questions[9];
    expect(last.problemId).toBe(pid(50));
    expect([...last.relaxed].sort()).toEqual(["난이도", "단원", "유형"].sort());
  });

  it("문제은행 후보가 없으면 판단 불가", () => {
    const paper = composePredictedPaper({
      blueprint: blueprint(),
      candidates: [],
    });

    expect(paper.ok).toBe(false);
    if (paper.ok) return;
    expect(paper.judgement).toBe("판단 불가");
    expect(paper.reason).toBe("후보_없음");
  });

  it("청사진에 배점 눈금 이력이 없으면 판단 불가", () => {
    const paper = composePredictedPaper({
      blueprint: { ...blueprint(), scoreHistogram: [] },
      candidates: exactCandidates(),
    });

    expect(paper.ok).toBe(false);
    if (paper.ok) return;
    expect(paper.reason).toBe("눈금_없음");
  });

  it("청사진 문항 수가 0 이면 판단 불가 — 0문항 시험지를 내지 않는다", () => {
    const paper = composePredictedPaper({
      blueprint: { ...blueprint(), questionCount: 0 },
      candidates: exactCandidates(),
    });

    expect(paper.ok).toBe(false);
    if (paper.ok) return;
    expect(paper.reason).toBe("청사진_결손");
  });

  it("계약(predictedPaperSchema)을 통과한다", () => {
    const paper = composePredictedPaper({
      blueprint: blueprint(),
      candidates: exactCandidates(),
    });
    expect(() => predictedPaperSchema.parse(paper)).not.toThrow();
  });
});

/**
 * 왜 이 묶음이 따로 있는가 — **`source` 하나로는 11 §3 L6 의 순서를 지킬 수 없다.**
 *
 * 문서의 재료 우선순위는 `③ 자작/RPM → ④ 부족분만 AI 변형` 이다. 그런데 RPM 교재 이관본과
 * AI 변형본이 **둘 다 `source = "transformed"`** 로 들어온다
 * (`src/lib/import/convertRpm.ts` 와 `src/lib/ai/transformer.ts:132`).
 * 즉 열거형만 보면 ③과 ④가 같은 값이라 갈리지 않는다.
 *
 * 둘을 가르는 것은 `originProblemId` 다 — RPM 은 우리 DB 에 원본이 없어 NULL 이고(전량 4,862),
 * AI 변형은 원본 id 를 갖는다. 「비어 있는 컬럼」이 아니라 **유일한 판별자**다.
 *
 * 지금은 AI 변형이 프로덕션에 0건이라 이 결함이 보이지 않는다. 원장님이 변형 기능을 처음
 * 쓰는 순간 조용히 드러난다 — 그래서 그 순간을 기다리지 않고 여기서 고정한다.
 */
describe("예측 문제지 — 재료 우선순위(11 §3 L6)", () => {
  const AI_VARIANT = 11; // pid 가 더 작다 — 동점이면 이쪽이 뽑힌다
  const RPM = 12;
  const MANUAL = 13;
  const PAST = 14;
  // pid 가 **AI 변형본보다 작다.** 동점이면 이쪽이 뽑히므로, AI 변형본이 뽑혔다면
  // 그건 오직 «등급이 갈렸기» 때문이다 — 동점 순서에 기대어 통과하는 것을 막는다.
  const AI_GEN = 3;

  /** UNIT_A·easy·객관식 칸 하나를 두 후보가 다투게 만든다. */
  function contested(...extras: PaperCandidate[]): PaperCandidate[] {
    return [
      ...exactCandidates().filter((c) => c.problemId !== pid(3)),
      ...extras,
    ];
  }

  it("RPM 교재본을 AI 변형본보다 먼저 쓴다 (③ before ④)", () => {
    const paper = composePredictedPaper({
      blueprint: blueprint(),
      candidates: contested(
        candidate(AI_VARIANT, UNIT_A, "easy", "객관식", {
          source: "transformed",
          originProblemId: pid(1),
        }),
        candidate(RPM, UNIT_A, "easy", "객관식", {
          source: "transformed",
          originProblemId: null,
        }),
      ),
    });

    expect(paper.ok).toBe(true);
    if (!paper.ok) return;

    const ids = paper.questions.map((q) => q.problemId);
    expect(ids).toContain(pid(RPM));
    expect(ids).not.toContain(pid(AI_VARIANT));
  });

  it("기출이 RPM 보다 먼저다 (② before ③)", () => {
    // 적대적 리뷰가 잡은 구멍: 「RPM 이 기출보다 앞」으로 뒤집어도 시험이 전부 초록이었다.
    // 우선순위의 **맨 위**를 못 박지 않으면 아래만 맞춰도 통과한다.
    const paper = composePredictedPaper({
      blueprint: blueprint(),
      candidates: contested(
        candidate(RPM, UNIT_A, "easy", "객관식", {
          source: "transformed",
          originProblemId: null,
        }),
        candidate(PAST, UNIT_A, "easy", "객관식", { source: "past_exam" }),
      ),
    });
    expect(paper.ok).toBe(true);
    if (!paper.ok) return;
    const ids = paper.questions.map((q) => q.problemId);
    // pid 는 RPM(12) 이 기출(14) 보다 작다 — 그런데도 기출이 뽑혀야 등급이 이긴 것이다.
    expect(ids).toContain(pid(PAST));
    expect(ids).not.toContain(pid(RPM));
  });

  it("AI 생성물은 맨 뒤다 — AI 변형본보다도 뒤", () => {
    // `ai_generated` 가 리팩터 중에 3 → 2 로 조용히 올라가 AI 변형본과 같아졌었다.
    const paper = composePredictedPaper({
      blueprint: blueprint(),
      candidates: contested(
        candidate(AI_GEN, UNIT_A, "easy", "객관식", {
          source: "ai_generated",
          originProblemId: null,
        }),
        candidate(AI_VARIANT, UNIT_A, "easy", "객관식", {
          source: "transformed",
          originProblemId: pid(1),
        }),
      ),
    });
    expect(paper.ok).toBe(true);
    if (!paper.ok) return;
    const ids = paper.questions.map((q) => q.problemId);
    // AI_GEN(3) 이 AI_VARIANT(11) 보다 **작은데도** 변형본이 뽑혀야 한다.
    expect(ids).toContain(pid(AI_VARIANT));
    expect(ids).not.toContain(pid(AI_GEN));
  });

  it("자작과 RPM 은 같은 등급이다 — 출처로 갈리지 않는다 (③)", () => {
    const paper = composePredictedPaper({
      blueprint: blueprint(),
      candidates: contested(
        candidate(RPM, UNIT_A, "easy", "객관식", {
          source: "transformed",
          originProblemId: null,
        }),
        candidate(MANUAL, UNIT_A, "easy", "객관식", { source: "manual" }),
      ),
    });

    expect(paper.ok).toBe(true);
    if (!paper.ok) return;

    // 등급이 같으면 problemId 로 결정된다 — RPM(12) 이 자작(13) 보다 작다.
    expect(paper.questions.map((q) => q.problemId)).toContain(pid(RPM));
  });
});
