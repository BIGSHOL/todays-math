import type { UnitSeed } from "../../../prisma/seed-data/units";

import { expr, n as num, polyName, sino, unitNum } from "./format";
import { fig, make } from "./make";
import { divFrac, fmtFrac, gcd, lcm, mulFrac } from "./math";
import { intBetween, pick } from "./rng";
import type { ChapterHandler, ElemProblem, Rng } from "./types";

/**
 * 초6 생성기.
 *
 * 원장님 육안 검수(2026-08-22, `docs/planning/tracks/elem-engine-review-20260822.md`)로 다시 짰다.
 * 규칙은 `rules.ts` 가 전량에 대고, 여기서는 그 규칙이 **지면에서 뜻이 통하는 모양**으로 나오게 한다.
 *
 * - R1 모든 수는 KaTeX (`num`·`expr`·`unitNum`). **수 하나가 답이면 답은 `$수$` 한 덩어리**로 —
 *   단위·「개」·「명」을 붙이지 않는다(발문이 「몇 개인가?」로 이미 말한다).
 *   `elementaryEngine.test.ts` 의 `answerNumber` 가 그 모양을 요구한다(D-66).
 * - R2 분수 답은 대분수 (`fmtFrac`) — 소수는 **정수 배율로** 만들어 부동소수점을 안 거친다
 * - R4 도형 이름은 한자 수사 (`polyName`·`sino`)
 * - R5 소단원이 다르면 **묻는 것**이 다르다 (같은 대단원 안에서 발문이 겹치지 않는다)
 * - R6 묻는 값을 그림이 그대로 적어 주지 않는다
 *   (원기둥·구는 **발문이** 반지름을 주므로 지름을 묻는다. 그림은 치수를 **안 적는다** —
 *    원장님 확정 2026-08-22 「문제에 굳이 있는데 라벨로 이중표기」. 09 §4-20-b.
 *    ⚠️ 예전 주석은 「그림이 치수를 적으므로」라고 적어 두었는데, 그걸 이 문항이 성립하는
 *    **근거**로 읽으면 라벨을 되살리게 된다. 근거는 그림이 아니라 **발문**이다.)
 * - R9 씨앗을 바꾸면 수·소재·도형이 바뀐다
 */

/**
 * 받침에 따라 조사를 고른다 — 지면에 「사과을」·「겨울를」이 나가지 않게.
 *
 * 수식 뒤에는 쓰지 않는다. `$4:7$` 은 「사 대 칠」로 읽혀 글자만 봐서는 받침을 알 수 없다 —
 * 그런 자리는 「다음 …\n\n$식$」 처럼 조사가 필요 없는 문장으로 쓴다.
 */
function josa(word: string, withFinal: string, withoutFinal: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const hasFinal = code >= 0 && code <= 11171 && code % 28 !== 0;
  return hasFinal ? withFinal : withoutFinal;
}

/** 정수 배율로 들고 다닌 소수를 글자로. **부동소수점을 거치지 않는다**(R2). */
function decStr(scaled: number, digits: number): string {
  if (digits <= 0) return String(scaled);
  const p = 10 ** digits;
  return `${Math.trunc(scaled / p)}.${String(scaled % p).padStart(digits, "0")}`;
}

/**
 * 분모와 서로소인 분자를 고른다 — **발문의 분수는 기약분수로 쓴다.**
 *
 * `2\frac{2}{6}\div\frac{6}{5}` 처럼 약분이 남은 분수는 초등 교재에 안 나온다.
 * `lo` 를 `den+1` 로 주면 가분수가 되는데, `gcd(den+1, den)=1` 이라 폴백도 늘 안전하다.
 */
function coprimeTop(rng: Rng, den: number, lo = 1, hi = den - 1): number {
  const pool: number[] = [];
  for (let i = lo; i <= hi; i += 1) if (gcd(i, den) === 1) pool.push(i);
  return pool.length > 0 ? pick(rng, pool) : lo;
}

/** ×100 으로 들고 다닌 수를 **필요한 자릿수만큼** 적는다. `630` → `6.3`, `2700` → `27`. */
function fromCents(cents: number): string {
  if (cents % 100 === 0) return String(cents / 100);
  if (cents % 10 === 0) return decStr(cents / 10, 1);
  return decStr(cents, 2);
}

// ───────────────────────── 1-1 분수의 나눗셈 ─────────────────────────

function fracDiv61(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;

  if (s.includes("(자연수)÷(자연수)")) {
    const b = intBetween(rng, 3, 9);
    const a = intBetween(rng, 2, b - 1);
    const done = fmtFrac(a, b);
    const raw = `\\frac{${a}}{${b}}`;
    const chain =
      gcd(a, b) === 1 ? `${a}\\div${b}=${raw}` : `${a}\\div${b}=${raw}=${done}`;
    return make(
      unit,
      `${expr(`${a}\\div${b}`)} 의 몫을 분수로 나타내시오.`,
      expr(done),
      `나누어지는 수를 분자, 나누는 수를 분모로 씁니다. ${expr(chain)}`,
    );
  }

  if (s.includes("(대분수)")) {
    const k = intBetween(rng, 2, 6);
    const d = intBetween(rng, 2, 8);
    const top = coprimeTop(rng, d);
    const w = intBetween(rng, 1, 4);
    const imp = w * d + top;
    const [p, q] = divFrac(imp, d, k, 1);
    return make(
      unit,
      `다음을 계산하시오.\n\n${expr(`${w}\\frac{${top}}{${d}}\\div${k}=\\square`)}`,
      expr(fmtFrac(p, q)),
      `대분수를 가분수로 고칩니다. ${expr(`${w}\\frac{${top}}{${d}}=\\frac{${imp}}{${d}}`)}` +
        ` 이므로 분자는 그대로 두고 분모에 나누는 수를 곱합니다. ` +
        `${expr(`\\frac{${imp}}{${d}\\times${k}}=${fmtFrac(p, q)}`)}`,
    );
  }

  // 1-1-2 (분수)÷(자연수) — 원장님이 잡으신 자리다.
  // 「분자에 1/k 를 곱합니다」 라고 써 놓고 식은 분모에 곱하고 있었다. 초등은 **분모에 곱한다**.
  const k = intBetween(rng, 2, 7);
  const d = intBetween(rng, 2, 9);
  const top = coprimeTop(rng, d);
  const [p, q] = divFrac(top, d, k, 1);
  return make(
    unit,
    `다음을 계산하시오.\n\n${expr(`\\frac{${top}}{${d}}\\div${k}=\\square`)}`,
    expr(fmtFrac(p, q)),
    `분자는 그대로 두고 분모에 나누는 수를 곱합니다. ` +
      `${expr(`\\frac{${top}}{${d}}\\div${k}=\\frac{${top}}{${d}\\times${k}}=${fmtFrac(p, q)}`)}`,
  );
}

// ───────────────────────── 1-2 각기둥과 각뿔 ─────────────────────────

