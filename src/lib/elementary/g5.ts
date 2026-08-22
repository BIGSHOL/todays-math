/**
 * 초5 생성기.
 *
 * 표기는 `format.ts` 한 곳을 거친다 — R1(모든 수는 KaTeX) · R2(분수 답은 대분수) ·
 * R4(도형 이름은 한자 수사). 소재·도형은 씨앗으로 갈린다(R9).
 *
 * 그리고 **소단원 이름이 내건 조건을 생성기가 실제로 지킨다.** 「(자연수)×(1보다 작은 소수)」가
 * `7×2.0` 을 내던 자리가 그것이다(2026-08-22 원장님 검수). 이름이 조건인 소단원은
 * 갈래가 하나도 안 맞으면 **던진다** — 조용히 엉뚱한 꼴을 내면 아무도 모른다.
 */
import type { UnitSeed } from "../../../prisma/seed-data/units";

import { decLatex, expr, fracLatex, n, polyName } from "./format";
import { fracSpec } from "./fracFig";
import { fig, make } from "./make";
import { addFrac, divisors, gcd, lcm, simplify, subFrac } from "./math";
import { intBetween, pick } from "./rng";
import type { ChapterHandler, ElemProblem, Rng } from "./types";

/* ────────────────────────────── 지역 헬퍼 ────────────────────────────── */

/**
 * 정수 스케일로 계산한 소수를 표기로. 부동소수점을 지면에 흘리지 않는다 —
 * `dec(42, 1)` → `"4.2"`, `dec(360, 1)` → `"36"`. 딱 떨어지지 않으면 `decLatex` 가 던진다.
 */
function dec(scaled: number, digits: number): string {
  let value = scaled;
  let d = digits;
  while (d > 0 && value % 10 === 0) {
    value /= 10;
    d -= 1;
  }
  return decLatex(value / 10 ** d, d);
}

/** 수 여러 개를 **한 덩어리** KaTeX 로. 숫자마다 따로 감싸면 지면에서 띄어쓰기가 깨진다. */
function nums(values: readonly (number | string)[]): string {
  return expr(values.join(",\\ "));
}

/** 씨앗으로 섞는다. 「늘 같은 도형」을 막는 것은 취향이 아니라 제품 요구다(원장님, 2026-08-22). */
function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = intBetween(rng, 0, i);
    const swap = out[i]!;
    out[i] = out[j]!;
    out[j] = swap;
  }
  return out;
}

/** 서로 다른 것 `count` 개. */
function pickSome<T>(rng: Rng, items: readonly T[], count: number): T[] {
  return shuffled(rng, items).slice(0, count);
}

/** 대분수 표기 — `2\frac{1}{3}`. 자연수부는 `1` 이상만 넘긴다. */
function mixedLatex(whole: number, num: number, den: number): string {
  return `${whole}\\frac{${num}}{${den}}`;
}

/**
 * **기약** 진분수 하나. 발문에 `\frac{3}{6}` 같은 약분 안 된 분수를 내면 교재답지 않고,
 * 두 분수를 뽑을 때 값이 우연히 같아진다(`\frac12` 과 `\frac24` 를 통분하라는 문항이 나왔다).
 * 분모가 다르고 둘 다 기약이면 두 값은 절대 같지 않다.
 */
function properFrac(rng: Rng, dens: readonly number[]): [number, number] {
  const den = pick(rng, dens);
  const tops: number[] = [];
  for (let i = 1; i < den; i += 1) if (gcd(i, den) === 1) tops.push(i);
  return [pick(rng, tops), den];
}

const LABELS = ["가", "나", "다", "라", "마"] as const;

/* ── 조사 ──
 * 수 뒤 조사는 **그 수를 읽은 소리**가 정한다. `11` 은 「일」이라 받침이 있어 `11은` 이고
 * `55` 는 「오」라 `55는` 이다. 손으로 「는」을 박아 두면 지면에 「11는」·「8를」·「28와」가
 * 그대로 나간다 — 원장님이 종이에서 보실 자리다. 마지막 자리 숫자 하나면 정해진다.
 */

/** 영·일·삼·육·칠·팔 은 받침이 있다. `0` 으로 끝나면 십·백·천·만 이라 역시 받침이 있다. */
const FINAL_DIGITS = new Set([0, 1, 3, 6, 7, 8]);
/** 일·칠·팔 은 **ㄹ 받침**이라 `으로` 가 아니라 `로` 를 쓴다. */
const RIEUL_DIGITS = new Set([1, 7, 8]);

function lastDigit(value: number | string): number {
  const digits = String(value).replace(/\D/g, "");
  return Number(digits[digits.length - 1] ?? "0");
}

/** KaTeX 로 감싼 수 + 알맞은 조사. `nj(11, "은", "는")` → `$11$은`. */
function nj(value: number, withFinal: string, without: string): string {
  return `${n(value)}${FINAL_DIGITS.has(lastDigit(value)) ? withFinal : without}`;
}

/** `(으)로`. `nro(10)` → `$10$으로`, `nro(8)` → `$8$로`(ㄹ 받침). */
function nro(value: number): string {
  const d = lastDigit(value);
  return `${n(value)}${FINAL_DIGITS.has(d) && !RIEUL_DIGITS.has(d) ? "으로" : "로"}`;
}

/** 낱말 뒤 조사. `wj("손가락", "이", "가")` → `손가락이`. */
function wj(word: string, withFinal: string, without: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const hasFinal = code >= 0 && code <= 11171 && code % 28 !== 0;
  return `${word}${hasFinal ? withFinal : without}`;
}

/* ────────────────────────────── 1-1 자연수의 혼합 계산 ────────────────────────────── */

function mixedCalc(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;

  // 1-1-1 「덧셈과 뺄셈」 또는 「곱셈과 나눗셈」 — 두 갈래를 씨앗으로 고른다.
  if (s.includes("덧셈과 뺄셈 /")) {
    if (intBetween(rng, 0, 1) === 0) {
      const a = intBetween(rng, 40, 90);
      const b = intBetween(rng, 10, 25);
      const c = intBetween(rng, 5, 20);
      return make(
        unit,
        expr(`${a}-(${b}+${c})=\\square`),
        n(a - b - c),
        `괄호 안을 먼저 계산합니다. ${expr(`${b}+${c}=${b + c}`)}이므로 ${expr(`${a}-${b + c}=${a - b - c}`)}입니다.`,
      );
    }
    const a = intBetween(rng, 3, 9);
    const b = intBetween(rng, 4, 9);
    // `a` 자신이 언제나 후보라 비지 않는다(`b >= 4` 이므로 `a !== a*b`).
    const c = pick(
      rng,
      [2, 3, 4, 5, 6, 7, 8, 9].filter((k) => k !== a * b && (a * b) % k === 0),
    );
    return make(
      unit,
      expr(`${a}\\times${b}\\div${c}=\\square`),
      n((a * b) / c),
      `곱셈과 나눗셈만 있으면 앞에서부터 계산합니다. ${expr(`${a}\\times${b}=${a * b}`)}, ${expr(`${a * b}\\div${c}=${(a * b) / c}`)}입니다.`,
    );
  }

  // 1-1-2 「덧셈, 뺄셈, 곱셈(나눗셈)」 — +, -, 그리고 ×(또는 ÷)가 **모두** 있어야 한다.
  if (s.includes("곱셈(나눗셈)")) {
    if (intBetween(rng, 0, 1) === 0) {
      const a = intBetween(rng, 20, 50);
      const b = intBetween(rng, 3, 9);
      const c = intBetween(rng, 2, 6);
      const d = intBetween(rng, 4, 15);
      return make(
        unit,
        expr(`${a}+${b}\\times${c}-${d}=\\square`),
        n(a + b * c - d),
        `곱셈을 먼저 계산합니다. ${expr(`${b}\\times${c}=${b * c}`)}이므로 ${expr(`${a}+${b * c}-${d}=${a + b * c - d}`)}입니다.`,
      );
    }
    const c = intBetween(rng, 2, 9);
    const q = intBetween(rng, 2, 9);
    const b = c * q;
    const a = intBetween(rng, 30, 70);
    const d = intBetween(rng, 5, 20);
    return make(
      unit,
      expr(`${a}-${b}\\div${c}+${d}=\\square`),
      n(a - q + d),
      `나눗셈을 먼저 계산합니다. ${expr(`${b}\\div${c}=${q}`)}이므로 ${expr(`${a}-${q}+${d}=${a - q + d}`)}입니다.`,
    );
  }

  // 1-1-3 「덧셈, 뺄셈, 곱셈, 나눗셈」 — 네 연산이 **모두** 있어야 한다.
  const b = intBetween(rng, 3, 9);
  const c = intBetween(rng, 2, 6);
  const e = intBetween(rng, 2, 6);
  const q = intBetween(rng, 2, 8);
  const d = e * q;
  const a = intBetween(rng, 20, 60);
  if (intBetween(rng, 0, 1) === 0) {
    return make(
      unit,
      expr(`${a}+${b}\\times${c}-${d}\\div${e}=\\square`),
      n(a + b * c - q),
      `곱셈과 나눗셈을 먼저 계산합니다. ${expr(`${b}\\times${c}=${b * c}`)}, ${expr(`${d}\\div${e}=${q}`)}이므로 ${expr(`${a}+${b * c}-${q}=${a + b * c - q}`)}입니다.`,
    );
  }
  // 괄호가 있으면 괄호 안을 먼저. 나누어떨어지게 `a-f` 를 `e` 의 배수로 만든다.
  // `a` 는 `20` 이상이고 `e` 는 `6` 이하라 몫의 최댓값은 언제나 `3` 이상이다.
  const p = intBetween(rng, 2, Math.floor((a - 1) / e));
  const inner = e * p;
  const f = a - inner;
  return make(
    unit,
    expr(`(${a}-${f})\\div${e}+${b}\\times${c}=\\square`),
    n(inner / e + b * c),
    `괄호 안을 먼저 계산합니다. ${expr(`${a}-${f}=${inner}`)}, ${expr(`${inner}\\div${e}=${inner / e}`)}, ${expr(`${b}\\times${c}=${b * c}`)}이므로 ${expr(`${inner / e}+${b * c}=${inner / e + b * c}`)}입니다.`,
  );
}

