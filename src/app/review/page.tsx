import { redirect } from "next/navigation";

import { ReviewConsole } from "@/components/review/ReviewConsole";
import type {
  ConsoleProblem,
  ConsoleQueue,
} from "@/components/review/ReviewConsole";
import type { ReviewQueueKey } from "@/contracts/review.contract";
import { db } from "@/lib/db";
import { REVIEW_QUEUES, unreviewedWhere } from "@/lib/review/queues";
import { getSessionUser } from "@/lib/session";

/**
 * 검수 콘솔 화면 — 검수 전용 계정이 로그인하면 여기로 온다(미들웨어가 보낸다).
 *
 * 원장님도 들어올 수 있다. 검수는 역할이 아니라 **일**이고, 지금 문항이 47,049건이라
 * 원장님이 직접 보시는 편이 빠른 대기열도 있다.
 *
 * ⚠️ 첫 묶음을 서버에서 같이 내려보낸다 — 화면이 뜨자마자 빈 칸을 보여 주고
 *    그 다음에 채우면, 검수처럼 **연달아 누르는 일**에서는 그 한 박자가 계속 걸린다.
 */
export const dynamic = "force-dynamic";

const FIRST_BATCH = 10;

export default async function ReviewPage() {
  const session = await getSessionUser();
  if (!session) redirect("/login");

  const summaries: ConsoleQueue[] = await Promise.all(
    REVIEW_QUEUES.map(async (q) => ({
      key: q.key,
      label: q.label,
      why: q.why,
      look: q.look,
      remaining: await db.problem.count({
        where: unreviewedWhere(q.key, session.id),
      }),
    })),
  );

  /**
   * 처음 여는 대기열은 **남은 것이 있는 첫 갈래**다. 늘 같은 갈래로 열면
   * 그게 0이 된 날 검수자가 「할 게 없다」고 읽고 나간다.
   */
  const initialKey: ReviewQueueKey =
    summaries.find((q) => q.remaining > 0)?.key ?? summaries[0].key;

  const [rows, reviewedByMe] = await Promise.all([
    db.problem.findMany({
      where: unreviewedWhere(initialKey, session.id),
      take: FIRST_BATCH,
      orderBy: { updatedAt: "asc" },
      include: {
        unit: { select: { grade: true, section: true } },
      },
    }),
    db.problemReviewLog.count({ where: { reviewerId: session.id } }),
  ]);

  const initialRows: ConsoleProblem[] = rows.map((p) => ({
    id: p.id,
    problemCode: p.problemCode,
    content: p.content,
    answer: p.answer,
    solution: p.solution,
    questionType: p.questionType,
    figureUrls: p.figureUrls,
    figureDims: p.figureDims,
    figureSourceMm: p.figureSourceMm,
    directUseAllowed: p.directUseAllowed,
    unitName: p.unit ? `${p.unit.grade} · ${p.unit.section}` : "—",
  }));

  return (
    <ReviewConsole
      queues={summaries}
      initialKey={initialKey}
      initialRows={initialRows}
      reviewedByMe={reviewedByMe}
    />
  );
}