function prismPyr(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const sides = intBetween(rng, 3, 8);
  const base = polyName(sides);
  const prismName = `${sino(sides)}각기둥`;
  const pyrName = `${sino(sides)}각뿔`;
  const prismFig = fig("prism", { sides, h: 3 });
  const pyrFig = fig("pyramid", { sides, h: 3 });

  if (s.includes("각뿔의 이름")) {
    const which = pick(rng, ["이름", "꼭짓점", "모서리", "면"]);
    if (which === "이름") {
      return make(
        unit,
        `밑면이 ${base}인 각뿔의 이름을 쓰시오.`,
        pyrName,
        `각뿔의 이름은 밑면의 모양으로 정합니다. 밑면이 ${base}이므로 ${pyrName}입니다.`,
        pyrFig,
      );
    }
    if (which === "꼭짓점") {
      return make(
        unit,
        `${pyrName}의 꼭짓점은 모두 몇 개인가?`,
        num(sides + 1),
        `밑면의 꼭짓점 ${num(sides)}개에 각뿔의 꼭짓점 ${num(1)}개를 더합니다. ` +
          `${expr(`${sides}+1=${sides + 1}`)}`,
        pyrFig,
      );
    }
    if (which === "모서리") {
      return make(
        unit,
        `${pyrName}의 모서리는 모두 몇 개인가?`,
        num(2 * sides),
        `밑면의 모서리 ${num(sides)}개와 옆면의 모서리 ${num(sides)}개를 더합니다. ` +
          `${expr(`${sides}+${sides}=${2 * sides}`)}`,
        pyrFig,
      );
    }
    return make(
      unit,
      `${pyrName}의 면은 모두 몇 개인가?`,
      num(sides + 1),
      `밑면 ${num(1)}개와 옆면 ${num(sides)}개를 더합니다. ${expr(`1+${sides}=${sides + 1}`)}`,
      pyrFig,
    );
  }

  if (s.includes("각뿔")) {
    if (rng() < 0.5) {
      return make(
        unit,
        `각뿔의 옆면은 어떤 도형인가?`,
        "삼각형",
        `각뿔의 옆면은 밑면의 한 변과 각뿔의 꼭짓점을 이은 삼각형입니다.`,
        pyrFig,
      );
    }
    return make(
      unit,
      `밑면이 ${base}인 각뿔의 옆면은 모두 몇 개인가?`,
      num(sides),
      `옆면의 수는 밑면의 변의 수와 같습니다. ${base}의 변은 ${num(sides)}개이므로 옆면도 ${num(sides)}개입니다.`,
      pyrFig,
    );
  }

  if (s.includes("전개도")) {
    if (rng() < 0.5) {
      return make(
        unit,
        `밑면이 ${base}인 각기둥의 전개도입니다. 이 전개도를 접으면 어떤 입체도형이 되는가?`,
        prismName,
        `두 밑면이 ${base}이고 옆면이 직사각형이므로 ${prismName}이 됩니다.`,
        fig("prism", { sides, h: 3, net: true }),
      );
    }
    return make(
      unit,
      `밑면이 ${base}인 각기둥의 전개도에서 옆면인 직사각형은 모두 몇 개인가?`,
      num(sides),
      `옆면의 수는 밑면의 변의 수와 같습니다. ${base}의 변이 ${num(sides)}개이므로 직사각형도 ${num(sides)}개입니다.`,
      fig("prism", { sides, h: 3, net: true }),
    );
  }

  if (s.includes("이름") || s.includes("구성")) {
    const which = pick(rng, ["이름", "꼭짓점", "모서리", "면"]);
    if (which === "이름") {
      return make(
        unit,
        `밑면이 ${base}인 각기둥의 이름을 쓰시오.`,
        prismName,
        `각기둥의 이름은 밑면의 모양으로 정합니다. 밑면이 ${base}이므로 ${prismName}입니다.`,
        prismFig,
      );
    }
    if (which === "꼭짓점") {
      return make(
        unit,
        `${prismName}의 꼭짓점은 모두 몇 개인가?`,
        num(2 * sides),
        `두 밑면의 꼭짓점을 더합니다. ${expr(`${sides}\\times2=${2 * sides}`)}`,
        prismFig,
      );
    }
    if (which === "모서리") {
      return make(
        unit,
        `${prismName}의 모서리는 모두 몇 개인가?`,
        num(3 * sides),
        `두 밑면의 모서리 ${num(2 * sides)}개와 옆면의 모서리 ${num(sides)}개를 더합니다. ` +
          `${expr(`${2 * sides}+${sides}=${3 * sides}`)}`,
        prismFig,
      );
    }
    return make(
      unit,
      `${prismName}의 면은 모두 몇 개인가?`,
      num(sides + 2),
      `밑면 ${num(2)}개와 옆면 ${num(sides)}개를 더합니다. ${expr(`2+${sides}=${sides + 2}`)}`,
      prismFig,
    );
  }

  // 1-2-1 각기둥 알아보기와 밑면·옆면
  if (rng() < 0.4) {
    return make(
      unit,
      `각기둥에서 서로 평행하고 합동인 두 면을 무엇이라고 하는가?`,
      "밑면",
      `각기둥의 두 밑면은 서로 평행하고 합동입니다. 나머지 면은 옆면입니다.`,
      prismFig,
    );
  }
  return make(
    unit,
    `밑면이 ${base}인 각기둥의 옆면은 모두 몇 개인가?`,
    num(sides),
    `옆면의 수는 밑면의 변의 수와 같습니다. ${base}의 변이 ${num(sides)}개이므로 옆면도 ${num(sides)}개입니다.`,
    prismFig,
  );
}

// ───────────────────────── 1-3 소수의 나눗셈 ─────────────────────────

/** `a`·`q` 는 **×100 정수**. 부동소수점으로 몫을 만들지 않는다(R2). */
type DecCase = { a: number; b: number; q: number };

function decDivPool(keep: (c: DecCase) => boolean): DecCase[] {
  const out: DecCase[] = [];
  for (let b = 2; b <= 9; b += 1) {
    for (let q = 5; q <= 900; q += 1) {
      const a = b * q;
      if (a > 9900) break;
      const c = { a, b, q };
      if (keep(c)) out.push(c);
    }
  }
  return out;
}

/** 나누어지는 수가 **소수 한 자리**. */
const oneDecDividend = (c: DecCase) => c.a % 10 === 0 && c.a % 100 !== 0;

const DEC_DIV = {
  plain: decDivPool((c) => c.q > 100 && c.q % 10 === 0 && oneDecDividend(c)),
  underOne: decDivPool(
    (c) => c.q >= 20 && c.q < 100 && c.q % 10 === 0 && oneDecDividend(c),
  ),
  bringZero: decDivPool(
    (c) => c.q > 100 && c.q % 10 !== 0 && oneDecDividend(c),
  ),
  zeroTenth: decDivPool(
    (c) =>
      c.q > 100 &&
      c.q % 10 !== 0 &&
      Math.floor(c.q / 10) % 10 === 0 &&
      oneDecDividend(c),
  ),
  wholes: decDivPool((c) => c.a % 100 === 0 && c.a >= 1000 && c.q % 100 !== 0),
} as const;

function decDiv61(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;

  if (s.includes("어림셈")) {
    const c = pick(rng, DEC_DIV.wholes);
    const a = String(c.a / 100);
    const q = fromCents(c.q);
    return make(
      unit,
      `몫을 소수로 나타내시오.\n\n${expr(`${a}\\div${c.b}=\\square`)}`,
      expr(q),
      `자연수처럼 나눈 뒤 어림한 값으로 소수점의 위치를 확인합니다. ${expr(`${a}\\div${c.b}=${q}`)}`,
    );
  }

  if (s.includes("몫이 1보다 작은")) {
    const c = pick(rng, DEC_DIV.underOne);
    const a = fromCents(c.a);
    const q = fromCents(c.q);
    return make(
      unit,
      `몫을 구하시오.\n\n${expr(`${a}\\div${c.b}=\\square`)}`,
      expr(q),
      `나누어지는 수가 나누는 수보다 작으므로 몫의 자연수 부분에 ${num(0)}을 씁니다. ` +
        `${expr(`${a}\\div${c.b}=${q}`)}`,
    );
  }

  if (s.includes("소수 첫째 자리에 0")) {
    const c = pick(rng, DEC_DIV.zeroTenth);
    const a = fromCents(c.a);
    const q = fromCents(c.q);
    return make(
      unit,
      `몫을 구하시오.\n\n${expr(`${a}\\div${c.b}=\\square`)}`,
      expr(q),
      `나누어야 할 수가 나누는 수보다 작은 자리에는 몫에 ${num(0)}을 씁니다. ` +
        `${expr(`${a}\\div${c.b}=${q}`)}`,
    );
  }

  if (s.includes("0을 내려")) {
    const c = pick(rng, DEC_DIV.bringZero);
    const a = fromCents(c.a);
    const q = fromCents(c.q);
    return make(
      unit,
      `몫을 구하시오.\n\n${expr(`${a}\\div${c.b}=\\square`)}`,
      expr(q),
      `나누어떨어지지 않으면 소수점 아래에 ${num(0)}을 내려 계속 나눕니다. ${expr(`${a}\\div${c.b}=${q}`)}`,
    );
  }

  const c = pick(rng, DEC_DIV.plain);
  const a = fromCents(c.a);
  const q = fromCents(c.q);
  return make(
    unit,
    `몫을 구하시오.\n\n${expr(`${a}\\div${c.b}=\\square`)}`,
    expr(q),
    `자연수의 나눗셈처럼 계산한 뒤, 나누어지는 수의 소수점 자리에 맞추어 몫에 소수점을 찍습니다. ` +
      `${expr(`${a}\\div${c.b}=${q}`)}`,
  );
}

// ───────────────────────── 1-4 비와 비율 ─────────────────────────

const PAIR_ITEMS = [
  ["사과", "귤"],
  ["딸기", "포도"],
  ["빨간 구슬", "파란 구슬"],
  ["초콜릿", "사탕"],
  ["도넛", "빵"],
  ["풍선", "공"],
] as const;

/** 백분율이 자연수로 떨어지는 기준량. */
const PCT_DENOMS = [4, 5, 10, 20, 25, 50] as const;

