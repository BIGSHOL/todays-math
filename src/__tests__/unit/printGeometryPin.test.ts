/**
 * 🟢 회귀 가드 — 적대적 리뷰 ④ **«가드가 장식이 아니게»**.
 *
 * ## 왜 이 파일이 있는가
 *
 * `JASEUP_MEASURED_PX` 의 값 하나하나를 망가뜨려 기존 가드가 빨개지는지 전수로
 * 시험했다(상수 29개 × 단위·화면 테스트). **9개가 초록이었다** — 즉 가드가 없었다:
 *
 * ```
 * unit 6.25→7 · problemColumn 363.5→500 · choiceTextColumn 345→363.5
 * boxItemColumn 329.5→363.5 · choiceGridTop 16→0 · figureMaxWidth 264.567→363.5
 * figureBlockTop 12→0 · figureGap 16→0 · quickAnswerGap 16.5→0
 * ```
 *
 * `figureMaxWidth`·`figureBlockTop`·`figureGap` 가 초록이던 이유가 특히 나쁘다 —
 * `printFigureHeight.test.ts` 가 기대값을 **그 상수에서 만들어** 썼다. 상수를 바꾸면
 * 기대값이 같이 움직인다. **채점기가 제품 상수를 읽어 동어반복이 되는 것**과 같은
 * 자리다(CLAUDE.md 2026-08-18 「세는 쪽과 고치는 쪽이 같이 눈이 먼다」).
 * `choiceTextColumn`·`boxItemColumn`·`unit` 은 픽스처가 셋을 **가르지 못해서**
 * 초록이었다(폭 40·60 짜리 항목은 어느 열 폭에서도 한 줄이다).
 *
 * 그래서 여기서는 상수를 **지면 원문**(CSS·JSX)이나 **실측 리터럴**에 못 박는다.
 * 지면을 바꾸면 여기가 빨개지고, 그때 `measure-paper-units.tsx` 로 다시 재면 된다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FIGURE_MAX_WIDTH_MM, mmToCssPx } from "@/lib/figurePrintSize";
import { JASEUP_GEOMETRY, JASEUP_MEASURED_PX } from "@/lib/printGeometry";
import {
  UNKNOWN_FIGURE_HEIGHT_PX,
  estimateProblemPx,
  estimateSolutionPx,
} from "@/lib/printOverflow";

const read = (file: string) =>
  readFileSync(path.join(process.cwd(), file), "utf8");

const css = read("src/components/print/TestPrint.module.css");
const problemContent = read("src/components/math/ProblemContent.tsx");
const markdown = read("src/components/math/MarkdownRenderer.tsx");

/** CSS 규칙 한 덩어리를 원문에서 뜯어 온다. */
const rule = (name: string) =>
  new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

/** Tailwind 간격 눈금 — `mt-3` = 0.75rem = 12px. */
const spacing = (step: number) => step * 4;