/* ────────────────────────────── 1-2 약수와 배수 ────────────────────────────── */

const FACTOR_NUMBERS = [
  12, 16, 18, 20, 24, 28, 30, 32, 36, 40, 42, 45,
] as const;

function factor(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;

  // 1-2-2 약수와 배수의 관계 — 곱셈식 하나에서 「배수」와 「약수」를 함께 읽는다.
  if (s.includes("관계")) {
    const a = intBetween(rng, 3, 12);
    const b = intBetween(rng, 3, 9);
    const c = a * b;
    if (intBetween(rng, 0, 1) === 0) {
      return make(
        unit,
        `${expr(`${a}\\times${b}=${c}`)}입니다. ${nj(c, "은", "는")} ${n(a)}의 □이고, ${nj(a, "은", "는")} ${n(c)}의 □입니다. □에 알맞은 말을 차례로 쓰시오.`,
        "배수, 약수",
        `${expr(`${a}\\times${b}=${c}`)}이므로 ${nj(c, "은", "는")} ${n(a)}의 배수이고, ${nj(a, "은", "는")} ${nj(c, "을", "를")} 나누어떨어지게 하므로 ${n(c)}의 약수입니다.`,
      );
    }
    return make(
      unit,
      `${nj(a, "은", "는")} ${n(c)}의 약수입니다. 그러면 ${nj(c, "은", "는")} ${n(a)}의 무엇인지 쓰시오.`,
      "배수",
      `${nj(c, "은", "는")} ${nro(a)} 나누어떨어집니다. ${expr(`${c}\\div${a}=${b}`)}이므로 ${nj(a, "이", "가")} ${n(c)}의 약수이면 ${nj(c, "은", "는")} ${n(a)}의 배수입니다.`,
    );
  }

  // 1-2-3 공약수와 최대공약수 — 공약수를 **모두** 본다(최대공약수만 묻는 1-2-4 와 다르다).
  if (s.includes("공약수와 최대공약수")) {
    const a = pick(rng, FACTOR_NUMBERS);
    // 공약수가 `1` 뿐이면 물을 것이 없다 — 서로소인 짝은 뺀다.
    const b = pick(
      rng,
      FACTOR_NUMBERS.filter((x) => x !== a && gcd(a, x) > 1),
    );
    const common = divisors(gcd(a, b));
    if (intBetween(rng, 0, 1) === 0) {
      return make(
        unit,
        `${nj(a, "과", "와")} ${n(b)}의 공약수를 모두 구하시오.`,
        nums(common),
        `${nj(gcd(a, b), "이", "가")} 두 수의 최대공약수이고, 공약수는 최대공약수의 약수인 ${nums(common)}입니다.`,
      );
    }
    return make(
      unit,
      `${nj(a, "과", "와")} ${n(b)}의 공약수는 모두 몇 개인가?`,
      n(common.length),
      `공약수는 ${nums(common)}이므로 ${n(common.length)}개입니다.`,
    );
  }

  // 1-2-4 최대공약수 구하는 방법
  if (s.includes("최대공약수")) {
    const a = pick(rng, FACTOR_NUMBERS);
    const b = pick(
      rng,
      FACTOR_NUMBERS.filter((x) => x !== a && gcd(a, x) > 1),
    );
    const g = gcd(a, b);
    return make(
      unit,
      `${nj(a, "과", "와")} ${n(b)}의 최대공약수를 구하시오.`,
      n(g),
      `${n(a)}의 약수는 ${nums(divisors(a))}입니다. ${n(b)}의 약수는 ${nums(divisors(b))}입니다. 두 수의 공약수 중 가장 큰 수는 ${n(g)}입니다.`,
    );
  }

  // 1-2-5 공배수와 최소공배수 — 공배수를 **여러 개** 본다(최소공배수만 묻는 1-2-6 과 다르다).
  if (s.includes("공배수와 최소공배수")) {
    const a = intBetween(rng, 3, 9);
    const b = pick(
      rng,
      [4, 6, 8, 9, 10, 12].filter((x) => x !== a),
    );
    const m = lcm(a, b);
    if (intBetween(rng, 0, 1) === 0) {
      return make(
        unit,
        `${nj(a, "과", "와")} ${n(b)}의 공배수 중에서 두 번째로 작은 수를 구하시오.`,
        n(2 * m),
        `공배수는 최소공배수 ${n(m)}의 배수이므로 ${nums([m, 2 * m, 3 * m])}입니다. 두 번째로 작은 수는 ${n(2 * m)}입니다.`,
      );
    }
    return make(
      unit,
      `${nj(a, "과", "와")} ${n(b)}의 공배수를 가장 작은 수부터 ${n(3)}개 쓰시오.`,
      nums([m, 2 * m, 3 * m]),
      `최소공배수가 ${n(m)}이므로 공배수는 ${n(m)}의 배수인 ${nums([m, 2 * m, 3 * m])}입니다.`,
    );
  }

  // 1-2-6 최소공배수 구하는 방법
  if (s.includes("최소공배수")) {
    // 서로소면 해설이 「최대공약수가 $1$이므로 … ÷1」이 되어 방법을 보여 주지 못한다.
    // `a` 도 짝이 반드시 남는 수에서만 뽑는다 — `11` 은 뒤 목록 전부와 서로소라 후보가 빈다.
    const a = pick(rng, [4, 6, 8, 9, 10, 12]);
    const b = pick(
      rng,
      [6, 8, 9, 10, 14, 15, 18].filter((x) => x !== a && gcd(a, x) > 1),
    );
    const m = lcm(a, b);
    return make(
      unit,
      `${nj(a, "과", "와")} ${n(b)}의 최소공배수를 구하시오.`,
      n(m),
      `최대공약수가 ${n(gcd(a, b))}이므로 최소공배수는 ${expr(`${a}\\times${b}\\div${gcd(a, b)}=${m}`)}입니다.`,
    );
  }

  // 1-2-1 약수와 배수
  const num = pick(rng, FACTOR_NUMBERS);
  const roll = intBetween(rng, 0, 2);
  if (roll === 0) {
    return make(
      unit,
      `${n(num)}의 약수를 모두 구하시오.`,
      nums(divisors(num)),
      `${nj(num, "을", "를")} 나누어떨어지게 하는 수는 ${nums(divisors(num))}입니다.`,
    );
  }
  if (roll === 1) {
    return make(
      unit,
      `${n(num)}의 약수는 모두 몇 개인가?`,
      n(divisors(num).length),
      `약수는 ${nums(divisors(num))}이므로 ${n(divisors(num).length)}개입니다.`,
    );
  }
  const base = intBetween(rng, 3, 12);
  return make(
    unit,
    `${n(base)}의 배수를 가장 작은 수부터 ${n(4)}개 쓰시오.`,
    nums([base, base * 2, base * 3, base * 4]),
    `${n(base)}에 ${nums([1, 2, 3, 4])}를 차례로 곱하면 ${nums([base, base * 2, base * 3, base * 4])}입니다.`,
  );
}

/* ────────────────────────────── 1-3 대응 관계 ────────────────────────────── */

/** 생활 속 대응 — (물건, 딸린 것, 한 개당 수). 소재가 하나로 굳지 않게 풀에서 뽑는다. */
const LIFE_PAIRS = [
  ["자동차", "바퀴", 4],
  ["세발자전거", "바퀴", 3],
  ["오리", "다리", 2],
  ["의자", "다리", 4],
  ["삼각형", "변", 3],
  ["문어", "다리", 8],
  ["장갑", "손가락", 5],
  ["상자", "사탕", 6],
] as const;

function correspond(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const k = intBetween(rng, 2, 8);

  // 1-3-3 생활 속에서 찾아 **식으로** 나타내기
  if (s.includes("생활 속")) {
    const [thing, part, per] = pick(rng, LIFE_PAIRS);
    return make(
      unit,
      `${thing} ${n(1)}개에 ${wj(part, "이", "가")} ${n(per)}개 있습니다. ${thing}의 수를 ${expr("x")}, ${part}의 수를 ${expr("y")}라고 할 때 두 양 사이의 대응 관계를 식으로 나타내시오.`,
      expr(`y=${per}\\times x`),
      `${wj(thing, "이", "가")} ${n(1)}개 늘어날 때마다 ${wj(part, "은", "는")} ${n(per)}개씩 늘어나므로 ${expr(`y=${per}\\times x`)}입니다.`,
    );
  }

  // 1-3-2 대응 관계를 **식으로** 나타내기 — 표를 읽고 식을 쓴다.
  // 표가 어디서 시작하는지를 발문이 말하므로 씨앗마다 발문이 갈린다(R9).
  if (s.includes("식으로")) {
    const from = intBetween(rng, 1, 9);
    const xs = [from, from + 1, from + 2];
    const ask = `표는 ${expr("x")}가 ${n(from)}부터 ${n(1)}씩 커질 때의 ${expr("y")}를 나타낸 것입니다. ${expr("x")}와 ${expr("y")} 사이의 대응 관계를 식으로 나타내시오.`;
    if (intBetween(rng, 0, 1) === 0) {
      const c = intBetween(rng, 3, 12);
      return make(
        unit,
        ask,
        expr(`y=x+${c}`),
        `${expr("y")}는 언제나 ${expr("x")}보다 ${n(c)}만큼 큽니다.`,
        fig("table", {
          headers: ["x", "y"],
          rows: xs.map((x) => [String(x), String(x + c)]),
        }),
      );
    }
    return make(
      unit,
      ask,
      expr(`y=${k}\\times x`),
      `${expr("y")}는 언제나 ${expr("x")}의 ${n(k)}배입니다.`,
      fig("table", {
        headers: ["x", "y"],
        rows: xs.map((x) => [String(x), String(x * k)]),
      }),
    );
  }

  // 1-3-1 두 양 사이의 대응 관계 — 표에서 빈칸의 값을 찾는다.
  const x = intBetween(rng, 5, 12);
  return make(
    unit,
    `표를 보고 ${expr(`x=${x}`)}일 때 ${expr("y")}의 값을 구하시오.`,
    n(k * x),
    `${expr("y")}는 ${expr("x")}의 ${n(k)}배이므로 ${expr(`${k}\\times${x}=${k * x}`)}입니다.`,
    fig("table", {
      headers: ["x", "y"],
      rows: [
        ["1", String(k)],
        ["2", String(2 * k)],
        ["3", String(3 * k)],
        [String(x), ""],
      ],
    }),
  );
}

