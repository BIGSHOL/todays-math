/**
 * POST /api/problems/transform/adopt — 미리보기에서 **채택한** 변형만 pending 으로 적재.
 *
 * `POST /api/problems/transform` 이 만든 후보 중 원장님이 고른 것만 여기로 온다
 * (원장님 확정 2026-08-19 "미리보기 후 채택").
 *
 * ⚠️ 분류 필드는 **전부 서버가 원본에서 물려받아 부여한다** — 요청은 본문·정답·풀이와
 *    난이도 조정만 보낸다. 특히 `source="transformed"` 와 `originProblemId` 는 클라이언트가
 *    정할 수 없다: `originProblemId` 가 NULL 인지 아닌지가 RPM 교재 이관본(source=transformed,
 *    originProblemId=NULL)과 AI 변형본을 가르는 **유일한 판별자**이고(D-51),
 *    `composePredictedPaper` 의 `SOURCE_RANK` 가 그 값으로 출제 등급을 나눈다.
 *
 * 대응 계약: src/contracts/problem.contract.ts (problemTransformAdoptRequestSchema)
 */
import type { NextRequest } from "next/server";

import type { Difficulty } from "@/contracts/common.contract";
import {
  problemTransformAdoptRequestSchema,
  problemTransformAdoptResponseSchema,
  shiftDifficulty,
} from "@/contracts/problem.contract";
import {
  jsonOk,
  unauthorizedError,
  validationError,
} from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { requireAccessibleProblem } from "@/lib/ownership";
import { serializeProblem } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const body = await request.json().catch(() => undefined);
  const parsed = problemTransformAdoptRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const accessible = await requireAccessibleProblem(
    parsed.data.originProblemId,
    session.id,
  );
  if (!accessible.ok) return accessible.response;

  const origin = accessible.data;
  const difficulty = shiftDifficulty(
    origin.difficulty as Difficulty,
    parsed.data.difficultyShift,
  );

  // 생성 쪽과 같은 이유로 `createManyAndReturn`(=INSERT ... RETURNING) 한 문장이다.
  // 문장이 하나뿐이므로 트랜잭션 래퍼 없이도 전부 아니면 전무다 — 채택 묶음이 반쯤
  // 저장되는 일이 없다. 반환 순서는 입력 순서라 응답 순서도 화면이 보낸 그대로다.
  // exam-wiring: 기출아님 — AI 변형본만 넣는다. 원본 시험지가 없다
  const created = await db.problem.createManyAndReturn({
    data: parsed.data.items.map((item) => ({
      userId: session.id,
      unitId: origin.unitId,
      source: "transformed",
      originProblemId: origin.id,
      difficulty,
      problemType: origin.problemType,
      content: item.content,
      answer: item.answer,
      solution: item.solution,
      reviewStatus: "pending",
    })),
  });

  return jsonOk(
    problemTransformAdoptResponseSchema,
    { data: created.map(serializeProblem) },
    { status: 201 },
  );
}
