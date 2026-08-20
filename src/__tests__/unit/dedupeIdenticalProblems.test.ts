import { describe, expect, it } from "vitest";

import {
  groupBy,
  hasAnswer,
  type Row,
} from "../../../scripts/qa/find-true-duplicates";
import { pointsAtPrintedFigure } from "../../lib/figure/missingFigureRule";
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

describe("[2026-08-20] 그림 보류의 열쇠는 **낱말이 아니라 지시**다", () => {
  /**
   * 첫 판은 「그림|그래프|상자|좌표평면…」이라는 **낱말**로 잡았다. 일부러 넓게 잡은
   * 것이고 그때는 옳았다 — 보류는 아무것도 망가뜨리지 않으니까. 그런데 그 뒤 그림을
   * 회수해도 **한 무리도 안 갈렸다.** 39무리를 전량 눈으로 보니 이유가 분명했다:
   * 「$y=ax$ 의 **그래프**에 대한 설명으로 옳지 않은 것은?」처럼 **식이 본문에 다 있는**
   * 문항이 대부분이었다. 지면에 그림이 있어야 풀리는 것은 세 무리뿐이다.
   *
   * CLAUDE.md 2026-08-18 이 적은 그 자리다 — 「열쇠를 낱말에서 **지시어**로 바꿔야 갈렸다」.
   */
  it("식이 본문에 다 있으면 «그림을 가리키지 않는다»", () => {
    expect(
      pointsAtPrintedFigure(
        "다음 중 $y=ax$의 그래프에 대한 설명으로 옳지 않은 것은? 1. 원점을 지나는 직선이다.",
      ),
    ).toBe(false);
  });

  it("지면의 그래프를 **제시**하면 가리킨다", () => {
    expect(
      pointsAtPrintedFigure(
        "다음 직선 도로를 달리는 자전거의 시간에 따른 속력의 변화를 나타낸 그래프이다.",
      ),
    ).toBe(true);
  });

  it("보기 문장의 「…그래프이다.」는 제시가 아니다", () => {
    expect(
      pointsAtPrintedFigure(
        "이차함수 $y=-x^{2}+5$ 의 그래프에 대한 설명으로 옳지 않은 것은? 5. $y=-x^{2}$ 의 그래프를 $x$ 축의 방향으로 $5$ 만큼 평행이동한 그래프이다.",
      ),
    ).toBe(false);
  });

  it("좌표가 그림에만 있는 문항은 가리킨다", () => {
    expect(
      pointsAtPrintedFigure(
        "다음 중 좌표평면 위의 각 점 A, B, C, D, E의 좌표를 나타낸 것으로 옳지 않은 것은?",
      ),
    ).toBe(true);
  });

  it("«상자»는 본문 마크업이라 그림이 아니다", () => {
    expect(
      pointsAtPrintedFigure("다음을 계산한 것은? <상자> ($x-2$)($x-5$)"),
    ).toBe(false);
  });

  it("정본 판정기가 «유실»이라 하면 그대로 따른다 — 규칙을 두 벌 만들지 않는다", () => {
    expect(
      pointsAtPrintedFigure("다음 그림에서 ∠$x$ 의 크기를 구하시오."),
    ).toBe(true);
  });

  it("라벨로만 정의되는 도형은 **보수적으로** 가리킨다고 본다", () => {
    // 지시어를 안 써도 지면에 그림이 있어야 푸는 부류. 반대쪽(그림이 붙은 행)에
    // 지시어만 대면 24.5%를 못 봤고 그 대부분이 이 모양이었다.
    expect(
      pointsAtPrintedFigure("평행사변형 ABCD에서 점 O는 두 대각선의 교점이다."),
    ).toBe(true);
  });
});