/* ────────────────────────────── 1-4 약분과 통분 ────────────────────────────── */

const EQ_FRAC_PAIRS = [
  [1, 2],
  [1, 3],
  [2, 3],
  [1, 4],
  [3, 4],
  [1, 5],
  [2, 5],
  [3, 5],
  [4, 5],
] as const;

/** 소수로 딱 떨어지는 분수 — 「분수와 소수의 크기 비교」에 쓴다. 값은 천분의 일 정수로 잰다. */
const FRAC_DEC_PAIRS = [
  [1, 2, 500],
  [1, 4, 250],
  [3, 4, 750],
  [1, 5, 200],
  [2, 5, 400],
  [3, 5, 600],
  [4, 5, 800],
  [1, 8, 125],
  [3, 8, 375],
  [7, 10, 700],
  [3, 20, 150],
] as const;

function reduce(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;

  // 1-4-5 분수와 소수의 크기 비교
  if (s.includes("소수")) {
    const [fn, fd, milli] = pick(rng, FRAC_DEC_PAIRS);
    const decMilli = pick(
      rng,
      [
        100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 650, 700, 750, 800,
        850,
      ].filter((v) => v !== milli),
    );
    const decText = dec(decMilli, 3);
    const fracText = expr(`\\frac{${fn}}{${fd}}`);
    const bigger = milli > decMilli ? fracText : expr(decText);
    return make(
      unit,
      `${fracText}과 ${expr(decText)} 중 더 큰 수를 쓰시오.`,
      bigger,
      `${expr(`\\frac{${fn}}{${fd}}=${dec(milli, 3)}`)}이고 ${expr(`${dec(milli, 3)}${milli > decMilli ? ">" : "<"}${decText}`)}입니다.`,
    );
  }

  // 1-4-1 크기가 같은 분수 — 분모와 분자에 **같은 수를 곱한다**.
  if (s.includes("크기가 같은")) {
    const [sn, sd] = pick(rng, EQ_FRAC_PAIRS);
    const g = pick(
      rng,
      [2, 3, 4].filter((x) => sd * x <= 12),
    );
    return make(
      unit,
      `그림에서 색칠한 부분은 ${expr(`\\frac{${sn}}{${sd}}`)}입니다. 분모와 분자에 각각 ${nj(g, "을", "를")} 곱하여 크기가 같은 분수를 구하시오.`,
      expr(`\\frac{${sn * g}}{${sd * g}}`),
      `분모와 분자에 같은 수를 곱해도 크기는 변하지 않습니다. ${expr(`\\frac{${sn}}{${sd}}=\\frac{${sn * g}}{${sd * g}}`)}입니다.`,
      fracSpec(rng, sd, sn),
    );
  }

  // 1-4-2 분수를 간단하게 나타내기 — 그림 없이 약분한다.
  if (s.includes("간단하게")) {
    const g = pick(rng, [2, 3, 4, 5, 6]);
    const sn = intBetween(rng, 2, 5);
    const sd = intBetween(rng, sn + 1, 9);
    const [rn, rd] = simplify(sn * g, sd * g);
    return make(
      unit,
      `${expr(`\\frac{${sn * g}}{${sd * g}}`)}를 기약분수로 나타내시오.`,
      expr(`\\frac{${rn}}{${rd}}`),
      `${nj(sn * g, "과", "와")} ${n(sd * g)}의 최대공약수 ${nro(gcd(sn * g, sd * g))} 분모와 분자를 나눕니다.`,
    );
  }

  // 1-4-3 통분 — 답은 **통분된 두 분수**다.
  // 분모가 다르고 둘 다 기약이면 두 분수는 절대 같아질 수 없다. 그냥 뽑으면
  // `1/2` 과 `2/4` 처럼 **같은 수 둘을 통분하라**는 문항이 나온다.
  if (s.includes("통분")) {
    const [a, d1] = properFrac(rng, [2, 3, 4, 6]);
    const [b, d2] = properFrac(
      rng,
      [3, 4, 5, 6, 8, 9].filter((x) => x !== d1),
    );
    const L = lcm(d1, d2);
    return make(
      unit,
      `${expr(`\\frac{${a}}{${d1}}`)}과 ${expr(`\\frac{${b}}{${d2}}`)}를 통분하시오.`,
      nums([`\\frac{${(a * L) / d1}}{${L}}`, `\\frac{${(b * L) / d2}}{${L}}`]),
      `두 분모의 최소공배수 ${nj(L, "을", "를")} 공통분모로 삼습니다. ${expr(`\\frac{${a}}{${d1}}=\\frac{${(a * L) / d1}}{${L}}`)}, ${expr(`\\frac{${b}}{${d2}}=\\frac{${(b * L) / d2}}{${L}}`)}입니다.`,
    );
  }

  // 1-4-4 분수의 크기 비교
  const [a, d1] = properFrac(rng, [3, 4, 5, 6]);
  const [b, d2] = properFrac(
    rng,
    [4, 6, 8, 9, 10].filter((x) => x !== d1),
  );
  const L = lcm(d1, d2);
  const leftBig = a * d2 > b * d1;
  return make(
    unit,
    `${expr(`\\frac{${a}}{${d1}}`)}과 ${expr(`\\frac{${b}}{${d2}}`)} 중 더 큰 분수를 쓰시오.`,
    leftBig ? expr(`\\frac{${a}}{${d1}}`) : expr(`\\frac{${b}}{${d2}}`),
    `${nro(L)} 통분하면 ${expr(`\\frac{${(a * L) / d1}}{${L}}`)}과 ${expr(`\\frac{${(b * L) / d2}}{${L}}`)}이므로 분자가 큰 쪽이 더 큽니다.`,
  );
}

/* ────────────────────────────── 1-5 분수의 덧셈과 뺄셈 ────────────────────────────── */

const FRAC_DENS = [3, 4, 5, 6, 8, 9, 10] as const;

function fracAddSub(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const [a, d1] = properFrac(rng, FRAC_DENS);
  const [b, d2] = properFrac(
    rng,
    FRAC_DENS.filter((x) => x !== d1),
  );
  const L = lcm(d1, d2);
  const a2 = (a * L) / d1;
  const b2 = (b * L) / d2;

  // 1-5-2 대분수의 덧셈
  if (s.includes("대분수의 덧셈")) {
    const w1 = intBetween(rng, 1, 4);
    const w2 = intBetween(rng, 1, 4);
    const [num, den] = addFrac(w1 * d1 + a, d1, w2 * d2 + b, d2);
    return make(
      unit,
      expr(`${mixedLatex(w1, a, d1)}+${mixedLatex(w2, b, d2)}=\\square`),
      expr(fracLatex(num, den)),
      `자연수는 자연수끼리, 분수는 ${nro(L)} 통분해 더합니다. ${expr(`${w1}+${w2}=${w1 + w2}`)}이고 ${expr(`\\frac{${a2}}{${L}}+\\frac{${b2}}{${L}}=\\frac{${a2 + b2}}{${L}}`)}이므로 답은 ${expr(fracLatex(num, den))}입니다.`,
    );
  }

  // 1-5-4 대분수의 뺄셈 — 자연수부를 벌려 두어 결과가 반드시 양수다.
  if (s.includes("대분수의 뺄셈")) {
    const w1 = intBetween(rng, 3, 6);
    const w2 = intBetween(rng, 1, w1 - 2);
    const [num, den] = subFrac(w1 * d1 + a, d1, w2 * d2 + b, d2);
    return make(
      unit,
      expr(`${mixedLatex(w1, a, d1)}-${mixedLatex(w2, b, d2)}=\\square`),
      expr(fracLatex(num, den)),
      `${nro(L)} 통분한 뒤 자연수는 자연수끼리, 분수는 분수끼리 뺍니다. 분수 부분을 뺄 수 없으면 자연수에서 ${n(1)}을 받아내립니다. 답은 ${expr(fracLatex(num, den))}입니다.`,
    );
  }

  // 1-5-3 진분수의 뺄셈 — 두 분수 **모두 진분수**이고 큰 것에서 작은 것을 뺀다.
  // 분모가 다르고 둘 다 기약이라 두 값이 같아지는 일은 없다 — 자리만 바꾸면 결과가 양수다.
  if (s.includes("뺄셈")) {
    const bigLeft = a * d2 > b * d1;
    const [pn, pd, p2] = bigLeft ? [a, d1, a2] : [b, d2, b2];
    const [qn, qd, q2] = bigLeft ? [b, d2, b2] : [a, d1, a2];
    const [num, den] = subFrac(pn, pd, qn, qd);
    return make(
      unit,
      expr(`\\frac{${pn}}{${pd}}-\\frac{${qn}}{${qd}}=\\square`),
      expr(fracLatex(num, den)),
      `${nro(L)} 통분하면 ${expr(`\\frac{${p2}}{${L}}-\\frac{${q2}}{${L}}=\\frac{${p2 - q2}}{${L}}`)}입니다.`,
    );
  }

  // 1-5-1 진분수의 덧셈
  const [num, den] = addFrac(a, d1, b, d2);
  return make(
    unit,
    expr(`\\frac{${a}}{${d1}}+\\frac{${b}}{${d2}}=\\square`),
    expr(fracLatex(num, den)),
    `${nro(L)} 통분하면 ${expr(`\\frac{${a2}}{${L}}+\\frac{${b2}}{${L}}=\\frac{${a2 + b2}}{${L}}`)}입니다.`,
  );
}

