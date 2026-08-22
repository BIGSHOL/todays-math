/**
 * 소단원 **이름이 내건 조건**을 그 생성기가 실제로 지키는가.
 *
 * 왜 따로 있나 — `probe-elem-rules.ts` 의 가드는 **표기**를 본다. 표기가 완벽해도
 * `2-4-3 (자연수)×(**1보다 작은 소수**)의 계산` 이 `7 × 2.0` 을 내는 것은 못 잡는다.
 * 2.0 은 1보다 작지 않다. 이건 **에러를 안 내는 틀린 문항**이라 스스로 신고하지 않는다.
 *
 *   npx tsx scripts/qa/probe-elem-section-conditions.ts
 *   npx tsx scripts/qa/probe-elem-section-conditions.ts 초5
 *
 * ⚠️ 조건을 못 읽는 소단원은 **`미판정` 으로 반드시 출력한다.** 손으로 적은 조건 목록은
 * 새는데, 조용히 0이 되면 「없다」와 「못 센다」를 구분할 수 없다
 * (CLAUDE.md 2026-08-18 `report-missing-figures.ts` 와 같은 태도).
 */
import {
  elementaryUnits,
  generateElementaryProblem,
} from "../../src/lib/elementary/generate";

/** 여러 씨앗으로 봐야 «가끔 어기는» 생성기가 드러난다. */
const SEEDS = [20260821, 7, 1234, 99991, 20260822, 555, 31337, 4242];

/** 발문에서 수를 뽑는다 — KaTeX 안팎을 가리지 않는다. */
function numbers(text: string): number[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** `\frac{a}{b}` 짝. */
function fracs(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of text.matchAll(/\\frac\{(\d+)\}\{(\d+)\}/g)) {
    out.push([Number(m[1]), Number(m[2])]);
  }
  return out;
}

/** 소수점 아래 자릿수 — `0.30` 은 2. 글자로 세야 한다(`0.30` 을 수로 읽으면 0.3 이다). */
function decimalPlaces(text: string): number[] {
  return [...text.matchAll(/\d+\.(\d+)/g)].map((m) => m[1]!.length);
}

/**
 * 식의 피연산자 하나 — `2\frac{1}{3}`(대분수)·`\frac{1}{3}`·`4.83`·`16` 을 가른다.
 * `dp` 는 소수점 아래 자릿수(소수만), `denom` 은 분모(분수만).
 */
type Operand = {
  kind: "자연수" | "소수" | "분수";
  value: number;
  dp: number;
  denom?: number;
};

const NUM_TOKEN = String.raw`(?:\d+\s*)?\\frac\{\d+\}\{\d+\}|\d+\.\d+|\d+`;

function classifyOperand(tok: string): Operand {
  const frac = tok.match(/^(\d+)?\s*\\frac\{(\d+)\}\{(\d+)\}$/);
  if (frac) {
    const whole = frac[1] ? Number(frac[1]) : 0;
    return {
      kind: "분수",
      value: whole + Number(frac[2]) / Number(frac[3]),
      dp: 0,
      denom: Number(frac[3]),
    };
  }
  if (tok.includes(".")) {
    return { kind: "소수", value: Number(tok), dp: tok.split(".")[1]!.length };
  }
  return { kind: "자연수", value: Number(tok), dp: 0 };
}

/**
 * `a\div b`·`a\times b` 의 두 피연산자. 식이 없으면 null.
 *
 * ⚠️ null 을 받는 검사는 **위반**으로 처리한다 — 이 소단원들의 발문은 전부 식 하나다
 * (씨앗 120개 실측: 소단원 16개 모두 뼈대 1가지). 문장형이 생기면 여기서 빨개지므로
 * 그때 이 추출기를 넓힌다 — 조용히 통과시키면 그 부류가 통째로 사각지대가 된다.
 */
function operandsOf(
  content: string,
  op: "div" | "times",
): [Operand, Operand] | null {
  const m = content.match(
    new RegExp(`(${NUM_TOKEN})\\s*\\\\${op}\\s*(${NUM_TOKEN})`),
  );
  return m
    ? [classifyOperand(m[1]!.trim()), classifyOperand(m[2]!.trim())]
    : null;
}

/** 「(A)÷(B)」·「(A)×(B)」 — 식의 두 피연산자 종류가 소단원 이름 그대로인가. */
function opShape(
  op: "div" | "times",
  left: Operand["kind"],
  right: Operand["kind"],
): (content: string) => boolean {
  return (c) => {
    const o = operandsOf(c, op);
    return o !== null && o[0].kind === left && o[1].kind === right;
  };
}

