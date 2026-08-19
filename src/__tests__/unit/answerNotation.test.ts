/**
 * 정답 표기 규칙 회귀 테스트 (트랙 B-1).
 *
 * ⚠️ **픽스처는 전부 실제 DB·실제 공식 정답면에서 가져온 짝이다.** 지어내지 말 것 —
 * 지난 회차에 합성 픽스처가 이관 결함(`convertRpm` 이 `choiceId` 를 `id` 로 읽어
 * 객관식 정답 4,862건이 빈 사고)을 통과시켜 테스트가 초록인 채로 넘어갔다.
 *
 * 「흡수해야 하는 것」과 「절대 흡수하면 안 되는 것」을 같은 무게로 둔다.
 * 규칙이 헐거우면 **틀린 답이 표기 차이로 숨어 학생 시험지에 그대로 인쇄된다.**
 * 아래 `진짜 오답` 짝은 원본 정답면을 렌더해 눈으로 확인한 것이다.
 */
import { describe, expect, it } from "vitest";

import { classifyPair } from "../../../scripts/qa/classify-answer-mismatch";
import {
  canon,
  circledSet,
  circledValue,
  hasBrokenGlyph,
  parts,
  repairGlyphs,
} from "../../../scripts/qa/answer-notation";
import {
  circledValue as rulesCircledValue,
  knownCircledGlyphs as rulesKnownCircledGlyphs,
} from "../../../scripts/qa/answerChoiceRules";

/** DB 정답 ↔ 공식 정답면. 같은 답을 다르게 적은 것들. */
const 표기차이: Array<[string, string, string]> = [
  ["-5√2", "-5√⁄2", "분수 가로선 잔재"],
  ["±2√3 i", "±2√⁄3i", "분수 가로선 + 공백"],
  ["$2e ^{2} +1$", "2e2+1", "LaTeX 래퍼와 위첨자"],
  ["x²", "x2", "위첨자 소실"],
  ["aₙ=3", "an=3", "아래첨자 소실"],
  ["12°", "12≅", "도 기호가 다른 글리프로"],
  ["114%", "114≠", "퍼센트가 다른 글리프로"],
  ["④", "④ 현풍고 24-2-중간 16번", "출처 주석"],
  ["7", "7개", "단위"],
  ["124", "124°", "단위(도)"],
  ["85/2", "42.5", "분수와 소수"],
  ["5x^2-9x+1", "R(x)=5x2-9x+1", "이름표"],
  ["9x+2", "A+B=9x+2", "합 이름표"],
  ["√3-1", "-1+√⁄3", "항 순서"],
  ["x=-3 또는 x=3", "x=3 또는 x=-3", "답 순서"],
  ["a=3, 6", "a=3 또는 a=6", "구분자"],
  ["31 (a=1, b=3, c=27)", "31", "근거 부연"],
  ["70", "(단답형) 정답 70", "한글 머리표"],
  ["⑴ x² = 64, ⑵ x² = 225", "⑴ 64 ⑵ 225", "소문항"],
  ["x=4, a=2", "(1) x=4 (2) a=2", "소문항 번호 유무"],
  ["$12$$f(x)=3x+", "12", "답 뒤에 풀이가 붙음"],
  ["(3√3 - 3) cm", "3√⁄3-3(cm)", "겉괄호와 괄호 단위"],
  ["⑴ 5x²-4x-9, ⑵ (x+1)(5x-9)", "⑴ 5x2-4x-9 ⑵ (5x-9)(x+1)", "인수 순서"],
  ["2⁵⁰ < 7²⁰ < 3⁴⁰ < 5³⁰", "530>340>720>250", "부등호 방향"],
  ["1) A=30  2) B=6", "(1) 30 (2) 6", "소문항 머리 표기"],
];

/** 값이 실제로 다른 짝. **원본 정답면을 렌더해 확인했다.** 흡수되면 안 된다. */
const 진짜오답: Array<[string, string, string]> = [
  ["-45/49", "5", "3187-19"],
  ["462", "495", "3713-19"],
  ["11", "8", "4664-27"],
  ["-17/4", "8", "3094-17"],
  ["-4", "1", "4703-15"],
  ["e⁴", "e12", "3306-18 — e⁴ 와 e¹²"],
  ["81 ln 3 - 26", "27(3ln3-1)", "3266-22 — 27(3ln3-1)=81ln3-27"],
  ["k=-1", "-3", "3141-16"],
  ["4", "8+2√⁄2", "3943-17"],
  ["2", "15", "4141-19"],
  ["0", "-10", "3234-18"],
  ["6", "7", "5409-19"],
  ["⑴ x는 7의 배수, ⑵ 61", "⑴ 21의 배수  ⑵ 61", "3644-16 — 7 과 21"],
  [
    "⑴ △EBD (RHS 합동), ⑵ 10 cm",
    "⑴ ∆ABD≡∆EBD,  RHA합동    ⑵",
    "3879-19 — RHS 와 RHA",
  ],
];

/** 규칙이 헐거우면 여기서 뚫린다. 전부 실측에서 잡은 위험이다. */
const 흡수금지: Array<[string, string, string]> = [
  ["x=4", "y=4", "변수명이 다르면 다른 답이다"],
  ["x=4, y=2", "x=2, y=4", "값을 맞바꾼 것"],
  ["12√3/25", "12√⁄3", "연산자에 물린 조각은 답이 아니다"],
  ["49", "8x=49", "계수는 이름표가 아니다 — 답은 49/8"],
  ["b=2, 3, 4, 6", "4,6", "우리에게만 있는 맨 값은 부연이 아니다"],
  ["12", "120", "숫자가 잘리면 안 된다"],
];

