/**
 * 하위 문항 마커 판정 — `(1)` · `⑴` 처럼 한 문항 안에서 갈라지는 소문항 번호.
 *
 * ── 왜 「마커처럼 생겼다」로는 안 되는가 ─────────────────────────────────────
 * 전수 실측(47,152건, `scripts/qa/measure-subquestions.ts --samples`):
 *   마커 후보가 2개 이상인 문항 2,873건(6.09%)
 *   — `⑴⑵` 괄호원문자 1,597 · `(1)` 반각괄호 1,334 · `1)` 닫는괄호만 196 · `가)` 38
 * 그런데 표본을 **눈으로** 보니 갈렸다:
 *   · `⑴⑵⑶` 원문자는 표본 8건 전부 진짜 하위 문항이다.
 *   · `(1)` 반각괄호는 표본 **대부분이 오탐**이다 — `f(0)+f(1)`(함수값) ·
 *     `(0,4)`(구간) · `(x+2)(x-3)`(인수분해) · `1. $5$`(보기 번호).
 *   · `1)` 닫는괄호만은 표본 전량 오탐(`(-6.7)-(+3.9)` 같은 수식 조각).
 * 그래서 이 모듈은 `1)` · `가)` 를 **아예 보지 않는다.** 2,873건을 고치려다
 * 44,000건을 망가뜨리면 손해다.
 *
 * ── 세 조건을 **동시에** 요구한다 ────────────────────────────────────────────
 *  ① 모양이 깨끗하다 — 수식 span 통째(`$(1)~$` · `$⑴$`)이거나, 줄머리 `(1)` 이거나,
 *    공백 뒤 괄호원문자.  ← 수식 **한가운데** 있는 `(1)` 은 절대 마커가 아니다.
 *  ② 앞이 영문자·숫자·닫는 괄호·프라임이 아니다.  ← `f(1)` · `g′(1)` 배제.
 *  ③ 문항 안에 **1부터 잇따라 오르는 번호가 2개 이상** 있다.
 *    ← 본문과 **독립인 근거**. 홀로 선 `(1)` 은 하위 문항이 아니다
 *      (CLAUDE.md 2026-08-17: 문턱이 안 갈라주면 근거를 하나 더 요구하라).
 *
 * 쓰는 곳이 둘이라 한 모듈에 모았다 — 둘이 갈라지면 조용히 어긋난다:
 *   · `parseProblemContent` — 하위 문항 앞에서 줄을 바꾼다(원장님 2026-08-18 지적).
 *   · `boxBlock` — 상자가 하위 문항을 삼키지 않게 **끊는다**(회귀 ①).
 */

export interface SubQuestionMarker {
  /** 원문에서 마커가 시작하는 위치. */
  index: number;
  /** 마커 길이. 수식 span 이면 `$…$` 전체 길이다. */
  length: number;
  /** 번호(1부터). */
  number: number;
}

/** 괄호원문자 `⑴`(U+2474) ~ `⒇`(U+2487) — 1~20. */
const PAREN_DIGIT_FIRST = 0x2474;
const PAREN_DIGIT_LAST = 0x2487;

function parenDigitNumber(ch: string): number | null {
  const code = ch.codePointAt(0) ?? 0;
  if (code < PAREN_DIGIT_FIRST || code > PAREN_DIGIT_LAST) return null;
  return code - PAREN_DIGIT_FIRST + 1;
}

/**
 * 수식 span 안에서 **번호 말고 아무것도 아닌** 채움. HWP 변환 잔재다.
 * `~`(비줄바꿈 공백) · `\,` `\;` `\:` `\!`(간격) · `\quad` · 공백.
 */
const MATH_PADDING = "(?:~|\\\\[,;:!]|\\\\q?quad|\\s)*";

/** `$(1)~$` · `$ (12) $` — 수식 span **통째**가 번호 하나다. */
const SPAN_ARABIC = new RegExp(
  `\\$${MATH_PADDING}\\(${MATH_PADDING}(\\d{1,2})${MATH_PADDING}\\)${MATH_PADDING}\\$`,
  "g",
);

/** `$⑴$` — 수식 span 통째가 괄호원문자 하나다. */
const SPAN_PAREN_DIGIT = new RegExp(
  `\\$${MATH_PADDING}([\\u2474-\\u2487])${MATH_PADDING}\\$`,
  "g",
);

/** 줄머리 `(1)` — 앞에 줄바꿈과 공백만 있다. */
const LINE_START_ARABIC = /(^|\n)[ \t]*\((\d{1,2})\)/g;

/** 맨 앞이거나 공백 뒤의 괄호원문자. */
const BARE_PAREN_DIGIT = /[⑴-⒇]/g;

/**
 * 마커 **앞**에 오면 하위 문항이 아니라고 보는 글자 — 영문자·숫자(함수값 `f(1)`)와
 * 프라임(도함수 `g′(1)`)뿐이다.
 *
 * ⚠️ **닫는 괄호 셋(`)` `]` `}`)은 넣으면 안 된다.** 넣었다가 실측에서 진짜 하위
 * 문항을 무더기로 버렸다. 닫는 괄호는 수식 안이 아니라 **앞 문장 끝**에 있다:
 *   · `[그림] ⑴ …`                    000efe4c · 01106a23 · 015439c0
 *   · `[총 $7$점] $(1)$ …`            00d7cd01 · 01d367e2
 *   · `…자세히 서술하시오.) $(2)$ …`   0185c43b
 *   · `…유지된다.) ⑴ …`               01abfe77
 *   · `…예시 참고)) ⑵ …`              0160c032
 * 인수분해 `(x-3)(1)` 은 **수식 span 안쪽**이라 여기 후보로 올라오지도 않는다
 * (후보는 span 통째이거나 줄머리여야 한다). 즉 닫는 괄호가 막는 오탐은 없고,
 * 막는 것은 진짜뿐이었다 — 손상 지표와 정상 지표를 한 문턱으로 가르면
 * **고쳐야 할 문항이 먼저 버려진다**(CLAUDE.md 2026-08-16).
 */