describe("[적대④] 지면 상수는 지면 원문에서 나온다", () => {
  it("본문 행높이·표시단위는 `.problemText` 글꼴과 `leading-relaxed` 에서 나온다", () => {
    const fontSize = Number(
      /font-size:\s*([\d.]+)px/.exec(rule("problemText"))?.[1],
    );
    expect(fontSize).toBe(12.5);
    // 본문 문단은 `leading-relaxed`(1.625) 다 — MarkdownRenderer 의 `p` 가 그 클래스다.
    expect(markdown).toContain('className="leading-relaxed"');
    expect(JASEUP_MEASURED_PX.line).toBeCloseTo(fontSize * 1.625, 6);
    // 표시폭 1단위 = 한글 한 글자의 **절반**(`displayWidth` 는 전각을 2로 센다).
    expect(JASEUP_MEASURED_PX.unit).toBeCloseTo(fontSize / 2, 6);
  });

  it("문항 열 폭은 `.problemItem` 그리드에서 나온다 — `.paperParity` 와 같은 식", () => {
    expect(rule("problemItem")).toContain("grid-template-columns: 1.15fr 1fr");
    expect(rule("problemItem")).toContain("gap: 14px");
    expect(JASEUP_GEOMETRY.problemColumns).toBe("1.15fr 1fr");
    // 지면 내용폭 = 210mm − 좌우 패딩 50px×2. 열은 (1.15 / 2.15).
    const A4_WIDTH_PX = (210 * 96) / 25.4;
    const expected = ((A4_WIDTH_PX - 100 - 14) * 1.15) / 2.15;
    // 브라우저가 210mm 를 793.7px 로 반올림해 0.06px 이 남는다.
    expect(JASEUP_MEASURED_PX.problemColumn).toBeCloseTo(expected, 0);
    // 화면 지면 틀도 같은 식을 쓴다 — 둘이 갈라지면 줄바꿈이 달라진다.
    expect(css).toContain("calc((210mm - 100px - 14px) * 1.15 / 2.15)");
  });

  it("1열 보기 글자칸은 마커(①)와 `gap-1.5` 만큼 좁다", () => {
    expect(problemContent).toContain('className="flex items-start gap-1.5');
    const marker = 12.5; // 마커 한 글자 = 본문 글꼴 폭
    const gap = spacing(1.5); // gap-1.5 = 6px
    expect(JASEUP_MEASURED_PX.choiceTextColumn).toBeCloseTo(
      JASEUP_MEASURED_PX.problemColumn - marker - gap,
      0,
    );
  });

  it("상자 항목칸은 `p-4` 와 테두리만큼 좁다", () => {
    expect(markdown).toContain("border border-[#8A8A88] bg-white p-4");
    const inset = spacing(4) * 2 + 1 * 2; // p-4 양쪽 + 테두리 양쪽
    expect(JASEUP_MEASURED_PX.boxItemColumn).toBeCloseTo(
      JASEUP_MEASURED_PX.problemColumn - inset,
      1,
    );
  });

  /**
   * 그림 상한은 이제 **세 곳**에 있다 — 지면 CSS(mm) · 자의 실측 px · 크기 규칙의 mm.
   * 셋이 갈라지면 「지면은 70mm 로 자르는데 자는 다른 데서 자르는」 상태가 되고,
   * 그건 아무도 모르게 어긋난다(2026-08-19 그림 인쇄 크기 트랙).
   */
  it("그림 상한은 `print:max-w-[70mm]` 그대로다 — mm 와 px 가 **한 수**다", () => {
    expect(problemContent).toContain("print:max-w-[70mm]");
    expect(JASEUP_MEASURED_PX.figureMaxWidth).toBeCloseTo((70 * 96) / 25.4, 3);
    expect(FIGURE_MAX_WIDTH_MM).toBe(70);
    expect(mmToCssPx(FIGURE_MAX_WIDTH_MM)).toBeCloseTo(
      JASEUP_MEASURED_PX.figureMaxWidth,
      3,
    );
  });

  it("그림 묶음 여백은 `mt-3`·`gap-4` 그대로다", () => {
    // 2026-08-20 에 `justify-center` 가 들어왔다(원장님 지시: 「그림이 문제 중앙
    // 정렬 되면 좋겠네」). **가로** 배치라 `mt-3`(위 여백)·`gap-4`(장 사이)는
    // 안 바뀐다 — 아래 두 상수와 여전히 한 수다. 문자열을 통째로 못 박아 두는
    // 이유가 이것이다: 여백이 아닌 변경이어도 **한 번은 사람이 보게** 만든다.
    expect(problemContent).toContain(
      "mt-3 flex flex-wrap items-start justify-center gap-4",
    );
    expect(JASEUP_MEASURED_PX.figureBlockTop).toBe(spacing(3));
    expect(JASEUP_MEASURED_PX.figureGap).toBe(spacing(4));
  });

  it("보기 그리드 여백은 `mt-4`·`gap-y-2` 그대로다", () => {
    expect(problemContent).toContain("mt-4 grid grid-cols-1 gap-x-8 gap-y-2");
    expect(JASEUP_MEASURED_PX.choiceGridTop).toBe(spacing(4));
    expect(JASEUP_MEASURED_PX.choiceRowGap).toBe(spacing(2));
  });

  it("문항번호 몫은 `.questionNumber` 글꼴·마진 그대로다", () => {
    const number = rule("questionNumber");
    expect(number).toContain("font-size: 18px");
    expect(number).toContain("line-height: 1");
    expect(number).toContain("margin-bottom: 6px");
    expect(rule("answerBlank")).toContain("margin-top: 8px");
    // 나머지(정답란 높이 30.5px)는 실측이다 — 합이 62.5px.
    expect(JASEUP_MEASURED_PX.fixedChrome).toBeCloseTo(18 + 6 + 8 + 30.5, 6);
  });

  it("해설 행높이는 `.solutionBody` 글꼴 × `.answerSolutions` 행간이다", () => {
    const fontSize = Number(
      /font-size:\s*([\d.]+)px/.exec(rule("solutionBody"))?.[1],
    );
    const lineHeight = Number(
      /line-height:\s*([\d.]+)/.exec(rule("answerSolutions"))?.[1],
    );
    expect(fontSize).toBe(11.5);
    expect(lineHeight).toBe(1.55);
    expect(JASEUP_MEASURED_PX.solutionLine).toBeCloseTo(
      fontSize * lineHeight,
      6,
    );
  });

  it("「빠른 정답」 셀 치수는 `.quickAnswerCell`·`.quickAnswerGrid` 그대로다", () => {
    expect(rule("quickAnswerGrid")).toContain(
      "grid-template-columns: repeat(4, minmax(0, 1fr))",
    );
    expect(JASEUP_MEASURED_PX.quickAnswerColumns).toBe(4);
    expect(rule("quickAnswerGrid")).toContain("gap: 6px");
    expect(JASEUP_MEASURED_PX.quickAnswerRowGap).toBe(6);

    const cell = rule("quickAnswerCell");
    expect(cell).toContain("padding: 8px 8px 6px");
    expect(JASEUP_MEASURED_PX.quickAnswerCellBase).toBe(8 + 6);
    expect(cell).toContain("font-size: 11px");
    expect(cell).toContain("line-height: 2.1");
    expect(JASEUP_MEASURED_PX.quickAnswerCellLine).toBeCloseTo(11 * 2.1, 6);
  });

  it("해설은 2단이다 — 판정과 지면이 같은 수를 쓴다", () => {
    expect(JASEUP_MEASURED_PX.solutionColumns).toBe(2);
    expect(read("src/components/print/PrintAnswerKeyPage.tsx")).toContain(
      "columnCount: 2",
    );
  });
});

