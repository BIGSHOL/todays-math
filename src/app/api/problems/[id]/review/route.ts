/**
 * POST /api/problems/{id}/review — 검수 판정 (검수 콘솔 4/n).
 * 대응 계약: src/contracts/review.contract.ts
 *
 * 판정은 셋이다: `pass` 통과 · `unsure` 판단 못 하겠다 · `defect` 신고.
 *
 * 🔴 **`unsure` 와 `defect` 는 문항을 바꾸지 않는다.** 판정을 기록만 하고,
 *    지면에서 빼는 것은 사람이 따로 결정한다. 오신고 한 건이 멀쩡한 문항을
 *    지우면 안 된다(신고 API 와 같은 규칙).
 * 🔴 `pass` 만 `reviewStatus` 를 approved 로 올린다. 그게 「출제해도 된다」는 뜻이다.
 *
 * ⚠️ 기록·상태·신고를 **한 트랜잭션**으로 쓴다. 갈라지면 「봤는데 신고가 없다」거나
 *    「신고는 있는데 안 본 것으로 남는다」가 생기고, 대기열이 그 문항을 영영 다시 낸다.
 */
import type { NextRequest } from "next/server";

import { idParamSchema } from "@/contracts/common.contract";
import {
  reviewSubmitRequestSchema,
  reviewSubmitResponseSchema,
} from "@/contracts/review.contract";
import { jsonOk, unauthorizedError, validationError } from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { requireAccessibleProblem } from "@/lib/ownership";
import { serializeReviewLog } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { id } = await params;
  const idResult = idParamSchema.safeParse({ id });
  if (!idResult.success) return validationError(idResult.error);

  // 남의 **공용** 문항도 검수한다 — 검수 계정은 자기 문항이 없다(D-31).
  const accessible = await requireAccessibleProblem(id, session.id);
  if (!accessible.ok) return accessible.response;

  const body = await request.json().catch(() => undefined);
  const parsed = reviewSubmitRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  const { verdict, reason, note } = parsed.data;

  const result = await db.$transaction(async (tx) => {
    const log = await tx.problemReviewLog.create({
      data: {
        problemId: id,
        reviewerId: session.id,
        verdict,
        note: note ?? null,
      },
    });

    let reviewStatus = accessible.data.reviewStatus;
    if (verdict === "pass" && reviewStatus !== "approved") {
      const updated = await tx.problem.update({
        where: { id },
        data: { reviewStatus: "approved" },
      });
      reviewStatus = updated.reviewStatus;
    }

    let reportId: string | null = null;
    if (verdict === "defect" && reason) {
      // 같은 사람이 같은 사유로 거듭 신고하면 한 건으로 본다(신고 API 와 같은 규칙).
      const existing = await tx.problemReport.findFirst({
        where: {
          problemId: id,
          reporterId: session.id,
          reason,
          status: "open",
        },
      });
      reportId =
        existing?.id ??
        (
          await tx.problemReport.create({
            data: {
              problemId: id,
              reporterId: session.id,
              reason,
              note: note ?? null,
            },
          })
        ).id;
    }

    return { log, reviewStatus, reportId };
  });

  return jsonOk(
    reviewSubmitResponseSchema,
    {
      data: {
        log: serializeReviewLog(result.log),
        reviewStatus: result.reviewStatus,
        reportId: result.reportId,
      },
    },
    { status: 201 },
  );
}
