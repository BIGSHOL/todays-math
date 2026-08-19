/**
 * 🔴 RED → 🟢 GREEN — 원문자 목록을 **한 곳에 둔다** (원장님 지시 2026-08-19,
 * 「나머지 열두 벌도 같은 방식으로 고쳐」).
 *
 * ## 「같은 방식」이 무엇이었나
 *
 * 1. **무엇이 원문자인지 미리 정하지 않는 발견기**로 실제 건수를 센다.
 * 2. 계열은 **계산**한다 (시작 코드포인트만 적는다).
 * 3. 목록은 **한 곳**에 두고 자리마다 **이름으로** 어느 목록을 쓰는지 드러낸다.
 * 4. 가드를 **망가뜨려 본다.**
 * 5. 🔴 **그리고 넓히면 안 되는 자리는 세어서 밝히고 안 넓힌다.**
 *
 * 5번이 이 회차의 핵심이다. 실측으로 갈렸다 — 정답 판독은 넓혀야 하고
 * (비표준 44행 중 43행이 진짜 정답 번호), **본문 보기 마커는 넓히면 깨진다**
 * (비표준이 줄머리에 온 6행이 전부 규칙 항목·작도 순서·그래프 라벨이었다).
 */
import { describe, expect, it } from "vitest";

import {
  ANSWER_CIRCLED_CLASS,
  BODY_CHOICE_CLASS,
  BODY_CHOICE_MARKS,
  CHOICE_MARKS,
  canonicalCircled,
  circledValueRaw,
  knownCircledGlyphs,
} from "../../lib/math/circledNumber";
import { parseProblemContent } from "../../lib/problem/parseProblemContent";

describe("원문자 — 계열은 계산한다", () => {
  it("`➀`(U+2780) 계열을 안다", () => {
    expect(circledValueRaw("\u2780")).toBe(1);
    expect(circledValueRaw("\u2784")).toBe(5);
  });

  it("`❶`·`➊`·`⓵` 계열도 안다", () => {
    expect(circledValueRaw("\u2776")).toBe(1);
    expect(circledValueRaw("\u278a")).toBe(1);
    expect(circledValueRaw("\u24f5")).toBe(1);
  });

  it("원문자가 아니면 0", () => {
    for (const ch of ["3", "가", "⑴", "㉠", "㈎", "a"])
      expect(circledValueRaw(ch), ch).toBe(0);
  });

  it("정규형으로 모은다 — 계열이 달라도 같은 번호면 같은 글자", () => {
    expect(canonicalCircled(circledValueRaw("\u2782"))).toBe("③");
    expect(canonicalCircled(circledValueRaw("\u2778"))).toBe("③");
    expect(canonicalCircled(0)).toBeNull();
    expect(canonicalCircled(21)).toBeNull();
  });

  it("아는 글자가 서로 겹치지 않는다 — 계열표에 오타가 나면 여기서 잡힌다", () => {
    const g = knownCircledGlyphs();
    expect(new Set(g).size).toBe(g.length);
  });
});

describe("정답 판독용 목록 — **넓다**", () => {
  const RE = new RegExp(`[${ANSWER_CIRCLED_CLASS}]`);

  it("비표준 계열을 본다 — 실측 43행이 이 글자로 정답을 적었다", () => {
    for (const ch of ["\u2780", "\u2784", "\u2776", "\u278a", "\u24f5"])
      expect(RE.test(ch), ch).toBe(true);
  });

  it("표준 계열도 당연히 본다", () => {
    for (const ch of ["①", "⑤", "⑮", "⑳"]) expect(RE.test(ch), ch).toBe(true);
  });

  it("소문항 마커 `⑴` 와 상자 라벨 `㉠` 은 **안 본다** — 정답 번호가 아니다", () => {
    for (const ch of ["⑴", "⑽", "㉠", "㈎"])
      expect(RE.test(ch), ch).toBe(false);
  });
});

describe("본문 보기 마커 — **일부러 좁다**", () => {
  it("`①..⑮` 뿐이다", () => {
    expect(BODY_CHOICE_MARKS).toBe("①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮");
  });

  const RE = new RegExp(`[${BODY_CHOICE_CLASS}]`);

  it("🔴 `➊`·`❶` 을 보기 마커로 **보지 않는다**", () => {
    // 넓히면 아래 픽스처의 「규칙」이 보기로 잘려 나간다.
    expect(RE.test("\u278a")).toBe(false);
    expect(RE.test("\u2776")).toBe(false);
  });

  /**
   * 실제 본문이다(`352f8aac`, 객관식·정답 ③). 발문 안 `<규칙>` 항목이
   * `➊➋` 로 적혀 있다. 보기는 그 아래 따로 `①②③④⑤` 로 온다.
   */
  const 규칙문항 = [
    "점 P 가 점 (4, -2) 에 도착할 확률은?",
    "<규칙>",
    "➊ 두 눈의 수의 합이 짝수이면 x축 방향으로 1 만큼 움직인다.",
    "➋ 두 눈의 수의 합이 홀수이면 y축 방향으로 -1 만큼 움직인다.",
    "① 1/9",
    "② 2/9",
    "③ 1/3",
    "④ 4/9",
    "⑤ 5/9",
  ].join("\n");

  it("🔴 제품 파서가 `<규칙>` 을 보기로 자르지 않는다 — 보기는 정확히 5칸", () => {
    const parsed = parseProblemContent(규칙문항);
    expect(parsed.choices).toHaveLength(5);
    // 규칙 두 줄은 **발문에 남아야** 한다.
    expect(parsed.question).toContain("➊");
    expect(parsed.question).toContain("➋");
    expect(parsed.choices).toEqual(["1/9", "2/9", "1/3", "4/9", "5/9"]);
  });
});

describe("지면에 찍는 글자", () => {
  it("①..⑩ 열 개다", () => {
    expect(CHOICE_MARKS).toEqual([
      "①",
      "②",
      "③",
      "④",
      "⑤",
      "⑥",
      "⑦",
      "⑧",
      "⑨",
      "⑩",
    ]);
  });
});