/**
 * 지면 원문에서 유도가 안 되는 값들 — **실측 리터럴로 못 박는다.**
 * 여기가 빨개지면 `npx tsx scripts/qa/measure-paper-units.tsx` 로 다시 재고,
 * 그 산출값으로 상수와 이 리터럴을 **같이** 고칠 것. 한쪽만 고치면 가드가 죽는다.
 */
describe("[적대④] 실측으로만 아는 값은 리터럴로 못 박는다", () => {
  it("문항 칸 넷 — 장의 문항 수로 갈린다", () => {
    expect(JASEUP_MEASURED_PX.firstPageSlot).toBe(405);
    expect(JASEUP_MEASURED_PX.continuationSlot).toBe(484);
    expect(JASEUP_MEASURED_PX.soloFirstPageSlot).toBe(838);
    expect(JASEUP_MEASURED_PX.soloContinuationSlot).toBe(997);
  });

  it("상자 chrome·해설 칸·「빠른 정답」 상자의 실측값", () => {
    expect(JASEUP_MEASURED_PX.boxChrome).toBe(98);
    expect(JASEUP_MEASURED_PX.answerSolutionsFull).toBe(964.8);
    expect(JASEUP_MEASURED_PX.solutionColumnWidth).toBe(331);
    expect(JASEUP_MEASURED_PX.quickAnswerTitle).toBe(49);
    expect(JASEUP_MEASURED_PX.quickAnswerCellUnits).toBe(16);
    expect(JASEUP_MEASURED_PX.quickAnswerGap).toBe(16.5);
  });

  /**
   * 치수를 모르는 그림의 가정 높이. 실데이터 9,587장을 인쇄 폭 상한으로 환산한
   * **중앙값**이다. 낮추면 그림 문항이 조용해진다 — 「모른다」가 「안 넘친다」로
   * 읽히는 그 자리다(CLAUDE.md 2026-08-16).
   */
  it("모르는 그림의 가정 높이는 실측 중앙값 207px 이다", () => {
    expect(UNKNOWN_FIGURE_HEIGHT_PX).toBe(207);
  });
});

/**
 * 🟢 회귀 가드 — 적대적 리뷰 ④ `[적대④-A]` 승격.
 *
 * **세로로 쌓이는 수식** 항은 해설 자에만 배선돼 있었다. 같은 규칙을 한쪽만 걸면
 * 그쪽 지표만 좋아지고 다른 쪽은 조용히 «과소»가 된다 — 과소는 곧 놓침이다.
 */
describe("[적대④-A] 세로 수식 항이 문제지·정답지 **양쪽**에 걸려 있다", () => {
  const flat = "가나다라마바사아자차카타파하";
  const tall = `$\\frac{1}{2}$ $\\frac{3}{4}$ $\\sum_{k=1}^{n}$`;

  it("문제지 자가 세로 수식만큼 더 센다", () => {
    // 표시폭이 같아도(수식은 글리프 근사) 세로로 쌓이면 더 높아야 한다.
    expect(estimateProblemPx(tall)).toBeGreaterThan(
      estimateProblemPx("$x+1$ $y+2$ $z+3$"),
    );
  });

  it("정답지 자도 같은 항을 쓴다", () => {
    expect(estimateSolutionPx(tall)).toBeGreaterThan(
      estimateSolutionPx("$x+1$ $y+2$ $z+3$"),
    );
  });

  /** 두 자가 **같은 상수**를 쓴다 — 한쪽만 옮기면 여기가 빨개진다. */
  it("한 문항에 세로 수식이 늘면 두 자가 같은 만큼 늘어난다", () => {
    const one = `${flat} $\\frac{1}{2}$`;
    const two = `${flat} $\\frac{1}{2}$ $\\frac{3}{4}$`;
    const problemStep = estimateProblemPx(two) - estimateProblemPx(one);
    const solutionStep = estimateSolutionPx(two) - estimateSolutionPx(one);
    expect(problemStep).toBeGreaterThan(0);
    expect(problemStep).toBeCloseTo(solutionStep, 6);
  });
});