/* ────────────────────────────── 1-6 다각형의 둘레와 넓이 ────────────────────────────── */

function area(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;

  // 1-6-1 정다각형과 사각형의 둘레 — 도형 이름은 한자 수사(R4).
  if (s.includes("둘레")) {
    const roll = intBetween(rng, 0, 3);
    if (roll === 0) {
      const sides = intBetween(rng, 3, 8);
      const side = intBetween(rng, 4, 14);
      return make(
        unit,
        `한 변의 길이가 ${n(side)} cm인 ${polyName(sides, true)}의 둘레는 몇 cm인가?`,
        n(sides * side),
        `${wj(polyName(sides, true), "은", "는")} 변이 ${n(sides)}개이고 길이가 모두 같으므로 ${expr(`${side}\\times${sides}=${sides * side}`)}입니다.`,
      );
    }
    if (roll === 1) {
      const w = intBetween(rng, 7, 18);
      const h = intBetween(rng, 3, w - 1);
      return make(
        unit,
        `가로가 ${n(w)} cm, 세로가 ${n(h)} cm인 직사각형의 둘레는 몇 cm인가?`,
        n(2 * (w + h)),
        `${expr(`(${w}+${h})\\times2=${2 * (w + h)}`)}입니다.`,
        fig("areaPoly", { shape: "rect", base: w, height: h }),
      );
    }
    if (roll === 2) {
      const side = intBetween(rng, 4, 15);
      return make(
        unit,
        `한 변의 길이가 ${n(side)} cm인 마름모의 둘레는 몇 cm인가?`,
        n(4 * side),
        `마름모는 네 변의 길이가 모두 같으므로 ${expr(`${side}\\times4=${4 * side}`)}입니다.`,
      );
    }
    const p = intBetween(rng, 5, 16);
    const q = intBetween(rng, 3, 12);
    return make(
      unit,
      `이웃한 두 변의 길이가 ${n(p)} cm, ${n(q)} cm인 평행사변형의 둘레는 몇 cm인가?`,
      n(2 * (p + q)),
      `평행사변형은 마주 보는 두 변의 길이가 같으므로 ${expr(`(${p}+${q})\\times2=${2 * (p + q)}`)}입니다.`,
    );
  }

  // 1-6-3 1cm²보다 더 큰 넓이의 단위 — **단위 사이의 관계**를 묻는다.
  if (s.includes("보다 더 큰 넓이의 단위")) {
    const roll = intBetween(rng, 0, 2);
    if (roll === 0) {
      const k = intBetween(rng, 2, 9);
      return make(
        unit,
        `${expr(`${k}\\,\\mathrm{m}^2`)}는 몇 ${expr("\\mathrm{cm}^2")}인가?`,
        n(k * 10000),
        `${expr("1\\,\\mathrm{m}=100\\,\\mathrm{cm}")}이므로 ${expr("1\\,\\mathrm{m}^2=10000\\,\\mathrm{cm}^2")}입니다. 따라서 ${expr(`${k}\\times10000=${k * 10000}`)}입니다.`,
      );
    }
    if (roll === 1) {
      const k = intBetween(rng, 2, 9);
      return make(
        unit,
        `${expr(`${k}\\,\\mathrm{km}^2`)}는 몇 ${expr("\\mathrm{m}^2")}인가?`,
        n(k * 1000000),
        `${expr("1\\,\\mathrm{km}=1000\\,\\mathrm{m}")}이므로 ${expr("1\\,\\mathrm{km}^2=1000000\\,\\mathrm{m}^2")}입니다. 따라서 ${expr(`${k}\\times1000000=${k * 1000000}`)}입니다.`,
      );
    }
    const w = intBetween(rng, 6, 25);
    const h = intBetween(rng, 4, 20);
    return make(
      unit,
      `가로가 ${n(w)} m, 세로가 ${n(h)} m인 직사각형 모양 텃밭의 넓이는 몇 ${expr("\\mathrm{m}^2")}인가?`,
      n(w * h),
      `직사각형의 넓이는 가로와 세로의 곱이므로 ${expr(`${w}\\times${h}=${w * h}`)}입니다.`,
    );
  }

  // 1-6-2 1cm², 직사각형과 정사각형의 넓이
  if (s.includes("직사각형과 정사각형")) {
    if (intBetween(rng, 0, 1) === 0) {
      const side = intBetween(rng, 4, 14);
      return make(
        unit,
        `한 변의 길이가 ${n(side)} cm인 정사각형의 넓이는 몇 cm²인가?`,
        n(side * side),
        `${expr(`${side}\\times${side}=${side * side}`)}입니다.`,
        fig("areaPoly", { shape: "rect", base: side, height: side }),
      );
    }
    // 가로와 세로가 같으면 그건 정사각형이다 — 앞 갈래와 겹치지 않게 벌린다.
    const w = intBetween(rng, 7, 16);
    const h = intBetween(rng, 3, w - 1);
    return make(
      unit,
      `가로가 ${n(w)} cm, 세로가 ${n(h)} cm인 직사각형의 넓이는 몇 cm²인가?`,
      n(w * h),
      `${expr(`${w}\\times${h}=${w * h}`)}입니다.`,
      fig("areaPoly", { shape: "rect", base: w, height: h }),
    );
  }

  // 1-6-4 평행사변형과 삼각형의 넓이
  if (s.includes("평행사변형과 삼각형")) {
    const b = intBetween(rng, 3, 9) * 2;
    const h = intBetween(rng, 3, 11);
    if (intBetween(rng, 0, 1) === 0) {
      return make(
        unit,
        `밑변의 길이가 ${n(b)} cm, 높이가 ${n(h)} cm인 삼각형의 넓이는 몇 cm²인가?`,
        n((b * h) / 2),
        `삼각형의 넓이는 밑변과 높이를 곱한 뒤 ${n(2)}로 나눕니다. ${expr(`${b}\\times${h}\\div2=${(b * h) / 2}`)}입니다.`,
        fig("areaPoly", { shape: "tri", base: b, height: h }),
      );
    }
    return make(
      unit,
      `밑변의 길이가 ${n(b)} cm, 높이가 ${n(h)} cm인 평행사변형의 넓이는 몇 cm²인가?`,
      n(b * h),
      `평행사변형의 넓이는 밑변과 높이의 곱이므로 ${expr(`${b}\\times${h}=${b * h}`)}입니다.`,
      fig("areaPoly", { shape: "para", base: b, height: h }),
    );
  }

  // 1-6-5 마름모와 사다리꼴의 넓이
  if (intBetween(rng, 0, 1) === 0) {
    // 두 대각선이 같으면 그건 **정사각형**이다 — 그려 놓고 「마름모」라 부르면 안 된다.
    // 실측 4/200 이 그렇게 나왔다(1-6-2 가로=세로 「직사각형」과 같은 부류).
    const d1 = intBetween(rng, 3, 9) * 2;
    const d2 = pick(
      rng,
      [4, 5, 6, 7, 8, 9, 10, 11].filter((v) => v !== d1),
    );
    return make(
      unit,
      `두 대각선의 길이가 ${n(d1)} cm, ${n(d2)} cm인 마름모의 넓이는 몇 cm²인가?`,
      n((d1 * d2) / 2),
      `마름모의 넓이는 두 대각선을 곱한 뒤 ${n(2)}로 나눕니다. ${expr(`${d1}\\times${d2}\\div2=${(d1 * d2) / 2}`)}입니다.`,
      fig("areaPoly", { shape: "rhombus", base: d1, height: d2, d2 }),
    );
  }
  // 사다리꼴로 **보여야** 한다. 윗변과 아랫변이 비슷하고 키가 크면(7·9·12) 지면에서
  // 직사각형과 구분이 안 된다 — 두 변을 충분히 벌리고 높이가 아랫변을 넘지 않게 한다.
  // 높이를 짝수로 두면 `(윗변+아랫변)×높이÷2` 가 늘 자연수다.
  const top = intBetween(rng, 3, 8);
  const bot = top + intBetween(rng, 3, 7);
  const h = 2 * intBetween(rng, 2, Math.min(5, Math.floor(bot / 2)));
  return make(
    unit,
    `윗변의 길이가 ${n(top)} cm, 아랫변의 길이가 ${n(bot)} cm, 높이가 ${n(h)} cm인 사다리꼴의 넓이는 몇 cm²인가?`,
    n(((top + bot) * h) / 2),
    `사다리꼴의 넓이는 두 변의 길이를 더해 높이를 곱한 뒤 ${n(2)}로 나눕니다. ${expr(`(${top}+${bot})\\times${h}\\div2=${((top + bot) * h) / 2}`)}입니다.`,
    fig("areaPoly", { shape: "trap", base: bot, height: h, top }),
  );
}

/* ────────────────────────────── 2-1 수의 범위와 어림하기 ────────────────────────────── */

const RANGE_RIDES = [
  ["놀이기구", "키", "cm"],
  ["회전목마", "키", "cm"],
  ["범퍼카", "키", "cm"],
  ["바이킹", "키", "cm"],
] as const;

