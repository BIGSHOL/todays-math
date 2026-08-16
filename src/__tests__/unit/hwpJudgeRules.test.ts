/**
 * 트랙 D-2 — HWP 교체 판정 규칙의 회귀 테스트.
 *
 * 이 규칙은 **표본을 눈으로 보면서** 여섯 번 고쳐 나온 것이다. 고친 이유가 전부
 * "가드를 거꾸로 걸었다" 였고, 그중 넷은 **DB 의 손상 자체를 'DB 가 충실하다' 는
 * 증거로 읽고** 있었다. 문장으로만 남기면 다음 사람이 같은 자리에서 다시 넘어진다.
 * 그래서 실제로 틀렸던 표본을 픽스처로 박아 둔다.
 *
 * ⚠️ 픽스처는 **실데이터에서 온 모양**이다(tracks/README: "합성 픽스처가 이관 결함을
 * 통과시켰다"). 지어낸 모양으로 초록을 만들지 말 것.
 */
import { describe, expect, it } from "vitest";

import {
  buildHwpContent,
  judgeSignals,
  stripWatermark,
  verdictOf,
  type DbRow,
  type HwpQ,
} from "../../../scripts/qa/hwpJudgeRules";

const dbRow = (over: Partial<DbRow> = {}): DbRow => ({
  id: "id",
  externalId: "2928-1",
  examId: "2928",
  n: 1,
  problemType: "개념",
  score: null,
  content: "",
  answer: "(정답 없음)",
  figs: 0,
  ...over,
});

const hwpQ = (over: Partial<HwpQ> = {}): HwpQ => ({
  number: 1,
  stem: "",
  choices: [],
  answer: null,
  solution: null,
  topic: null,
  score: null,
  type: "객관식",
  label: null,
  ...over,
});

/** parseProblemContent 대신 쓰는 최소 분해 — 테스트가 그 모듈에 매이지 않게. */
const judge = (row: DbRow, hwp: HwpQ, question: string, choices: string[] = []) =>
  judgeSignals({
    row,
    hwp,
    dbQuestion: question,
    dbChoices: choices,
    dbMathFail: 0,
    hwpMathFail: 0,
    dbMathTotal: 0,
    hwpMathTotal: 0,
  });

describe("stripWatermark", () => {
  it("지면 한가운데 낀 연구회 워터마크를 지운다 (HWP 문항의 2.3%)", () => {
    const out = stripWatermark(
      "과 몫의 합은?\n대구광역시 내신 수학 연구회\n다음을 구하시오.",
    );
    expect(out).toBe("과 몫의 합은?\n다음을 구하시오.");
  });

  it("작업자 서명을 지운다 — 안 지우면 학생 시험지에 사람 이름이 찍힌다 (4.67%)", () => {
    const out = stripWatermark(
      "다음 극한값을 구하시오.\n정답\n워드:최성욱t\n오검:조혜미t\n완료:백용선t",
    );
    expect(out).toBe("다음 극한값을 구하시오.");
  });

  it("서명이 없으면 `정답` 줄을 지우지 않는다 — 본문일 수 있다", () => {
    const out = stripWatermark("정답\n다음을 구하시오.");
    expect(out).toContain("정답");
  });
});