/** 몫이 소수 몇 자리에서 나누어떨어지는가 — 부동소수 오차는 1e-6 으로 눌러 잰다. */
function quotientDp(q: number): number {
  for (let d = 0; d <= 6; d += 1) {
    if (Math.abs(q * 10 ** d - Math.round(q * 10 ** d)) < 1e-6) return d;
  }
  return 7;
}

const DIGIT_WORD: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4 };

/**
 * 소단원 이름이 내건 「소수 N 자리」를 **전부** 모은다.
 *
 * ⚠️ 「소수 두 자리 수**, 세 자리 수** 알아보기」는 **둘을 나란히** 가르친다.
 * 앞의 것만 보고 걸면 멀쩡한 산출 6/8 이 거짓 경보로 잡힌다(2026-08-22 실측).
 *
 * 「둘 다」와 「둘 중 하나」를 가르는 것은 **구조**다 —
 * 괄호 안 피연산자(`(세 자리 수)×(한 자리 수)`)는 **둘 다** 있어야 하고,
 * 쉼표 나열(`두 자리 수, 세 자리 수`)은 **어느 쪽이든** 좋다.
 * 소수 쪽에는 괄호로 묶인 자릿수 조건이 없으므로 여기서는 나열로만 읽는다
 * (정수 쪽은 아래 needle 별 검사가 그대로 «둘 다»를 요구한다).
 */
function decimalPlacesWanted(section: string): number[] {
  const out = new Set<number>();
  for (const m of section.matchAll(/([한두세네])\s*자리\s*수/g)) {
    out.add(DIGIT_WORD[m[1]!]!);
  }
  return [...out];
}

type Check = {
  /** 소단원 이름에 이 말이 있으면 적용한다. */
  needle: string;
  /** 발문이 조건을 지키면 true. */
  ok: (content: string, section: string) => boolean;
  /**
   * 이 조건이 그 소단원에 정말 적용되는가. 없으면 늘 적용.
   *
   * ⚠️ 「소수 **한 자리 수**의 덧셈」의 「한 자리」는 **자릿수가 아니라 소수점 아래 자리**다.
   * 이걸 안 가르면 `3.1+2.5` 가 거짓 경보로 잡힌다 — 실제로 잡혔다(2026-08-22).
   * **거짓 경보는 가드를 끈다.**
   */
  when?: (section: string) => boolean;
};

const notDecimalContext = (s: string) => !s.includes("소수");
const decimalContext = (s: string) => s.includes("소수");