function ratio(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const [x, y] = pick(rng, PAIR_ITEMS);

  if (s.includes("백분율이 사용되는")) {
    const kind = pick(rng, ["할인율", "찬성률", "성공률"]);
    if (kind === "할인율") {
      const before = pick(rng, [4000, 5000, 8000, 10000, 20000]);
      const rate = pick(rng, [10, 20, 25, 40]);
      const cut = (before * rate) / 100;
      return make(
        unit,
        `${num(before)}원짜리 물건을 ${num(before - cut)}원에 샀습니다. 할인율은 몇 %인가?`,
        num(rate),
        `할인 금액은 ${expr(`${before}-${before - cut}=${cut}`)} 원입니다. ` +
          `${expr(`\\frac{${cut}}{${before}}\\times100=${rate}`)} 이므로 ${expr(`${rate}\\%`)} 입니다.`,
      );
    }
    if (kind === "찬성률") {
      const total = pick(rng, [200, 250, 400, 500]);
      const rate = pick(rng, [15, 30, 45, 60]);
      const yes = (total * rate) / 100;
      return make(
        unit,
        `전체 ${num(total)}명 중 ${num(yes)}명이 찬성했습니다. 찬성률은 몇 %인가?`,
        num(rate),
        `${expr(`\\frac{${yes}}{${total}}\\times100=${rate}`)} 이므로 ${expr(`${rate}\\%`)} 입니다.`,
      );
    }
    const tries = pick(rng, [20, 25, 40, 50]);
    const rate = pick(rng, [20, 40, 60, 80]);
    const hit = (tries * rate) / 100;
    return make(
      unit,
      `공을 ${num(tries)}번 던져 ${num(hit)}번 성공했습니다. 성공률은 몇 %인가?`,
      num(rate),
      `${expr(`\\frac{${hit}}{${tries}}\\times100=${rate}`)} 이므로 ${expr(`${rate}\\%`)} 입니다.`,
    );
  }

  if (s.includes("백분율")) {
    const den = pick(rng, PCT_DENOMS);
    const top = coprimeTop(rng, den);
    const pct = (top * 100) / den;
    return make(
      unit,
      `다음 비율을 백분율로 나타내시오.\n\n${expr(`\\frac{${top}}{${den}}`)}`,
      num(pct),
      `비율에 ${num(100)}을 곱하고 기호 ${expr("\\%")} 를 붙입니다. ` +
        `${expr(`\\frac{${top}}{${den}}\\times100=${pct}`)}`,
    );
  }

  if (s.includes("비율이 사용되는")) {
    const kind = pick(rng, ["속력", "인구밀도", "진하기"]);
    if (kind === "속력") {
      const hours = intBetween(rng, 2, 6);
      const speed = pick(rng, [40, 50, 60, 70, 80]);
      return make(
        unit,
        `자동차가 ${num(speed * hours)} km를 가는 데 ${num(hours)}시간이 걸렸습니다. 걸린 시간에 대한 간 거리의 비율을 구하시오.`,
        num(speed),
        `기준량은 걸린 시간입니다. ${expr(`\\frac{${speed * hours}}{${hours}}=${speed}`)}`,
      );
    }
    if (kind === "인구밀도") {
      const area = intBetween(rng, 2, 8);
      const per = pick(rng, [150, 200, 300, 400]);
      return make(
        unit,
        `넓이가 ${num(area)} km²인 마을에 ${num(area * per)}명이 삽니다. 넓이에 대한 인구의 비율을 구하시오.`,
        num(per),
        `기준량은 넓이입니다. ${expr(`\\frac{${area * per}}{${area}}=${per}`)}`,
      );
    }
    const salt = pick(rng, [20, 30, 40, 50]);
    const water = pick(rng, [200, 250, 400, 500]);
    return make(
      unit,
      `소금 ${num(salt)} g을 녹여 소금물 ${num(water)} g을 만들었습니다. 소금물 양에 대한 소금 양의 비율을 분수로 나타내시오.`,
      expr(fmtFrac(salt, water)),
      `기준량은 소금물의 양입니다. ${expr(`\\frac{${salt}}{${water}}=${fmtFrac(salt, water)}`)}`,
    );
  }

  if (s.includes("비율")) {
    let a = intBetween(rng, 2, 9);
    let b = intBetween(rng, 3, 12);
    for (let t = 0; t < 20 && (gcd(a, b) !== 1 || a === b); t += 1) {
      a = intBetween(rng, 2, 9);
      b = intBetween(rng, 3, 12);
    }
    return make(
      unit,
      `비 ${expr(`${a}:${b}`)} 의 비율을 분수로 나타내시오.`,
      expr(`\\frac{${a}}{${b}}`),
      `${expr(`${a}:${b}`)} 에서 비교하는 양은 ${num(a)}, 기준량은 ${num(b)}입니다. ` +
        `(비율)=(비교하는 양)÷(기준량)이므로 ${expr(`\\frac{${a}}{${b}}`)} 입니다.`,
    );
  }

  if (s.includes("두 수 비교")) {
    const k = intBetween(rng, 2, 6);
    const b = intBetween(rng, 3, 9);
    return make(
      unit,
      `${x} ${num(b * k)}개와 ${y} ${num(b)}개가 있습니다. ${x} 수는 ${y} 수의 몇 배인지 나눗셈으로 비교하시오.`,
      num(k),
      `나눗셈으로 비교합니다. ${expr(`${b * k}\\div${b}=${k}`)}`,
    );
  }

  // 1-4-2 비
  const a = intBetween(rng, 2, 9);
  const b = intBetween(rng, 2, 9);
  return make(
    unit,
    `${x} ${num(a)}개와 ${y} ${num(b)}개가 있습니다. ${x} 수에 대한 ${y} 수의 비를 쓰시오.`,
    expr(`${b}:${a}`),
    `「에 대한」 앞에 있는 것이 기준량이므로 기준량은 ${x} 수 ${num(a)}입니다. ` +
      `비는 (비교하는 양):(기준량)으로 쓰므로 ${expr(`${b}:${a}`)} 입니다.`,
  );
}

// ───────────────────────── 1-5 여러 가지 그래프 ─────────────────────────

const GRAPH_THEMES = [
  { subject: "좋아하는 과일", items: ["사과", "배", "포도"] },
  { subject: "좋아하는 운동", items: ["축구", "농구", "배구", "야구"] },
  { subject: "학교에 오는 방법", items: ["버스", "지하철", "도보"] },
  { subject: "좋아하는 과목", items: ["국어", "수학", "영어", "과학"] },
  { subject: "즐겨 읽는 책", items: ["동화", "과학", "역사", "만화"] },
  { subject: "좋아하는 계절", items: ["봄", "여름", "가을", "겨울"] },
] as const;

function split100(rng: Rng, k: number): number[] {
  const min = 15;
  const step = 5;
  for (let t = 0; t < 40; t += 1) {
    const out: number[] = [];
    let left = 100;
    let ok = true;
    for (let i = 0; i < k - 1; i += 1) {
      const remain = k - 1 - i;
      const cap = Math.min(55, Math.floor((left - min * remain) / step) * step);
      if (cap < min) {
        ok = false;
        break;
      }
      const n = intBetween(rng, min / step, cap / step) * step;
      out.push(n);
      left -= n;
    }
    if (!ok || left < min || left > 60 || left % step !== 0) continue;
    out.push(left);
    return out;
  }
  return k === 4 ? [15, 20, 25, 40] : [20, 30, 50];
}

type ChartData = { subject: string; items: { label: string; pct: number }[] };

/** 백분율이 다 같으면 「가장 큰 것과 가장 작은 것의 차」가 $0$ 이 된다 — `spread` 로 막는다. */
function chartData(rng: Rng, spread = false): ChartData {
  let last: ChartData | null = null;
  for (let t = 0; t < 12; t += 1) {
    const theme = pick(rng, GRAPH_THEMES);
    const k = Math.min(theme.items.length, pick(rng, [3, 4]));
    const pcts = split100(rng, k);
    const items = theme.items
      .slice(0, k)
      .map((label, i) => ({ label, pct: pcts[i]! }));
    last = { subject: theme.subject, items };
    if (!spread || Math.max(...pcts) > Math.min(...pcts)) return last;
  }
  const fallback = last!;
  fallback.items[0]!.pct += 5;
  fallback.items[1]!.pct -= 5;
  return fallback;
}

/** 전체 수량. 백분율이 $5$ 의 배수이므로 $20$ 의 배수면 항목 수량이 자연수로 떨어진다. */
const CHART_TOTALS = [100, 200, 300, 400] as const;

function twoLabels(rng: Rng, items: { label: string; pct: number }[]) {
  const i = intBetween(rng, 0, items.length - 1);
  const j = (i + intBetween(rng, 1, items.length - 1)) % items.length;
  return [items[i]!, items[j]!] as const;
}

