/**
 * 🟢 인쇄 검수 시험지 견본의 **문항 고르기** — 「못 채운 자리를 숨기지 않는다」.
 *
 * 이 도구의 존재 이유는 하나다: `/dev/print-check` 의 미결 16건이 **시험지를
 * 뽑아 봐야** 드러나는데, 출제 엔진이 고른 문항이 그 16건을 다 건드릴 보장이
 * 없다는 것. 서술형이 하나도 안 뽑히면 「서술형 배지」는 영영 못 본다.
 *
 * 그래서 **못 채운 자리가 반드시 밖으로 나와야 한다.** 조용히 넘기면
 * 「뽑아서 검수했다」가 되면서 그 항목은 검수된 척 남는다.
 */
import { describe, expect, it } from "vitest";

import {
  pickPaperProblems,
  type Candidate,
  type Slot,
} from "../../app/dev/print-paper/pickPaperProblems";

const c = (over: Partial<Candidate> & { id: string }): Candidate => ({
  problemCode: `X-${over.id}`,
  content: "본문",
  answer: "①",
  solution: null,
  questionType: "객관식",
  figureUrls: [],
  figureDims: [],
  figureSourceMm: [],
  ...over,
});

const SLOT_ESSAY: Slot = {
  forItem: "essay-badge",
  label: "서술형",
  want: (x) => x.questionType === "서술형",
  count: 2,
};
const SLOT_FIG: Slot = {
  forItem: "figures-multi",
  label: "그림 2장",
  want: (x) => x.figureUrls.length >= 2,
  count: 2,
};

describe("자리를 채운다", () => {
  it("자리마다 원하는 종류를 원하는 만큼 넣는다", () => {
    const pool = [
      c({ id: "a", questionType: "서술형" }),
      c({ id: "b", questionType: "서술형" }),
      c({ id: "d", figureUrls: ["/f/1.png", "/f/2.png"] }),
      c({ id: "e", figureUrls: ["/f/3.png", "/f/4.png"] }),
      c({ id: "f" }),
    ];
    const r = pickPaperProblems(pool, 5, [SLOT_ESSAY, SLOT_FIG]);
    expect(r.filled.map((f) => [f.forItem, f.got])).toEqual([
      ["essay-badge", 2],
      ["figures-multi", 2],
    ]);
    expect(r.padding).toBe(1);
    expect(r.picked).toHaveLength(5);
  });

  it("같은 문항을 두 자리에 쓰지 않는다", () => {
    // 서술형이면서 그림이 2장인 문항 하나뿐 — 한 자리만 채워져야 한다.
    const pool = [
      c({
        id: "a",
        questionType: "서술형",
        figureUrls: ["/f/1.png", "/f/2.png"],
      }),
    ];
    const r = pickPaperProblems(pool, 5, [SLOT_ESSAY, SLOT_FIG]);
    expect(r.picked.map((p) => p.id)).toEqual(["a"]);
    expect(r.filled.find((f) => f.forItem === "figures-multi")!.got).toBe(0);
  });
});

describe("🔴 못 채운 자리를 **숨기지 않는다**", () => {
  it("풀에 그 종류가 없으면 got 0 으로 남는다 — 조용히 빠지지 않는다", () => {
    const pool = [c({ id: "a" }), c({ id: "b" })];
    const r = pickPaperProblems(pool, 2, [SLOT_ESSAY, SLOT_FIG]);
    expect(r.filled).toEqual([
      { forItem: "essay-badge", label: "서술형", want: 2, got: 0 },
      { forItem: "figures-multi", label: "그림 2장", want: 2, got: 0 },
    ]);
    // 그래도 시험지는 나온다 — 다만 그 두 항목은 «검수 못 함»이다.
    expect(r.picked).toHaveLength(2);
    expect(r.padding).toBe(2);
  });

  it("정원이 모자라면 뒷자리가 못 채워지고 그게 보인다", () => {
    const pool = [
      c({ id: "a", questionType: "서술형" }),
      c({ id: "b", questionType: "서술형" }),
      c({ id: "d", figureUrls: ["/f/1.png", "/f/2.png"] }),
    ];
    const r = pickPaperProblems(pool, 2, [SLOT_ESSAY, SLOT_FIG]);
    expect(r.picked).toHaveLength(2);
    expect(r.filled.find((f) => f.forItem === "figures-multi")!.got).toBe(0);
  });
});

describe("정원", () => {
  it("자리를 다 채운 뒤 정원까지 평범한 문항으로 메운다", () => {
    // 정답지 1쪽 정원(overflow-first-page)은 **문항 수**가 있어야 드러난다.
    const pool = Array.from({ length: 40 }, (_, i) => c({ id: `p${i}` }));
    const r = pickPaperProblems(pool, 25, []);
    expect(r.picked).toHaveLength(25);
    expect(r.padding).toBe(25);
  });

  it("풀이 정원보다 작으면 있는 만큼만", () => {
    const pool = [c({ id: "a" })];
    expect(pickPaperProblems(pool, 25, []).picked).toHaveLength(1);
  });
});