function estimate(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;

  // 2-1-1 이상과 이하 — 양 끝을 **포함**한다.
  if (s.includes("이상과 이하")) {
    const a = intBetween(rng, 12, 480);
    const gap = intBetween(rng, 5, 20);
    return make(
      unit,
      `${n(a)} 이상 ${n(a + gap)} 이하인 자연수는 모두 몇 개인가?`,
      n(gap + 1),
      `${nj(a, "과", "와")} ${nj(a + gap, "을", "를")} 모두 포함하므로 ${expr(`${a + gap}-${a}+1=${gap + 1}`)}개입니다.`,
    );
  }

  // 2-1-2 초과와 미만 — 양 끝을 **포함하지 않는다**.
  if (s.includes("초과와 미만")) {
    const a = intBetween(rng, 12, 480);
    const gap = intBetween(rng, 5, 20);
    return make(
      unit,
      `${n(a)} 초과 ${n(a + gap)} 미만인 자연수는 모두 몇 개인가?`,
      n(gap - 1),
      `${nj(a, "과", "와")} ${nj(a + gap, "을", "를")} 모두 빼야 하므로 ${expr(`${a + gap}-${a}-1=${gap - 1}`)}개입니다.`,
    );
  }

  // 2-1-3 수의 범위를 알고 문제 해결하기 — 범위를 **생활 장면**에 대 본다.
  if (s.includes("문제 해결")) {
    const [place, what, unitName] = pick(rng, RANGE_RIDES);
    const limit = intBetween(rng, 110, 140);
    // 다섯 중 넷을 고르므로 기준 이상인 것(치우침 `0`·`4`·`11`)이 적어도 둘 남는다 —
    // 답이 `0` 이 되어 해설의 나열이 비는 일이 없다.
    const offsets = shuffled(rng, [-8, -3, 0, 4, 11]).slice(0, 4);
    const values = offsets.map((d) => limit + d);
    const ok = values.filter((v) => v >= limit).length;
    return make(
      unit,
      `${wj(place, "을", "를")} 타려면 ${wj(what, "이", "가")} ${n(limit)} ${unitName} 이상이어야 합니다. 네 사람의 ${what}가 ${nums(values)} ${unitName}일 때 탈 수 있는 사람은 몇 명인가?`,
      n(ok),
      `${n(limit)} ${unitName} 이상인 ${what}를 셉니다. ${nums(values.filter((v) => v >= limit))} ${unitName}이므로 ${n(ok)}명입니다.`,
    );
  }

  const x = intBetween(rng, 1234, 8765);
  const toHundred = intBetween(rng, 0, 1) === 0;
  const place = toHundred ? 100 : 10;
  const placeName = toHundred ? "백" : "십";

  // ⚠️ **「반올림」을 「올림」보다 먼저 본다.** 「반올림 알아보기와 어림의 활용」은
  // `includes("올림")` 에 걸린다 — 그대로 두면 2-1-6 이 올림 문항을 낸다(정답은 맞으니
  // 가드가 조용하다). 2026-08-22 변이 시험으로 잡은 자리다.
  if (s.includes("반올림")) {
    const roll = intBetween(rng, 0, 2);
    if (roll <= 1) {
      const digit = Math.floor((x % place) / (place / 10));
      const rounded =
        digit >= 5
          ? Math.ceil(x / place) * place
          : Math.floor(x / place) * place;
      return make(
        unit,
        `${nj(x, "을", "를")} 반올림하여 ${placeName}의 자리까지 나타내시오.`,
        n(rounded),
        `바로 아래 자리 숫자가 ${n(digit)}이므로 ${digit >= 5 ? "올립니다" : "버립니다"}. 답은 ${n(rounded)}입니다.`,
      );
    }
    // 어림의 활용 — 남는 것을 팔 수 없으니 버림한다.
    const boxes = intBetween(rng, 12, 48);
    const per = pick(rng, [10, 20, 50]);
    const left = intBetween(rng, 1, per - 1);
    const total = boxes * per + left;
    return make(
      unit,
      `사탕 ${n(total)}개를 한 상자에 ${n(per)}개씩 담아 팔려고 합니다. 팔 수 있는 사탕은 모두 몇 개인가?`,
      n(boxes * per),
      `${n(per)}개씩 ${n(boxes)}상자를 담으면 ${n(left)}개가 남습니다. 남은 것은 팔 수 없으므로 버림하면 ${expr(`${boxes}\\times${per}=${boxes * per}`)}개입니다.`,
    );
  }

  // 2-1-4 올림
  if (s.includes("올림")) {
    const up = Math.ceil(x / place) * place;
    return make(
      unit,
      `${nj(x, "을", "를")} 올림하여 ${placeName}의 자리까지 나타내시오.`,
      n(up),
      `${placeName}의 자리 아래 수가 ${nj(0, "이", "가")} 아니면 올립니다. ${nj(x, "을", "를")} 올리면 ${n(up)}입니다.`,
    );
  }

  // 2-1-5 버림
  const down = Math.floor(x / place) * place;
  return make(
    unit,
    `${nj(x, "을", "를")} 버림하여 ${placeName}의 자리까지 나타내시오.`,
    n(down),
    `${placeName}의 자리 아래 수를 모두 버립니다. ${nj(x, "을", "를")} 버리면 ${n(down)}입니다.`,
  );
}

/* ────────────────────────────── 2-2 분수의 곱셈 ────────────────────────────── */

function fracMul(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const k = intBetween(rng, 2, 8);
  // 발문의 분수는 기약으로 낸다 — `\frac{3}{6}\times8` 은 교재 발문이 아니다.
  const [a, d] = properFrac(rng, [3, 4, 5, 6, 7, 8]);

  // 2-2-1 (분수)×(자연수) — 분수가 앞, 자연수가 뒤.
  if (s.includes("(분수)×(자연수)")) {
    const [num, den] = simplify(a * k, d);
    return make(
      unit,
      expr(`\\frac{${a}}{${d}}\\times${k}=\\square`),
      expr(fracLatex(num, den)),
      `분모는 그대로 두고 분자에 ${nj(k, "을", "를")} 곱합니다. ${expr(`\\frac{${a}\\times${k}}{${d}}=${fracLatex(num, den)}`)}입니다.`,
      fig("fracBars", { cols: d, rows: 1, filled: a, fill: "#7eb89a" }),
    );
  }

  // 2-2-2 (자연수)×(분수) — 자연수가 앞, 분수가 뒤.
  if (s.includes("(자연수)×(분수)")) {
    const [num, den] = simplify(k * a, d);
    return make(
      unit,
      expr(`${k}\\times\\frac{${a}}{${d}}=\\square`),
      expr(fracLatex(num, den)),
      `자연수를 분자에 곱합니다. ${expr(`\\frac{${k}\\times${a}}{${d}}=${fracLatex(num, den)}`)}입니다.`,
    );
  }

  // 2-2-3 진분수의 곱셈 — 두 분수가 **모두 진분수**다.
  if (s.includes("진분수의 곱셈")) {
    const [b, d2] = properFrac(rng, [3, 4, 5, 6, 7, 8, 9]);
    const [num, den] = simplify(a * b, d * d2);
    return make(
      unit,
      expr(`\\frac{${a}}{${d}}\\times\\frac{${b}}{${d2}}=\\square`),
      expr(fracLatex(num, den)),
      // 이미 기약이면 `\frac{7}{27}=\frac{7}{27}` 이라는 동어반복이 나온다 — 약분이 있을 때만 덧붙인다.
      `분자끼리, 분모끼리 곱합니다. ${expr(`\\frac{${a}\\times${b}}{${d}\\times${d2}}=\\frac{${a * b}}{${d * d2}}${a * b === num && d * d2 === den ? "" : `=${fracLatex(num, den)}`}`)}입니다.`,
    );
  }

  // 2-2-4 여러 가지 분수의 곱셈 — **대분수**가 들어간다.
  if (s.includes("여러 가지")) {
    const w = intBetween(rng, 1, 4);
    if (intBetween(rng, 0, 1) === 0) {
      const [num, den] = simplify((w * d + a) * k, d);
      return make(
        unit,
        expr(`${mixedLatex(w, a, d)}\\times${k}=\\square`),
        expr(fracLatex(num, den)),
        `대분수를 가분수 ${expr(`\\frac{${w * d + a}}{${d}}`)}로 고친 뒤 분자에 ${nj(k, "을", "를")} 곱합니다.`,
      );
    }
    const [b, d2] = properFrac(rng, [3, 4, 5, 6, 7, 8, 9]);
    const [num, den] = simplify((w * d + a) * b, d * d2);
    return make(
      unit,
      expr(`${mixedLatex(w, a, d)}\\times\\frac{${b}}{${d2}}=\\square`),
      expr(fracLatex(num, den)),
      `대분수를 가분수 ${expr(`\\frac{${w * d + a}}{${d}}`)}로 고친 뒤 분자끼리, 분모끼리 곱합니다.`,
    );
  }

  throw new Error(`분수의 곱셈 소단원 이름이 바뀌었습니다: ${s}`);
}

/* ────────────────────────────── 2-3 합동과 대칭 ────────────────────────────── */

/**
 * 합동 판정에 쓰는 도형 풀. `namedShapes` 는 같은 kind 를 같은 크기로 그리므로 kind 가 곧 합동이다.
 *
 * 이 풀은 **두 가지**를 만족해야 문항이 성립한다. 둘은 다른 축이라 하나로 갈음할 수 없다.
 *
 * ㉠ **어느 두 kind 도 합동이 아니다.** 「포개면 겹치는가」는 돌리고 뒤집어도 되므로
 *    자리가 아니라 **변 길이 다중집합**으로 봐야 한다. 11종 55쌍 실측 — 겹치는 짝 없음.
 *    (`eqTri` 44·44·44 vs `square` 44·44·44·44 는 꼭짓점 수부터 다르다.)
 * ㉡ **합동이 아닌 둘이 같아 보이지도 않는다.** 그려진 자리의 윤곽 거리 최소 **7.92px**
 *    (`square↔rect`). 6px 미만이면 학생이 눈으로 못 고른다.
 *
 * ⚠️ 2026-08-22 에 ㉡ 가 실제로 깨졌었다. 등변 tick 이 `marks` 옵트인으로 바뀌자(원장님
 * 결함 ⑤ 수리) `eqTri` 가 `isoTri` 와 **3.93px** 까지 붙어 잠시 뺐다. 엔진이 `isoTri`
 * 밑변을 좁혀 고쳤고(9.45px), 되돌린 뒤 55쌍을 다시 재어 위 두 값을 확인했다.
 * **도형 좌표가 바뀌면 한 짝을 벌릴 때 다른 짝이 좁아진다 — 전 쌍을 다시 재라.**
 *
 * 여기 문항들은 등변·직각을 **묻지 않으므로** `marks` 는 켜지 않는다(기본이 안전한 쪽이다).
 */