function graphs61(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;

  if (s.includes("비교하기")) {
    const { subject, items } = chartData(rng, true);
    const usePie = rng() < 0.5;
    const kindName = usePie ? "원그래프" : "띠그래프";
    const pcts = items.map((it) => it.pct);
    const max = Math.max(...pcts);
    const min = Math.min(...pcts);
    return make(
      unit,
      `학생들의 ${subject}을 조사하여 나타낸 ${kindName}입니다. 비율이 가장 높은 항목과 가장 낮은 항목의 비율의 차는 몇 %인가?`,
      num(max - min),
      `가장 높은 비율은 ${expr(`${max}\\%`)}, 가장 낮은 비율은 ${expr(`${min}\\%`)} 입니다. ` +
        `${expr(`${max}-${min}=${max - min}`)}`,
      usePie
        ? fig("pieChart", { slices: items })
        : fig("stripChart", { segments: items }),
    );
  }

  if (s.includes("원그래프로 나타내기")) {
    const { subject, items } = chartData(rng);
    const total = pick(rng, CHART_TOTALS);
    const [one, two] = twoLabels(rng, items);
    const sum = one.pct + two.pct;
    const people = (total * sum) / 100;
    return make(
      unit,
      `학생 ${num(total)}명의 ${subject}을 조사하여 나타낸 원그래프입니다. ` +
        `${one.label}${josa(one.label, "과", "와")} ${two.label}${josa(two.label, "을", "를")} 고른 학생은 모두 몇 명인가?`,
      num(people),
      `두 항목의 비율은 ${expr(`${one.pct}+${two.pct}=${sum}`)} 이므로 ${expr(`${sum}\\%`)} 입니다. ` +
        `${expr(`${total}\\times\\frac{${sum}}{100}=${people}`)}`,
      fig("pieChart", { slices: items }),
    );
  }

  if (s.includes("원그래프")) {
    const { subject, items } = chartData(rng);
    const [one, two] = twoLabels(rng, items);
    const sum = one.pct + two.pct;
    return make(
      unit,
      `학생들의 ${subject}을 조사하여 나타낸 원그래프입니다. ` +
        `${one.label}${josa(one.label, "과", "와")} ${two.label}의 비율의 합은 몇 %인가?`,
      num(sum),
      `${one.label}${josa(one.label, "은", "는")} ${expr(`${one.pct}\\%`)}, ` +
        `${two.label}${josa(two.label, "은", "는")} ${expr(`${two.pct}\\%`)} 이므로 ` +
        `${expr(`${one.pct}+${two.pct}=${sum}`)} 입니다.`,
      fig("pieChart", { slices: items }),
    );
  }

  if (s.includes("띠그래프로 나타내기")) {
    const { subject, items } = chartData(rng);
    const width = pick(rng, [20, 40]);
    const one = items[intBetween(rng, 0, items.length - 1)]!;
    const len = (width * one.pct) / 100;
    return make(
      unit,
      `학생들의 ${subject}을 조사한 결과입니다. 이 자료를 전체 길이가 ${unitNum(width, "cm")} 인 띠그래프로 나타낼 때, ` +
        `${one.label}${josa(one.label, "이", "가")} 차지하는 부분의 길이는 몇 cm인가?`,
      num(len),
      `${one.label}${josa(one.label, "은", "는")} 전체의 ${expr(`${one.pct}\\%`)} 입니다. ` +
        `${expr(`${width}\\times\\frac{${one.pct}}{100}=${len}`)}`,
      fig("stripChart", { segments: items }),
    );
  }

  const { subject, items } = chartData(rng);
  const total = pick(rng, CHART_TOTALS);
  const one = items[intBetween(rng, 0, items.length - 1)]!;
  const people = (total * one.pct) / 100;
  return make(
    unit,
    `학생 ${num(total)}명의 ${subject}을 조사하여 나타낸 띠그래프입니다. ` +
      `${one.label}${josa(one.label, "을", "를")} 고른 학생은 몇 명인가?`,
    num(people),
    `${one.label}${josa(one.label, "은", "는")} 전체의 ${expr(`${one.pct}\\%`)} 입니다. ` +
      `${expr(`${total}\\times\\frac{${one.pct}}{100}=${people}`)}`,
    fig("stripChart", { segments: items }),
  );
}

// ───────────────────── 1-6 직육면체의 겉넓이와 부피 ─────────────────────

function volume(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;

  if (s.includes("㎥") || s.includes("m³")) {
    const which = pick(rng, ["toCm", "toM", "box"]);
    if (which === "toCm") {
      const k = intBetween(rng, 1, 9);
      return make(
        unit,
        `${expr("\\square")} 안에 알맞은 수를 써넣으시오.\n\n${expr(`${k}\\,\\mathrm{m}^3=\\square\\,\\mathrm{cm}^3`)}`,
        num(k * 1000000),
        `${expr("1\\,\\mathrm{m}=100\\,\\mathrm{cm}")} 이므로 ${expr("1\\,\\mathrm{m}^3=1000000\\,\\mathrm{cm}^3")} 입니다. ` +
          `${expr(`${k}\\times1000000=${k * 1000000}`)}`,
      );
    }
    if (which === "toM") {
      const k = intBetween(rng, 2, 9);
      return make(
        unit,
        `${expr("\\square")} 안에 알맞은 수를 써넣으시오.\n\n${expr(`${k * 1000000}\\,\\mathrm{cm}^3=\\square\\,\\mathrm{m}^3`)}`,
        num(k),
        `${expr("1000000\\,\\mathrm{cm}^3=1\\,\\mathrm{m}^3")} 이므로 ${expr(`${k * 1000000}\\div1000000=${k}`)} 입니다.`,
      );
    }
    const w = intBetween(rng, 2, 6);
    const d = intBetween(rng, 2, 5);
    const h = intBetween(rng, 2, 4);
    return make(
      unit,
      `가로 ${unitNum(w, "m")}, 세로 ${unitNum(d, "m")}, 높이 ${unitNum(h, "m")} 인 직육면체의 부피는 몇 m³인가?`,
      num(w * d * h),
      `${expr(`${w}\\times${d}\\times${h}=${w * d * h}`)}`,
      fig("cuboid", { w, d, h }),
    );
  }

  if (s.includes("겉넓이")) {
    if (rng() < 0.35) {
      const a = intBetween(rng, 2, 8);
      return make(
        unit,
        `한 모서리의 길이가 ${unitNum(a, "cm")} 인 정육면체의 겉넓이는 몇 cm²인가?`,
        num(6 * a * a),
        `정육면체의 면은 모두 합동인 정사각형 ${num(6)}개입니다. ${expr(`${a}\\times${a}\\times6=${6 * a * a}`)}`,
        fig("cuboid", { w: a, d: a, h: a }),
      );
    }
    const w = intBetween(rng, 2, 8);
    const d = intBetween(rng, 2, 6);
    const h = intBetween(rng, 2, 7);
    const area = 2 * (w * d + d * h + h * w);
    return make(
      unit,
      `가로 ${unitNum(w, "cm")}, 세로 ${unitNum(d, "cm")}, 높이 ${unitNum(h, "cm")} 인 직육면체의 겉넓이는 몇 cm²인가?`,
      num(area),
      `마주 보는 면끼리 합동이므로 세 종류의 면을 더해 ${num(2)}배 합니다. ` +
        `${expr(`(${w}\\times${d}+${d}\\times${h}+${h}\\times${w})\\times2=${area}`)}`,
      fig("cuboid", { w, d, h }),
    );
  }

  const w = intBetween(rng, 2, 8);
  const d = intBetween(rng, 2, 6);
  const h = intBetween(rng, 2, 7);
  return make(
    unit,
    `가로 ${unitNum(w, "cm")}, 세로 ${unitNum(d, "cm")}, 높이 ${unitNum(h, "cm")} 인 직육면체의 부피는 몇 cm³인가?`,
    num(w * d * h),
    `(직육면체의 부피)=(가로)×(세로)×(높이)입니다. ${expr(`${w}\\times${d}\\times${h}=${w * d * h}`)}`,
    fig("cuboid", { w, d, h }),
  );
}

// ───────────────────────── 2-1 분수의 나눗셈 ─────────────────────────

