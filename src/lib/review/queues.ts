/**
 * 검수 대기열 — 「오늘 무엇을 볼까」.
 *
 * 부르는 곳: src/app/api/review/queue/route.ts · src/app/review/page.tsx
 *
 * 🔴 **대기열마다 «왜 이게 올라왔나»를 사람 말로 적는다.** 사유를 못 적는 대기열은
 *    검수자가 무엇을 봐야 할지 모른 채 넘기게 만들고, 그러면 기록이 잡음이 된다.
 *
 * 🔴 **「이미 봤다」는 `problem.reviewStatus` 로 못 묻는다.** 이관 적재가 문항을
 *    전부 `approved` 로 넣기 때문이다(`src/lib/import/toLoadRows.ts`).
 *    그 컬럼이 적는 것은 「출제 자격」이지 「사람이 봤음」이 아니다 —
 *    그래서 `problem_review_log` 를 따로 둔다.
 */
import type { Prisma } from "@prisma/client";

import type { ReviewQueueKey } from "@/contracts/review.contract";
import { problemVisibleWhere } from "@/lib/problemPool";

export type ReviewQueueDef = {
  key: ReviewQueueKey;
  label: string;
  /** 왜 이게 대기열에 올라왔나. */
  why: string;
  /** 이 대기열에서 **무엇을 봐야 하나**. */
  look: string;
  where: Prisma.ProblemWhereInput;
};

export const REVIEW_QUEUES: readonly ReviewQueueDef[] = [
  {
    key: "mm",
    label: "그림 크기를 모른다",
    why: "그림은 붙어 있는데 원본 지면에서 몇 mm 였는지가 없다. 인쇄 크기가 추측이라 종이에서 커지거나 작아진다.",
    look: "그림이 문항에 견주어 지나치게 크거나 작지 않은가",
    where: {
      NOT: { figureUrls: { isEmpty: true } },
      figureSourceMm: { isEmpty: true },
    },
  },
  {
    key: "pending",
    label: "사람이 아직 안 봤다",
    why: "만들어진 뒤로 아무도 승격하지 않은 문항이다. 출제 풀에 못 들어간다.",
    look: "발문·보기·정답이 서로 맞는가",
    where: { reviewStatus: "pending" },
  },
  {
    key: "excluded",
    label: "출제에서 빠져 있다",
    why: "그림이 없거나 짝을 못 찾아 출제 대상에서 잠갔다. 되살릴 수 있으면 되살린다.",
    look: "지금 화면만으로 학생이 풀 수 있는가",
    where: { directUseAllowed: false },
  },
  {
    key: "figure",
    label: "그림을 보라",
    why: "그림이 붙은 문항 전부다. 화질이 낮은 래스터·지면과 다른 스타일·해설 그림이 본문에 딸려 온 것을 가려낸다 (2026-08-21 원장님: 그림 문제를 한번에 검수).",
    look: "그림이 흐리지 않은가 · 흑백 지면 스타일인가 · 둘째 그림이 해설 그림은 아닌가. 이상하면 «신고 → 그림»",
    where: { NOT: { figureUrls: { isEmpty: true } } },
  },
  {
    key: "nosolution",
    label: "해설이 없다",
    why: "정답만 있고 풀이가 없다. 답이 맞는지 이 화면에서 검산할 수 없다.",
    look: "정답이 그럴듯한가. 아니면 «판단 못 하겠다»로 넘겨라",
    where: { OR: [{ solution: null }, { solution: "" }] },
  },
];

export function findQueue(key: ReviewQueueKey): ReviewQueueDef {
  const q = REVIEW_QUEUES.find((x) => x.key === key);
  // 계약이 열거형으로 막으므로 여기 오면 목록과 계약이 갈라진 것이다.
  if (!q) throw new Error(`모르는 대기열: ${key}`);
  return q;
}

/**
 * 그 대기열에서 **이 사람이 아직 안 본** 문항 조건.
 *
 * ⚠️ `reviewerId` 로 거른다 — 검수자를 안 가리면 남이 본 것까지 사라져서
 *    두 사람이 나눠 볼 수가 없다. 그리고 검수자 없이 들어간 기록(스크립트 적재 등)은
 *    누구의 것도 아니므로 아무도 건너뛰지 않는다.
 */
export function unreviewedWhere(
  key: ReviewQueueKey,
  userId: string,
): Prisma.ProblemWhereInput {
  return {
    AND: [
      problemVisibleWhere(userId),
      findQueue(key).where,
      { reviewLogs: { none: { reviewerId: userId } } },
    ],
  };
}
