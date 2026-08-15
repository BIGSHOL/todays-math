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
  it("questionType 한 필드만 UPDATE 한다 — externalId 를 절대 쓰지 않는다", async () => {
    const update = vi.fn(
      async ({
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        if ("externalId" in data) {
          throw new Error("externalId 는 트랙 C 소유 컬럼 — 절대 쓰면 안 된다");
        }
        return {};
      },
    );
    const prisma = { problem: { update } } as unknown as Pick<
      PrismaClient,
      "problem"
    >;

    const n = await applyBackfill(prisma, [
      { id: "p1", questionType: "객관식" },
      { id: "p2", questionType: "서술형" },
    ]);

    expect(n).toBe(2);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: "p1" },
      data: { questionType: "객관식" },
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: "p2" },
      data: { questionType: "서술형" },
    });
  });
});
