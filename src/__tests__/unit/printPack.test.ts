/**
 * 지면 분할 — **문항 길이가 장당 문항 수를 정한다** (인쇄 정확성 · 절대 규칙 6).
 *
 * 원장님 확정(2026-08-21): 「문항 길이에 따라 배치를 다르게. 길이가 긴 문항은
 * 2개를 넣을 수 없음. 길이가 길면 1개로.」
 *
 * 그전까지 `packProblems` 는 장을 **문항 수로만** 잘랐다. 첫 장은 머리글과
 * 「◆ 핵심 개념 정리」 상자가 얹혀 칸이 79px 좁은데 분할이 그걸 몰라서,
 * **같은 문항이 1·2번이면 겹치고 3번이면 멀쩡**했다(실측 첫 장 3,653건 · 이어지는
 * 장 1,275건). 이 파일은 그 결함의 회귀 가드다 —
 * `qa/adversarial/_adv-print-overflow.test.ts` 의 `[적대③-B]` 를 옮겨 왔다.
 *
 * 실물 프린터 검수는 이 테스트가 대신하지 못한다(`/dev/print-check`).
 * 여기서 보는 것은 「분할이 높이를 보는가」뿐이다.
 */
import { describe, expect, it } from "vitest";

import type { TestPrintProblem } from "@/components/print/types";
import { JASEUP_GEOMETRY, JASEUP_MEASURED_PX } from "@/lib/printGeometry";
import { paginateAnswerKey } from "@/lib/printLayout";
import {
  assessOverflowRisk,
  assessSeat,
  seatCapacities,
} from "@/lib/printOverflow";
import { packProblems } from "@/lib/printPack";

const {
  firstPageSlot,
  continuationSlot,
  soloFirstPageSlot,
  soloContinuationSlot,
} = JASEUP_MEASURED_PX;

const LINE =
  "다음 이차방정식의 해를 구하고 그 과정을 자세히 서술하시오 가나다라마바사아자";
const 본문 = (줄: number) =>
  Array.from({ length: 줄 }, () => LINE).join("\n\n");

/** 어느 반 칸에도 들어간다. */
const 짧다 = 본문(17);
/** 이어지는 장 반 칸에는 들어가고 **첫 장 반 칸에는 안 들어간다.** */
const 중간 = 본문(25);
/** 반 칸 어디에도 안 들어간다. 혼자 쓰면 들어간다. */
const 길다 = 본문(30);
/** **혼자 써도 안 들어간다** — 분할로는 못 고치는 부류. */
const 아주길다 = 본문(70);

function problems(count: number, content = "문제"): TestPrintProblem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    orderIndex: index + 1,
    content: `${content}`,
    answer: String(index + 1),
    solution: null,
  }));
}

const 문항 = (id: string, content: string): TestPrintProblem => ({
  id,
  orderIndex: 0,
  content,
  answer: "1",
  solution: null,
});

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

const 넘치나 = (content: string, slotPx: number) =>
  assessSeat({ content }, slotPx).tooTall;

describe("[픽스처] 이 본문들이 **실제로** 경계를 가른다", () => {
  /**
   * 🔴 이 시험이 없으면 아래 전부가 장식이 될 수 있다. 자(`estimateProblemPx`)가
   *    바뀌면 「길다」가 반 칸에 들어가 버리고, 그러면 분할 시험은 통과하면서
   *    **아무것도 안 가른다**. 그때 빨개져야 할 곳이 여기다 — 본문을 다시 고르라는
   *    뜻이지, 아래 시험을 고치라는 뜻이 아니다.
   *    (CLAUDE.md 2026-08-21 「픽스처가 경계를 가르는지부터 보라」)
   */
  it("짧다 · 중간 · 길다 · 아주길다 가 서로 다른 칸에서 갈린다", () => {
    expect(넘치나(짧다, firstPageSlot)).toBe(false);

    expect(넘치나(중간, firstPageSlot)).toBe(true);
    expect(넘치나(중간, continuationSlot)).toBe(false);

    expect(넘치나(길다, continuationSlot)).toBe(true);
    expect(넘치나(길다, soloFirstPageSlot)).toBe(false);

    expect(넘치나(아주길다, soloContinuationSlot)).toBe(true);
  });
});

