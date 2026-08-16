/**
 * 배점 보정 결과를 시험지에 적재한다 — `TestProblem.score` 에만 쓴다.
 *
 * 설계 SSOT: docs/planning/11-score-predictor.md §10 (원장님 지시 D-42).
 *
 * ## 이 파일이 지키는 경계
 *
 * - **`Problem.score` 를 절대 쓰지 않는다.** 원본 기출 배점은 학습 코퍼스다. 조정 배점은
 *   시험지 쪽(`TestProblem.score`)에만 싣는다(11 §10.2-4). 이 파일은 `problem` 테이블에
 *   `update` 를 부르지 않는다 — 테스트가 그것까지 확인한다.
 * - `answer` · `figureUrls` · `figureSource` · `externalId` 는 읽지도 쓰지도 않는다(다른 트랙 소유).
 * - `prisma/schema.prisma` 는 건드리지 않았다. 필요한 컬럼(`TestProblem.score Float?`)은
 *   이미 있다.
 *
 * ## 만점 100 가드를 저장 직전에 한 번 더 건다
 *
 * 보정기가 이미 100 을 보장하지만, 여기서 **저장 직전에 다시 센다.** 만점이 100 이 아닌
 * 시험지는 출제·채점에서 제외한다는 것이 D-45 이고, 그 판정을 우회하는 유일한 길이
 * "누군가 손으로 만든 배점 배열을 그대로 저장하는 것"이기 때문이다. 합이 어긋나면 **아무것도
 * 쓰지 않고 거부한다** — 반만 쓰인 시험지를 남기지 않으려고 트랜잭션 안에서 판정한다.
 *
 * ## `TestType` 에 대한 타협 (코디네이터 확인 필요)
 *
 * 예측 문제지는 성격상 **범위 기반 시험**이라 `review`(확인테스트)로 저장한다.
 * `TestType` enum 에 `predicted` 를 새로 넣으려면 마이그레이션이 필요한데, 4개 세션이 병렬이라
 * 스키마를 건드리지 말라는 지시가 있어 넣지 않았다. 구분이 필요하면 보고하라고 했으므로
 * REPORT.md 에 적었다.
 */
import type { PredictedPaper } from "@/contracts/scoreNormalizer.contract";
import { db } from "@/lib/db";

import { EXAM_FULL_MARK } from "./paperTrust";
import { sumScores, validateManualScores } from "./scoreNormalizer";

export type PersistRefusal =
  /** 청사진이나 문제은행이 모자라 시험지 자체가 안 나온 경우. */
  | "판단_불가"
  /** 만점이 100 이 아니다. D-45 가 막는다. */
  | "만점_불일치"
  /** 그 시험지·반이 이 사용자 것이 아니다. */
  | "권한_없음"
  /** 대상 시험지나 반이 없다. */
  | "대상_없음"
  /** 시험지 문항과 넘어온 배점이 짝이 안 맞는다. */
  | "문항_불일치";

export type PersistResult =
  | {
      ok: true;
      testId: string;
      questionCount: number;
      /** 저장된 만점. 항상 100 이다. */
      totalScore: number;
    }
  | { ok: false; reason: PersistRefusal; detail: string };

function refuse(reason: PersistRefusal, detail: string): PersistResult {
  return { ok: false, reason, detail };
}

export interface PersistPredictedPaperInput {
  userId: string;
  classId: string;
  /** NULL 이면 반 전체 대상. */
  studentId?: string | null;
  /** `YYYY-MM-DD`. */
  testDate: string;
  rangeStartUnitId?: string | null;
  rangeEndUnitId: string;
  /** `composePredictedPaper` 의 결과. 판단 불가면 저장하지 않는다. */
  paper: PredictedPaper;
}

/**
 * 예측 문제지를 새 시험지로 적재한다. `Test` 1행 + `TestProblem` n행을 한 트랜잭션에 만든다.
 *
 * 멱등이 아니다 — 두 번 부르면 시험지가 두 장 생긴다. `Test` 에는 외부 고유 키가 없어서
 * 멱등 키를 만들 수 없다. 재적재가 필요하면 호출자가 이전 시험지를 지우고 부른다.
 */
