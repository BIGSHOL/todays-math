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
          // 그림 원본 치수 — 넘침 판정이 그림 높이를 계산하는 유일한 근거다.
          // 판정은 브라우저에서 돌아 이미지 파일을 읽을 수 없다(printOverflow.ts).
          figureDims: item.problem.figureDims,
          // 원본 지면에서 그 그림이 차지하던 **물리 폭(mm)** — 「얼마로 그린다」의
          // 유일한 근거다. 비면 «모른다»라 오늘처럼 픽셀로 그린다(회귀 0).
          // 자(printOverflow)와 지면(ProblemContent)이 같은 함수로 읽는다.
          figureSourceMm: item.problem.figureSourceMm,
        })),
      }}
    />
  );
}