const CONG_SHAPES = [
  "square",
  "rect",
  "rightTri",
  "isoTri",
  "wideTri",
  "eqTri",
  "diamond",
  "tallDiamond",
  "trap",
  "para",
  "irregQuad",
] as const;

const LINE_MOTIFS = [
  "kite",
  "eqTri",
  "isoTrap",
  "arrow",
  "house",
  "rhombus",
  "hex",
  "heart",
] as const;
const POINT_MOTIFS = ["para", "hourglass", "z", "hex", "rhombus"] as const;

function congSym(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;

  // 2-3-3 선대칭도형과 그 성질
  if (s.includes("선대칭")) {
    const motif = pick(rng, LINE_MOTIFS);
    const upright =
      motif === "heart" ||
      motif === "house" ||
      motif === "arrow" ||
      motif === "eqTri" ||
      motif === "kite";
    const axis = upright ? "v" : pick(rng, ["v", "h"] as const);
    const figure = fig("symmetry", { axis, motif });
    const roll = intBetween(rng, 0, 3);
    if (roll === 0) {
      return make(
        unit,
        "점선을 따라 접었을 때 완전히 겹치는 이런 도형을 무엇이라고 하는가?",
        "선대칭도형",
        "한 직선을 따라 접어서 완전히 겹치는 도형을 선대칭도형이라고 하고, 그 직선을 대칭축이라고 합니다.",
        figure,
      );
    }
    if (roll === 1) {
      const len = intBetween(rng, 3, 14);
      return make(
        unit,
        `점선을 대칭축으로 하는 선대칭도형입니다. 한 변의 길이가 ${n(len)} cm일 때 이와 대응하는 변의 길이는 몇 cm인가?`,
        n(len),
        `선대칭도형에서 대응하는 변의 길이는 서로 같으므로 ${n(len)} cm입니다.`,
        figure,
      );
    }
    if (roll === 2) {
      const deg = intBetween(rng, 35, 140);
      return make(
        unit,
        `점선을 대칭축으로 하는 선대칭도형입니다. 한 각의 크기가 ${expr(`${deg}^\\circ`)}일 때 이와 대응하는 각의 크기는 몇 도인가?`,
        expr(`${deg}^\\circ`),
        `선대칭도형에서 대응하는 각의 크기는 서로 같으므로 ${expr(`${deg}^\\circ`)}입니다.`,
        figure,
      );
    }
    const gap = intBetween(rng, 2, 12);
    return make(
      unit,
      `점선을 대칭축으로 하는 선대칭도형입니다. 대칭축에서 ${n(gap)} cm 떨어진 점의 대응점은 대칭축에서 몇 cm 떨어져 있는가?`,
      n(gap),
      `대응하는 두 점을 이은 선분은 대칭축과 수직으로 만나고 대칭축이 그 선분을 반으로 나누므로 ${n(gap)} cm입니다.`,
      figure,
    );
  }

  // 2-3-4 점대칭도형과 그 성질
  if (s.includes("점대칭")) {
    const motif = pick(rng, POINT_MOTIFS);
    const figure = fig("symmetry", { axis: "point", motif });
    const roll = intBetween(rng, 0, 3);
    if (roll === 0) {
      return make(
        unit,
        `가운데 점을 중심으로 ${expr("180^\\circ")} 돌렸을 때 처음 도형과 완전히 겹치는 이런 도형을 무엇이라고 하는가?`,
        "점대칭도형",
        `한 점을 중심으로 ${expr("180^\\circ")} 돌렸을 때 처음 도형과 완전히 겹치면 점대칭도형이고, 그 점을 대칭의 중심이라고 합니다.`,
        figure,
      );
    }
    if (roll === 1) {
      return make(
        unit,
        "점대칭도형에서 대응하는 두 점을 이은 선분은 모두 어느 점을 지나는가?",
        "대칭의 중심",
        "대응점을 이은 선분은 모두 대칭의 중심을 지나고, 대칭의 중심이 그 선분을 반으로 나눕니다.",
        figure,
      );
    }
    if (roll === 2) {
      const len = intBetween(rng, 3, 14);
      return make(
        unit,
        `점대칭도형입니다. 한 변의 길이가 ${n(len)} cm일 때 이와 대응하는 변의 길이는 몇 cm인가?`,
        n(len),
        `점대칭도형에서 대응하는 변의 길이는 서로 같으므로 ${n(len)} cm입니다.`,
        figure,
      );
    }
    const gap = intBetween(rng, 2, 12);
    return make(
      unit,
      `점대칭도형입니다. 대칭의 중심에서 한 점까지의 거리가 ${n(gap)} cm일 때, 그 점의 대응점까지의 거리는 몇 cm인가?`,
      n(gap),
      `대칭의 중심은 대응점을 이은 선분을 반으로 나누므로 ${n(gap)} cm입니다.`,
      figure,
    );
  }

  // 2-3-2 합동인 도형의 성질 — 대응변·대응각을 묻는다(2-3-1 과 다른 문항이다).
  if (s.includes("성질")) {
    const shape = pick(rng, CONG_SHAPES);
    const figure = fig("namedShapes", {
      items: [
        { shape, label: "가" },
        { shape, label: "나" },
      ],
    });
    if (intBetween(rng, 0, 1) === 0) {
      const len = intBetween(rng, 4, 15);
      return make(
        unit,
        `두 도형은 서로 합동입니다. 도형 가의 어떤 변의 길이가 ${n(len)} cm일 때, 도형 나에서 이와 대응하는 변의 길이는 몇 cm인가?`,
        n(len),
        `합동인 두 도형에서 대응하는 변의 길이는 서로 같으므로 ${n(len)} cm입니다.`,
        figure,
      );
    }
    const deg = intBetween(rng, 35, 145);
    return make(
      unit,
      `두 도형은 서로 합동입니다. 도형 가의 어떤 각의 크기가 ${expr(`${deg}^\\circ`)}일 때, 도형 나에서 이와 대응하는 각의 크기는 몇 도인가?`,
      expr(`${deg}^\\circ`),
      `합동인 두 도형에서 대응하는 각의 크기는 서로 같으므로 ${expr(`${deg}^\\circ`)}입니다.`,
      figure,
    );
  }

  // 2-3-1 도형의 합동 알아보기 — **여러 도형 중** 포개어지는 둘을 고른다.
  // `namedShapes` 는 같은 kind 를 같은 크기로 그린다. 그래서 「같은 kind 한 쌍」이 곧 합동이고,
  // 다른 kind 끼리는 어느 짝도 합동이 아니다 — 답이 하나로 정해진다.
  const total = intBetween(rng, 4, 5);
  const kinds = pickSome(rng, CONG_SHAPES, total - 1);
  const twin = kinds[intBetween(rng, 0, kinds.length - 1)]!;
  const items = shuffled(rng, [...kinds, twin]).map((shape, i) => ({
    shape,
    label: LABELS[i]!,
  }));
  const hits = items.filter((it) => it.shape === twin).map((it) => it.label);
  const answer = `${hits[0]}와 ${hits[1]}`;
  const ask = pick(rng, [
    "포개었을 때 완전히 겹치는 두 도형",
    "모양과 크기가 같아 서로 합동인 두 도형",
    "서로 합동인 두 도형",
  ]);
  return make(
    unit,
    `도형 ${n(total)}개 중에서 ${ask}의 기호를 쓰시오.`,
    answer,
    `모양과 크기가 같아서 포개면 완전히 겹치는 두 도형을 서로 합동이라고 합니다. ${answer}가 서로 합동입니다.`,
    fig("namedShapes", { items }),
  );
}

/* ────────────────────────────── 2-4 소수의 곱셈 ────────────────────────────── */

/** `1`보다 **작은** 소수 한 자리 — `0.2` ~ `0.9`. 십분의 일 정수로 잰다. */
function underOne(
  rng: Rng,
  forbid: (t: number) => boolean = () => false,
): number {
  const cands = [2, 3, 4, 5, 6, 7, 8, 9].filter((t) => !forbid(t));
  return pick(rng, cands.length > 0 ? cands : [3]);
}

/** `1`보다 **큰** 소수 한 자리 — `1.1` ~ `4.9`. 십분의 일 정수로 잰다. */
function overOne(rng: Rng): number {
  return intBetween(rng, 1, 4) * 10 + intBetween(rng, 1, 9);
}

