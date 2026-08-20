import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import { ReviewWireClient } from "./ReviewWireClient";

/**
 * 문제은행 **검수 콘솔** 와이어 시안 (D-07 1단계).
 *
 * 🔴 **실데이터로 세운다.** 2026-08-19 에 확인테스트 범위 시안을 중2 17개짜리
 *    픽스처로 만들었더니, 실제 시드(735개)에서 피커가 화면 밖으로 밀렸다.
 *    시안은 「모양」을 보여 주는 물건인데 모양을 정하는 것은 **데이터의 크기**다.
 *    그래서 여기서는 진짜 문제은행을 읽는다 — 47,049문항의 무게가 보여야 한다.
 *
 * ⚠️ 읽기만 한다. 아무것도 안 바꾼다.
 */
const SELECT = {
  id: true,
  problemCode: true,
  content: true,
  answer: true,
  solution: true,
  questionType: true,
  difficulty: true,
  source: true,
  school: true,
  figureUrls: true,
  figureDims: true,
  figureSourceMm: true,
  reviewStatus: true,
  directUseAllowed: true,
  unit: { select: { grade: true, chapter: true, section: true } },
} satisfies Prisma.ProblemSelect;

export const dynamic = "force-dynamic";

const SAMPLE = 48;

export default async function ReviewWirePage() {
  const [total, excluded, pending, withFigure, figureNoMm, noSolution, units] =
    await Promise.all([
      db.problem.count(),
      db.problem.count({ where: { directUseAllowed: false } }),
      db.problem.count({ where: { reviewStatus: "pending" } }),
      db.problem.count({ where: { NOT: { figureUrls: { isEmpty: true } } } }),
      db.problem.count({
        where: {
          NOT: { figureUrls: { isEmpty: true } },
          figureSourceMm: { isEmpty: true },
        },
      }),
      db.problem.count({
        where: { OR: [{ solution: null }, { solution: "" }] },
      }),
      db.unit.count(),
    ]);

  /**
   * 🔴 표본을 `problemCode` 순으로 뽑았더니 **초3~초5만** 걸렸다(코드가 E3·E4·E5
   *    로 시작해 먼저 정렬된다). 47,049문항의 87%가 기출인데 시안이 구석만
   *    보여 준 것이다 — 「시안은 가장 큰 실데이터로 세워라」의 반대를 했다.
   *
   * 그래서 **검수가 실제로 마주칠 네 갈래**에서 고루 뽑는다. 이게 곧
   * 「어디부터 볼까」의 답이기도 하다.
   */
  const buckets = [
    {
      why: "그림은 있는데 원본 크기(mm)를 모른다",
      where: {
        NOT: { figureUrls: { isEmpty: true } },
        figureSourceMm: { isEmpty: true },
      },
    },
    {
      why: "검수 대기 — 사람이 아직 안 봤다",
      where: { reviewStatus: "pending" as const },
    },
    { why: "출제에서 빠져 있다", where: { directUseAllowed: false } },
    {
      why: "그림이 붙은 평범한 기출",
      where: {
        source: "past_exam" as const,
        NOT: { figureUrls: { isEmpty: true } },
        directUseAllowed: true,
      },
    },
  ];

  const picked = await Promise.all(
    buckets.map((b) =>
      db.problem.findMany({
        where: b.where,
        take: SAMPLE / buckets.length,
        orderBy: { updatedAt: "desc" },
        select: SELECT,
      }),
    ),
  );

  // 갈래를 번갈아 끼운다 — 한 갈래만 몰리면 목록 밀도가 거짓이 된다.
  const sample = Array.from(
    { length: SAMPLE },
    (_, k) => picked[k % buckets.length]?.[Math.floor(k / buckets.length)],
  )
    .filter(Boolean)
    .map((p) => ({
      ...p,
      unitName: p.unit ? p.unit.grade + " · " + p.unit.section : "—",
      why: undefined,
      unit: undefined,
    }));

  return (
    <ReviewWireClient
      counts={{
        total,
        excluded,
        pending,
        withFigure,
        figureNoMm,
        noSolution,
        units,
      }}
      sample={JSON.parse(JSON.stringify(sample))}
    />
  );
}
