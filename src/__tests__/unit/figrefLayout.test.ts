/**
 * 보기 그림 조판 시안의 **자**와 **판정기** 회귀 가드.
 *
 * 이 트랙은 지면 형태를 아직 안 바꾼다(D-07 — 원장님 확정 대기). 그런데 시안의 숫자가
 * 보고서에 실려 결정 근거가 되므로, **그 숫자를 낸 함수**는 잠가 둔다.
 *
 * ## 기대값은 어디서 왔나 — 「참」이 제품에서 오면 안 된다
 *
 * 아래 격자 높이는 전부 **Chromium 이 실제 A4 지면에서 잰 값**이다
 * (`scripts/qa/reports/figref-layout-stem70.json`, 2026-08-18).
 * 제품 상수로 다시 계산해서 적으면 상수를 망가뜨려도 초록이 된다
 * (CLAUDE.md 2026-08-18 「지표의 «참»이 제품 상수에서 나오면 성적이 오른다」).
 *
 * 실측 `choicePx` 는 격자 **요소의 높이**라 `mt-4`(16px)가 빠져 있다.
 * 자는 그 여백을 포함하므로 기대값은 `실측 choicePx + 16` 이다 — 그 16 도
 * `JASEUP_MEASURED_PX.choiceGridTop` 이 아니라 **여기 리터럴로** 못 박는다.
 *
 * 다시 만들기:
 * ```
 * npx tsx scripts/qa/measure-figref-layout.tsx --json scripts/qa/reports/figref-layout-stem70.json
 * npx tsx scripts/qa/score-figref-ruler.ts scripts/qa/reports/figref-layout-stem70.json
 * bash scripts/qa/mutate-figref-ruler.sh          # 변이 19개가 **전부** 빨강이어야 한다
 * ```
 */
import { describe, expect, it } from "vitest";

import {
  choiceFigureBlockPx,
  choiceFigureWidth,
  stripFigureMarks,
} from "../../../scripts/qa/figrefRuler";
import {
  answerChoiceMax,
  classify,
  layoutFacts,
  OBJECTIVE_ANSWER,
  type LayoutFacts,
} from "../../../scripts/qa/report-figref-layout";

/** 실측 치수 그대로 (측정 출력 표 「시안별 실측 칸 치수」). */
const MEASURED_FIG_CELL = {
  옆2: 155.27,
  옆3: 92.02,
  아래2: 173.77,
  아래3: 110.52,
} as const;

function dims(flat: number[]) {
  return Array.from({ length: flat.length / 2 }, (_, i) => ({
    width: flat[i * 2]!,
    height: flat[i * 2 + 1]!,
  }));
}

describe("보기 그림 격자 — 폭", () => {
  it("실측 그림칸 폭과 0.05px 안에서 같다", () => {
    expect(choiceFigureWidth({ cols: 2, beside: true })).toBeCloseTo(
      MEASURED_FIG_CELL["옆2"],
      1,
    );
    expect(choiceFigureWidth({ cols: 3, beside: true })).toBeCloseTo(
      MEASURED_FIG_CELL["옆3"],
      1,
    );
    expect(choiceFigureWidth({ cols: 2, beside: false })).toBeCloseTo(
      MEASURED_FIG_CELL["아래2"],
      1,
    );
    expect(choiceFigureWidth({ cols: 3, beside: false })).toBeCloseTo(
      MEASURED_FIG_CELL["아래3"],
      1,
    );
  });

  it("번호를 옆에 두면 그림칸이 마커 폭 + 간격만큼 좁다", () => {
    expect(
      choiceFigureWidth({ cols: 3, beside: false }) -
        choiceFigureWidth({ cols: 3, beside: true }),
    ).toBeCloseTo(18.5, 5);
  });
});