function fracDiv62(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;

  if (s.includes("(자연수)÷(분수)")) {
    const k = intBetween(rng, 2, 8);
    const d = intBetween(rng, 3, 9);
    const top = coprimeTop(rng, d, 2);
    const [p, q] = divFrac(k, 1, top, d);
    return make(
      unit,
      `다음을 계산하시오.\n\n${expr(`${k}\\div\\frac{${top}}{${d}}=\\square`)}`,
      expr(fmtFrac(p, q)),
      `나누는 수의 분모와 분자를 바꾸어 곱합니다. ` +
        `${expr(`${k}\\div\\frac{${top}}{${d}}=${k}\\times\\frac{${d}}{${top}}=${fmtFrac(p, q)}`)}`,
    );
  }

  if (s.includes("(분수)×(분수)로")) {
    const d1 = intBetween(rng, 3, 9);
    const n1 = coprimeTop(rng, d1);
    const d2 = intBetween(rng, 3, 8);
    const n2 = coprimeTop(rng, d2, 2);
    return make(
      unit,
      `다음 나눗셈식을 곱셈식으로 나타내시오.\n\n${expr(`\\frac{${n1}}{${d1}}\\div\\frac{${n2}}{${d2}}`)}`,
      expr(`\\frac{${n1}}{${d1}}\\times\\frac{${d2}}{${n2}}`),
      `나누는 수 ${expr(`\\frac{${n2}}{${d2}}`)} 의 분모와 분자를 바꾼 수를 곱합니다.`,
    );
  }

  if (s.includes("(가분수)") || s.includes("(대분수)")) {
    const d1 = intBetween(rng, 2, 6);
    const w = intBetween(rng, 1, 3);
    const t1 = coprimeTop(rng, d1);
    const imp = w * d1 + t1; // `w >= 1`·`t1 >= 1` 이므로 `imp > d1` — 반드시 가분수다.
    const d2 = intBetween(rng, 3, 8);
    // 소단원 이름이 **가분수와 대분수 둘 다** 내걸었다. 씨앗마다 갈라 내되,
    // 대분수 쪽은 **나누는 수를 가분수**로 두어 어느 씨앗에서도 가분수가 지면에 선다.
    const dividendImproper = rng() < 0.5;
    const n2 = dividendImproper
      ? coprimeTop(rng, d2, 2)
      : coprimeTop(rng, d2, d2 + 1, d2 + 6);
    const [p, q] = mulFrac(imp, d1, d2, n2);
    const flip = expr(
      `\\frac{${imp}}{${d1}}\\times\\frac{${d2}}{${n2}}=${fmtFrac(p, q)}`,
    );
    if (dividendImproper) {
      return make(
        unit,
        `다음을 계산하시오.\n\n${expr(`\\frac{${imp}}{${d1}}\\div\\frac{${n2}}{${d2}}=\\square`)}`,
        expr(fmtFrac(p, q)),
        `가분수는 그대로 두고 나누는 수의 분모와 분자를 바꾸어 곱합니다. ${flip}`,
      );
    }
    return make(
      unit,
      `다음을 계산하시오.\n\n${expr(`${w}\\frac{${t1}}{${d1}}\\div\\frac{${n2}}{${d2}}=\\square`)}`,
      expr(fmtFrac(p, q)),
      `대분수를 가분수로 고칩니다. ${expr(`${w}\\frac{${t1}}{${d1}}=\\frac{${imp}}{${d1}}`)} 이므로 ` +
        `나누는 수의 분모와 분자를 바꾸어 곱합니다. ${flip}`,
    );
  }

  if (s.includes("분모가 다른")) {
    const d1 = intBetween(rng, 2, 7);
    // 소단원 이름이 「분모가 **다른**」이다 — 같아지면 그 소단원이 아니다.
    // 이 조건은 `probe-elem-section-conditions.ts` 가 «미판정» 으로 흘리므로 여기서 못 박는다.
    let d2 = intBetween(rng, 2, 9);
    for (let t = 0; t < 20 && d2 === d1; t += 1) d2 = intBetween(rng, 2, 9);
    if (d2 === d1) d2 = d1 === 9 ? 8 : d1 + 1;
    const n1 = coprimeTop(rng, d1);
    const n2 = coprimeTop(rng, d2);
    const L = lcm(d1, d2);
    const x = (n1 * L) / d1;
    const y = (n2 * L) / d2;
    const [p, q] = divFrac(n1, d1, n2, d2);
    return make(
      unit,
      `다음을 계산하시오.\n\n${expr(`\\frac{${n1}}{${d1}}\\div\\frac{${n2}}{${d2}}=\\square`)}`,
      expr(fmtFrac(p, q)),
      `분모를 같게 통분한 뒤 분자끼리 나눕니다. ` +
        `${expr(`\\frac{${x}}{${L}}\\div\\frac{${y}}{${L}}=${x}\\div${y}=${fmtFrac(p, q)}`)}`,
    );
  }

  // 2-1-1 분모가 같은 (분수)÷(분수)
  const d = intBetween(rng, 3, 9);
  let a = coprimeTop(rng, d);
  let b = coprimeTop(rng, d);
  for (let t = 0; t < 20 && a === b; t += 1) b = coprimeTop(rng, d);
  if (a === b) a = ((a % (d - 1)) + 1) % d || 1;
  return make(
    unit,
    `다음을 계산하시오.\n\n${expr(`\\frac{${a}}{${d}}\\div\\frac{${b}}{${d}}=\\square`)}`,
    expr(fmtFrac(a, b)),
    `분모가 같으면 분자끼리 나눕니다. ` +
      `${expr(`\\frac{${a}}{${d}}\\div\\frac{${b}}{${d}}=${a}\\div${b}=${fmtFrac(a, b)}`)}`,
  );
}

// ───────────────────────── 2-2 소수의 나눗셈 ─────────────────────────

/** 자릿수가 **같은** (소수)÷(소수). `a`·`b` 는 ×10, `q` 는 자연수. */
const SAME_DIGIT: { a: number; b: number; q: number }[] = [];
/** 자릿수가 **다른** (소수)÷(소수). `a`·`q` 는 ×100, `b` 는 ×10. */
const DIFF_DIGIT: { a: number; b: number; q: number }[] = [];
/** (자연수)÷(소수). `a` 는 자연수, `b` 는 ×10, `q` 는 자연수. */
const NAT_BY_DEC: { a: number; b: number; q: number }[] = [];
for (let b = 11; b <= 49; b += 1) {
  if (b % 10 === 0) continue;
  for (let q = 2; q <= 9; q += 1) {
    const a = b * q;
    if (a <= 900 && a % 10 !== 0) SAME_DIGIT.push({ a, b, q });
  }
  for (let q = 105; q <= 900; q += 1) {
    const prod = b * q;
    if (prod % 10 !== 0) continue;
    const a = prod / 10;
    if (a % 10 === 0 || a > 5000) continue;
    DIFF_DIGIT.push({ a, b, q });
  }
  for (let q = 2; q <= 12; q += 1) {
    const prod = b * q;
    if (prod % 10 === 0) NAT_BY_DEC.push({ a: prod / 10, b, q });
  }
}

/** 반올림 문항의 나누는 수 — 몫이 딱 떨어지지 않아야 「반올림」이 뜻을 가진다. */
const ROUND_DIVISORS = [3, 6, 7, 9, 11, 12, 13] as const;

const SHARE_THEMES = [
  { item: "끈", unit: "m", measure: "길이" },
  { item: "철사", unit: "m", measure: "길이" },
  { item: "리본", unit: "m", measure: "길이" },
  { item: "주스", unit: "L", measure: "양" },
  { item: "물", unit: "L", measure: "양" },
] as const;

function decDiv62(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;

  if (s.includes("남는")) {
    const t = pick(rng, SHARE_THEMES);
    const per = intBetween(rng, 2, 6);
    const people = intBetween(rng, 3, 7);
    const rem10 = intBetween(rng, 0, per - 1) * 10 + intBetween(rng, 1, 9);
    const total10 = people * per * 10 + rem10;
    const total = decStr(total10, 1);
    const rem = decStr(rem10, 1);
    return make(
      unit,
      `${t.measure}가 ${unitNum(total, t.unit)} 인 ${t.item}${josa(t.item, "을", "를")} 한 사람에게 ${unitNum(per, t.unit)} 씩 나누어 주려고 합니다. ` +
        `몇 명에게 나누어 줄 수 있고 몇 ${t.unit}가 남는지 구하시오.`,
      `${num(people)}명, ${unitNum(rem, t.unit)}`,
      `${expr(`${per}\\times${people}=${per * people}`)} 이므로 ${num(people)}명에게 나누어 줄 수 있고, ` +
        `${expr(`${total}-${per * people}=${rem}`)} 만큼 남습니다.`,
    );
  }

  if (s.includes("반올림")) {
    const place = pick(rng, [1, 2]);
    const b = pick(rng, ROUND_DIVISORS);
    const shownOf = (x: number) => Math.floor((x * 10 ** (place + 1)) / b);
    const cutOf = (x: number) => {
      const scale = x * 10 ** place;
      return Math.floor(scale / b) + ((scale % b) * 2 >= b ? 1 : 0);
    };
    /**
     * 쓸 수 있는 나누어지는 수인가.
     * ㉠ 딱 떨어지면 「반올림」이 뜻이 없다. ㉡ 해설에 보일 자리에서 끝나도 `\ldots` 가 거짓말이 된다.
     * ㉢·㉣ **꼬리 $0$** 이면 `8.090\ldots`·`3.0` 이 되는데 초등 지면에 그렇게 쓰지 않는다.
     */
    const usable = (x: number) =>
      x % b !== 0 &&
      (x * 10 ** (place + 1)) % b !== 0 &&
      shownOf(x) % 10 !== 0 &&
      cutOf(x) % 10 !== 0;
    let a = intBetween(rng, 11, 99);
    for (let t = 0; t < 40 && !usable(a); t += 1) a = intBetween(rng, 11, 99);
    if (!usable(a)) {
      // 무작위로 못 찾으면 훑어서 고른다. 하나도 없으면 **던진다** — 조용히 나쁜 값을 내지 않는다.
      const found = Array.from({ length: 89 }, (_, i) => i + 11).find(usable);
      if (found === undefined) {
        throw new Error(
          `반올림 문항을 만들 수 없습니다: 나누는 수 ${b}, 소수 ${place}자리`,
        );
      }
      a = found;
    }
    const shown = shownOf(a);
    const cut = cutOf(a);
    const placeName = place === 1 ? "첫" : "둘";
    const nextName = place === 1 ? "둘" : "셋";
    return make(
      unit,
      `${expr(`${a}\\div${b}`)} 의 몫을 반올림하여 소수 ${placeName}째 자리까지 나타내시오.`,
      expr(decStr(cut, place)),
      `몫은 ${expr(`${decStr(shown, place + 1)}\\ldots`)} 입니다. 소수 ${nextName}째 자리에서 반올림하면 ` +
        `${expr(decStr(cut, place))} 입니다.`,
    );
  }

  if (s.includes("(자연수)÷(소수)")) {
    const c = pick(rng, NAT_BY_DEC);
    const b = decStr(c.b, 1);
    return make(
      unit,
      `몫을 구하시오.\n\n${expr(`${c.a}\\div${b}=\\square`)}`,
      num(c.q),
      `나누는 수와 나누어지는 수의 소수점을 각각 오른쪽으로 한 자리씩 옮겨 계산합니다. ` +
        `${expr(`${c.a * 10}\\div${c.b}=${c.q}`)}`,
    );
  }

  if (s.includes("자릿수가 다른")) {
    const c = pick(rng, DIFF_DIGIT);
    const a = decStr(c.a, 2);
    const b = decStr(c.b, 1);
    const q = fromCents(c.q);
    return make(
      unit,
      `몫을 구하시오.\n\n${expr(`${a}\\div${b}=\\square`)}`,
      expr(q),
      `나누는 수가 자연수가 되도록 두 수의 소수점을 함께 한 자리씩 옮겨 ` +
        `${expr(`${decStr(c.a, 1)}\\div${c.b}`)} 로 계산합니다. ${expr(`${a}\\div${b}=${q}`)}`,
    );
  }

  const c = pick(rng, SAME_DIGIT);
  const a = decStr(c.a, 1);
  const b = decStr(c.b, 1);
  return make(
    unit,
    `몫을 구하시오.\n\n${expr(`${a}\\div${b}=\\square`)}`,
    num(c.q),
    `두 수의 소수점을 함께 오른쪽으로 한 자리씩 옮기면 ${expr(`${c.a}\\div${c.b}=${c.q}`)} 이므로 몫은 ${num(c.q)}입니다.`,
  );
}

