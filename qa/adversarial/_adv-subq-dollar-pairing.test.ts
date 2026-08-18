/**
 * 적대적 재현 🔴 — **하위 문항 줄바꿈이 `$` 짝을 밀어 LaTeX 를 지면에 날 글자로 내보낸다.**
 *
 * ── 무엇이 틀렸나 ──────────────────────────────────────────────────────────
 * `subQuestion.ts` 의 `SPAN_ARABIC`·`SPAN_PAREN_DIGIT` 은 「수식 span **통째**가
 * 번호 하나(`$(1)$` · `$⑴$`)」를 찾는다고 적었다. 그런데 정규식은 `$` 가 **여는
 * 것인지 닫는 것인지 모른다.** 그래서
 *
 *     ⑴ $4x+1≥-2x+13$ ⑵ $\frac{2x-1}{5}…$
 *                    ↑↑↑↑↑↑  여기를 「span 통째」로 읽는다
 *
 * 앞 수식의 **닫는 `$`** 부터 뒤 수식의 **여는 `$`** 까지가 한 마커가 된다.
 * 마커 인덱스가 닫는 `$` 위에 앉으므로,
 *   · `parseProblemContent.markSubQuestions` 가 **그 `$` 앞에서** 문단을 나누고
 *   · `boxBlock.findBoxStop` 이 **그 `$` 앞에서** 상자를 끊는다.
 * 결과는 문단마다 `$` 개수가 홀수 — 마크다운 렌더러가 짝을 다시 맞추면서
 * `$ ⑵ $` 를 수식으로, **뒤따르는 진짜 수식을 평문으로** 그린다.
 *
 * ⚠️ 이 부류는 KaTeX 오류가 아니다. 렌더는 «성공»한다 — 지면에 `\frac{2x-1}{5}` 가
 * 그대로 찍힐 뿐이다(CLAUDE.md 2026-08-16 «KaTeX 가 초록이라고 지면이 멀쩡한 게
 * 아니다», 2026-08-18 «세는 쪽과 고치는 쪽이 같이 눈이 먼다»).
 *
 * ── 실데이터 근거 (전수 47,152건) ──────────────────────────────────────────
 *   `npx tsx qa/adversarial/scripts/scan-dollar-pairing.ts`
 *     마커가 닫는 `$` 위에 앉은 문항        91건
 *     문단의 `$` 짝이 깨진 문항  옛 1 → 지금 94  (**새로 깨진 93건**)
 *   `npx tsx qa/adversarial/scripts/scan-box-item-splits.ts`
 *     상자 조각의 `$` 짝이 깨진 문항  옛 0 → 지금 4
 *   실례: 0c05c111 · 0ac5f132 · 31032d5b · 088e24eb · 2feffcf0 · 383a7eb4 …
 */
import { describe, expect, it } from "vitest";

import { findSubQuestionMarkers } from "@/lib/math/subQuestion";
import { parseProblemContent } from "@/lib/problem/parseProblemContent";

/** 문단마다 `$` 짝이 맞아야 한다 — 렌더러가 문단 단위로 수식을 짝짓는다. */
function paragraphsWithOddDollars(question: string): string[] {
  return question
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^>\s?/gm, "").trim())
    .filter((part) => (part.match(/\$/g)?.length ?? 0) % 2 === 1);
}

describe("적대적 ① 하위 문항 마커가 닫는 `$` 를 집는다", () => {
  it("마커는 번호 글자에서 시작해야 한다 — 앞 수식의 닫는 `$` 가 아니라", () => {
    // 실측 0c05c111 의 축약형.
    const text = "⑴ $4x+1≥-2x+13$ ⑵ $\\frac{2x-1}{5}>2.5x+1$";
    const markers = findSubQuestionMarkers(text);
    expect(markers).toHaveLength(2);

    const second = markers[1]!;
    // 지금은 `$` 위에 앉는다. 마커는 `⑵` 에서 시작해야 한다.
    expect(text[second.index]).toBe("⑵");
  });

  /**
   * 반각 `(1)` 판은 **우연히** 살아남는 경우가 많다 — `checkBefore` 가 켜져 있어
   * 앞 수식이 숫자·영문자로 끝나면 `REJECT_BEFORE` 가 막는다(`…=2$ (2) $…`).
   * 그런데 앞 수식이 **닫는 괄호**로 끝나면 뚫린다. 닫는 괄호는 2026-08-18 수리가
   * 「진짜 하위 문항을 무더기로 버린다」며 `REJECT_BEFORE` 에서 **일부러 뺀** 글자다.
   * 한 가드를 바로잡은 것이 다른 가드를 열었다.
   */
  it("문단을 나눠도 `$` 짝은 안 깨져야 한다 (반각 `(1)` 판)", () => {
    const text = "(1) $x=(a+b)$ (2) $\\frac{1}{2}x=3$";
    const { question } = parseProblemContent(text);
    expect(paragraphsWithOddDollars(question)).toEqual([]);
  });

  it("괄호원문자 판 — 실측 0c05c111", () => {
    const text = "⑴ $4x+1≥-2x+13$ ⑵ $\\frac{2x-1}{5}-\\frac{x-5}{2}>2.5x+1$";
    const { question } = parseProblemContent(text);
    expect(paragraphsWithOddDollars(question)).toEqual([]);
  });

  it("진짜 LaTeX 가 평문으로 새지 않는다", () => {
    const text = "⑴ $4x+1≥-2x+13$ ⑵ $\\frac{2x-1}{5}-\\frac{x-5}{2}>2.5x+1$";
    const { question } = parseProblemContent(text);
    // 두 번째 문단이 `$ ⑵ $` 를 수식으로 먹으면 뒤의 `\frac…` 이 평문이 된다.
    const second = question.split(/\n\s*\n/)[1] ?? "";
    expect(second.startsWith("$")).toBe(false);
  });

  it("상자 항목의 `$` 짝도 안 깨져야 한다 — 실측 088e24eb", () => {
    const text = [
      "다음은 제곱근표의 일부이다. <보기>와 같은 풀이과정으로 적으시오.",
      "<보기>",
      "$\\sqrt{5410}=\\sqrt{54.1\\times 100}=73.55$",
      "⑴ $\\sqrt{551}$ ",
      "⑵ $\\sqrt{552000}$ ",
    ].join("\n");
    const { question } = parseProblemContent(text);
    expect(paragraphsWithOddDollars(question)).toEqual([]);
  });
});