const REJECT_BEFORE = /[A-Za-z0-9′'’]/;

/**
 * 마커 바로 앞 글자(공백·비줄바꿈 공백 무시). 없으면 빈 문자열.
 *
 * **줄바꿈에서 멈춘다** — 줄머리는 언제나 안전한 자리다.
 * **수식 span 경계(`$`)에서도 멈춘다.** 앞 수식의 마지막 글자를 앞 글자로 읽으면
 * `$15$ $8$ $(1)$ 주어진 자료의 …`(실측 0185c43b)에서 숫자 `8` 때문에 진짜
 * 하위 문항이 버려진다. 도함수 `g′(1)` 의 프라임은 실측에서 **수식 밖**에
 * 맨 글자로 놓여 있으므로(`$3g$ ′ $(1)$`) 여기서 그대로 잡힌다.
 */
function charBefore(text: string, index: number): string {
  let i = index - 1;
  while (i >= 0 && /[ \t~]/.test(text[i]!)) i -= 1;
  if (i < 0 || text[i] === "\n") return "\n";
  if (text[i] === "$") return "";
  return text[i]!;
}

interface Candidate extends SubQuestionMarker {
  /** 같은 자리를 두 규칙이 잡으면 긴 쪽(수식 span 통째)을 남긴다. */
  readonly priority: number;
}

function collect(text: string): Candidate[] {
  const found: Candidate[] = [];

  /**
   * `checkBefore` 는 **반각 괄호 `(1)` 에만** 켠다.
   *
   * 괄호원문자 `⑴`~`⒇` 는 수식에 쓰이지 않는 전용 글자라 앞 글자를 볼 이유가 없다.
   * 켜 두었더니 실측에서 진짜 하위 문항이 무더기로 버려졌다 —
   * `…유지된다.) ⑴ …`(01abfe77) · `…예시 참고)) ⑵ …`(0160c032) 처럼
   * **앞 문장이 괄호로 끝나는 것**이 흔하고, `[총 $7$점]⑴`(01d367e2) 처럼
   * 배점 표기에 바로 붙기도 한다. 함수값과는 아무 상관이 없는 자리다.
   */
  const push = (
    index: number,
    length: number,
    num: number,
    priority: number,
    checkBefore: boolean,
  ) => {
    if (num < 1) return;
    if (checkBefore && REJECT_BEFORE.test(charBefore(text, index))) return;
    // `(1)(2)(3)` 처럼 붙어 있으면 표의 칸이지 하위 문항이 아니다(실측 33786c96).
    if (text[index + length] === "(") return;
    found.push({ index, length, number: num, priority });
  };

  for (const m of text.matchAll(SPAN_ARABIC))
    push(m.index, m[0].length, Number(m[1]), 2, true);
  for (const m of text.matchAll(SPAN_PAREN_DIGIT))
    push(m.index, m[0].length, parenDigitNumber(m[1]!) ?? 0, 2, false);
  for (const m of text.matchAll(LINE_START_ARABIC)) {
    const token = `(${m[2]})`;
    push(
      m.index + m[0].length - token.length,
      token.length,
      Number(m[2]),
      1,
      true,
    );
  }
  for (const m of text.matchAll(BARE_PAREN_DIGIT))
    push(m.index, 1, parenDigitNumber(m[0]) ?? 0, 1, false);

  found.sort((a, b) => a.index - b.index || b.priority - a.priority);

  // 같은 자리를 두 규칙이 잡았으면 앞선(긴) 것만 남긴다.
  const deduped: Candidate[] = [];
  for (const c of found) {
    const last = deduped[deduped.length - 1];
    if (last && c.index < last.index + last.length) continue;
    deduped.push(c);
  }
  return deduped;
}

/**
 * 하위 문항 마커를 찾는다. **1부터 잇따라 오르는 번호가 2개 이상**일 때만 돌려준다.
 *
 * 잇따름을 요구하는 이유: 홀로 선 `(1)`·`$⑴$` 은 그림 번호·참조이지 하위 문항이
 * 아니다. 1 부터를 요구하는 이유: `(2)` 만 나오는 것은 **다른 하위 문항을 가리키는
 * 참조**다(실측 2a584201 `∘(2) 풀이 과정을 자세히 적을 것`).
 */
export function findSubQuestionMarkers(text: string): SubQuestionMarker[] {
  if (!text) return [];
  const candidates = collect(text);
  if (candidates.length < 2) return [];

  const run: SubQuestionMarker[] = [];
  let expected = 1;
  for (const c of candidates) {
    if (c.number !== expected) continue;
    run.push({ index: c.index, length: c.length, number: c.number });
    expected += 1;
  }
  return run.length >= 2 ? run : [];
}
