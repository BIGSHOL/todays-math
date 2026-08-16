/**
 * POST /api/tests/{id}/submit — 채점 결과 입력 → 자동 채점 → 판독기(v0) 예상 점수 → 분석 리포트.
 * TestResult/ProblemAnswer/AnalysisReport를 하나의 트랜잭션으로 원자 생성한다.
 */
import type { TestResultSubmitRequest } from "@/contracts/testresult.contract";
import { testResultSubmitResponseSchema } from "@/contracts/testresult.contract";
import { jsonError, jsonOk } from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { requireOwnedStudentInClass, requireOwnedTest } from "@/lib/ownership";
import { predictStudentScore } from "@/lib/predictor/predictStudentScore";
import {
  serializeAnalysisReport,
  serializeTestResult,
} from "@/lib/serializers";
import type { SessionUser } from "@/lib/session";
import { buildAnalysisReport } from "@/lib/testResults/buildAnalysisReport";
import { gradeAnswers } from "@/lib/testResults/gradeAnswers";

export async function submitTestResult(
  session: SessionUser,
  testId: string,
  input: TestResultSubmitRequest,
) {
  const owned = await requireOwnedTest(testId, session.id);
  if (!owned.ok) return owned.response;

  const studentOwned = await requireOwnedStudentInClass(
    input.studentId,
    owned.data.classId,
    session.id,
  );
  if (!studentOwned.ok) return studentOwned.response;

  const testProblems = await db.testProblem.findMany({
    where: { testId },
    include: { problem: true },
  });

  const testProblemIds = new Set(testProblems.map((tp) => tp.problemId));
  const answerProblemIds = new Set(input.answers.map((a) => a.problemId));

  const unknownAnswer = input.answers.find(
    (a) => !testProblemIds.has(a.problemId),
  );
  if (unknownAnswer) {
    return jsonError(
      "VALIDATION_ERROR",
      "이 시험지에 출제되지 않은 문항이 포함되어 있습니다.",
      400,
      [{ field: "answers", message: unknownAnswer.problemId }],
    );
  }
  // 같은 문항에 응답이 두 번 들어오면 그 문항의 배점이 두 번 더해진다.
  // 아래 개수 검사는 Set 크기만 보므로 중복을 잡지 못한다 — [p1, p1, p2, p3] 은
  // 고유 3개라 "문항 3개"를 통과하고, 3문항(10·10·80) 시험지에서 70점이 80점이 됐다
  // (2026-08-16 적대적 리뷰 재현). 균등배분도 answers.length 로 나누므로 같이 흔들린다.
  if (answerProblemIds.size !== input.answers.length) {
    const duplicated = [
      ...new Set(
        input.answers
          .map((a) => a.problemId)
          .filter((id, i, all) => all.indexOf(id) !== i),
      ),
    ];
    return jsonError(
      "VALIDATION_ERROR",
      "같은 문항에 대한 응답이 여러 번 들어왔습니다.",
      400,
      duplicated.map((problemId) => ({
        field: "answers",
        message: problemId,
      })),
    );
  }

  if (answerProblemIds.size !== testProblems.length) {
    return jsonError(
      "VALIDATION_ERROR",
      "시험지의 모든 문항에 대한 응답이 필요합니다.",
      400,
    );
  }

  const gradingProblems = testProblems.map((tp) => ({
    id: tp.problem.id,
    unitId: tp.problem.unitId,
    difficulty: tp.problem.difficulty,
    answer: tp.problem.answer,
    score: tp.problem.score ?? null,
    // 배점 보정기가 이 시험지에 매긴 조정 배점(11 §10, D-42). 있으면 원본보다 우선한다 —
    // 짜깁기 시험지의 만점을 100으로 맞추는 경로가 여기다. 없으면 기존 규칙 그대로.
    adjustedScore: tp.score ?? null,
  }));

  const { graded, score } = gradeAnswers(input.answers, gradingProblems);
  const predictedScore = predictStudentScore(score, graded);
  const { unitScores, difficultyDistribution, recommendedUnits } =
    buildAnalysisReport(graded);

  const created = await db.$transaction(async (tx) => {
    const testResult = await tx.testResult.create({
      data: {
        testId,
        studentId: input.studentId,
        score,
        predictedScore,
      },
    });

    for (const g of graded) {
      await tx.problemAnswer.create({
        data: {
          testResultId: testResult.id,
          problemId: g.problemId,
          selectedChoice: g.selectedChoice,
          essayScore: g.essayScore,
          isCorrect: g.isCorrect,
          sequence: g.sequence,
        },
      });
    }

    const analysisReport = await tx.analysisReport.create({
      data: {
        testResultId: testResult.id,
        totalScore: score,
        predictedScore,
        unitScores,
        difficultyDistribution,
        recommendedUnits,
      },
    });

    return { testResult, analysisReport };
  });

  return jsonOk(
    testResultSubmitResponseSchema,
    {
      data: {
        testResult: serializeTestResult(created.testResult),
        analysisReport: serializeAnalysisReport(created.analysisReport),
      },
    },
    { status: 201 },
  );
}
