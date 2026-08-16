// T7.6 — Problem.questionType 백필 (externalId 조인).
//
// 배경은 docs/planning/11-score-predictor.md §2.4 — mapProblemType.ts 가 이관 때
// 객관식→"개념", 단답형→"계산" 으로 뭉개 출제 형식 구분이 소실됐다. 여기서 채우는
// questionType 은 problemType 과는 다른 축이다.
//
// ⚠️ externalId 는 트랙 C 소유 컬럼 — applyBackfill 이 이 필드를 절대 쓰지 않는지
//    반드시 테스트로 강제한다.
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { ExamPaper } from "@/contracts/predictor.contract";

import {
  applyBackfill,
  BACKFILL_BATCH_SIZE,
  buildExternalIdMap,
  planBackfill,
  type ProblemJoinRow,
} from "../../../scripts/qa/backfill-question-type";

function paper(
  overrides: Partial<ExamPaper> & { externalExamId: string },
): ExamPaper {
  return {
    series: { school: "정화중", level: "중", grade: 3, subject: "중3" },
    period: { year: 2025, semester: 1 as const, round: "중간" as const },
    subjectRaw: "수학",
    totalScore: 100,
    sourceFile: null,
    questions: [],
    ...overrides,
  };
}

const CORPUS: ExamPaper[] = [
  paper({
    externalExamId: "1001",
    questions: [
      {
        number: 1,
        score: 3,
        qtype: "객관식",
        difficultyLabel: "중",
        topicRaw: null,
        unitId: null,
        answer: "①",
        hasFigure: false,
        problemId: null,
      },
      {
        number: 2,
        score: 4,
        qtype: "단답형",
        difficultyLabel: "중",
        topicRaw: null,
        unitId: null,
        answer: "5",
        hasFigure: false,
        problemId: null,
      },
      {
        number: 3,
        score: 8,
        qtype: "서술형",
        difficultyLabel: "상",
        topicRaw: null,
        unitId: null,
        answer: "풀이 생략",
        hasFigure: false,
        problemId: null,
      },
    ],
  }),
];

function row(
  overrides: Partial<ProblemJoinRow> & { id: string },
): ProblemJoinRow {
  return {
    externalId: null,
    questionType: null,
    problemType: "계산",
    ...overrides,
  };
}

describe("buildExternalIdMap", () => {
  it("externalExamId-문항번호 를 키로 문항 유형을 담는다", () => {
    const map = buildExternalIdMap(CORPUS);
    expect(map.get("1001-1")).toBe("객관식");
    expect(map.get("1001-2")).toBe("단답형");
    expect(map.get("1001-3")).toBe("서술형");
    expect(map.has("1001-4")).toBe(false);
  });
});

describe("planBackfill", () => {
  it("externalId 로 정확히 조인되어 객관식/단답형/서술형 3값이 매핑된다", () => {
    const map = buildExternalIdMap(CORPUS);
    const problems: ProblemJoinRow[] = [
      row({ id: "p1", externalId: "1001-1", problemType: "개념" }),
      row({ id: "p2", externalId: "1001-2", problemType: "계산" }),
      row({ id: "p3", externalId: "1001-3", problemType: "서술형" }),
    ];

    const plan = planBackfill(problems, map);

    expect(plan.updates).toEqual([
      { id: "p1", questionType: "객관식" },
      { id: "p2", questionType: "단답형" },
      { id: "p3", questionType: "서술형" },
    ]);
    expect(plan.matched).toBe(3);
    expect(plan.unmatched).toBe(0);
    expect(plan.distribution).toEqual({ 객관식: 1, 단답형: 1, 서술형: 1 });
  });

  it("멱등 — 같은 입력으로 두 번 돌리면 두 번째는 UPDATE 0건", () => {
    const map = buildExternalIdMap(CORPUS);
    const first = planBackfill([row({ id: "p1", externalId: "1001-1" })], map);
    expect(first.updates).toHaveLength(1);

    // 첫 실행이 반영된 상태(questionType 이 이미 채워짐)를 다시 넣는다.
    const second = planBackfill(
      [
        row({
          id: "p1",
          externalId: "1001-1",
          questionType: first.updates[0]!.questionType,
        }),
      ],
      map,
    );

    expect(second.updates).toHaveLength(0);
    expect(second.matched).toBe(1);
    expect(second.alreadyCorrect).toBe(1);
  });

  it("조인 실패 건은 건드리지 않는다(null 유지) + 그 수가 집계에 잡힌다", () => {
    const map = buildExternalIdMap(CORPUS);
    const problems: ProblemJoinRow[] = [
      // externalId 자체가 없다 — 예: RPM/자작 문항.
      row({ id: "no-external-id", externalId: null }),
      // externalId 는 있지만 코퍼스에 없는 문항(다른 배치/조인 실패).
      row({ id: "no-corpus-match", externalId: "9999-1" }),
      // 정상 매칭 1건도 섞어 대조군으로 둔다.
      row({ id: "matched", externalId: "1001-1" }),
    ];

    const plan = planBackfill(problems, map);

    expect(plan.unmatched).toBe(2);
    expect(plan.matched).toBe(1);
    // 조인 실패 건의 id 는 updates 에 전혀 등장하지 않는다 — 건드리지 않는다.
    expect(plan.updates.map((u) => u.id)).toEqual(["matched"]);
  });

  it("problemType='서술형' 라벨과 questionType 불일치 건수를 참고용으로 센다", () => {
    const map = buildExternalIdMap(CORPUS);
    const problems: ProblemJoinRow[] = [
      // 라벨은 서술형이 아닌데 실제 출제형식은 서술형(1001-3) — 불일치.
      row({ id: "p1", externalId: "1001-3", problemType: "개념" }),
      // 라벨도 서술형, 실제도 서술형 — 일치.
      row({ id: "p2", externalId: "1001-3", problemType: "서술형" }),
    ];

    const plan = planBackfill(problems, map);

    expect(plan.problemTypeMismatch).toBe(1);
  });
});