describe("[packProblems] 문제지 분할 — 길이가 장당 문항 수를 정한다", () => {
  /**
   * 칸 실측은 「그 장에 하나」와 「그 장에 둘」 **두 가지뿐**이다
   * (`JASEUP_MEASURED_PX`). 분할도 그 둘만 안다 — 정원을 3으로 올리면 칸을
   * 다시 재야 하므로, 그 순간 이 시험이 빨개져 알려 준다.
   */
  it("장당 정원은 둘이 최대다", () => {
    expect(JASEUP_GEOMETRY.questionsPerPage).toBe(2);
    expect(
      packProblems(problems(9, 짧다)).every((p) => p.problems.length <= 2),
    ).toBe(true);
  });

  it("짧은 문항은 그대로 장당 둘, 읽기 순서 그대로", () => {
    expect(layout(packProblems(problems(5, 짧다)))).toEqual([
      "p1/문1/p1",
      "p1/문2/p2",
      "p2/문3/p3",
      "p2/문4/p4",
      "p3/문5/p5",
    ]);
  });

  /** 🔴 원장님이 종이에서 보신 그 자리 — 「문제가 너무 길어서 아래쪽이 짤렸어」. */
  it("첫 장 반 칸을 넘는 문항이 1번이면 **첫 장을 혼자 쓴다**", () => {
    const pages = packProblems([
      문항("긴것", 중간),
      문항("a", 짧다),
      문항("b", 짧다),
    ]);
    expect(pages.map((p) => p.problems.map((q) => q.id))).toEqual([
      ["긴것"],
      ["a", "b"],
    ]);
  });

  /** 짝이 될 **뒤 문항**이 안 들어가도 그 장은 하나만 받는다. */
  it("2번이 안 들어가면 1번만 첫 장에 놓고 2번은 다음 장으로", () => {
    const pages = packProblems([
      문항("a", 짧다),
      문항("긴것", 중간),
      문항("b", 짧다),
    ]);
    expect(pages.map((p) => p.problems.map((q) => q.id))).toEqual([
      ["a"],
      ["긴것", "b"],
    ]);
  });

  /**
   * 🔴 **첫 장과 이어지는 장은 칸이 다르다.** 같은 문항이 첫 장이면 혼자여야 하고
   *    뒤로 가면 짝을 이룬다 — 분할이 «몇째 장인가»를 봐야만 나오는 결과다.
   */
  it("첫 장에서만 큰 문항은 뒤 장에서는 짝을 이룬다", () => {
    const pages = packProblems([
      문항("a", 짧다),
      문항("b", 짧다),
      문항("중간1", 중간),
      문항("중간2", 중간),
    ]);
    expect(pages.map((p) => p.problems.map((q) => q.id))).toEqual([
      ["a", "b"],
      ["중간1", "중간2"],
    ]);
  });

  it("반 칸 어디에도 안 들어가는 문항은 늘 혼자 쓴다", () => {
    const pages = packProblems([
      문항("a", 짧다),
      문항("b", 짧다),
      문항("길다", 길다),
      문항("c", 짧다),
      문항("d", 짧다),
    ]);
    expect(pages.map((p) => p.problems.map((q) => q.id))).toEqual([
      ["a", "b"],
      ["길다"],
      ["c", "d"],
    ]);
  });

  it("읽기 순서는 절대 안 바뀐다 — 번호도 이어진다", () => {
    const 섞임 = [짧다, 길다, 짧다, 중간, 짧다, 짧다, 길다];
    const pages = packProblems(
      섞임.map((content, i) => 문항(`p${i + 1}`, content)),
    );
    expect(layout(pages).map((s) => s.split("/").slice(1).join("/"))).toEqual(
      섞임.map((_, i) => `문${i + 1}/p${i + 1}`),
    );
  });

  /**
   * 🔴 **분할이 경고를 대신하지 않는다.** 혼자 놓아도 안 들어가는 문항이 있다
   *    (실측 47,152건 중 54건). 그 자리는 계속 경고해야 한다 — 분할이 조용히
   *    삼키면 원장님은 종이를 받고서야 안다.
   */
  it("혼자 놓아도 안 들어가면 혼자 놓되 **경고는 그대로 나간다**", () => {
    const list = [문항("아주긴것", 아주길다), 문항("a", 짧다)];
    expect(packProblems(list)[0]!.problems.map((q) => q.id)).toEqual([
      "아주긴것",
    ]);
    const risks = assessOverflowRisk(list);
    expect(risks.map((r) => r.problemId)).toEqual(["아주긴것"]);
  });

  it("문항이 없으면 장도 없다", () => {
    expect(packProblems([])).toEqual([]);
    expect(packProblems(problems(1, 짧다))).toEqual([
      { problems: problems(1, 짧다), startingNumber: 1 },
    ]);
  });
});

describe("[seatCapacities] 판정이 **그 분할**을 본다", () => {
  /**
   * 🔴 분할과 판정이 각자 자리 계산을 가지면 「조판은 넣었는데 판정은 경고하는」
   *    문항이 생긴다. 그래서 자리 계산은 `packProblems` 에서 **유도**한다.
   */
  it("자리마다의 칸이 분할 결과와 정확히 맞는다", () => {
    const list = [
      문항("긴것", 중간),
      문항("a", 짧다),
      문항("b", 짧다),
      문항("길다", 길다),
    ];
    expect(seatCapacities(list)).toEqual([
      soloFirstPageSlot, // 첫 장을 혼자
      continuationSlot,
      continuationSlot,
      soloContinuationSlot, // 이어지는 장을 혼자
    ]);
  });

  it("짧은 문항만이면 예전 계산과 한 글자도 다르지 않다", () => {
    expect(seatCapacities(problems(8, 짧다))).toEqual([
      firstPageSlot,
      firstPageSlot,
      continuationSlot,
      continuationSlot,
      continuationSlot,
      continuationSlot,
      continuationSlot,
      continuationSlot,
    ]);
    expect(seatCapacities(problems(25, 짧다)).at(-1)).toBe(
      soloContinuationSlot,
    );
    expect(seatCapacities(problems(1, 짧다))).toEqual([soloFirstPageSlot]);
  });

  /**
   * 🔴 분할이 높이를 보게 됐으므로, **반 칸을 넘는다는 이유만으로는 더 이상
   *    경고가 나오면 안 된다.** 그 문항은 이제 칸을 혼자 쓴다.
   */
  it("칸을 혼자 쓰게 된 문항에는 경고가 없다", () => {
    expect(
      assessOverflowRisk([
        문항("긴것", 길다),
        문항("a", 짧다),
        문항("b", 짧다),
      ]),
    ).toEqual([]);
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
