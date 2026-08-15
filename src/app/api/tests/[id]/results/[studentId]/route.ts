/**
 * GET /api/tests/{id}/results/{studentId} — 특정 학생의 최신 응시 결과 상세(문항별 응답 + 분석 리포트).
 * 대응 계약: src/contracts/testresult.contract.ts
 */
import type { NextRequest } from "next/server";

import { idParamSchema } from "@/contracts/common.contract";
import { testResultDetailResponseSchema } from "@/contracts/testresult.contract";
import {
  jsonOk,
  notFoundError,
  unauthorizedError,
  validationError,
} from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { requireOwnedStudentInClass, requireOwnedTest } from "@/lib/ownership";
import {
  serializeAnalysisReport,
  serializeProblemAnswer,
  serializeTestResult,
} from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string; studentId: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { id, studentId } = await params;
  const idResult = idParamSchema.safeParse({ id });
  const studentIdResult = idParamSchema.safeParse({ id: studentId });
  if (!idResult.success) return validationError(idResult.error);
  if (!studentIdResult.success) return validationError(studentIdResult.error);

  const owned = await requireOwnedTest(id, session.id);
  if (!owned.ok) return owned.response;

  const studentOwned = await requireOwnedStudentInClass(
    studentId,
    owned.data.classId,
    session.id,
  );
  if (!studentOwned.ok) return studentOwned.response;

  const testResult = await db.testResult.findFirst({
    where: { testId: id, studentId },
    orderBy: { takenAt: "desc" },
    include: { answers: true, analysisReport: true },
  });
  if (!testResult?.analysisReport) return notFoundError("응시 결과");

  return jsonOk(testResultDetailResponseSchema, {
    data: {
      testResult: serializeTestResult(testResult),
      answers: testResult.answers
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map(serializeProblemAnswer),
      analysisReport: serializeAnalysisReport(testResult.analysisReport),
    },
  });
}
