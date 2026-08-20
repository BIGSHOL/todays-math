import { notFound } from "next/navigation";
import { connection } from "next/server";

import { TestPrint } from "@/components/print/TestPrint";
import type { TestPrintDocument } from "@/components/print/types";
import { db } from "@/lib/db";

import { pickPaperProblems, SLOTS, type Candidate } from "./pickPaperProblems";
import { SlotReport } from "./SlotReport";

/**
 * 인쇄 검수 **시험지 견본** — 미결 항목을 **한 번에 뽑아 보는** 자리.
 *
 * ## 왜 만들었나
 *
 * `/dev/print-check` 의 미결 22건 중 **16건이 「시험지를 뽑아 봐야」 드러난다.**
 * 그런데 출제 엔진이 고르는 문항이 그 16건을 다 건드릴 보장이 없다 — 서술형이
 * 하나도 안 뽑히면 「서술형 배지」는 영영 못 본다. `items.ts` 의 `SAMPLING_PLAN` 이
 * 「일부러 넣어야 한다」고 적어 두었지만 **일부러 넣는 장치가 없었다.**
 *
 * 그리고 시험지를 뽑으려면 반 · 진도 · 출제 · 확정이 앞에 있어야 한다. 검수 하나
 * 하려고 그 절차를 매번 밟는 것은 「완료 조건」을 사실상 막아 둔 것과 같다.
 *
 * ## 🔴 견본이라고 딴 지면을 그리지 않는다
 *
 * 이 화면은 제품의 `TestPrint` 를 **그대로** 부른다 — 인쇄 단추·모드 전환·지면
 * 분할·넘침 경고가 전부 실제 시험지와 같은 코드다. 여기서 다른 것은 **문항을
 * 고른 방법**뿐이다. 검수용으로 따로 그리면 「본 것」과 「나가는 것」이 갈라진다.
 *
 * ## 못 채운 자리를 숨기지 않는다
 *
 * 어떤 자리를 못 채웠으면 그 항목은 **이 시험지로 검수할 수 없다.** 조용히
 * 넘기면 「뽑아서 검수했다」가 되면서 그 항목이 검수된 척 남는다. 화면 위에
 * 자리별 채움 현황을 먼저 찍는다.
 *
 * ⚠️ 다른 `/dev` 화면과 같은 가드 — production 에서는 기본으로 없다.
 * ⚠️ `force-static` 금지(형제 화면 주석). `connection()` 으로 옵트아웃한다.
 * ⚠️ **DB 를 한 건도 안 바꾼다.** 읽기만 한다 — 시험지 레코드를 만들지 않는다.
 */

/** 정답지 1쪽 정원(`overflow-first-page`)이 드러나려면 문항 수가 있어야 한다. */
const TOTAL = 25;

export default async function PrintPaperPage() {
  await connection();
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_RENDER_QA !== "1"
  ) {
    notFound();
  }

  // 출제 풀과 **같은 자격**으로 고른다 — 검수용으로 더 넓게 보면 실제로는
  // 안 나가는 문항을 검수하게 된다.
  const pool = (await db.problem.findMany({
    where: {
      reviewStatus: "approved",
      directUseAllowed: true,
    },
    select: {
      id: true,
      problemCode: true,
      content: true,
      answer: true,
      solution: true,
      questionType: true,
      figureUrls: true,
      figureDims: true,
      figureSourceMm: true,
    },
    // 🔴 `problemCode` 순으로 앞에서 자르면 **한 학년·한 단원**만 본다 —
    //    그 편향 때문에 「보기 상자」 자리가 0/2 로 비었다(2026-08-20).
    //    id(uuid) 순은 내용과 무관하므로 학년·유형이 고루 섞인다.
    take: 12000,
    orderBy: { id: "asc" },
  })) as Candidate[];

  const { picked, filled, padding } = pickPaperProblems(pool, TOTAL);

  const doc: TestPrintDocument = {
    testId: "print-paper-specimen",
    testType: "daily",
    testDate: "검수 견본",
    className: "인쇄 검수",
    section: "미결 항목 한 번에 보기",
    todayGoal: "지면이 종이에서 제대로 나오는지 확인",
    conceptNote: "",
    problems: picked.map((p, i) => ({
      id: p.id,
      orderIndex: i + 1,
      content: p.content,
      answer: p.answer,
      solution: p.solution,
      questionType: p.questionType,
      figureUrls: p.figureUrls,
      figureDims: p.figureDims,
      figureSourceMm: p.figureSourceMm,
    })),
  };

  return (
    <>
      <SlotReport
        filled={filled}
        padding={padding}
        total={TOTAL}
        picked={picked.length}
        pool={pool.length}
        slots={SLOTS.length}
      />
      <TestPrint data={doc} />
    </>
  );
}
