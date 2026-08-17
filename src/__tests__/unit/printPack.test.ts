/**
 * 지면 분할 결과 잠금 (인쇄 정확성 — 절대 규칙 6).
 *
 * `packProblems`(문제지)와 `paginateAnswerKey`(정답지)는 어느 문항이 몇 쪽
 * 몇 번으로 찍히는지를 정한다. 성능 수리로 이 계산을 `useMemo` 뒤로 옮기는데,
 * 옮긴 뒤에도 **출력이 한 글자도 달라지지 않아야** 한다. 그래서 먼저 잠근다.
 *
 * 실물 프린터 검수는 이 테스트가 대신하지 못한다 — 이건 "분할이 그대로인가"만 본다.
 */
import { describe, expect, it } from "vitest";

import type { TestPrintProblem } from "@/components/print/types";
import { JASEUP_GEOMETRY } from "@/lib/printGeometry";
import { paginateAnswerKey } from "@/lib/printLayout";
import { packProblems } from "@/lib/printPack";

function problems(count: number): TestPrintProblem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    orderIndex: index + 1,
    content: `문제 ${index + 1}`,
    answer: String(index + 1),
    solution: null,
  }));
}

/** 어느 문항이 몇 쪽 몇 번인지 — 지면에서 눈으로 확인할 수 있는 형태로 편다. */
function layout(
  pages: Array<{ problems: TestPrintProblem[]; startingNumber: number }>,
): string[] {
  return pages.flatMap((page, pageIndex) =>
    page.problems.map(
      (problem, index) =>
        `p${pageIndex + 1}/문${page.startingNumber + index}/${problem.id}`,
    ),
  );
}

describe("[packProblems] 문제지 분할", () => {
  it("장당 두 문항, 읽기 순서 그대로", () => {
    expect(JASEUP_GEOMETRY.questionsPerPage).toBe(2);
    expect(layout(packProblems(problems(5)))).toEqual([
      "p1/문1/p1",
      "p1/문2/p2",
      "p2/문3/p3",
      "p2/문4/p4",
      "p3/문5/p5",
    ]);
  });

  it("문항 수가 딱 떨어지면 빈 장을 만들지 않는다", () => {
    const pages = packProblems(problems(4));
    expect(pages).toHaveLength(2);
    expect(pages.every((page) => page.problems.length === 2)).toBe(true);
  });

  it("한 문항이면 한 장, 문항이 없으면 장도 없다", () => {
    expect(packProblems(problems(1))).toEqual([
      { problems: problems(1), startingNumber: 1 },
    ]);
    expect(packProblems([])).toEqual([]);
  });

  it("최대 출제 문항 수(30)까지 번호가 이어진다", () => {
    const pages = packProblems(problems(30));
    expect(pages).toHaveLength(15);
    expect(pages.at(-1)?.startingNumber).toBe(29);
    expect(layout(pages).at(-1)).toBe("p15/문30/p30");
  });
});

describe("[paginateAnswerKey] 정답지 분할", () => {
  it("장당 8항목, 번호가 이어진다", () => {
    expect(JASEUP_GEOMETRY.answerEntriesPerPage).toBe(8);
    const pages = paginateAnswerKey(problems(20));
    expect(pages.map((page) => page.startingNumber)).toEqual([1, 9, 17]);
    expect(pages.map((page) => page.problems.length)).toEqual([8, 8, 4]);
    expect(layout(pages).at(-1)).toBe("p3/문20/p20");
  });

  it("8항목 이하는 한 장", () => {
    expect(paginateAnswerKey(problems(8))).toHaveLength(1);
    expect(paginateAnswerKey([])).toEqual([]);
  });
});