const CHECKS: Check[] = [
  {
    needle: "1보다 작은 소수",
    // `2.0` 은 JS 에서 정수라 `Number.isInteger` 가 참이다. 그것도 결함이다 —
    // 「소수」라면서 정수를 내는 것이니 어느 쪽으로든 걸려야 맞다.
    ok: (c) => numbers(c).some((v) => v < 1 && v > 0 && !Number.isInteger(v)),
  },
  {
    needle: "1보다 큰 소수",
    ok: (c) => numbers(c).some((v) => v > 1 && !Number.isInteger(v)),
  },
  {
    // 「진분수와 가분수 알아보기」처럼 **둘을 나란히 가르치는** 소단원은 어느 쪽이든 좋다.
    needle: "진분수",
    ok: (c) => fracs(c).some(([a, b]) => a < b),
    when: (s) => !s.includes("가분수"),
  },
  {
    needle: "가분수",
    ok: (c) => fracs(c).some(([a, b]) => a >= b),
    when: (s) => !s.includes("진분수"),
  },
  {
    // 「진분수와 가분수 알아보기」는 위 둘이 서로를 꺼서 **검사가 하나도 안 붙었다**.
    // 어느 쪽이든 좋지만 **분수는 있어야 한다** — 사각지대로 두지 않는다.
    needle: "진분수와 가분수",
    ok: (c) => fracs(c).length > 0,
  },
  {
    // 「대분수**의** 덧셈」·「**(대분수)**÷」는 대분수가 **피연산자**다.
    // 「대분수 알아보기」는 대분수가 **답** 쪽일 수 있어(가분수→대분수) 적용하지 않는다.
    needle: "대분수",
    ok: (c) => /\d+\s*\\frac\{/.test(c),
    when: (s) => /대분수의|\(대분수\)/.test(s),
  },
  {
    // 위 검사가 꺼지는 「대분수 알아보기」도 **사각지대로 두지 않는다** —
    // 대분수가 답 쪽이어도 발문에는 바꿀 분수가 있어야 한다.
    needle: "대분수 알아보기",
    ok: (c) => fracs(c).length > 0,
  },
  {
    needle: "세 자리 수",
    ok: (c) =>
      numbers(c).some((v) => Number.isInteger(v) && v >= 100 && v <= 999),
    when: notDecimalContext,
  },
  {
    needle: "두 자리 수",
    ok: (c) =>
      numbers(c).some((v) => Number.isInteger(v) && v >= 10 && v <= 99),
    when: notDecimalContext,
  },
  {
    needle: "한 자리 수",
    ok: (c) => numbers(c).some((v) => Number.isInteger(v) && v >= 1 && v <= 9),
    when: notDecimalContext,
  },
  // 소수 문맥에서의 「N 자리 수」 — 자릿수가 아니라 **소수점 아래 자리**로 읽는다.
  // 소단원이 나열한 자리 **가운데 하나**면 통과. 나열이 하나뿐이면 그 하나를 요구하므로
  // 「소수 한 자리 수의 덧셈」의 엄격함은 그대로다.
  {
    needle: "자리 수",
    ok: (c, s) => {
      const wanted = decimalPlacesWanted(s);
      return (
        wanted.length === 0 || decimalPlaces(c).some((d) => wanted.includes(d))
      );
    },
    when: decimalContext,
  },
  // ── 「(A)÷(B)」·「(A)×(B)」 피연산자 종류 (2026-08-22, 미판정이던 16개 소단원) ──
  // needle 이 실제로 닿는 소단원은 `scripts/qa` 에서 전수 열거로 확인했다 —
  // 「(분수)×(분수)」 는 일부러 안 만든다: 2-1-4 의 그 구절은 **답** 쪽 조건이라
  // 발문에 걸면 멀쩡한 소단원이 통째로 위반이 된다.
  { needle: "(분수)×(자연수)", ok: opShape("times", "분수", "자연수") },
  { needle: "(자연수)×(분수)", ok: opShape("times", "자연수", "분수") },
  { needle: "(자연수)÷(자연수)", ok: opShape("div", "자연수", "자연수") },
  { needle: "(분수)÷(자연수)", ok: opShape("div", "분수", "자연수") },
  { needle: "(소수)÷(자연수)", ok: opShape("div", "소수", "자연수") },
  { needle: "(분수)÷(분수)", ok: opShape("div", "분수", "분수") },
  { needle: "(자연수)÷(분수)", ok: opShape("div", "자연수", "분수") },
  { needle: "(소수)÷(소수)", ok: opShape("div", "소수", "소수") },
  { needle: "(자연수)÷(소수)", ok: opShape("div", "자연수", "소수") },
  {
    needle: "몫이 1보다 작은",
    ok: (c) => {
      const o = operandsOf(c, "div");
      return o !== null && o[0].value < o[1].value;
    },
  },
  {
    // 「0 을 내린다」 = 피제수의 소수 자리를 다 쓰고도 안 나누어떨어진다
    // — 곧 몫의 소수 자릿수가 피제수보다 깊다 (42.4÷5 = 8.48).
    needle: "소수점 아래 0을 내려",
    ok: (c) => {
      const o = operandsOf(c, "div");
      return o !== null && quotientDp(o[0].value / o[1].value) > o[0].dp;
    },
  },
  {
    needle: "몫의 소수 첫째 자리에 0",
    ok: (c) => {
      const o = operandsOf(c, "div");
      if (o === null) return false;
      const q = o[0].value / o[1].value;
      const dp = quotientDp(q);
      // 몫이 정수·한 자리(6.8)면 「첫째 자리의 0」 자체가 없다.
      return dp >= 2 && q.toFixed(dp).split(".")[1]![0] === "0";
    },
  },
  {
    needle: "자릿수가 같은",
    ok: (c) => {
      const o = operandsOf(c, "div");
      return o !== null && o[0].dp > 0 && o[0].dp === o[1].dp;
    },
  },
  {
    needle: "자릿수가 다른",
    ok: (c) => {
      const o = operandsOf(c, "div");
      return o !== null && o[0].dp > 0 && o[1].dp > 0 && o[0].dp !== o[1].dp;
    },
  },
  {
    // 초6 「분모가 같은 (분수)÷(분수)」만이 아니라 **초3 「분모가 같은 분수의 크기 비교」**도
    // 이 이름을 쓴다 — 거기엔 나눗셈이 없다. 그래서 식이 아니라 발문의 분수 **전부**를 본다.
    needle: "분모가 같은",
    ok: (c) => {
      const f = fracs(c);
      return f.length >= 2 && f.every(([, d]) => d === f[0]![1]);
    },
  },
  {
    needle: "분모가 다른",
    ok: (c) => {
      const f = fracs(c);
      return f.length >= 2 && f.some(([, d]) => d !== f[0]![1]);
    },
  },
];

/**
 * **일부러 걸리는 입력**으로 가드가 실제로 빨개지는지 본다.
 *
 * 0은 「깨끗하다」와 「못 센다」를 구분해 주지 않는다(CLAUDE.md 2026-08-21).
 * 그리고 눈금에는 **양성·음성 대조군이 둘 다** 있어야 한다 —
 * 걸려야 할 것만 대면 「지어냄」이 구조적으로 0이 된다(2026-08-20).
 *
 *   npx tsx scripts/qa/probe-elem-section-conditions.ts --selftest
 */
type Fixture = { section: string; content: string; want: boolean; why: string };
const FIXTURES: Fixture[] = [
  // ── 걸려야 하는 것 (양성) ─────────────────────────────────────────
  {
    section: "2-4-3 (자연수)×(1보다 작은 소수)의 계산",
    content: "$7\\times2.0$을 계산하시오.",
    want: false,
    why: "2.0 은 1보다 작지 않다 — 원장님 검수 밖에서 내가 찾은 그 결함",
  },
  {
    section: "2-3-4 소수 한 자리 수의 덧셈",
    content: "$3.14+2.71$을 계산하시오.",
    want: false,
    why: "두 자리다",
  },
  {
    section: "2-3-1 소수 두 자리 수, 세 자리 수 알아보기",
    content: "$0.5$에서 소수 첫째 자리 숫자를 쓰시오.",
    want: false,
    why: "나열한 자리(2·3) 어느 쪽도 아니다",
  },
  {
    section: "1-3-2 (세 자리 수)×(두 자리 수)의 계산",
    content: "$347\\times5$를 계산하시오.",
    want: false,
    why: "두 자리 수가 없다 — 괄호 피연산자는 **둘 다** 요구한다",
  },
  {
    section: "2-1-1 진분수 알아보기",
    content: "$\\frac{7}{3}$은 진분수인가?",
    want: false,
    why: "가분수다",
  },
  {
    section: "2-4-4 진분수와 가분수 알아보기",
    content: "다음 수는 진분수인가 가분수인가?  $7$",
    want: false,
    why: "어느 쪽이든 좋지만 **분수는 있어야** 한다",
  },
  {
    section: "2-1-3 대분수의 덧셈",
    content: "$\\frac{6}{7}+\\frac{2}{7}=\\square$",
    want: false,
    why: "대분수가 피연산자인데 진분수만 있다",
  },
  // ── 걸리면 안 되는 것 (음성) ──────────────────────────────────────
  {
    section: "2-3-1 소수 두 자리 수, 세 자리 수 알아보기",
    content: "$3.821$에서 소수 셋째 자리 숫자를 쓰시오.",
    want: true,
    why: "쉼표 나열 — 세 자리도 이 소단원이 가르친다(거짓 경보였던 자리)",
  },
  {
    section: "2-3-1 소수 두 자리 수, 세 자리 수 알아보기",
    content: "$0.01$이 $51$개인 수를 소수로 쓰시오.",
    want: true,
    why: "같은 소단원의 두 자리 쪽",
  },
  {
    section: "2-3-4 소수 한 자리 수의 덧셈",
    content: "$3.1+2.5$를 계산하시오.",
    want: true,
    why: "「한 자리」는 자릿수가 아니라 소수점 아래 자리다",
  },
  {
    section: "1-3-2 (세 자리 수)×(두 자리 수)의 계산",
    content: "$347\\times52$를 계산하시오.",
    want: true,
    why: "둘 다 있다",
  },
  {
    section: "2-4-4 진분수와 가분수 알아보기",
    content: "$\\frac{7}{3}$은 진분수인가 가분수인가?",
    want: true,
    why: "둘을 나란히 가르치는 소단원 — 어느 쪽이든 좋다",
  },
  {
    section: "2-4-5 대분수 알아보기",
    content: "다음 가분수를 대분수로 나타내시오.  $\\frac{27}{7}$",
    want: true,
    why: "여기서는 대분수가 **답** 쪽이다 — 발문에 없어도 옳다",
  },
  {
    section: "2-1-3 대분수의 덧셈",
    content: "$2\\frac{6}{7}+1\\frac{2}{7}=\\square$",
    want: true,
    why: "대분수가 피연산자로 있다",
  },
  // ── (A)÷(B) 피연산자 검사 (2026-08-22) — 걸려야 하는 것 ──────────────
  {
    section: "1-3-2 몫이 1보다 작은 (소수)÷(자연수) 알아보기",
    content: "몫을 구하시오.\n\n$3.2\\div2=\\square$",
    want: false,
    why: "몫 1.6 — 1보다 작지 않다",
  },
  {
    section: "1-3-3 소수점 아래 0을 내려 계산하는 (소수)÷(자연수) 알아보기",
    content: "몫을 구하시오.\n\n$9.5\\div5=\\square$",
    want: false,
    why: "몫 1.9 — 내릴 0 이 없다",
  },
  {
    section: "1-3-4 몫의 소수 첫째 자리에 0이 있는 (소수)÷(자연수) 알아보기",
    content: "몫을 구하시오.\n\n$27.2\\div4=\\square$",
    want: false,
    why: "몫 6.8 — 첫째 자리가 8 이다",
  },
  {
    section: "2-2-1 자릿수가 같은 (소수)÷(소수) 알아보기",
    content: "몫을 구하시오.\n\n$15.47\\div3.5=\\square$",
    want: false,
    why: "두 자리 ÷ 한 자리 — 자릿수가 다르다",
  },
  {
    section: "2-1-1 분모가 같은 (분수)÷(분수) 알아보기",
    content: "다음을 계산하시오.\n\n$\\frac{1}{4}\\div\\frac{1}{6}=\\square$",
    want: false,
    why: "분모 4 ≠ 6",
  },
  {
    section: "2-2-1 (분수)×(자연수)의 계산",
    content: "$6\\times\\frac{3}{4}=\\square$",
    want: false,
    why: "차례가 뒤집혔다 — (자연수)×(분수)다",
  },
  {
    section: "1-3-1 (소수)÷(자연수) 알아보기",
    content: "몫을 구하시오.\n\n$12\\div4=\\square$",
    want: false,
    why: "피제수에 소수가 없다",
  },
  // ── (A)÷(B) 피연산자 검사 — 걸리면 안 되는 것 ────────────────────────
  {
    section: "1-3-2 몫이 1보다 작은 (소수)÷(자연수) 알아보기",
    content: "몫을 구하시오.\n\n$1.2\\div6=\\square$",
    want: true,
    why: "몫 0.2",
  },
  {
    section: "1-3-3 소수점 아래 0을 내려 계산하는 (소수)÷(자연수) 알아보기",
    content: "몫을 구하시오.\n\n$8.7\\div2=\\square$",
    want: true,
    why: "몫 4.35 — 0 을 한 번 내린다",
  },
  {
    section: "1-3-4 몫의 소수 첫째 자리에 0이 있는 (소수)÷(자연수) 알아보기",
    content: "몫을 구하시오.\n\n$25.4\\div5=\\square$",
    want: true,
    why: "몫 5.08",
  },
  {
    section: "2-2-2 자릿수가 다른 (소수)÷(소수) 알아보기",
    content: "몫을 구하시오.\n\n$15.47\\div3.5=\\square$",
    want: true,
    why: "두 자리 ÷ 한 자리",
  },
  {
    section: "1-6-4 분모가 같은 분수의 크기 비교",
    content:
      "다음 두 분수 중 더 큰 분수를 쓰시오.\n\n$\\frac{2}{7}$,  $\\frac{5}{7}$",
    want: true,
    why: "나눗셈이 없어도 분모가 같으면 통과 — 초3 비교 소단원",
  },
  {
    section: "2-1-4 (분수)÷(분수)를 (분수)×(분수)로 나타내기",
    content:
      "다음 나눗셈식을 곱셈식으로 나타내시오.\n\n$\\frac{2}{3}\\div\\frac{5}{6}$",
    want: true,
    why: "「×(분수)」 구절은 답 쪽 조건이다 — 발문에는 나눗셈식만 있어도 옳다",
  },
];

/**
 * 소단원 이름은 **대안의 나열**이다 — 쉼표로 갈린다.
 *
 * 「(가분수)÷(분수)**,** (대분수)÷(분수)」는 **어느 쪽이든** 좋고,
 * 한 대안 안의 괄호 피연산자 「(세 자리 수)×(한 자리 수)」는 **둘 다** 있어야 한다.
 * 조건을 하나도 안 걸치는 대안(「받아올림이 없는」)은 **세지 않는다** —
 * 안 그러면 그 대안이 늘 참이라 소단원이 통째로 사각지대가 된다.
 *
 * ⚠️ 「소수」는 **소단원 전체**의 문맥이다. 쉼표 뒤 「세 자리 수」에도 걸린다
 * (「소수 두 자리 수, 세 자리 수」의 뒤쪽은 「소수」가 생략된 것이다).
 * 이걸 대안 단위로 읽으면 3자리 **정수**를 요구하게 된다.
 */
function verdict(
  content: string,
  section: string,
): { kind: "통과" | "위반" | "미판정"; needles: string[] } {
  const seen: string[] = [];
  for (const alt of section.split(/\s*,\s*/)) {
    const checks = CHECKS.filter(
      (c) => alt.includes(c.needle) && (c.when?.(section) ?? true),
    );
    if (checks.length === 0) continue;
    seen.push(...checks.map((c) => c.needle));
    if (checks.every((c) => c.ok(content, alt)))
      return { kind: "통과", needles: seen };
  }
  return { kind: seen.length > 0 ? "위반" : "미판정", needles: seen };
}

if (process.argv.includes("--selftest")) {
  let failed = 0;
  for (const f of FIXTURES) {
    const v = verdict(f.content, f.section);
    if (v.kind === "미판정") {
      console.log(`  ❌ 검사가 아예 안 붙는다 — ${f.section}`);
      failed += 1;
      continue;
    }
    const got = v.kind === "통과";
    const mark = got === f.want ? "✅" : "❌";
    if (got !== f.want) failed += 1;
    console.log(
      `  ${mark} ${f.want ? "통과해야" : "걸려야"} — ${f.why}\n       ${f.section}\n       ${f.content}`,
    );
  }
  // 개수를 손으로 적으면 fixture 를 늘릴 때마다 거짓말이 된다 — 세어서 찍는다.
  const positives = FIXTURES.filter((f) => !f.want).length;
  console.log(
    failed === 0
      ? `\n✅ 눈금 ${FIXTURES.length}건 전부 맞다 (양성 ${positives} · 음성 ${FIXTURES.length - positives})`
      : `\n❌ 눈금 ${failed}건 어긋남 — **가드를 믿을 수 없다**`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

const gradeArg = process.argv.slice(2).find((a) => a.startsWith("초"));
const units = elementaryUnits().filter(
  (u) => !gradeArg || u.grade === gradeArg,
);

const broken: string[] = [];
const unjudged: string[] = [];
let checked = 0;

for (const unit of units) {
  const verdicts = SEEDS.map((s) => ({
    seed: s,
    v: verdict(generateElementaryProblem(unit, s).content, unit.section),
  }));
  if (verdicts.every((x) => x.v.kind === "미판정")) {
    // 조건어가 괄호 안에 있는데 우리 목록에 없는 것만 «미판정» 으로 센다.
    if (/\([^)]*(?:수|분수)\)/.test(unit.section)) {
      unjudged.push(`${unit.grade} ${unit.section}`);
    }
    continue;
  }
  checked += 1;
  const bad = verdicts.filter((x) => x.v.kind === "위반");
  if (bad.length > 0) {
    const sample = generateElementaryProblem(
      unit,
      bad[0]!.seed,
    ).content.replace(/\n/g, " ");
    const needles = [...new Set(bad.flatMap((x) => x.v.needles))].join(" · ");
    broken.push(
      `${unit.grade} ${unit.section}\n      조건 「${needles}」 · 씨앗 ${bad.length}/${SEEDS.length} 위반\n      예: ${sample}`,
    );
  }
}

console.log(
  `조건이 있는 소단원 ${checked}${gradeArg ? ` (${gradeArg})` : ""}\n`,
);
if (broken.length === 0) {
  console.log("✅ 조건 위반 0");
} else {
  console.log(`❌ 조건 위반 ${broken.length}건`);
  for (const b of broken) console.log(`  · ${b}`);
}
if (unjudged.length > 0) {
  console.log(
    `\n⚠️ 미판정 ${unjudged.length}건 — 조건어가 있는데 우리 목록에 없다. 눈으로 볼 것:`,
  );
  for (const u of unjudged) console.log(`  · ${u}`);
}
process.exitCode = broken.length === 0 ? 0 : 1;
