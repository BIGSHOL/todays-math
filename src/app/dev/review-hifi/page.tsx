import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import { ReviewHifiClient } from "./ReviewHifiClient";

/**
 * 검수 콘솔 **Hi-fi 4안** (D-07 2단계). 와이어에서 원장님이 **A+E** 를 고르셨다 —
 * 「무엇을 볼지는 대기열(E)이 고르고, 한 문항씩(A) 본다」.
 *
 * 그래서 네 안이 다투는 것은 배치가 아니라 **대기열을 어디에 두느냐**다.
 * 대기열이 늘 보이면 맥락이 남고 지면이 좁아진다. 숨기면 그 반대다.
 *
 * ⚠️ 읽기만 한다. 아무것도 안 바꾼다.
 */
export const dynamic = "force-dynamic";

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

/**
 * 대기열 갈래 — **왜 이게 올라왔나**를 사람 말로 적는다.
 * 「사유를 못 적는 대기열」은 검수자가 무엇을 봐야 할지 모른 채 넘기게 만든다.
 */
const QUEUES = [
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
    where: { reviewStatus: "pending" as const },
  },
  {
    key: "excluded",
    label: "출제에서 빠져 있다",
    why: "그림이 없거나 짝을 못 찾아 출제 대상에서 잠갔다. 되살릴 수 있으면 되살린다.",
    look: "지금 화면만으로 학생이 풀 수 있는가",
    where: { directUseAllowed: false },
  },
  {
    key: "nosolution",
    label: "해설이 없다",
    why: "정답만 있고 풀이가 없다. 답이 맞는지 이 화면에서 검산할 수 없다.",
    look: "정답이 그럴듯한가. 아니면 «판단 못 하겠다»로 넘겨라",
    where: { OR: [{ solution: null }, { solution: "" }] },
  },
] satisfies {
  key: string;
  label: string;
  why: string;
  look: string;
  where: Prisma.ProblemWhereInput;
}[];

export default async function ReviewHifiPage() {
  const total = await db.problem.count();

  const queues = await Promise.all(
    QUEUES.map(async (q) => ({
      key: q.key,
      label: q.label,
      why: q.why,
      look: q.look,
      count: await db.problem.count({ where: q.where }),
      rows: (
        await db.problem.findMany({
          where: q.where,
          take: 8,
          orderBy: { updatedAt: "desc" },
          select: SELECT,
        })
      ).map((p) => ({
        ...p,
        unitName: p.unit ? p.unit.grade + " · " + p.unit.section : "—",
        unit: undefined,
      })),
    })),
  );

  return (
    <ReviewHifiClient
      total={total}
      queues={JSON.parse(JSON.stringify(queues))}
    />
  );
}
