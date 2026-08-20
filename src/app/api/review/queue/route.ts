/**
 * GET /api/review/queue — 「다음에 볼 문항」 (검수 콘솔 4/n).
 * 대응 계약: src/contracts/review.contract.ts
 *
 * 🔴 **이 사람이 아직 안 본 것만** 돌려준다. 안 그러면 판정한 문항이 다시 올라와
 *    영영 끝나지 않는다. 「봤나」는 `problem_review_log` 로 묻는다 —
 *    `reviewStatus` 로는 못 묻는다(이관 적재가 전부 approved 로 넣었다).
 *
 * ⚠️ 남은 수(`remaining`)를 **셀 때와 고를 때가 같은 조건**을 쓴다. 두 벌로 적으면
 *    「12건 남았다」고 해 놓고 8건만 오는 일이 생기고, 아무도 그걸 못 알아챈다.
 */
import type { NextRequest } from "next/server";

import {
  reviewQueueQuerySchema,
  reviewQueueResponseSchema,
} from "@/contracts/review.contract";
import { jsonOk, unauthorizedError, validationError } from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { findQueue, unreviewedWhere } from "@/lib/review/queues";
import { serializeProblem } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const url = new URL(request.url);
  const parsed = reviewQueueQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsed.success) return validationError(parsed.error);
  const { key, limit } = parsed.data;

  const queue = findQueue(key);
  const where = unreviewedWhere(key, session.id);

  const [rows, remaining, reviewedByMe] = await Promise.all([
    db.problem.findMany({
      where,
      take: limit,
      // 가장 오래 방치된 것부터. 새로 들어온 것이 늘 앞에 서면 뒤가 영영 안 온다.
      orderBy: { updatedAt: "asc" },
    }),
    db.problem.count({ where }),
    db.problemReviewLog.count({ where: { reviewerId: session.id } }),
  ]);

  return jsonOk(reviewQueueResponseSchema, {
    data: rows.map(serializeProblem),
    meta: {
      queue: {
        key: queue.key,
        label: queue.label,
        why: queue.why,
        look: queue.look,
        remaining,
      },
      reviewedByMe,
    },
  });
}