describe("교체해야 하는 것", () => {
  it("본문이 통째로 `정답` 두 글자면 교체한다 (강북고 2928 1~12번)", () => {
    const row = dbRow({ content: "정답" });
    const hwp = hwpQ({
      stem: "좌표평면 위를 움직이는 점 P의 시각 t에서 위치가 $( x, y )$ 이고, $x=t^{4}-3t^{2}$ 일 때 가속도의 크기는?",
      choices: ["$2$", "$4$", "$10$", "$26$", "$6$"],
    });
    const sig = judge(row, hwp, "정답");
    expect(sig.S).toContain("S1_초단문");
    expect(sig.S).toContain("S5_보기결손");
    expect(verdictOf(sig)).toBe("교체");
  });

  it("해설이 문제 자리를 덮으면 교체한다 — **해설이 더 길다고 막으면 안 된다** (2928-19)", () => {
    // DB 723자(해설) vs HWP 321자(문제). 길이만 보는 가드는 여기서 정확히 거꾸로 걸린다.
    const row = dbRow({
      content:
        "[단답형 $4$] 정답 $\\frac{28}{3}$ [풀이] $f(4)=1$ 이므로 대입하면 값이 나오고," +
        " 따라서 $f'(4)=3$ 이다. 그러므로 정리하면 구하는 값은 $\\frac{28}{3}$ 이다.",
    });
    const hwp = hwpQ({
      stem: "실수 전체 집합에서 이계도함수를 갖는 함수 $f(x)$ 에 대하여 $\\frac{28}{3}$ 의 값을 구하시오.",
      type: "단답형",
    });
    const sig = judge(row, hwp, row.content);
    expect(sig.S).toContain("S2_해설냄새");
    expect(sig.H).not.toContain("H3_HWP더짧음");
    expect(verdictOf(sig)).toBe("교체");
  });

  it("발문이 `정답` 으로 시작하면 해설지 지면이다 — 접속어가 없어도 잡는다", () => {
    const row = dbRow({
      content: "[서술형 $1$] 정답 $10x^{2}+13x$ 풀이 $(6x+5)(3x+4)-(4x+5)(2x+4)$",
    });
    const hwp = hwpQ({
      stem: "가로의 길이가 $6x+5$ 인 직사각형 모양의 밭에 길을 만들 때 길의 넓이를 구하시오.",
      type: "서술형",
    });
    const sig = judge(row, hwp, row.content);
    expect(sig.S).toContain("S10_해설지머리표");
    expect(verdictOf(sig)).toBe("교체");
  });

  it("분수·지수가 뭉개진 본문을 잡는다 — 한글 지문이 멀쩡해 유사도로는 안 잡힌다", () => {
    // 실제 DB: `<상자> ⁄ • $26+26$ • $42+42+42+42$` ← 원본은 (4²+…)/(2⁶+2⁶)
    const row = dbRow({
      content: "다음 식을 계산한 값은? <상자> ⁄ • $26+26$ • $42+42+42+42$",
    });
    const hwp = hwpQ({
      stem: "다음 식을 계산한 값은? $\\frac{4^{2}+4^{2}}{2^{6}+2^{6}}$",
      choices: ["$1$", "$2$", "$3$", "$4$", "$5$"],
    });
    const sig = judge(row, hwp, "다음 식을 계산한 값은? <상자> ⁄ • $26+26$", ["a", "b", "c", "d", "e"]);
    expect(sig.S).toContain("S8_수식뭉갬");
    expect(verdictOf(sig)).toBe("교체");
  });

  it("수식만 있는 문항도 교체한다 — 한글이 짧다고 `HWP 빈약` 으로 막으면 안 된다", () => {
    // DB 는 Σ 를 통째로 잃었다: `$_{k=1}^{9}a_{k}=12$`
    const row = dbRow({ content: "$_{k=1}^{9}a_{k}=12$ 일 때, 값은? ⁄" });
    const hwp = hwpQ({
      stem: "$\\sum _{k=1}^{9}a_{k}=12$ 일 때, $\\sum _{k=1}^{9}(2a_{k}+3)$ 의 값은?",
      choices: ["$18$", "$21$", "$24$", "$27$", "$30$"],
    });
    const sig = judge(row, hwp, "$_{k=1}^{9}a_{k}=12$ 일 때, 값은? ⁄", ["1", "2", "3", "4", "5"]);
    expect(sig.H).not.toContain("H1_HWP빈약");
    expect(verdictOf(sig)).toBe("교체");
  });

  it("지면 머리말이 딸려 들어온 본문 — 그 오염이 `HWP 더 짧음` 을 유발하면 안 된다", () => {
    const row = dbRow({
      content:
        "$l$ ⫽ $m$ 일 때, $x$ 의 값은? [그림] 학원로고 2024년 2학기 기말고사 사동중 2학년 수학 학원 로고 사동중 기말고사 대비",
      figs: 2,
    });
    const hwp = hwpQ({
      stem: "$l⫽m⫽n$ 일 때, $x$ 의 값은?",
      choices: ["$3$", "$4$", "$5$", "$6$", "$7$"],
    });
    const sig = judge(row, hwp, row.content, ["1", "2", "3", "4", "5"]);
    expect(sig.S).toContain("S12_지면머리말혼입");
    expect(sig.H).not.toContain("H3_HWP더짧음");
    expect(verdictOf(sig)).toBe("교체");
  });
});