export async function persistPredictedPaper(
  input: PersistPredictedPaperInput,
): Promise<PersistResult> {
  const { paper } = input;

  // 판단 불가를 시험지로 만들지 않는다. 근거 없는 값을 저장하는 것이 제일 나쁘다.
  if (!paper.ok) {
    return refuse("판단_불가", paper.detail);
  }

  const total = sumScores(paper.questions.map((q) => q.score));
  if (total !== EXAM_FULL_MARK) {
    return refuse(
      "만점_불일치",
      `만점이 ${total} 입니다. ${EXAM_FULL_MARK}점이 아닌 시험지는 저장하지 않습니다.`,
    );
  }

  const owner = await db.class.findUnique({ where: { id: input.classId } });
  if (!owner) return refuse("대상_없음", "반을 찾을 수 없습니다.");
  if (owner.userId !== input.userId) {
    return refuse("권한_없음", "이 반에 시험지를 만들 권한이 없습니다.");
  }

  const created = await db.$transaction(async (tx) => {
    const test = await tx.test.create({
      data: {
        userId: input.userId,
        classId: input.classId,
        studentId: input.studentId ?? null,
        // 예측 문제지는 범위 기반이라 확인테스트로 저장한다(위 주석의 타협).
        testType: "review",
        rangeStartUnitId: input.rangeStartUnitId ?? null,
        rangeEndUnitId: input.rangeEndUnitId,
        status: "draft",
        modified: false,
        testDate: new Date(`${input.testDate}T00:00:00.000Z`),
      },
    });

    for (const question of paper.questions) {
      await tx.testProblem.create({
        data: {
          testId: test.id,
          problemId: question.problemId,
          orderIndex: question.orderIndex,
          replaced: false,
          // ⚠️ 조정 배점은 여기에만 쓴다. Problem.score 는 건드리지 않는다.
          score: question.score,
        },
      });
    }

    return test;
  });

  return {
    ok: true,
    testId: created.id,
    questionCount: paper.questions.length,
    totalScore: EXAM_FULL_MARK,
  };
}

export interface SaveManualScoresInput {
  userId: string;
  testId: string;
  /** 원장이 화면에서 고친 배점. `orderIndex` 는 시험지의 문항 번호다. */
  scores: ReadonlyArray<{ orderIndex: number; score: number }>;
}

/**
 * 원장 수동 조정 저장 (11 §10.4).
 *
 * **합계가 100 이 아니면 아무것도 쓰지 않고 거부한다.** 남은 점수는 `detail` 에 담아
 * 그대로 화면에 띄울 수 있게 한다(`합계 98.5 — 1.5점 남음`).
 * 자동으로 다른 문항을 건드려 사용자를 놀라게 하지 않는다 — 고칠 곳은 원장이 정한다.
 */
export async function saveManualScores(
  input: SaveManualScoresInput,
): Promise<PersistResult> {
  const test = await db.test.findUnique({ where: { id: input.testId } });
  if (!test) return refuse("대상_없음", "시험지를 찾을 수 없습니다.");
  if (test.userId !== input.userId) {
    return refuse("권한_없음", "이 시험지를 고칠 권한이 없습니다.");
  }

  const rows = await db.testProblem.findMany({
    where: { testId: input.testId },
  });
  const byOrder = new Map(rows.map((row) => [row.orderIndex, row]));

  if (
    rows.length !== input.scores.length ||
    input.scores.some((item) => !byOrder.has(item.orderIndex))
  ) {
    return refuse(
      "문항_불일치",
      `시험지 문항은 ${rows.length}개인데 배점은 ${input.scores.length}개 들어왔습니다.`,
    );
  }

  const check = validateManualScores(
    input.scores.map((item) => ({
      number: item.orderIndex,
      score: item.score,
    })),
  );
  if (!check.ok) {
    return refuse("만점_불일치", check.message);
  }

  await db.$transaction(async (tx) => {
    for (const item of input.scores) {
      const row = byOrder.get(item.orderIndex);
      if (!row) continue;
      await tx.testProblem.update({
        where: { id: row.id },
        data: { score: item.score },
      });
    }
  });

  return {
    ok: true,
    testId: input.testId,
    questionCount: input.scores.length,
    totalScore: EXAM_FULL_MARK,
  };
}