// ───────────────────────── 2-3 공간과 입체 ─────────────────────────

function heightGrid(rng: Rng, cols: number, rows: number): number[][] {
  const h: number[][] = [];
  for (let y = 0; y < rows; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < cols; x += 1) row.push(intBetween(rng, 0, 3));
    h.push(row);
  }
  // 발문이 격자 크기를 말하므로 **가장자리 줄이 비면 안 된다** — 그림이 작아져 말과 어긋난다.
  for (let y = 0; y < rows; y += 1) {
    if (h[y]!.every((v) => v === 0))
      h[y]![intBetween(rng, 0, cols - 1)] = intBetween(rng, 1, 3);
  }
  for (let x = 0; x < cols; x += 1) {
    if (h.every((row) => row[x] === 0))
      h[intBetween(rng, 0, rows - 1)]![x] = intBetween(rng, 1, 3);
  }
  // 「2층에 놓인 개수」가 늘 $0$ 이 되지 않게 적어도 한 자리는 두 층 이상.
  if (Math.max(...h.flat()) < 2) {
    h[intBetween(rng, 0, rows - 1)]![intBetween(rng, 0, cols - 1)] = intBetween(
      rng,
      2,
      3,
    );
  }
  return h;
}

function heightsToVoxels(h: number[][]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let y = 0; y < h.length; y += 1) {
    const row = h[y]!;
    for (let x = 0; x < row.length; x += 1) {
      for (let z = 0; z < row[x]!; z += 1) out.push([x, y, z]);
    }
  }
  return out;
}

function stacking(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  // 바닥이 넓을수록 발문·그림이 갈린다. `4\times4` 는 최대 $48$ 개로 엔진 한도에 딱 붙어 뺀다.
  const cols = intBetween(rng, 2, 4);
  const rows = cols === 4 ? intBetween(rng, 2, 3) : intBetween(rng, 2, 4);
  const h = heightGrid(rng, cols, rows);
  const flat = h.flat();
  const voxels = heightsToVoxels(h);
  const total = voxels.length;
  const floorCells = flat.filter((v) => v > 0).length;
  const maxH = Math.max(...flat);
  const grid = `가로 ${num(cols)}칸, 세로 ${num(rows)}칸`;

  if (s.includes("어느 방향")) {
    return make(
      unit,
      `${grid} 바닥에 쌓기나무를 쌓은 모양입니다. 이 모양을 위에서 보면 몇 칸이 보이는가?`,
      num(floorCells),
      `위에서 보면 쌓기나무가 놓인 자리가 한 칸씩 보입니다. 놓인 자리가 ${num(floorCells)}곳이므로 ${num(floorCells)}칸입니다.`,
      fig("stackCubes", { voxels, views: ["iso"] }),
    );
  }

  if (s.includes("(1)")) {
    return make(
      unit,
      `${grid} 바닥에 쌓은 모양과 위에서 본 모양입니다. 사용한 쌓기나무는 모두 몇 개인가?`,
      num(total),
      `위에서 본 모양의 각 칸에 적힌 층수를 모두 더합니다. ${expr(`${flat.filter((v) => v > 0).join("+")}=${total}`)}`,
      fig("stackCubes", { voxels, views: ["iso", "top"] }),
    );
  }

  if (s.includes("(2)")) {
    return make(
      unit,
      `${grid} 바닥에 쌓은 모양을 위에서 본 것입니다. 각 칸의 수는 그 자리에 쌓은 층수입니다. 사용한 쌓기나무는 모두 몇 개인가?`,
      num(total),
      `칸에 적힌 수가 그 자리에 쌓은 쌓기나무의 개수입니다. ${expr(`${flat.filter((v) => v > 0).join("+")}=${total}`)}`,
      fig("stackCubes", { voxels, views: ["top"] }),
    );
  }

  if (s.includes("(3)")) {
    const layer = maxH >= 3 ? pick(rng, [2, 3]) : 2;
    const count = flat.filter((v) => v >= layer).length;
    return make(
      unit,
      `${grid} 바닥에 쌓은 모양입니다. ${num(layer)}층에 놓인 쌓기나무는 몇 개인가?`,
      num(count),
      `${num(layer)}층에 쌓기나무가 있으려면 그 자리가 ${num(layer)}층 이상이어야 합니다. 그런 자리는 ${num(count)}곳입니다.`,
      fig("stackCubes", { voxels, views: ["iso", "top"] }),
    );
  }

  if (s.includes("(4)")) {
    const box = cols * rows * maxH;
    const target = box === total ? maxH + 1 : maxH;
    const need = cols * rows * target - total;
    return make(
      unit,
      `${grid} 바닥에 쌓은 모양입니다. 여기에 쌓기나무를 더 쌓아 ${grid}, 높이 ${num(target)}층인 직육면체 모양을 만들려면 쌓기나무가 몇 개 더 필요한가?`,
      num(need),
      `직육면체 모양에 필요한 쌓기나무는 ${expr(`${cols}\\times${rows}\\times${target}=${cols * rows * target}`)} 개입니다. ` +
        `지금 ${num(total)}개를 썼으므로 ${expr(`${cols * rows * target}-${total}=${need}`)} 개가 더 필요합니다.`,
      fig("stackCubes", { voxels, views: ["iso", "top"] }),
    );
  }

  const copies = pick(rng, [2, 3]);
  return make(
    unit,
    `${grid} 바닥에 쌓기나무로 만든 모양입니다. 이와 똑같은 모양 ${num(copies)}개를 붙여 새로운 모양을 만들었습니다. 새로 만든 모양에 사용한 쌓기나무는 모두 몇 개인가?`,
    num(copies * total),
    `한 모양에 쓴 쌓기나무는 ${num(total)}개입니다. ${expr(`${total}\\times${copies}=${copies * total}`)}`,
    fig("stackCubes", { voxels, views: ["iso", "top"] }),
  );
}

// ───────────────────── 2-4 비례식과 비례배분 ─────────────────────

const SHARE_PAIRS = [
  { one: "형", two: "동생" },
  { one: "언니", two: "동생" },
  { one: "지호", two: "서연" },
  { one: "민준", two: "수아" },
] as const;

const SHARE_GOODS = ["사탕", "구슬", "딱지", "초콜릿"] as const;