describe("정답 표기 정규화", () => {
  it.each(표기차이)("표기 차이로 흡수한다: %s ↔ %s (%s)", (ours, official) => {
    expect(classifyPair(ours, official).verdict).toBe("표기차이");
  });

  it.each(진짜오답)(
    "값이 다르면 흡수하지 않는다: %s ↔ %s (%s)",
    (ours, official) => {
      expect(classifyPair(ours, official).verdict).not.toBe("표기차이");
    },
  );

  it.each(흡수금지)("절대 흡수하면 안 된다: %s ↔ %s (%s)", (ours, official) => {
    expect(classifyPair(ours, official).verdict).not.toBe("표기차이");
  });
});

describe("글리프 복구", () => {
  // U+F081~F085 = ①~⑤. 시험지 7편의 정답면을 렌더해 96건 전수 대조로 확인했다.
  it("PUA 원문자를 되돌린다", () => {
    expect(repairGlyphs("\uF081")).toBe("①");
    expect(repairGlyphs("\uF085")).toBe("⑤");
    expect(hasBrokenGlyph("\uF083")).toBe(true);
    expect(hasBrokenGlyph("③")).toBe(false);
  });

  it("되돌릴 표가 없는 PUA 는 그대로 둔다", () => {
    expect(repairGlyphs("\uE287")).toBe("\uE287");
  });
});

describe("소문항 쪼개기", () => {
  it("공백 뒤의 `2)` 를 값에 묻히지 않게 가른다", () => {
    // canon 이 공백을 지운 뒤에 쪼개면 `A=302)` 가 되어 소문항이 하나로 보인다.
    expect([...parts("1) A=30  2) B=6").keys()]).toEqual(["1", "2"]);
  });

  it("괄호번호와 원문자 번호를 같이 본다", () => {
    expect([...parts("⑴ 64 ⑵ 225").keys()]).toEqual(["1", "2"]);
    expect([...parts("(1) 64 (2) 225").keys()]).toEqual(["1", "2"]);
  });
});

describe("canon 의 경계", () => {
  it("NFKC 가 원문자를 숫자로 바꾸므로 개수 세기에 쓰면 안 된다", () => {
    // 이 성질을 잊고 `canon` 위에서 원문자를 세다가 복수정답 갈래가 통째로 죽었다.
    expect(canon("③")).toBe("3");
  });
});

/**
 * 🔴 RED → 🟢 GREEN — 원문자 **계열**을 손으로 나열하지 않는다 (2026-08-19).
 *
 * `circledSet` 이 `[①-⑩]` 만 봤다. 그래서 `➀`(U+2780) 계열이 든 행은
 * **정답 대조에서 「원문자가 없다」로 읽혔다.** 실측(`census-circled-glyphs.ts`,
 * 분모 47,152건): 손 목록 밖의 글자가 **`answer` 44행 · `content` 11행 ·
 * `solution` 6행 · 합 58행**.
 *
 * 이 저장소에 원문자 목록이 **손으로 열세 벌** 적혀 있다. CLAUDE.md 2026-08-18 —
 * 「목록을 손으로 쓰면 세는 쪽과 고치는 쪽이 같이 눈이 먼다.」
 * 목록에 없는 계열은 0 이 되고, **0 인 줄도 모른다.**
 */
describe("원문자 계열 — 목록이 아니라 계산으로", () => {
  it("`➂`(U+2782) 를 셋으로 읽는다 — 예전엔 아예 못 봤다", () => {
    expect(circledValue("\u2782")).toBe(3);
  });

  it("계열이 달라도 **같은 답이면 같은 값**이 나온다 — 대조가 새면 안 된다", () => {
    // `③`(U+2462) · `➂`(U+2782) · `❸`(U+2778) 은 전부 «3번» 이다.
    expect(circledSet("\u2782")).toEqual(circledSet("③"));
    expect(circledSet("\u2778")).toEqual(circledSet("③"));
  });

  it("정규형으로 모은다 — 집합 비교가 글리프 모양에 걸리지 않게", () => {
    expect(circledSet("\u2782, \u2783")).toEqual(["③", "④"]);
  });

  it("원문자가 아닌 것은 0 이다", () => {
    expect(circledValue("3")).toBe(0);
    expect(circledValue("가")).toBe(0);
    expect(circledSet("정답은 3 이다")).toEqual([]);
  });

  it("PUA 잔재는 먼저 펴서 읽는다", () => {
    // `repairGlyphs` 가 U+F083 → `③` 로 편다. 계열 계산은 그 뒤에 온다.
    expect(circledSet("\uF083")).toEqual(["③"]);
  });

  /**
   * ⚠️ **이 검사가 없으면 두 파일이 조용히 갈라진다.**
   * `answerChoiceRules.ts` 도 같은 계열표를 들고 있다. 한쪽만 계열을 더하면
   * 판정기와 대조기가 서로 다른 것을 원문자로 본다.
   */
  it("`answerChoiceRules` 와 **같은 계열**을 안다", () => {
    for (const g of rulesKnownCircledGlyphs()) {
      expect(
        circledValue(g),
        `${g} (U+${g.codePointAt(0)!.toString(16)})`,
      ).toBe(rulesCircledValue(g));
    }
  });
});