describe("보기 그림 격자 — 높이 (기대값은 전부 Chromium 실측)", () => {
  // 대구북중 13 · 그림 5장 (작은 수직선 그림 — 칸보다 커서 전부 줄어든다)
  const 대구북중13 = dims([196, 97, 191, 82, 197, 82, 193, 90, 191, 90]);
  // 심인중 13 · 그림 5장 (큰 그래프)
  const 심인중13 = dims([645, 595, 615, 474, 655, 605, 615, 635, 635, 554]);
  // 관음중 17 · 보기 5장 (발문 1장은 뺀 나머지)
  const 관음중17보기 = dims([107, 107, 101, 97, 101, 97, 101, 98, 97, 95]);

  const cases: [string, ReturnType<typeof dims>, boolean, number, number][] = [
    // [이름, 치수, beside, cols, 실측 choicePx + 16]
    ["대구북중13 옆2", 대구북중13, true, 2, 238.390625 + 16],
    ["대구북중13 옆3", 대구북중13, true, 3, 96.875 + 16],
    ["대구북중13 아래2", 대구북중13, false, 2, 331.828125 + 16],
    ["대구북중13 아래3", 대구북중13, false, 3, 159.375 + 16],
    ["심인중13 옆2", 심인중13, true, 2, 455 + 16],
    ["심인중13 옆3", 심인중13, true, 3, 187.984375 + 16],
    ["심인중13 아래3", 심인중13, false, 3, 268.8125 + 16],
    ["관음중17 옆3", 관음중17보기, true, 3, 190.125 + 16],
    ["관음중17 아래2", 관음중17보기, false, 2, 382.9375 + 16],
  ];

  for (const [name, figures, beside, cols, expected] of cases)
    it(`${name} — 자와 지면이 1px 안에서 같다`, () => {
      expect(choiceFigureBlockPx(figures, { cols, beside })).toBeCloseTo(
        expected,
        0,
      );
    });

  it("그림이 없으면 0 — 여백도 안 먹는다", () => {
    expect(choiceFigureBlockPx([], { cols: 3, beside: true })).toBe(0);
  });

  it("치수를 모르는 그림도 «0» 이 아니라 값을 갖는다", () => {
    // 「모른다」를 0으로 세면 그림 문항일수록 조용해진다(적대적 리뷰 ③ §2).
    expect(
      choiceFigureBlockPx([null, null, null], { cols: 3, beside: true }),
    ).toBeGreaterThan(60);
  });

  it("칸보다 낮은 그림이라도 줄 높이는 마커 한 줄 아래로 안 내려간다", () => {
    // ⚠️ 이 픽스처는 **변이 시험이 초록을 냈기 때문에** 생겼다. 오늘 데이터의 보기
    //    그림은 3열 92px 칸에서 최소 17.1px 인데, 그 줄의 다른 칸이 더 높아 가려졌다
    //    (사수중 11 · 435×81). 그래서 「한 줄의 그림이 **전부** 마커보다 낮은」 경우를
    //    따로 만든다 — 없으면 `Math.max(line, …)` 항이 있으나 없으나 같다.
    const 납작한그림 = dims([400, 20, 400, 20, 400, 20]);
    const px = choiceFigureBlockPx(납작한그림, { cols: 3, beside: true });
    // 그림은 92/400 배로 줄어 4.6px — 그래도 마커 한 줄(20.3125px)은 차지한다.
    expect(px).toBeCloseTo(16 + 20.3125, 3);
  });

  it("한 줄이 늘면 줄 사이 간격도 같이 는다", () => {
    const one = choiceFigureBlockPx(대구북중13.slice(0, 3), {
      cols: 3,
      beside: true,
    });
    const two = choiceFigureBlockPx(대구북중13, { cols: 3, beside: true });
    // 두 줄이면 줄 하나 + 간격 8px 이 더 붙는다.
    expect(two - one).toBeGreaterThan(8);
  });
});

describe("stripFigureMarks — 조판과 자가 같은 문자열을 본다", () => {
  it("표시를 지우고 빈 보기 줄까지 없앤다", () => {
    const raw = "…것은?\n\n[그림]\n\n1. [그림]\n2. [그림]\n3. [그림]";
    expect(stripFigureMarks(raw)).toBe("…것은?");
  });

  it("글자가 남는 보기는 **안 지운다**", () => {
    const raw = "…것은?\n\n1. [그림]\n2. [그림]\n5. 해당되는 그래프가 없다.";
    expect(stripFigureMarks(raw)).toContain("5. 해당되는 그래프가 없다.");
  });

  it("원문자 보기 마커도 빈 줄이면 지운다", () => {
    expect(stripFigureMarks("문제\n\n① [그림]\n② [그림]")).toBe("문제");
  });
});

describe("정답으로 객관식을 가른다 — 본문과 독립인 근거", () => {
  it("원문자뿐이면 객관식", () => {
    expect(OBJECTIVE_ANSWER.test("③")).toBe(true);
    expect(OBJECTIVE_ANSWER.test("③, ⑤")).toBe(true);
  });
  it("서술형·단답형은 아니다", () => {
    expect(OBJECTIVE_ANSWER.test("36")).toBe(false);
    expect(OBJECTIVE_ANSWER.test("⑴ y=1, ⑵ x=-3")).toBe(false);
    expect(OBJECTIVE_ANSWER.test("풀이 참조 (벤다이어그램 색칠)")).toBe(false);
  });
  it("가장 큰 보기 번호를 읽는다", () => {
    expect(answerChoiceMax("③")).toBe(3);
    expect(answerChoiceMax("③, ⑤")).toBe(5);
    expect(answerChoiceMax("36")).toBe(0);
  });
});

