/**
 * 문제 본문 → { 지문, 보기[] } 분해 (mathgen ProblemDisplay 의 question/choices 구조에 맞춤).
 *
 * mathgen 은 Gemini 가 question/choices 를 이미 나눠서 주지만, 우리 데이터는 OCR 이관본이라
 * 보기가 본문 문자열 안에 섞여 있다. mathgen 렌더러(MarkdownRenderer)에 넣기 전에
 * 같은 모양(지문 + 보기 배열)으로 만들어 주는 것이 이 모듈의 책임이다.
 *
 * 데이터 실측(1,000건 표본):
 *  - 321건: `\n1. …\n2. …` 숫자 마커 (파싱 가능)
 *  - 4건  : `①②③④⑤` 원문자 마커 (파싱 가능)
 *  - 675건: 마커 없음 (주관식이거나 OCR 이 마커를 유실) → 지문 그대로 폴백
 *  - 일부 : 보기 블록이 통째로 2회 중복 저장됨 (OCR 이관 결함) → 중복 제거
 */
import { describe, expect, it } from "vitest";

import { parseProblemContent } from "@/lib/problem/parseProblemContent";

describe("[parseProblemContent] 지문/보기 분해", () => {
  it("숫자 마커 보기를 5개로 분해하고 지문에서 제거한다", () => {
    const raw =
      "두 수\n\n$A$\n\n의 최소공배수는?\n1. $a$\n2. $b$\n3. $c$\n4. $d$\n5. $e$";
    const { question, choices } = parseProblemContent(raw);
    expect(choices).toHaveLength(5);
    expect(choices[0]).toBe("$a$");
    expect(choices[4]).toBe("$e$");
    expect(question).not.toContain("1.");
    expect(question).toContain("최소공배수는?");
  });

  it("OCR 이중 개행을 공백으로 합쳐 지문이 한 문장으로 흐른다", () => {
    const raw = "다음 조건을 만족시키는 자연수\n\n$m,n$\n\n의 개수는?";
    const { question, choices } = parseProblemContent(raw);
    expect(choices).toHaveLength(0);
    expect(question).toBe("다음 조건을 만족시키는 자연수 $m,n$ 의 개수는?");
  });

  it("원문자(①②③) 마커도 보기로 분해한다", () => {
    const raw = "그림을 보아라\n\n① $a$\n② $b$\n③ $c$";
    const { question, choices } = parseProblemContent(raw);
    expect(choices).toEqual(["$a$", "$b$", "$c$"]);
    expect(question).toBe("그림을 보아라");
  });

  it("마커가 없으면 지문 그대로 두고 보기는 비운다 (폴백)", () => {
    const raw = "순환소수\n\n$0.\\overline{3}$\n\n을 분수로 나타내어라.";
    const { question, choices } = parseProblemContent(raw);
    expect(choices).toHaveLength(0);
    expect(question).toContain("순환소수");
    expect(question).toContain("을 분수로 나타내어라.");
  });

  it("보기 블록이 2회 중복 저장된 OCR 결함을 제거한다", () => {
    const raw =
      "다음 중 바르게 짝 지어진 것은?\n1. $a$\n2. $b$\n3. $c$\n4. $d$\n5. $e$\n1. $a$\n2. $b$\n3. $c$\n4. $d$\n5. $e$";
    const { choices } = parseProblemContent(raw);
    expect(choices).toHaveLength(5);
  });

  it("수식 안의 개행·달러는 건드리지 않는다", () => {
    const raw = "값은\n\n$\\frac{1}{2}$\n\n이다.";
    const { question } = parseProblemContent(raw);
    expect(question).toContain("$\\frac{1}{2}$");
  });

  it("빈 문자열도 안전하게 처리한다", () => {
    expect(parseProblemContent("")).toEqual({ question: "", choices: [] });
  });

  it("마커 없이 꼬리 블록이 통째로 중복된 OCR 결함을 제거한다", () => {
    // 실데이터(2,000건 중 340건): 보기 마커를 잃은 채 보기 묶음이 2회 반복 저장됨.
    const raw =
      "다음 중 일차부등식이 아닌 것은?\n\n$5-3x\\ge x+9$\n\n$6x\\le3x+1$\n\n$x-2x^{2}>7-2x^{2}$\n\n$5-3x\\ge x+9$\n\n$6x\\le3x+1$\n\n$x-2x^{2}>7-2x^{2}$";
    const { question } = parseProblemContent(raw);
    expect(question).toBe(
      "다음 중 일차부등식이 아닌 것은? $5-3x\\ge x+9$ $6x\\le3x+1$ $x-2x^{2}>7-2x^{2}$",
    );
  });

  it("정상적으로 반복되는 짧은 표현은 중복으로 오인하지 않는다", () => {
    const raw = "값을 구하시오. $a$ $a$";
    const { question } = parseProblemContent(raw);
    expect(question).toBe("값을 구하시오. $a$ $a$");
  });
});

/**
 * 상자(<보기>·<조건>) 통합 — 렌더 수리 B.
 *
 * 지문 정규화(`collapseWhitespace`)가 개행을 전부 공백으로 합치기 때문에,
 * 상자 구조는 **여기서 마크다운 인용문으로 굳혀야** 렌더러까지 살아 남는다.
 * (mathgen 도 같은 자리에서 `wrapBareConditionBoxes` 로 blockquote 를 만든다.)
 */
describe("[parseProblemContent] <보기>·<조건> 상자", () => {
  it("상자를 인용문으로 굳혀 발문과 갈라 놓는다", () => {
    const raw =
      "<보기>에서 옳은 것은?\n< 보 기 >\nㄱ. 참이다.\nㄴ. 거짓이다.\n1. ㄱ\n2. ㄴ";
    const { question, choices } = parseProblemContent(raw);
    expect(choices).toEqual(["ㄱ", "ㄴ"]);
    // 라벨 뒤 숫자는 **열 수**다(`<보기2>` = 2열). 렌더러가 지우고 그린다.
    expect(question).toBe(
      "<보기>에서 옳은 것은?\n\n> <보기2>\n>\n> ㄱ. 참이다.\n>\n> ㄴ. 거짓이다.",
    );
  });

  it("상자가 없는 문항의 지문은 예전과 한 글자도 다르지 않다", () => {
    const raw = "다음 조건을 만족시키는 자연수\n\n$m,n$\n\n의 개수는?";
    expect(parseProblemContent(raw).question).toBe(
      "다음 조건을 만족시키는 자연수 $m,n$ 의 개수는?",
    );
  });

  it("상자 뒤 발문 꼬리는 인용문 밖 문단으로 돌아온다", () => {
    const raw =
      "다음 <조건>을 만족한다. <조건>(가) $p$는 확률이다.(나) $q$는 확률이다.이 때 $p+q$의 값은?";
    const { question } = parseProblemContent(raw);
    expect(question.endsWith("이 때 $p+q$의 값은?")).toBe(true);
    expect(question).toContain("> (가) $p$는 확률이다.");
  });

  it("항목이 숫자 마커로 시작해도 마크다운 목록으로 오해되지 않게 감싼다", () => {
    // 인용문 안에서 `1.` 로 시작하면 마크다운이 번호 목록으로 바꿔 **마커를 지운다**.
    const raw = "다음 <조건>에 맞게 쓰시오. <조건>1. 소인수분해를 이용할 것.";
    const { question } = parseProblemContent(raw);
    expect(question).toContain("> 1\\. 소인수분해를 이용할 것.");
  });
});
