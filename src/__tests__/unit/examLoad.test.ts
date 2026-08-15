// T7.3 — 추출 JSON → Exam/ExamQuestion DB 적재기.
//
// 설계 근거: docs/planning/11-score-predictor.md §2.4·§5, 트랙 문서
// docs/planning/tracks/track-e-todays-exam.md.
//
// DB 대역은 src/mocks/prismaTestDouble.ts(전역 vi.mock("@/lib/db"), vitest.setup.ts)를
// 그대로 쓴다 — 실제 공유 DB에는 붙지 않는다.
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { ExamPaper, ExamQuestion } from "@/contracts/predictor.contract";
import { db } from "@/lib/db";

import {
  loadExamPaper,
  summarizeCoverage,
} from "../../../scripts/predictor/load-exams";

const prisma = db as unknown as PrismaClient;

function question(
  overrides: Partial<ExamQuestion> & { number: number },
): ExamQuestion {
  return {
    score: 4,
    qtype: "객관식",
    difficultyLabel: "중",
    topicRaw: null,
    unitId: null,
    answer: "1",
    hasFigure: false,
    problemId: null,
    ...overrides,
  };
}

function paper(
  overrides: Partial<ExamPaper> & { externalExamId: string },
): ExamPaper {
  const questions = overrides.questions ?? [
    question({ number: 1 }),
    question({ number: 2 }),
    question({ number: 3 }),
    question({ number: 4 }),
    question({ number: 5 }),
  ];
  return {
    series: { school: "정화중", level: "중", grade: 3, subject: "중3" },
    period: { year: 2025, semester: 1, round: "중간" },
    subjectRaw: "수학",
    totalScore: questions.reduce((s, q) => s + q.score, 0),
    sourceFile: null,
    ...overrides,
    questions,
  };
}

describe("[T7.3] loadExamPaper — Exam/ExamQuestion 적재", () => {
  it("같은 ExamPaper 를 2회 적재해도 exam 1행·question N행 그대로다 (멱등)", async () => {
    const p = paper({ externalExamId: "idem-1" });

    const first = await loadExamPaper(prisma, p);
    expect(first.status).toBe("inserted");

    const second = await loadExamPaper(prisma, p);
    expect(second.status).toBe("updated");

    const exams = await prisma.exam.findMany({
      where: { externalExamId: "idem-1" },
    });
    expect(exams).toHaveLength(1);

    const questions = await prisma.examQuestion.findMany({
      where: { examId: exams[0]!.id },
    });
    expect(questions).toHaveLength(p.questions.length);
  });

  it("문항 하나라도 스키마에 안 맞으면 그 편 전체를 적재하지 않는다 (부분 실패 없음)", async () => {
    const invalid = paper({
      externalExamId: "invalid-1",
      questions: [
        question({ number: 1 }),
        // score 는 양수여야 한다(examQuestionSchema) — 0은 스키마 위반.
        question({ number: 2, score: 0 }),
        question({ number: 3 }),
        question({ number: 4 }),
        question({ number: 5 }),
      ],
    });

    const result = await loadExamPaper(prisma, invalid);
    expect(result.status).toBe("invalid");

    const exams = await prisma.exam.findMany({
      where: { externalExamId: "invalid-1" },
    });
    expect(exams).toHaveLength(0);
    // 이 테스트 안에서는 다른 편을 적재하지 않았으므로 examQuestion 전체가 비어 있어야 한다.
    const questions = await prisma.examQuestion.findMany({ where: {} });
    expect(questions).toHaveLength(0);
  });

  it("DB 쓰기 중 실패하면 그 편의 exam/examQuestion 이 함께 롤백된다 (트랜잭션)", async () => {
    const p = paper({ externalExamId: "tx-fail-1" });
    const spy = vi
      .spyOn(prisma.examQuestion, "createMany")
      .mockRejectedValueOnce(new Error("boom"));

    await expect(loadExamPaper(prisma, p)).rejects.toThrow("boom");

    const exams = await prisma.exam.findMany({
      where: { externalExamId: "tx-fail-1" },
    });
    expect(exams).toHaveLength(0);

    spy.mockRestore();
  });

  it("우리 트리 매핑이 없어도 시험지 원문 소단원 표기(topicRaw)를 그대로 보존한다", async () => {
    const raw = "제곱근의 뜻과 성질";
    const p = paper({
      externalExamId: "topic-1",
      questions: [
        question({ number: 1, topicRaw: raw, unitId: null }),
        question({ number: 2 }),
        question({ number: 3 }),
        question({ number: 4 }),
        question({ number: 5 }),
      ],
    });

    await loadExamPaper(prisma, p);

    const exam = await prisma.exam.findUnique({
      where: { externalExamId: "topic-1" },
    });
    const questions = await prisma.examQuestion.findMany({
      where: { examId: exam!.id },
    });
    const q1 = questions.find(
      (q) => (q as { number: number }).number === 1,
    ) as {
      topicRaw: string | null;
      unitId: string | null;
    };
    expect(q1.topicRaw).toBe(raw);
    // unitId 매핑은 별도 태스크 — 이 적재기는 항상 null 로 둔다.
    expect(q1.unitId).toBeNull();
  });
});

describe("[T7.3] summarizeCoverage", () => {
  it("정답·소단원·난이도라벨 보유율을 문항 기준으로 낸다", () => {
    const papers = [
      paper({
        externalExamId: "cov-1",
        questions: [
          question({
            number: 1,
            answer: "1",
            topicRaw: "단원A",
            difficultyLabel: "하",
          }),
          question({
            number: 2,
            answer: null,
            topicRaw: null,
            difficultyLabel: null,
          }),
        ],
      }),
    ];
    const coverage = summarizeCoverage(papers);
    expect(coverage.papers).toBe(1);
    expect(coverage.questions).toBe(2);
    expect(coverage.answerRate).toBeCloseTo(0.5);
    expect(coverage.topicRate).toBeCloseTo(0.5);
    expect(coverage.difficultyLabelRate).toBeCloseTo(0.5);
  });
});