describe("classify — 본문 표시만으로 보기 칸을 그릴 수 있는가", () => {
  const base: LayoutFacts = {
    marks: 6,
    choiceCells: 5,
    marksInChoices: 5,
    marksInQuestion: 1,
    figures: 6,
    answerMax: 5,
  };

  it("성광중 11 꼴 — 발문 1 + 보기 5 가 딱 맞으면 규약가능", () => {
    expect(classify(base)).toBe("규약가능");
  });

  it("정답이 보기 칸 수를 넘으면 **그 구조는 반증된다** (관음중 17 꼴)", () => {
    expect(
      classify({
        ...base,
        choiceCells: 3,
        marksInChoices: 3,
        marksInQuestion: 3,
      }),
    ).toBe("규약모순");
  });

  it("정답 열쇠 **하나만** 걸리는 자리 — 이 열쇠를 빼면 «가능» 이 된다", () => {
    // ⚠️ 위 관음중 17 꼴은 보기 칸이 3이라 **보기 칸 수 열쇠에도** 걸린다. 그래서
    //    정답 열쇠를 지워도 여전히 규약모순이고, 변이 시험이 초록을 냈다.
    //    보기 칸을 4로 두면 다른 열쇠는 전부 통과하고 정답 열쇠만 남는다.
    expect(
      classify({
        marks: 5,
        figures: 5,
        choiceCells: 4,
        marksInChoices: 4,
        marksInQuestion: 1,
        answerMax: 5,
      }),
    ).toBe("규약모순");
  });

  it("보기 칸이 4·5 가 아니면 구조가 깨진 것 — 분포에서 나온 경계", () => {
    expect(
      classify({
        ...base,
        choiceCells: 6,
        marksInChoices: 6,
        marksInQuestion: 0,
        answerMax: 5,
      }),
    ).toBe("규약모순");
    // 경계 바로 안쪽(4칸)은 통과해야 한다 — 문턱을 옮기면 이 줄이 빨개진다.
    expect(
      classify({
        ...base,
        figures: 5,
        marks: 5,
        choiceCells: 4,
        marksInChoices: 4,
        marksInQuestion: 1,
        answerMax: 4,
      }),
    ).toBe("규약가능");
  });

  it("발문 몫이 안 맞으면 규약모순 (범물중 13 꼴 — 한 칸이 표시를 둘 물었다)", () => {
    expect(
      classify({
        marks: 5,
        figures: 5,
        choiceCells: 4,
        marksInChoices: 5,
        marksInQuestion: 0,
        answerMax: 3,
      }),
    ).toBe("규약모순");
  });

  it("표시 수와 그림 수가 다르면 규약모순", () => {
    expect(classify({ ...base, marks: 5 })).toBe("규약모순");
  });

  it("표시가 아예 없으면 표시없음", () => {
    expect(
      classify({ ...base, marks: 0, marksInChoices: 0, marksInQuestion: 0 }),
    ).toBe("표시없음");
  });

  it("그림이 정답 번호보다 적으면 그릴 수가 없다", () => {
    expect(classify({ ...base, figures: 4, marks: 4 })).toBe("그림부족");
  });

  /* ── 미분류는 **낼 수 있어야** 한다. 0 인 것과 낼 수 없는 것은 다른 말이다. ── */

  it("정답에서 보기 번호를 못 읽으면 미분류 — 조용히 «가능»으로 세지 않는다", () => {
    expect(classify({ ...base, answerMax: 0 })).toBe("미분류");
  });

  it("표시가 발문·보기 어디에서도 안 잡히면 미분류 (사수중 11 꼴)", () => {
    // `dedupeRepeatedBlock` 이 보기 넷을 둘로 줄여 표시 둘이 사라진 자리.
    expect(
      classify({
        marks: 5,
        figures: 5,
        choiceCells: 2,
        marksInChoices: 2,
        marksInQuestion: 1,
        answerMax: 3,
      }),
    ).toBe("미분류");
  });
});

describe("layoutFacts — 파서가 실제로 무엇을 보는가", () => {
  it("발문·보기의 표시를 따로 센다", () => {
    const f = layoutFacts({
      content:
        "…것은?\n\n[그림]\n\n1. [그림]\n2. [그림]\n3. [그림]\n4. [그림]\n5. [그림]",
      figureUrls: ["a", "b", "c", "d", "e", "f"],
      answer: "⑤",
    });
    expect(f).toMatchObject({
      marks: 6,
      marksInQuestion: 1,
      marksInChoices: 5,
      choiceCells: 5,
      figures: 6,
      answerMax: 5,
    });
    expect(classify(f)).toBe("규약가능");
  });
});