function decMul(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;

  // 2-4-7 곱의 소수점의 위치 — `10`·`100` 과 `0.1`·`0.01` 을 곱해 소수점이 어디로 가는지 본다.
  if (s.includes("곱의 소수점")) {
    if (intBetween(rng, 0, 1) === 0) {
      const base = intBetween(rng, 105, 989);
      const mul = pick(rng, [10, 100]);
      return make(
        unit,
        expr(`${dec(base, 2)}\\times${mul}=\\square`),
        expr(dec(base * mul, 2)),
        `${nj(mul, "을", "를")} 곱하면 소수점이 오른쪽으로 ${n(mul === 10 ? 1 : 2)}칸 옮겨집니다. 답은 ${expr(dec(base * mul, 2))}입니다.`,
      );
    }
    const whole = intBetween(rng, 12, 987);
    const mul = pick(rng, [1, 2]);
    return make(
      unit,
      expr(`${whole}\\times${dec(1, mul)}=\\square`),
      expr(dec(whole, mul)),
      `${expr(dec(1, mul))}을 곱하면 소수점이 왼쪽으로 ${n(mul)}칸 옮겨집니다. 답은 ${expr(dec(whole, mul))}입니다.`,
    );
  }

  // 2-4-1 (1보다 작은 소수)×(자연수)
  if (s.includes("(1보다 작은 소수)×(자연수)")) {
    const k = intBetween(rng, 2, 9);
    const t = underOne(rng, (x) => (x * k) % 10 === 0);
    return make(
      unit,
      expr(`${dec(t, 1)}\\times${k}=\\square`),
      expr(dec(t * k, 1)),
      `${nj(t, "과", "와")} ${nj(k, "을", "를")} 곱한 ${n(t * k)}에 소수 한 자리를 찍으면 ${expr(dec(t * k, 1))}입니다.`,
    );
  }

  // 2-4-2 (1보다 큰 소수)×(자연수)
  if (s.includes("(1보다 큰 소수)×(자연수)")) {
    const k = intBetween(rng, 2, 9);
    const a = overOne(rng);
    return make(
      unit,
      expr(`${dec(a, 1)}\\times${k}=\\square`),
      expr(dec(a * k, 1)),
      `${nj(a, "과", "와")} ${nj(k, "을", "를")} 곱한 ${n(a * k)}에 소수 한 자리를 찍으면 ${expr(dec(a * k, 1))}입니다.`,
    );
  }

  // 2-4-3 (자연수)×(1보다 작은 소수)
  if (s.includes("(자연수)×(1보다 작은 소수)")) {
    const k = intBetween(rng, 2, 9);
    const t = underOne(rng, (x) => (x * k) % 10 === 0);
    return make(
      unit,
      expr(`${k}\\times${dec(t, 1)}=\\square`),
      expr(dec(k * t, 1)),
      `${nj(k, "과", "와")} ${nj(t, "을", "를")} 곱한 ${n(k * t)}에 소수 한 자리를 찍으면 ${expr(dec(k * t, 1))}입니다.`,
    );
  }

  // 2-4-4 (자연수)×(1보다 큰 소수)
  if (s.includes("(자연수)×(1보다 큰 소수)")) {
    const k = intBetween(rng, 2, 9);
    const a = overOne(rng);
    return make(
      unit,
      expr(`${k}\\times${dec(a, 1)}=\\square`),
      expr(dec(k * a, 1)),
      `${nj(k, "과", "와")} ${nj(a, "을", "를")} 곱한 ${n(k * a)}에 소수 한 자리를 찍으면 ${expr(dec(k * a, 1))}입니다.`,
    );
  }

  // 2-4-5 (1보다 작은 소수)×(1보다 작은 소수)
  if (s.includes("(1보다 작은 소수)×(1보다 작은 소수)")) {
    const t1 = underOne(rng);
    const t2 = underOne(rng, (x) => (x * t1) % 10 === 0);
    return make(
      unit,
      expr(`${dec(t1, 1)}\\times${dec(t2, 1)}=\\square`),
      expr(dec(t1 * t2, 2)),
      `${nj(t1, "과", "와")} ${nj(t2, "을", "를")} 곱한 ${n(t1 * t2)}에 소수 두 자리를 찍으면 ${expr(dec(t1 * t2, 2))}입니다.`,
    );
  }

  // 2-4-6 (1보다 큰 소수)×(1보다 큰 소수)
  if (s.includes("(1보다 큰 소수)×(1보다 큰 소수)")) {
    const a = overOne(rng);
    const b = overOne(rng);
    return make(
      unit,
      expr(`${dec(a, 1)}\\times${dec(b, 1)}=\\square`),
      expr(dec(a * b, 2)),
      `${nj(a, "과", "와")} ${nj(b, "을", "를")} 곱한 ${n(a * b)}에 소수 두 자리를 찍으면 ${expr(dec(a * b, 2))}입니다.`,
    );
  }

  throw new Error(`소수의 곱셈 소단원 이름이 바뀌었습니다: ${s}`);
}

/* ────────────────────────────── 2-5 직육면체 ────────────────────────────── */

function cuboid(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  // 「가장 넓은 면」이 하나로 정해지도록 `w > d > h` 로 잡는다.
  const w = intBetween(rng, 5, 12);
  const d = intBetween(rng, 3, w - 1);
  const h = intBetween(rng, 2, d - 1);

  // 2-5-2 정사각형 6개로 둘러싸인 도형 — 「면이 6개」는 발문이 이미 말했으므로 묻지 않는다.
  if (s.includes("정사각형 6개")) {
    const e = intBetween(rng, 3, 12);
    if (intBetween(rng, 0, 1) === 0) {
      return make(
        unit,
        `한 모서리의 길이가 ${n(e)} cm인 정사각형 ${n(6)}개로 둘러싸인 입체도형의 이름을 쓰시오.`,
        "정육면체",
        "여섯 면이 모두 합동인 정사각형인 입체도형을 정육면체라고 합니다.",
        fig("cuboid", { w: e, d: e, h: e }),
      );
    }
    return make(
      unit,
      `한 모서리의 길이가 ${n(e)} cm인 정육면체의 모든 모서리 길이의 합은 몇 cm인가?`,
      n(12 * e),
      `정육면체의 모서리는 ${n(12)}개이고 길이가 모두 같으므로 ${expr(`${e}\\times12=${12 * e}`)}입니다.`,
      fig("cuboid", { w: e, d: e, h: e }),
    );
  }

  // 2-5-1 직사각형 6개로 둘러싸인 도형
  if (s.includes("직사각형 6개")) {
    const roll = intBetween(rng, 0, 2);
    const figure = fig("cuboid", { w, d, h });
    const given = `가로가 ${n(w)} cm, 세로가 ${n(d)} cm, 높이가 ${n(h)} cm인 직사각형 ${n(6)}개로 둘러싸인 입체도형입니다.`;
    if (roll === 0) {
      return make(
        unit,
        `${given} 이 입체도형의 이름을 쓰시오.`,
        "직육면체",
        "직사각형 여섯 개로 둘러싸인 입체도형을 직육면체라고 합니다.",
        figure,
      );
    }
    if (roll === 1) {
      return make(
        unit,
        `${given} 모서리는 모두 몇 개인가?`,
        n(12),
        `직육면체의 모서리는 길이가 같은 것끼리 ${n(4)}개씩 세 묶음이므로 ${expr("4\\times3=12")}개입니다.`,
        figure,
      );
    }
    return make(
      unit,
      `${given} 꼭짓점은 모두 몇 개인가?`,
      n(8),
      `밑면에 ${n(4)}개, 윗면에 ${n(4)}개이므로 ${expr("4+4=8")}개입니다.`,
      figure,
    );
  }

  // 2-5-3 직육면체의 성질
  if (s.includes("성질")) {
    const roll = intBetween(rng, 0, 2);
    const figure = fig("cuboid", { w, d, h });
    const given = `가로가 ${n(w)} cm, 세로가 ${n(d)} cm, 높이가 ${n(h)} cm인 직육면체입니다.`;
    if (roll === 0) {
      return make(
        unit,
        `${given} 서로 평행한 면은 모두 몇 쌍인가?`,
        n(3),
        `마주 보는 두 면끼리 평행하고 그런 쌍이 ${n(3)}개 있습니다.`,
        figure,
      );
    }
    if (roll === 1) {
      return make(
        unit,
        `${given} 한 면과 수직인 면은 모두 몇 개인가?`,
        n(4),
        `한 면과 마주 보는 면만 평행하고 나머지 ${n(4)}개는 모두 수직입니다.`,
        figure,
      );
    }
    return make(
      unit,
      `${given} 한 모서리와 평행한 모서리는 모두 몇 개인가?`,
      n(3),
      `길이가 같은 모서리가 ${n(4)}개씩 있고 그중 자기 자신을 뺀 ${n(3)}개가 평행합니다.`,
      figure,
    );
  }

  // 2-5-4 직육면체의 겨냥도 — 겨냥도가 **실제로 보여 주는 것**만 묻는다.
  if (s.includes("겨냥도")) {
    const roll = intBetween(rng, 0, 2);
    const figure = fig("cuboid", { w, d, h });
    const given = `가로가 ${n(w)} cm, 세로가 ${n(d)} cm, 높이가 ${n(h)} cm인 직육면체의 겨냥도입니다.`;
    if (roll === 0) {
      return make(
        unit,
        `${given} 겨냥도에서 보이는 면은 모두 몇 개인가?`,
        n(3),
        `여섯 면 중 앞·옆·위의 ${n(3)}개가 보입니다.`,
        figure,
      );
    }
    if (roll === 1) {
      return make(
        unit,
        `${given} 겨냥도에서 보이는 모서리는 모두 몇 개인가?`,
        n(9),
        `모서리 ${n(12)}개 중 보이지 않는 ${n(3)}개를 빼면 ${expr("12-3=9")}개입니다.`,
        figure,
      );
    }
    return make(
      unit,
      `${given} 겨냥도에서 보이는 꼭짓점은 모두 몇 개인가?`,
      n(7),
      `꼭짓점 ${n(8)}개 중 뒤쪽에 가려진 ${n(1)}개를 빼면 ${expr("8-1=7")}개입니다.`,
      figure,
    );
  }

  // 2-5-5 정육면체의 전개도
  if (s.includes("정육면체의 전개도")) {
    const e = intBetween(rng, 3, 12);
    if (intBetween(rng, 0, 1) === 0) {
      return make(
        unit,
        `한 모서리의 길이가 ${n(e)} cm인 정육면체의 전개도입니다. 이 전개도를 접었을 때 서로 마주 보는 면은 모두 몇 쌍인가?`,
        n(3),
        `정육면체는 면이 ${n(6)}개이고 마주 보는 면끼리 짝을 이루므로 ${expr("6\\div2=3")}쌍입니다.`,
        fig("netCuboid", { w: e, d: e, h: e }),
      );
    }
    return make(
      unit,
      `한 모서리의 길이가 ${n(e)} cm인 정육면체의 전개도입니다. 이 전개도를 접어 만든 정육면체의 모든 모서리 길이의 합은 몇 cm인가?`,
      n(12 * e),
      `정육면체의 모서리는 ${n(12)}개이므로 ${expr(`${e}\\times12=${12 * e}`)}입니다.`,
      fig("netCuboid", { w: e, d: e, h: e }),
    );
  }

  // 2-5-6 직육면체의 전개도
  if (intBetween(rng, 0, 1) === 0) {
    return make(
      unit,
      `가로가 ${n(w)} cm, 세로가 ${n(d)} cm, 높이가 ${n(h)} cm인 직육면체의 전개도입니다. 이 전개도를 접어 만든 직육면체의 모든 모서리 길이의 합은 몇 cm인가?`,
      n(4 * (w + d + h)),
      `가로·세로·높이가 각각 ${n(4)}개씩이므로 ${expr(`(${w}+${d}+${h})\\times4=${4 * (w + d + h)}`)}입니다.`,
      fig("netCuboid", { w, d, h }),
    );
  }
  return make(
    unit,
    `가로가 ${n(w)} cm, 세로가 ${n(d)} cm, 높이가 ${n(h)} cm인 직육면체의 전개도입니다. 이 전개도에서 가장 넓은 면의 넓이는 몇 cm²인가?`,
    n(w * d),
    `면의 넓이는 ${expr(`${w}\\times${d}=${w * d}`)}, ${expr(`${w}\\times${h}=${w * h}`)}, ${expr(`${d}\\times${h}=${d * h}`)}이므로 가장 넓은 면은 ${n(w * d)}입니다.`,
    fig("netCuboid", { w, d, h }),
  );
}