function proportion(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;

  if (s.includes("비례배분")) {
    const pair = pick(rng, SHARE_PAIRS);
    const goods = pick(rng, SHARE_GOODS);
    const a = intBetween(rng, 2, 5);
    let b = intBetween(rng, 2, 5);
    // 비례배분의 비는 이미 «가장 간단한 자연수의 비»여야 한다 — `2:4` 는 교재에 안 쓴다.
    for (let t = 0; t < 20 && (b === a || gcd(a, b) !== 1); t += 1)
      b = intBetween(rng, 2, 5);
    if (gcd(a, b) !== 1) b = a === 2 ? 3 : 2;
    const k = intBetween(rng, 3, 9);
    const total = (a + b) * k;
    const mine = a * k;
    return make(
      unit,
      `${goods} ${num(total)}개를 ${pair.one}${josa(pair.one, "과", "와")} ${pair.two}${josa(pair.two, "이", "가")} ` +
        `${expr(`${a}:${b}`)} 의 비로 나누어 가지려고 합니다. ${pair.one}${josa(pair.one, "이", "가")} 갖는 ${goods}${josa(goods, "은", "는")} 몇 개인가?`,
      num(mine),
      `전체를 ${expr(`${a}+${b}=${a + b}`)} 묶음으로 나누면 한 묶음은 ${expr(`${total}\\div${a + b}=${k}`)} 개입니다. ` +
        `${pair.one}${josa(pair.one, "은", "는")} ${num(a)}묶음이므로 ${expr(`${k}\\times${a}=${mine}`)} 개입니다.`,
    );
  }

  if (s.includes("비례식의 성질")) {
    const a = intBetween(rng, 2, 9);
    const b = intBetween(rng, 2, 9);
    const k = intBetween(rng, 2, 6);
    return make(
      unit,
      `${expr("\\square")} 안에 알맞은 수를 구하시오.\n\n${expr(`${a}:${b}=${a * k}:\\square`)}`,
      num(b * k),
      `비례식에서 외항의 곱과 내항의 곱은 같습니다. ` +
        `${expr(`${a}\\times\\square=${b}\\times${a * k}=${b * a * k}`)} 이므로 ` +
        `${expr(`\\square=${b * a * k}\\div${a}=${b * k}`)} 입니다.`,
    );
  }

  if (s.includes("비례식")) {
    const a = intBetween(rng, 2, 9);
    const b = intBetween(rng, 2, 9);
    const k = intBetween(rng, 2, 5);
    const outer = rng() < 0.5;
    return make(
      unit,
      `비례식 ${expr(`${a}:${b}=${a * k}:${b * k}`)} 에서 ${outer ? "외항" : "내항"}을 모두 쓰시오.`,
      outer ? expr(`${a},\\ ${b * k}`) : expr(`${b},\\ ${a * k}`),
      outer
        ? `비례식의 바깥쪽에 있는 두 수가 외항입니다. ${expr(`${a},\\ ${b * k}`)} 입니다.`
        : `비례식의 안쪽에 있는 두 수가 내항입니다. ${expr(`${b},\\ ${a * k}`)} 입니다.`,
    );
  }

  if (s.includes("간단한 자연수의 비")) {
    const kind = pick(rng, ["자연수", "소수", "분수"]);
    if (kind === "소수") {
      const a = intBetween(rng, 2, 9);
      const b = intBetween(rng, 2, 9);
      const g = gcd(a, b);
      return make(
        unit,
        `다음 비를 가장 간단한 자연수의 비로 나타내시오.\n\n${expr(`0.${a}:0.${b}`)}`,
        expr(`${a / g}:${b / g}`),
        `소수 첫째 자리까지 있으므로 두 항에 ${num(10)}배를 하면 ${expr(`${a}:${b}`)} 입니다. ` +
          `두 항을 최대공약수로 나누면 ${expr(`${a / g}:${b / g}`)} 입니다.`,
      );
    }
    if (kind === "분수") {
      const d1 = intBetween(rng, 2, 6);
      const d2 = intBetween(rng, 2, 6);
      const L = lcm(d1, d2);
      const x = L / d1;
      const y = L / d2;
      const g = gcd(x, y);
      return make(
        unit,
        `다음 비를 가장 간단한 자연수의 비로 나타내시오.\n\n${expr(`\\frac{1}{${d1}}:\\frac{1}{${d2}}`)}`,
        expr(`${x / g}:${y / g}`),
        `두 항에 분모의 최소공배수를 곱하면 ${expr(`${x}:${y}`)} 입니다. ` +
          `두 항을 최대공약수로 나누면 ${expr(`${x / g}:${y / g}`)} 입니다.`,
      );
    }
    const g = intBetween(rng, 2, 9);
    const a = intBetween(rng, 2, 9);
    let b = intBetween(rng, 2, 9);
    for (let t = 0; t < 20 && (b === a || gcd(a, b) !== 1); t += 1)
      b = intBetween(rng, 2, 9);
    return make(
      unit,
      `다음 비를 가장 간단한 자연수의 비로 나타내시오.\n\n${expr(`${a * g}:${b * g}`)}`,
      expr(`${a}:${b}`),
      `두 항을 최대공약수로 나눕니다. ${expr(`${a * g}\\div${g}:${b * g}\\div${g}=${a}:${b}`)}`,
    );
  }

  // 2-4-1 비의 성질
  const a = intBetween(rng, 2, 9);
  const b = intBetween(rng, 2, 9);
  if (rng() < 0.5) {
    const g = gcd(a, b);
    const k = intBetween(rng, 2, 6);
    return make(
      unit,
      `다음 비와 비율이 같은 비 중에서 후항이 ${num(b / g)} 인 비를 쓰시오.\n\n${expr(`${a * k}:${b * k}`)}`,
      expr(`${a / g}:${b / g}`),
      `비의 전항과 후항을 ${num(0)}이 아닌 같은 수로 나누어도 비율은 같습니다. ` +
        `${expr(`${a * k}:${b * k}`)} 의 두 항을 ${expr(`${g * k}`)} 로 나누면 ${expr(`${a / g}:${b / g}`)} 입니다.`,
    );
  }
  const k = intBetween(rng, 2, 7);
  return make(
    unit,
    `비 ${expr(`${a}:${b}`)} 의 전항과 후항에 각각 ${num(k)}배를 하면 어떤 비가 되는가?`,
    expr(`${a * k}:${b * k}`),
    `비의 전항과 후항에 ${num(0)}이 아닌 같은 수를 곱해도 비율은 같습니다. ` +
      `${expr(`${a}\\times${k}:${b}\\times${k}=${a * k}:${b * k}`)}`,
  );
}

// ───────────────────── 2-5 원의 둘레와 넓이 ─────────────────────

function circle62(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;

  if (s.includes("원주율")) {
    const which = pick(rng, ["이름", "나눗셈", "일정", "계산"]);
    if (which === "이름") {
      return make(
        unit,
        "원의 둘레를 무엇이라고 하는가?",
        "원주",
        "원의 둘레를 원주라고 합니다.",
      );
    }
    if (which === "나눗셈") {
      return make(
        unit,
        "원주율은 원주를 무엇으로 나눈 값인가?",
        "지름",
        "(원주율)=(원주)÷(지름)입니다.",
      );
    }
    if (which === "일정") {
      return make(
        unit,
        "원의 크기가 달라지면 (원주)÷(지름)의 값은 어떻게 되는가?",
        "항상 일정하다",
        "원의 크기와 상관없이 (원주)÷(지름)의 값은 항상 일정하며, 이 값을 원주율이라고 합니다.",
      );
    }
    const d = pick(rng, [5, 10, 20, 50]);
    const c = fromCents(314 * d);
    return make(
      unit,
      `지름이 ${unitNum(d, "cm")} 인 원의 원주가 ${unitNum(c, "cm")} 입니다. (원주)÷(지름)의 값을 구하시오.`,
      num("3.14"),
      `${expr(`${c}\\div${d}=3.14`)}`,
    );
  }

  if (s.includes("원주와 지름")) {
    const which = pick(rng, ["원주지름", "원주반지름", "지름"]);
    if (which === "원주지름") {
      const d = intBetween(rng, 3, 12);
      return make(
        unit,
        `지름이 ${unitNum(d, "cm")} 인 원의 원주는 몇 cm인가? (원주율: ${num("3.14")})`,
        num(fromCents(314 * d)),
        `(원주)=(지름)×(원주율)입니다. ${expr(`${d}\\times3.14=${fromCents(314 * d)}`)}`,
      );
    }
    if (which === "원주반지름") {
      const r = intBetween(rng, 2, 9);
      return make(
        unit,
        `반지름이 ${unitNum(r, "cm")} 인 원의 원주는 몇 cm인가? (원주율: ${num(3)})`,
        num(2 * r * 3),
        `지름은 ${expr(`${r}\\times2=${2 * r}`)} 이므로 원주는 ${expr(`${2 * r}\\times3=${2 * r * 3}`)} 입니다.`,
      );
    }
    const d = intBetween(rng, 4, 15);
    return make(
      unit,
      `원주가 ${unitNum(3 * d, "cm")} 인 원의 지름은 몇 cm인가? (원주율: ${num(3)})`,
      num(d),
      `(지름)=(원주)÷(원주율)입니다. ${expr(`${3 * d}\\div3=${d}`)}`,
    );
  }

  if (s.includes("어림")) {
    const r = intBetween(rng, 3, 10);
    if (rng() < 0.5) {
      return make(
        unit,
        `반지름이 ${unitNum(r, "cm")} 인 원의 넓이를 어림하려고 합니다. 원 밖에 그린 정사각형의 넓이는 몇 cm²인가?`,
        num(4 * r * r),
        `원 밖에 그린 정사각형의 한 변은 원의 지름과 같은 ${unitNum(2 * r, "cm")} 입니다. ` +
          `${expr(`${2 * r}\\times${2 * r}=${4 * r * r}`)}`,
      );
    }
    return make(
      unit,
      `반지름이 ${unitNum(r, "cm")} 인 원의 넓이를 어림하려고 합니다. 원 안에 그린 마름모의 넓이는 몇 cm²인가?`,
      num(2 * r * r),
      `원 안에 그린 마름모의 두 대각선은 모두 원의 지름과 같은 ${unitNum(2 * r, "cm")} 입니다. ` +
        `${expr(`${2 * r}\\times${2 * r}\\div2=${2 * r * r}`)}`,
    );
  }

  if (rng() < 0.5) {
    const r = intBetween(rng, 2, 9);
    return make(
      unit,
      `반지름이 ${unitNum(r, "cm")} 인 원의 넓이는 몇 cm²인가? (원주율: ${num(3)})`,
      num(r * r * 3),
      `(원의 넓이)=(반지름)×(반지름)×(원주율)입니다. ${expr(`${r}\\times${r}\\times3=${r * r * 3}`)}`,
    );
  }
  const r = intBetween(rng, 2, 8);
  return make(
    unit,
    `지름이 ${unitNum(2 * r, "cm")} 인 원의 넓이는 몇 cm²인가? (원주율: ${num("3.14")})`,
    num(fromCents(314 * r * r)),
    `반지름은 ${expr(`${2 * r}\\div2=${r}`)} 입니다. ${expr(`${r}\\times${r}\\times3.14=${fromCents(314 * r * r)}`)}`,
  );
}

