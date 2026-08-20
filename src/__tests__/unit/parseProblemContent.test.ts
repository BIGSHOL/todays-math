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

/**
 * ── 세부 문항 줄바꿈 (2026-08-18 원장님) ────────────────────────────────────
 * "이런경우는 세부 문항이 줄바꿈 처리되어야할텐데?"
 *  `… 다음 물음에 답하여라. [총 6점] (1) 어떤 수를 구하시오. (2) 바르게 계산한
 *   결과를 구하시오.` 가 한 덩어리로 이어진다.
 *
 * 판정은 `subQuestion.ts` 가 한다(오탐 근거는 그 파일 주석). 여기서는 **개행을
 * 어디에 넣는가**만 잠근다. `collapseWhitespace` 가 개행을 전부 녹이므로
 * **녹이기 전에** 자리를 표시해 두었다가 녹인 뒤 문단으로 되살린다.
 */
describe("[parseProblemContent] 세부 문항 줄바꿈", () => {
  it("`(1)` `(2)` 앞에서 문단을 나눈다 (원장님 지적 모양)", () => {
    const raw =
      "어떤 수에 $3$을 더해야 할 것을 잘못하여 곱했더니 $21$이 되었다. 다음 물음에 답하여라. [총 $6$점]\n(1) 어떤 수를 구하시오.\n(2) 바르게 계산한 결과를 구하시오.";
    const { question } = parseProblemContent(raw);
    const paras = question.split(/\n\s*\n/);
    expect(paras).toHaveLength(3);
    expect(paras[0]).toContain("다음 물음에 답하여라");
    expect(paras[1]!.startsWith("(1)")).toBe(true);
    expect(paras[2]!.startsWith("(2)")).toBe(true);
  });

  it("수식에 갇힌 `$(1)~$` 도 문단을 나눈다 (실측 dba88a32)", () => {
    const raw =
      "다음 물음에 답하시오.\n$(1)~$가장 작은 값을 구하시오.\n$(2)~$절댓값이 가장 큰 값을 구하시오.";
    const paras = parseProblemContent(raw).question.split(/\n\s*\n/);
    expect(paras).toHaveLength(3);
    expect(paras[1]).toContain("가장 작은 값");
  });

  it("괄호원문자 `⑴` 도 나눈다", () => {
    const raw =
      "물음에 답하시오. ⑴ $a$ 를 구하시오. ⑵ $b$ 를 구하시오. ⑶ $c$ 를 구하시오.";
    expect(parseProblemContent(raw).question.split(/\n\s*\n/)).toHaveLength(4);
  });

  it("함수값 `f(1)` 은 나누지 않는다 — 수식이 깨진다", () => {
    const raw =
      "이차함수 $f(x)=2x^{2}-3x+1$ 에 대하여 $f(0)+f(1)$ 의 값은?\n1. $a$\n2. $b$";
    expect(parseProblemContent(raw).question).not.toContain("\n\n");
  });

  it("구간 `(0,4)` · 인수분해 `(x+2)(x-3)` 도 나누지 않는다", () => {
    const raw =
      "열린구간 $(0,4)$ 에서 $(x+2)(x-3)(x+1)$ 을 전개하면?\n1. $a$\n2. $b$";
    expect(parseProblemContent(raw).question).not.toContain("\n\n");
  });

  it("하위 문항이 하나뿐이면 나누지 않는다", () => {
    const raw = "다음 그림 $(1)$ 을 보고 답하시오.";
    expect(parseProblemContent(raw).question).not.toContain("\n\n");
  });

  it("상자 **안**의 항목 번호는 상자 안에 그대로 둔다", () => {
    // 상자 항목의 `⑴⑵⑶` 은 조건 번호다 — 문단으로 흩으면 상자가 깨진다.
    const raw =
      "<조건>을 모두 만족시키는 두 다항식 A, B 는? <조건>⑴ 다항식 A는 일차식이다.⑵ 다항식 B는 상수항이 $1$이다.⑶ A $-$ B $=x$";
    const { question } = parseProblemContent(raw);
    const boxLines = question
      .split(/\r?\n/)
      .filter((l) => l.trimStart().startsWith(">"));
    expect(boxLines.join(" ")).toContain("다항식 B는 상수항이");
  });
});

/**
 * 초등 기입 칸 · 세로셈 블록 (2026-08-20 원장님, /dev/cube-scrape).
 * collapse 가 개행을 녹이므로 자리를 되살리지 않으면
 * `각 (　　) 각의 꼭짓점 (　　)` 와 `계산해 보세요. 265` 가 한 문단이다.
 */
describe("[parseProblemContent] 기입 칸·세로셈 줄바꿈", () => {
  it("각·각의 꼭짓점·각의 변을 각각 문단으로 세운다", () => {
    const raw =
      "그림을 보고 각, 꼭짓점, 변을 쓰세요.\n\n각 (　　)  \n각의 꼭짓점 (　　)  \n각의 변 (　　)";
    const paras = parseProblemContent(raw).question.split(/\n\s*\n/);
    expect(paras).toHaveLength(4);
    expect(paras[0]).toContain("그림을 보고");
    expect(paras[1]!.startsWith("각 (")).toBe(true);
    expect(paras[2]!.startsWith("각의 꼭짓점")).toBe(true);
    expect(paras[3]!.startsWith("각의 변")).toBe(true);
  });

  it("빈칸이 하나뿐이면 나누지 않는다", () => {
    const raw = "빈칸 (　　) 에 알맞은 수를 쓰세요.";
    expect(parseProblemContent(raw).question).not.toContain("\n\n");
  });

  it("세로셈 display 수식은 발문 다음 문단이다", () => {
    const raw =
      "계산해 보세요.\n\n$$\\begin{array}{r} 265 \\\\ +413 \\\\ \\hline \\end{array}$$";
    const paras = parseProblemContent(raw).question.split(/\n\s*\n/);
    expect(paras).toHaveLength(2);
    expect(paras[0]).toBe("계산해 보세요.");
    expect(paras[1]!.startsWith("$$")).toBe(true);
    expect(paras[1]).toContain("\\begin{array}");
  });

  it("인라인 가로셈은 한 문장으로 둔다", () => {
    const raw = "계산해 보세요.\n\n$126+745$";
    expect(parseProblemContent(raw).question).toBe(
      "계산해 보세요. $126+745$",
    );
  });

  it("문장 속 네모 빈칸은 (1)(2) 와 같이 있어도 단어를 쪼개지 않는다", () => {
    const raw =
      "보기에서 고르세요.\n\n(1) 자의 길이는 약 $\\square$입니다.\n\n(2) 우리 집에서 이모 댁까지의 거리는 약 $\\square$입니다.";
    const question = parseProblemContent(raw).question;
    expect(question).toContain("우리 집에서 이모 댁까지의 거리");
    expect(question.split(/\n\s*\n/).some((p) => p.startsWith("(2) 우리 집"))).toBe(
      true,
    );
  });
});