describe("교체하면 안 되는 것 (개악 방지)", () => {
  it("HWP 보기가 그림이라 빈 껍데기면 보류한다 (3845-2: 사각형 4개가 전부 그림)", () => {
    const row = dbRow({ content: "다음 사각형 중에서 평행사변형이 아닌 것은? ⁄" });
    const hwp = hwpQ({
      stem: "다음 사각형 중에서 평행사변형이 아닌 것은?",
      choices: ["", "", "", ""],
    });
    const sig = judge(row, hwp, row.content);
    expect(sig.H).toContain("H10_HWP빈보기");
    expect(verdictOf(sig)).toBe("보류");
  });

  it("DB 에만 보기가 있으면 보류한다 — 넣으면 학생이 고를 대상이 사라진다", () => {
    const row = dbRow({ content: "옳은 것은? ⁄ • 값" });
    const hwp = hwpQ({ stem: "옳은 것은?", choices: [] });
    const sig = judge(row, hwp, "옳은 것은?", ["3cm", "4cm", "5cm", "6cm", "7cm"]);
    expect(sig.H).toContain("H6_보기손실");
    expect(verdictOf(sig)).toBe("보류");
  });

  it("그림이 안 붙은 문항의 `[그림] 말풀이` 는 유일한 단서라 지우지 않는다", () => {
    const row = dbRow({
      content: "[그림] 원 O 위의 점 P 에서 그은 접선 ⁄ • 이때 길이는?",
      figs: 0,
    });
    const hwp = hwpQ({ stem: "원 O 위의 점 P 에서 그은 접선의 길이는?", choices: [] });
    const sig = judge(row, hwp, row.content);
    expect(sig.H).toContain("H7_그림단서손실");
    expect(verdictOf(sig)).toBe("보류");
  });

  it("HWP 에만 PUA 가 있으면 보류한다 — 훼손을 다른 훼손으로 바꾸는 꼴이다", () => {
    const row = dbRow({ content: "$l ⫽ m$ 일 때 $x$ 의 값은? ⁄ • 값" });
    const hwp = hwpQ({
      stem: "$l m$ 일 때 $x$ 의 값은?",
      choices: ["$3$", "$4$", "$5$", "$6$", "$7$"],
    });
    const sig = judge(row, hwp, row.content, ["3", "4", "5", "6", "7"]);
    expect(sig.H).toContain("H11_HWP에PUA");
    expect(verdictOf(sig)).toBe("보류");
  });

  it("HWP 에도 지면 머리말이 들어 있으면 보류한다 (실측 문항의 0.26%)", () => {
    // ⚠️ 한때 `학원로고` 줄을 stripWatermark 로 지웠다. 그랬더니 **차단 근거만 사라지고**
    // `달서고 2학년 수학1` · 강사 이름 줄은 그대로 남아 더 나빠졌다. 지우지 말고 막는다.
    const row = dbRow({ content: "$6^{0}×8\\frac{2}{3}$ 의 값은?" });
    const hwp = hwpQ({
      stem: "$6^{0}×8^{\\frac{2}{3}}$ 의 값은?",
      choices: [
        "$0$", "$2$", "$4$", "$6$",
        "$8$\n2024년 1학기 중간고사\n지수 ~ 삼각함수의 그래프\n달서고 2학년 수학1\n학원로고\n강민구",
      ],
    });
    const sig = judge(row, hwp, row.content, ["0", "2", "4", "6", "8"]);
    expect(buildHwpContent(hwp)).toContain("달서고 2학년 수학1");
    expect(sig.H).toContain("H12_HWP지면머리말");
    expect(verdictOf(sig)).toBe("보류");
  });

  it("HWP 쪽 렌더가 더 나쁘면 보류한다", () => {
    const row = dbRow({ content: "$(x+2)(x-6)-9$ 를 인수분해한 것은? ⁄" });
    const hwp = hwpQ({ stem: "$\\left( x+2\\right) \\left( x-6)-9$ 를 인수분해한 것은?" });
    const sig = judgeSignals({
      row,
      hwp,
      dbQuestion: row.content,
      dbChoices: [],
      dbMathFail: 0,
      hwpMathFail: 2,
      dbMathTotal: 3,
      hwpMathTotal: 3,
    });
    expect(sig.H).toContain("H5_렌더열위");
    expect(verdictOf(sig)).toBe("보류");
  });

  it("`<상자>` 는 훼손이 아니다 — 원본에 실제로 있는 상자다 (모집단 2,675행)", () => {
    const row = dbRow({
      content: "다음 <상자> 안에 알맞은 수는? $x^{2}+2x+1$",
    });
    const hwp = hwpQ({
      stem: "다음 $\\square$ 안에 알맞은 수는? $x^{2}+2x+1$",
      choices: ["$1$", "$2$", "$3$", "$4$", "$5$"],
    });
    const sig = judge(row, hwp, row.content, ["1", "2", "3", "4", "5"]);
    expect(sig.S).toHaveLength(0);
    expect(verdictOf(sig)).toBe("유지");
  });

  it("멀쩡한 문항은 손대지 않는다", () => {
    const stem = "이차방정식 $x^{2}-2x+3=0$ 의 한 근을 $\\alpha$ 라 할 때, 값은?";
    const row = dbRow({ content: stem });
    const hwp = hwpQ({ stem, choices: ["$8$", "$9$", "$10$", "$11$", "$12$"] });
    const sig = judge(row, hwp, stem, ["8", "9", "10", "11", "12"]);
    expect(verdictOf(sig)).toBe("유지");
  });
});

