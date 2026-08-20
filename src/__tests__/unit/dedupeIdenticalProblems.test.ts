import { describe, expect, it } from "vitest";

import {
  groupBy,
  hasAnswer,
  type Row,
} from "../../../scripts/qa/find-true-duplicates";
import {
  holdReason,
  type Keepable,
  pickKeeper,
} from "../../../scripts/qa/dedupe-identical-problems";

const row = (over: Partial<Row> = {}): Row => ({
  id: "a",
  content: "다음을 계산하시오. $2+3$",
  answer: "5",
  figureUrls: [],
  ...over,
});

const card = (over: Partial<Keepable> = {}): Keepable => ({
  id: "a",
  usedInPaper: 0,
  examLinks: 0,
  externalId: null,
  sourceFile: null,
  figureCount: 0,
  hasSolution: false,
  createdAt: new Date("2026-08-15T00:00:00Z"),
  ...over,
});

describe("holdReason — 못 가르는 무리는 안 지운다", () => {
  it("정답이 없는 행이 하나라도 있으면 보류한다", () => {
    const bucket = [row(), row({ id: "b", answer: "(정답 없음)" })];
    expect(holdReason(bucket)).toMatch(/정답/);
  });

  it("본문이 그림을 지목하는데 전원 그림이 없으면 보류한다", () => {
    // 가르는 숫자가 하필 그 그림 안에 있을 수 있다 — 그림 유실이 아직 남아 있다.
    const bucket = [
      row({ content: "다음 그림에서 ∠$x$ 의 크기를 구하시오." }),
      row({ id: "b", content: "다음 그림에서 ∠$x$ 의 크기를 구하시오." }),
    ];
    expect(holdReason(bucket)).toMatch(/그림/);
  });

  it("그림을 지목하고 **그림이 실제로 붙어 있으면** 지울 수 있다", () => {
    const bucket = [
      row({
        content: "다음 그림에서 ∠$x$ 의 크기는?",
        figureUrls: ["/figures/a/0.png"],
      }),
      row({
        id: "b",
        content: "다음 그림에서 ∠$x$ 의 크기는?",
        figureUrls: ["/figures/a/0.png"],
      }),
    ];
    expect(holdReason(bucket)).toBeNull();
  });

  it("그림을 지목하지 않는 글자 문항은 그림이 없어도 지울 수 있다", () => {
    expect(holdReason([row(), row({ id: "b" })])).toBeNull();
  });

  it("«표를 완성하시오» 처럼 그림이 아닌 지면 자료도 보류한다", () => {
    const bucket = [
      row({ content: "다음 표를 완성하시오." }),
      row({ id: "b", content: "다음 표를 완성하시오." }),
    ];
    expect(holdReason(bucket)).not.toBeNull();
  });
});

describe("pickKeeper — 되짚을 수 있는 쪽을 남긴다", () => {
  it("시험지에 쓰인 행이 가장 세다", () => {
    const used = card({ id: "z", usedInPaper: 1 });
    const rich = card({
      id: "a",
      externalId: "e",
      sourceFile: "s",
      figureCount: 3,
    });
    expect(pickKeeper([rich, used]).id).toBe("z");
  });

  it("exam_question 링크가 걸린 쪽을 externalId 보다 먼저 남긴다", () => {
    // 이 컬럼에는 FK 가 없다 — 가리키던 행을 지우면 **오류 없이 끊긴다**.
    const linked = card({ id: "z", examLinks: 1 });
    const rich = card({
      id: "a",
      externalId: "e",
      sourceFile: "s",
      figureCount: 9,
    });
    expect(pickKeeper([rich, linked]).id).toBe("z");
  });

  it("externalId 가 sourceFile·그림보다 앞선다", () => {
    const ext = card({ id: "z", externalId: "e" });
    const src = card({ id: "a", sourceFile: "s", figureCount: 5 });
    expect(pickKeeper([src, ext]).id).toBe("z");
  });

  it("다 같으면 먼저 들어온 것을 남긴다", () => {
    const old = card({ id: "z", createdAt: new Date("2026-08-14T00:00:00Z") });
    const recent = card({
      id: "a",
      createdAt: new Date("2026-08-17T00:00:00Z"),
    });
    expect(pickKeeper([recent, old]).id).toBe("z");
  });

  it("완전히 동점이면 id 사전순 — 실행마다 같은 답을 낸다", () => {
    const a = card({ id: "aaa" });
    const b = card({ id: "bbb" });
    expect(pickKeeper([b, a]).id).toBe("aaa");
    expect(pickKeeper([a, b]).id).toBe("aaa");
  });
});

describe("판정을 두 벌 만들지 않는다", () => {
  it("무리 짓기는 find-true-duplicates 의 세 축 규칙 하나뿐이다", () => {
    // 본문·정답은 같고 **그림만 다르면** 다른 문항이다 — 묶이면 안 된다.
    const rows: Row[] = [
      row({ id: "a", content: "다음 그림에서 $x$?", figureUrls: ["/f/1.png"] }),
      row({ id: "b", content: "다음 그림에서 $x$?", figureUrls: ["/f/2.png"] }),
    ];
    expect(groupBy(rows, "all-three").size).toBe(0);
    expect(groupBy(rows, "content").size).toBe(1);
  });

  it("정답 축 판정(hasAnswer)은 지우는 쪽이 다시 만들지 않는다", () => {
    expect(hasAnswer({ answer: "(정답 없음)" })).toBe(false);
    expect(hasAnswer({ answer: "  " })).toBe(false);
    expect(hasAnswer({ answer: "③" })).toBe(true);
  });
});