/* ────────────────────────────── 2-6 평균과 가능성 ────────────────────────────── */

/**
 * 평균 문항의 소재 — (누구, 무엇, 단위, **그럴듯한 값의 범위**).
 *
 * ⚠️ 범위를 소재마다 두지 않으면 「선수 $5$명의 **키**를 조사했더니 평균이 $33$ cm」가
 * 나온다(실측 51/200). 산술도 표기도 소단원 조건도 전부 맞아서 **어느 가드도 못 본다** —
 * 수가 그 낱말과 어울리는지는 코드가 아니라 세상이 정하기 때문이다.
 */
const AVG_TOPICS = [
  ["학생", "몸무게", "kg", 28, 45],
  ["선수", "키", "cm", 150, 180],
  ["친구", "줄넘기 횟수", "번", 20, 60],
  ["학생", "수학 점수", "점", 60, 95],
  ["친구", "하루 운동 시간", "분", 20, 60],
] as const;

/** `lo`~`hi` 에서 `count` 로 나눈 나머지가 `want` 인 수. 범위가 `count` 보다 넓으면 안 빈다. */
function withResidue(
  lo: number,
  hi: number,
  count: number,
  want: number,
): number[] {
  const out: number[] = [];
  for (let v = lo; v <= hi; v += 1) if (v % count === want) out.push(v);
  return out;
}

function average(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;

  // 2-6-3 일이 일어날 가능성
  if (s.includes("가능성")) {
    if (intBetween(rng, 0, 1) === 0) {
      const k = intBetween(rng, 1, 5);
      const [num, den] = simplify(k, 6);
      return make(
        unit,
        `주사위를 한 번 굴릴 때 눈의 수가 ${n(k)} 이하일 가능성을 분수로 나타내시오.`,
        expr(`\\frac{${num}}{${den}}`),
        `나올 수 있는 눈은 ${n(6)}가지이고, 그중 ${n(k)} 이하인 것은 ${nums(Array.from({ length: k }, (_, i) => i + 1))}의 ${n(k)}가지입니다. 따라서 ${expr(`\\frac{${k}}{6}${k === num && den === 6 ? "" : `=\\frac{${num}}{${den}}`}`)}입니다.`,
      );
    }
    const total = pick(rng, [10, 12, 20]);
    const k = intBetween(rng, 2, total - 2);
    const [num, den] = simplify(k, total);
    return make(
      unit,
      `${n(1)}부터 ${n(total)}까지의 수가 하나씩 적힌 카드 ${n(total)}장 중에서 한 장을 뽑을 때, ${n(k)} 이하의 수가 적힌 카드를 뽑을 가능성을 분수로 나타내시오.`,
      expr(`\\frac{${num}}{${den}}`),
      `${n(total)}장 중 ${n(k)}장이므로 ${expr(`\\frac{${k}}{${total}}=\\frac{${num}}{${den}}`)}입니다.`,
    );
  }

  // 2-6-2 평균을 이용하여 문제해결하기 — 갈래 **둘**. 원장님 확정(2026-08-22, 「초5는 넣도록 해」).
  //  ㉠ 평균에서 **합**을 되찾는다
  //  ㉡ 자료 하나가 빠졌을 때 그 **값**을 되찾는다 (교과서에 있는데 우리가 안 내던 것)
  //
  // ⚠️ ㉡ 의 발문에는 「$5$명의 평균은」이 들어간다. `elementaryEngine.test.ts` 의 평균 검사가
  //    「의 평균」을 보고 **앞의 수들로 직접 검산**하는데, 여기 나열된 수는 **한 명이 빠진 것**이라
  //    그대로 두면 거짓 빨강이 난다. 그 검사는 team-lead 담당이라 발문 형태를 넘겨 맞추기로 했다
  //    (검사를 피하려고 발문을 비틀지 않는다 — 제품을 시험에 맞추는 것이다).
  if (s.includes("이용하여")) {
    const [who, what, unitName, lo, hi] = pick(rng, AVG_TOPICS);
    // `cm`·`kg` 은 수와 띄고, 한글 단위(`번`·`점`·`분`)는 붙여 쓴다.
    const sp = /^[a-z]/i.test(unitName) ? " " : "";

    // ㉠ 합 구하기
    if (intBetween(rng, 0, 1) === 0) {
      const count = intBetween(rng, 4, 8);
      const avg = intBetween(rng, lo, hi);
      return make(
        unit,
        `${who} ${n(count)}명의 ${wj(what, "을", "를")} 조사했더니 평균이 ${n(avg)}${sp}${unitName}입니다. ${who} ${n(count)}명의 ${wj(what, "을", "를")} 모두 더하면 몇 ${unitName}인가?`,
        n(count * avg),
        `합은 평균에 자료의 수를 곱한 값이므로 ${expr(`${avg}\\times${count}=${count * avg}`)}입니다.`,
      );
    }

    // ㉡ 빠진 자료 값 구하기.
    // **자료를 먼저 정하고 평균을 유도한다.** 평균을 먼저 뽑으면 빠진 값이 범위를 벗어나
    // 「몸무게 $71$ kg 인 초등학생」이 나온다. 이렇게 하면 모든 값이 범위 안이고
    // 평균이 자연수인 것이 **구성으로** 보장된다.
    const count = intBetween(rng, 4, 6);
    const head: number[] = [];
    for (let i = 0; i < count - 1; i += 1) head.push(intBetween(rng, lo, hi));
    const partial = head.reduce((x, y) => x + y, 0);
    // 마지막 값은 합이 `count` 로 나누어떨어지게 고른다. 나머지가 같은 수는 `count` 마다
    // 하나씩 있으므로 범위가 `count` 보다 넓으면(모든 소재가 그렇다) 반드시 있다.
    const want = ((-partial % count) + count) % count;
    head.push(pick(rng, withResidue(lo, hi, count, want)));
    const total = head.reduce((x, y) => x + y, 0);
    const avg = total / count;

    // 가리는 자리를 씨앗마다 옮긴다 — 늘 마지막이 빠지면 자리가 단조롭다.
    const ordered = shuffled(rng, head);
    const missing = ordered[0]!;
    const shown = ordered.slice(1);
    const shownSum = shown.reduce((x, y) => x + y, 0);
    return make(
      unit,
      `${who} ${n(count)}명의 ${wj(what, "을", "를")} 조사했습니다. 그중 ${n(count - 1)}명의 ${wj(what, "은", "는")} ${nums(shown)}${sp}${unitName}이고, ${n(count)}명의 평균은 ${n(avg)}${sp}${unitName}입니다. 나머지 한 명의 ${wj(what, "은", "는")} 몇 ${unitName}인가?`,
      n(missing),
      `${n(count)}명의 합은 ${expr(`${avg}\\times${count}=${total}`)}입니다. 여기에서 ${n(count - 1)}명의 합 ${nj(shownSum, "을", "를")} 빼면 ${expr(`${total}-${shownSum}=${missing}`)}입니다.`,
    );
  }

  // 2-6-1 평균 알아보기 — 세 수 또는 네 수의 평균.
  // 치우침의 합이 `0` 이므로 평균은 정확히 `avg` 다. 가장 큰 치우침(±18)보다 `avg` 를 크게 잡아
  // 자료에 음수가 생기지 않게 한다.
  const size = intBetween(rng, 3, 4);
  const avg = intBetween(rng, 20, 45);
  const offsets: number[] = [];
  let acc = 0;
  for (let i = 0; i < size - 1; i += 1) {
    const off = intBetween(rng, -6, 6);
    offsets.push(off);
    acc += off;
  }
  offsets.push(-acc);
  const values = shuffled(rng, offsets).map((off) => avg + off);
  return make(
    unit,
    `${nums(values)}의 평균을 구하시오.`,
    n(avg),
    `모두 더하면 ${n(values.reduce((x, y) => x + y, 0))}이고, 자료가 ${n(size)}개이므로 ${expr(`${values.reduce((x, y) => x + y, 0)}\\div${size}=${avg}`)}입니다.`,
  );
}

export const G5: Record<string, ChapterHandler> = {
  "초5|1-1 자연수의 혼합 계산": mixedCalc,
  "초5|1-2 약수와 배수": factor,
  "초5|1-3 대응 관계": correspond,
  "초5|1-4 약분과 통분": reduce,
  "초5|1-5 분수의 덧셈과 뺄셈": fracAddSub,
  "초5|1-6 다각형의 둘레와 넓이": area,
  "초5|2-1 수의 범위와 어림하기": estimate,
  "초5|2-2 분수의 곱셈": fracMul,
  "초5|2-3 합동과 대칭": congSym,
  "초5|2-4 소수의 곱셈": decMul,
  "초5|2-5 직육면체": cuboid,
  "초5|2-6 평균과 가능성": average,
};