describe("소문항 표기 차이", () => {
  it("HWP 가 ⑴ 대신 `(1)` 을 써도 소문항 손실이 아니다 (2952-16)", () => {
    const row = dbRow({
      content: "[서술형 $1$] 다음 부정적분을 구하시오. ⑴ $(3x^{2}-4x+1)dx$ ⑵ $(x+1)^{3}dx$ ⁄",
    });
    const hwp = hwpQ({
      stem:
        "[서술형 $1$] 다음 부정적분을 구하시오.\n$\\left( 1\\right)$ $\\int (3x^{2}-4x+1)\\,dx$\n" +
        "$\\left( 2\\right)$ $\\int (x+1)^{3}\\,dx$",
      type: "서술형",
    });
    const sig = judge(row, hwp, row.content);
    expect(sig.H).not.toContain("H8_소문항손실");
  });

  it("HWP 가 DB 보다 짧아도 `(1)` 표기가 있으면 소문항 손실이 아니다", () => {
    // 위 케이스는 길이 가드(HWP 가 더 길다)만으로도 통과해 `hasSubQuestions` 분기를
    // 타지 않는다. 여기서는 HWP 를 **일부러 더 짧게** 만들어 그 분기만 남긴다.
    const row = dbRow({
      content:
        "다음 물음에 답하시오. ⑴ 첫째항을 구하시오. [3점, 부분점수 있음] ⑵ 공비를 구하시오. [3점, 부분점수 있음] ⁄ 여백",
    });
    const hwp = hwpQ({
      stem: "다음 물음에 답하시오.\n(1) 첫째항을 구하시오.\n(2) 공비를 구하시오.",
    });
    expect(hwp.stem.length).toBeLessThan(row.content.length);
    const sig = judge(row, hwp, row.content);
    expect(sig.H).not.toContain("H8_소문항손실");
  });

  it("HWP 가 정말로 소문항을 잃었으면 보류한다", () => {
    const row = dbRow({
      content:
        "다음 물음에 답하시오. ⑴ 첫째항을 구하시오. ⑵ 공비를 구하시오. ⑶ 합을 구하시오. ⁄ 추가 조건 설명이 더 붙는다.",
    });
    const hwp = hwpQ({ stem: "다음 물음에 답하시오." });
    const sig = judge(row, hwp, row.content);
    expect(sig.H).toContain("H8_소문항손실");
  });
});

describe("buildHwpContent", () => {
  it("convertPastExam 과 같은 모양으로 보기를 `1.` 줄머리로 붙인다", () => {
    const out = buildHwpContent(
      hwpQ({ stem: "값은?", choices: ["$1$", "$2$", "$3$", "$4$", "$5$"] }),
    );
    expect(out).toBe("값은?\n\n1. $1$\n2. $2$\n3. $3$\n4. $4$\n5. $5$");
  });
});