// ───────────────────── 2-6 원기둥, 원뿔, 구 ─────────────────────

const CYL_NET_LAYOUTS = [
  "opp",
  "oppFlip",
  "oppMid",
  "sameTop",
  "sameBot",
  "ends",
] as const;

function cylCone(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const r = intBetween(rng, 2, 6);
  const h = intBetween(rng, 3, 9);

  if (s.includes("전개도")) {
    const layout = pick(rng, CYL_NET_LAYOUTS);
    const net = fig("netCylinder", { r, h, pi: 3, layout });
    const which = pick(rng, ["가로", "넓이", "모양"]);
    if (which === "모양") {
      return make(
        unit,
        "원기둥의 전개도에서 옆면은 어떤 도형인가?",
        "직사각형",
        "원기둥의 옆면을 잘라 펼치면 직사각형이 됩니다. 두 밑면은 원입니다.",
        net,
      );
    }
    if (which === "넓이") {
      return make(
        unit,
        `밑면의 반지름이 ${unitNum(r, "cm")} 이고 높이가 ${unitNum(h, "cm")} 인 원기둥의 전개도에서 옆면의 넓이는 몇 cm²인가? (원주율: ${num(3)})`,
        num(2 * r * 3 * h),
        `옆면의 가로는 밑면의 둘레와 같은 ${expr(`2\\times${r}\\times3=${2 * r * 3}`)} 이고, 세로는 높이와 같습니다. ` +
          `${expr(`${2 * r * 3}\\times${h}=${2 * r * 3 * h}`)}`,
        net,
      );
    }
    return make(
      unit,
      `밑면의 반지름이 ${unitNum(r, "cm")} 인 원기둥의 전개도에서 옆면인 직사각형의 가로는 몇 cm인가? (원주율: ${num(3)})`,
      num(2 * r * 3),
      `옆면의 가로는 밑면의 둘레와 같습니다. ${expr(`2\\times${r}\\times3=${2 * r * 3}`)}`,
      net,
    );
  }

  if (s.includes("원뿔")) {
    const cone = fig("cone", { r, h });
    const which = pick(rng, ["밑면", "꼭짓점", "앞", "모선", "반지름"]);
    if (which === "밑면") {
      return make(
        unit,
        "원뿔의 밑면은 어떤 도형인가?",
        "원",
        "원뿔의 밑면은 원 하나입니다.",
        cone,
      );
    }
    if (which === "꼭짓점") {
      return make(
        unit,
        "원뿔에서 뾰족한 부분의 점을 무엇이라고 하는가?",
        "원뿔의 꼭짓점",
        "원뿔에서 뾰족한 부분의 점을 원뿔의 꼭짓점이라고 합니다.",
        cone,
      );
    }
    if (which === "앞") {
      return make(
        unit,
        "원뿔을 앞에서 본 모양은 어떤 도형인가?",
        "삼각형",
        "원뿔을 앞에서 보면 삼각형으로 보이고, 위에서 보면 원으로 보입니다.",
        cone,
      );
    }
    if (which === "모선") {
      return make(
        unit,
        "원뿔의 꼭짓점과 밑면인 원의 둘레의 한 점을 이은 선분을 무엇이라고 하는가?",
        "모선",
        "원뿔의 꼭짓점과 밑면인 원의 둘레의 한 점을 이은 선분을 모선이라고 합니다.",
        cone,
      );
    }
    return make(
      unit,
      `밑면의 지름이 ${unitNum(2 * r, "cm")} 인 원뿔의 밑면의 반지름은 몇 cm인가?`,
      num(r),
      `반지름은 지름의 반입니다. ${expr(`${2 * r}\\div2=${r}`)}`,
      cone,
    );
  }

  if (s.includes("구")) {
    const ball = fig("sphere", { r });
    const which = pick(rng, ["단면", "위", "지름", "이름"]);
    if (which === "단면") {
      return make(
        unit,
        "구를 어느 방향에서 잘라도 잘린 면은 어떤 도형인가?",
        "원",
        "구는 어느 방향에서 잘라도 잘린 면이 원입니다.",
        ball,
      );
    }
    if (which === "위") {
      return make(
        unit,
        "구를 위에서 본 모양과 앞에서 본 모양은 어떤 도형인가?",
        "원",
        "구는 어느 방향에서 보아도 원으로 보입니다.",
        ball,
      );
    }
    if (which === "이름") {
      return make(
        unit,
        "구에서 가장 안쪽에 있는 점을 무엇이라고 하는가?",
        "구의 중심",
        "구에서 가장 안쪽에 있는 점을 구의 중심, 구의 중심에서 겉면의 한 점을 이은 선분을 구의 반지름이라고 합니다.",
        ball,
      );
    }
    return make(
      unit,
      `반지름이 ${unitNum(r, "cm")} 인 구의 지름은 몇 cm인가?`,
      num(2 * r),
      `지름은 반지름의 ${num(2)}배입니다. ${expr(`${r}\\times2=${2 * r}`)}`,
      ball,
    );
  }

  // 2-6-1 원기둥 알아보기 — 그림이 높이·반지름을 적어 주므로 그 둘은 묻지 않는다(R6).
  const cyl = fig("cylinder", { r, h });
  const which = pick(rng, ["밑면", "옆", "높이", "지름", "옆면"]);
  if (which === "밑면") {
    return make(
      unit,
      "원기둥에서 서로 평행하고 합동인 두 면을 무엇이라고 하는가?",
      "밑면",
      "원기둥의 두 밑면은 서로 평행하고 합동인 원입니다.",
      cyl,
    );
  }
  if (which === "옆") {
    return make(
      unit,
      "원기둥을 앞에서 본 모양은 어떤 도형인가?",
      "직사각형",
      "원기둥을 앞에서 보면 직사각형으로, 위에서 보면 원으로 보입니다.",
      cyl,
    );
  }
  if (which === "높이") {
    return make(
      unit,
      "원기둥에서 두 밑면에 수직인 선분의 길이를 무엇이라고 하는가?",
      "높이",
      "두 밑면에 수직인 선분의 길이를 원기둥의 높이라고 합니다.",
      cyl,
    );
  }
  if (which === "옆면") {
    return make(
      unit,
      "원기둥에서 두 밑면과 만나는 굽은 면을 무엇이라고 하는가?",
      "옆면",
      "원기둥에서 두 밑면과 만나는 굽은 면을 옆면이라고 합니다.",
      cyl,
    );
  }
  return make(
    unit,
    `밑면의 반지름이 ${unitNum(r, "cm")} 인 원기둥의 밑면의 지름은 몇 cm인가?`,
    num(2 * r),
    `지름은 반지름의 ${num(2)}배입니다. ${expr(`${r}\\times2=${2 * r}`)}`,
    cyl,
  );
}

export const G6: Record<string, ChapterHandler> = {
  "초6|1-1 분수의 나눗셈": fracDiv61,
  "초6|1-2 각기둥과 각뿔": prismPyr,
  "초6|1-3 소수의 나눗셈": decDiv61,
  "초6|1-4 비와 비율": ratio,
  "초6|1-5 여러 가지 그래프": graphs61,
  "초6|1-6 직육면체의 겉넓이와 부피": volume,
  "초6|2-1 분수의 나눗셈": fracDiv62,
  "초6|2-2 소수의 나눗셈": decDiv62,
  "초6|2-3 공간과 입체": stacking,
  "초6|2-4 비례식과 비례배분": proportion,
  "초6|2-5 원의 둘레와 넓이": circle62,
  "초6|2-6 원기둥, 원뿔, 구": cylCone,
};
