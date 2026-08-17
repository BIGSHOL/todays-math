import { notFound, redirect } from "next/navigation";

import { TestPrint } from "@/components/print/TestPrint";
import { idParamSchema } from "@/contracts/common.contract";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

type TestPrintPageProps = {
  params: Promise<{ id: string }>;
};

export default async function TestPrintPage({ params }: TestPrintPageProps) {
  const [session, routeParams] = await Promise.all([getSessionUser(), params]);
  if (!session) redirect("/login");

  const parsed = idParamSchema.safeParse(routeParams);
  if (!parsed.success) notFound();

  const test = await db.test.findFirst({
    where: { id: parsed.data.id, userId: session.id },
    include: {
      class: true,
      rangeEndUnit: true,
      testProblems: {
        include: { problem: true },
        orderBy: { orderIndex: "asc" },
      },
    },
  });

  if (!test) notFound();

  const section = test.rangeEndUnit.section;

  return (
    <TestPrint
      data={{
        testId: test.id,
        testType: test.testType,
        testDate: test.testDate.toISOString().slice(0, 10),
        className: test.class.name,
        section,
        todayGoal: `${section}의 핵심 개념을 확인하고 문제에 적용한다.`,
        conceptNote: `${section}의 정의와 계산 원리를 확인한 뒤 풀이 과정에 적용한다.`,
        problems: test.testProblems.map((item) => ({
          id: item.problem.id,
          orderIndex: item.orderIndex,
          content: item.problem.content,
          answer: item.problem.answer,
          solution: item.problem.solution,
          // 본문에서 원본 라벨 `[서술형 3]` 을 걷어낸 뒤로 지면의 「서술형 n」
          // 표시는 **이 컬럼 하나**에 달려 있다(assignEssayLabels).
          questionType: item.problem.questionType,
          // 원본에서 오려 온 그림 — 인쇄물에도 같이 나가야 문제가 성립한다.
          figureUrls: item.problem.figureUrls,
        })),
      }}
    />
  );
}