describe("applyBackfill", () => {
  /** updateMany 호출을 받아 적는 가짜 Prisma. 실제 왕복 횟수를 세기 위한 것이다. */
  function fakePrisma() {
    const calls: Array<{ ids: string[]; data: Record<string, unknown> }> = [];
    const updateMany = vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: { in: string[] } };
        data: Record<string, unknown>;
      }) => {
        if ("externalId" in data) {
          throw new Error("externalId 는 트랙 C 소유 컬럼 — 절대 쓰면 안 된다");
        }
        calls.push({ ids: where.id.in, data });
        return { count: where.id.in.length };
      },
    );
    return {
      calls,
      updateMany,
      prisma: { problem: { updateMany } } as unknown as Pick<
        PrismaClient,
        "problem"
      >,
    };
  }

  it("questionType 한 필드만 UPDATE 한다 — externalId 를 절대 쓰지 않는다", async () => {
    const { prisma, calls } = fakePrisma();

    const n = await applyBackfill(prisma, [
      { id: "p1", questionType: "객관식" },
      { id: "p2", questionType: "서술형" },
    ]);

    expect(n).toBe(2);
    for (const call of calls) {
      expect(Object.keys(call.data)).toEqual(["questionType"]);
    }
  });

  it("🔴 유형별로 묶어 한 번에 쓴다 — 건수만큼 왕복하지 않는다", async () => {
    const { prisma, updateMany, calls } = fakePrisma();
    const updates = [
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `a${i}`,
        questionType: "객관식" as const,
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `b${i}`,
        questionType: "서술형" as const,
      })),
    ];

    const n = await applyBackfill(prisma, updates);

    expect(n).toBe(50);
    // 50건인데 왕복은 유형 수(2회)뿐이어야 한다. 한 건씩 쓰면 공유 DB 풀러로 50회다.
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(calls.map((c) => c.data.questionType).sort()).toEqual([
      "객관식",
      "서술형",
    ]);
  });

  it("배치 한도를 넘으면 쪼개 보낸다 — IN 절이 무한정 길어지지 않게", async () => {
    const { prisma, updateMany } = fakePrisma();
    const updates = Array.from(
      { length: BACKFILL_BATCH_SIZE * 2 + 1 },
      (_, i) => ({ id: `x${i}`, questionType: "객관식" as const }),
    );

    const n = await applyBackfill(prisma, updates);

    expect(n).toBe(BACKFILL_BATCH_SIZE * 2 + 1);
    expect(updateMany).toHaveBeenCalledTimes(3);
  });

  it("진행 상황을 알린다 — 중간에 끊겨도 어디까지 갔는지 알아야 한다", async () => {
    const { prisma } = fakePrisma();
    const seen: number[] = [];
    const updates = Array.from({ length: BACKFILL_BATCH_SIZE + 1 }, (_, i) => ({
      id: `x${i}`,
      questionType: "객관식" as const,
    }));

    await applyBackfill(prisma, updates, (done, total) => {
      seen.push(done);
      expect(total).toBe(updates.length);
    });

    expect(seen).toEqual([BACKFILL_BATCH_SIZE, BACKFILL_BATCH_SIZE + 1]);
  });

  it("갱신할 게 없으면 DB 를 아예 건드리지 않는다", async () => {
    const { prisma, updateMany } = fakePrisma();
    expect(await applyBackfill(prisma, [])).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
