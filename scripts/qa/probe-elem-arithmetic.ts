/**
 * 발문의 식을 **직접 계산해서** 정답과 맞대 본다.
 *
 * 왜 세 번째 가드인가 —
 *  · `probe-elem-rules.ts` 는 **표기**를 본다(모든 수가 KaTeX 인가 · 대분수인가 · 씨앗마다 다른가).
 *  · `probe-elem-section-conditions.ts` 는 **소단원 이름의 조건**을 본다(1보다 작은 소수인가).
 *  둘 다 초록인데 정답이 `27.2\div4` 에 **`4`** 일 수 있다. 실제로 2026-08-22 편집 중간 상태에서
 *  그 값을 봤다 — **표기도 완벽하고 조건도 맞는 틀린 문항**이다. 스스로 신고하지 않는다.
 *
 * 참은 **바깥**에서 온다 — 생성기의 계산을 다시 부르지 않고, 지면에 실제로 찍히는
 * 발문 문자열을 파싱해 **유리수로 정확히** 계산한다. 부동소수는 쓰지 않는다
 * (`0.1+0.2 !== 0.3` 이 판정을 흔들면 안 된다).
 *
 *   npx tsx scripts/qa/probe-elem-arithmetic.ts
 *   npx tsx scripts/qa/probe-elem-arithmetic.ts 초6
 *   npx tsx scripts/qa/probe-elem-arithmetic.ts --selftest
 *   npx tsx scripts/qa/probe-elem-arithmetic.ts --unreadable [--full]
 *
 * ⚠️ 식을 못 읽은 소단원은 **「못 읽음」으로 반드시 센다.** 0을 「깨끗하다」와
 * 「못 센다」가 나눠 갖으면 지표가 아무것도 증명하지 못한다.
 *
 * ## 읽는 꼴을 넓힐 때의 선 (2026-08-22)
 *
 * **묻는 것이 «값»이 아닌 발문에는 대지 않는다.** 「곱셈식으로 나타내시오」의 정답은 몫이
 * 아니고, 「몫을 어림하시오」의 정답은 정확한 몫이 아니다. 대면 멀쩡한 문항이 빨개지고,
 * **거짓 경보는 가드를 끈다.** 애매하면 **못 읽는 쪽**으로 둔다.
 *
 * 넓히지 **않은** 자리도 근거를 남긴다 — 「기타」 85개는 되풀이되는 꼴이 거의 없는
 * 낱개 문장제라(정규화해 세면 대부분 1건씩) 한글 뜻을 읽어야 한다. 그건 거짓 경보의 원천이다.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  elementaryUnits,
  generateElementaryProblem,
} from "../../src/lib/elementary/generate";

const SEEDS = [20260821, 7, 1234, 99991, 20260822, 555, 31337, 4242];

// ── 유리수 ─────────────────────────────────────────────────────────────
type Rat = { n: number; d: number };

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}
function rat(n: number, d = 1): Rat {
  if (d === 0) throw new Error("분모 0");
  const s = d < 0 ? -1 : 1;
  const g = gcd(n, d) || 1;
  return { n: (s * n) / g, d: (s * d) / g };
}
const add = (a: Rat, b: Rat) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rat, b: Rat) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rat, b: Rat) => rat(a.n * b.n, a.d * b.d);
const div = (a: Rat, b: Rat) => rat(a.n * b.d, a.d * b.n);
const eq = (a: Rat, b: Rat) => a.n === b.n && a.d === b.d;
const isInt = (r: Rat) => r.d === 1;
const cmp = (a: Rat, b: Rat) => a.n * b.d - b.n * a.d;
const show = (r: Rat) => (r.d === 1 ? `${r.n}` : `${r.n}/${r.d}`);

/**
 * 한 항을 읽는다 — 대분수 · 분수 · 소수 · 자연수.
 * `\,` 같은 간격 명령과 단위(`\mathrm{cm}`)는 항이 아니므로 여기서 막힌다(= 못 읽음).
 */
function parseTerm(raw: string): Rat | null {
  const s = raw.trim();
  let m = s.match(/^(\d+)\\frac\{(\d+)\}\{(\d+)\}$/);
  if (m) return add(rat(Number(m[1])), rat(Number(m[2]), Number(m[3])));
  m = s.match(/^\\frac\{(\d+)\}\{(\d+)\}$/);
  if (m) return rat(Number(m[1]), Number(m[2]));
  m = s.match(/^(\d+)\.(\d+)$/);
  if (m) return rat(Number(m[1] + m[2]), 10 ** m[2]!.length);
  m = s.match(/^(\d+)$/);
  if (m) return rat(Number(m[1]));
  return null;
}

const OPS: [string, (a: Rat, b: Rat) => Rat][] = [
  ["\\div", div],
  ["\\times", mul],
  ["+", add],
  ["-", sub],
];
/** 같은 층끼리만 왼쪽에서 오른쪽으로 읽는다 — 층이 섞이면 우선순위가 생겨 못 읽는다. */
const TIER: Record<string, number> = {
  "\\div": 2,
  "\\times": 2,
  "+": 1,
  "-": 1,
};
const APPLY: Record<string, (a: Rat, b: Rat) => Rat> = {
  "\\div": div,
  "\\times": mul,
  "+": add,
  "-": sub,
};

// ── 답 읽기 ────────────────────────────────────────────────────────────

/** 답에서 수 하나. `$`·간격·단위·`^\circ`·한글 단위를 벗긴다. */
function ratAnswer(answer: string): Rat | null {
  const bare = answer
    .replace(/\$/g, "")
    .replace(/\\,|\\;|\\!/g, "")
    .replace(/\\mathrm\{[^}]*\}/g, "")
    .replace(/\^\\circ/g, "")
    .replace(/(칸|개|명|권|마리|쌍|원|도|분|장|번)$/u, "")
    .trim();
  return parseTerm(bare);
}

type Val = { kind: "rat"; v: Rat } | { kind: "pair"; a: Rat; b: Rat };

const same = (x: Val, y: Val): boolean =>
  x.kind === "rat" && y.kind === "rat"
    ? eq(x.v, y.v)
    : x.kind === "pair" && y.kind === "pair"
      ? eq(x.a, y.a) && eq(x.b, y.b)
      : false;

const showVal = (v: Val) =>
  v.kind === "rat" ? show(v.v) : `${show(v.a)} … ${show(v.b)}`;

// ── 단위 ───────────────────────────────────────────────────────────────
/** 같은 무리 안에서만 환산한다. 값은 «가장 작은 단위 몇 개인가». */
const UNITS: Record<string, { group: string; scale: number }> = {
  mm: { group: "길이", scale: 1 },
  cm: { group: "길이", scale: 10 },
  m: { group: "길이", scale: 1000 },
  km: { group: "길이", scale: 1000000 },
  mL: { group: "들이", scale: 1 },
  L: { group: "들이", scale: 1000 },
  g: { group: "무게", scale: 1 },
  kg: { group: "무게", scale: 1000 },
};

/** 도형 이름의 한자 수사 → 변의 수. */
const SIDES: Record<string, number> = {
  삼: 3,
  사: 4,
  오: 5,
  육: 6,
  칠: 7,
  팔: 8,
  구: 9,
  십: 10,
};

/** 발문에서 «이름표가 붙은 수». `밑변의 길이가 $16$ cm` 든 `밑변 $16\,\mathrm{cm}$` 든 잡는다. */
function labeledRat(content: string, label: string): Rat | null {
  const re = new RegExp(`${label}[^0-9$]{0,12}\\$?\\s*(\\d+(?:\\.\\d+)?)`);
  const hit = content.match(re);
  return hit ? parseTerm(hit[1]!) : null;
}

/** 값을 묻지 않는 신호. 하나라도 있으면 **읽지 않는다.** */
const NOT_A_VALUE =
  /어림|반올림|올림하여|버림하여|약 몇|곱셈식으로|나눗셈식으로|식으로 나타내|비교하시오|어떠한가|무엇이라고|이름을 쓰시오/;

// ── 읽는 꼴들 ──────────────────────────────────────────────────────────
type Reading = { truth: Val; got: Val } | null;
type Reader = {
  name: string;
  read: (content: string, answer: string) => Reading;
};

/** ① `$A op B=\square$` — 처음부터 있던 꼴. 같은 층이면 연산자가 여럿이어도 왼쪽부터 읽는다. */
const readSquare: Reader = {
  name: "=□ 식",
  read(content, answer) {
    const hits = [...content.matchAll(/\$([^$]*?)=\\square\$/g)];
    if (hits.length !== 1) return null;
    const lhs = hits[0]![1]!;
    if (lhs.includes("(") || lhs.includes("\\square")) return null;

    // 항과 연산자로 쪼갠다. 맨 앞의 `-` 는 연산자가 아니므로 자리를 1부터 본다.
    const terms: string[] = [];
    const ops: string[] = [];
    let rest = lhs;
    for (;;) {
      let at = -1;
      let sym = "";
      for (const [s] of OPS) {
        const i = rest.indexOf(s, 1);
        if (i > 0 && (at === -1 || i < at)) {
          at = i;
          sym = s;
        }
      }
      if (at === -1) {
        terms.push(rest);
        break;
      }
      terms.push(rest.slice(0, at));
      ops.push(sym);
      rest = rest.slice(at + sym.length);
    }
    if (ops.length === 0) return null;

    const vals = terms.map((t) => parseTerm(t));
    if (vals.some((v) => v === null)) return null;

    // 괄호가 없으면 우선순위는 정해져 있다 — ×÷ 를 먼저 접고, 그다음 +- 를 왼쪽부터.
    // (괄호가 있으면 위에서 이미 못 읽는 쪽으로 돌려보냈다.)
    let nums = vals as Rat[];
    let syms = ops;
    for (const tier of [2, 1]) {
      const outN: Rat[] = [nums[0]!];
      const outS: string[] = [];
      for (const [i, o] of syms.entries()) {
        if (TIER[o] === tier) {
          outN[outN.length - 1] = APPLY[o]!(
            outN[outN.length - 1]!,
            nums[i + 1]!,
          );
        } else {
          outS.push(o);
          outN.push(nums[i + 1]!);
        }
      }
      nums = outN;
      syms = outS;
    }
    if (nums.length !== 1 || syms.length !== 0) return null;
    const acc = nums[0]!;

    const got = ratAnswer(answer);
    if (got === null) return null;
    return { truth: { kind: "rat", v: acc }, got: { kind: "rat", v: got } };
  },
};

/** ② 몫과 나머지 — 자연수 나눗셈이므로 **내림 몫과 나머지**로 정확히 잰다. */
const readQuotRem: Reader = {
  name: "몫과 나머지",
  read(content, answer) {
    const q = content.match(/\$(\d+)\\div(\d+)\$\s*의?\s*몫과 나머지/);
    if (!q) return null;
    const a = Number(q[1]);
    const b = Number(q[2]);
    if (b === 0) return null;
    const hit = answer.match(/몫\s*\$(\d+)\$\s*,\s*나머지\s*\$(\d+)\$/);
    if (!hit) return null;
    return {
      truth: { kind: "pair", a: rat(Math.floor(a / b)), b: rat(a % b) },
      got: { kind: "pair", a: rat(Number(hit[1])), b: rat(Number(hit[2])) },
    };
  },
};

/**
 * ③ 몫만 묻는 꼴.
 *
 * ⚠️ 「몫」은 **나누어떨어질 때만** 뜻이 하나다. 안 떨어지면 자연수 몫(내림)인지 정확한
 * 몫(분수·소수)인지 발문마다 달라 **읽지 않는다** — 「분수로/소수로 나타내시오」라고
 * 못 박은 경우만 정확한 몫으로 읽는다. 「어림」류는 위 `NOT_A_VALUE` 가 먼저 막는다.
 */
const readQuotient: Reader = {
  name: "몫",
  read(content, answer) {
    if (!/몫/.test(content) || /나머지/.test(content)) return null;
    if (NOT_A_VALUE.test(content)) return null;
    const q = content.match(/\$(\d+)\\div(\d+)\$/);
    if (!q) return null;
    const a = Number(q[1]);
    const b = Number(q[2]);
    if (b === 0) return null;
    const exact = rat(a, b);
    const asFrac = /분수로 나타내|소수로 나타내/.test(content);
    if (!asFrac && !isInt(exact)) return null; // 뜻이 갈리는 자리 — 읽지 않는다
    const got = ratAnswer(answer);
    if (got === null) return null;
    return { truth: { kind: "rat", v: exact }, got: { kind: "rat", v: got } };
  },
};

/** ④ 삼각형·사각형의 나머지 한 각. 내각의 합은 상수라 바깥에서 온 참이다. */
const readAngleSum: Reader = {
  name: "내각의 합",
  read(content, answer) {
    const tri = content.match(
      /삼각형의 두 각의 크기가 \$(\d+)\^\\circ\$, \$(\d+)\^\\circ\$/,
    );
    const quad = content.match(
      /사각형의 세 각의 크기가 \$(\d+)\^\\circ\$, \$(\d+)\^\\circ\$, \$(\d+)\^\\circ\$/,
    );
    if (!/나머지 한 각/.test(content)) return null;
    const truth = tri
      ? 180 - Number(tri[1]) - Number(tri[2])
      : quad
        ? 360 - Number(quad[1]) - Number(quad[2]) - Number(quad[3])
        : null;
    if (truth === null) return null;
    const got = ratAnswer(answer);
    if (got === null) return null;
    return {
      truth: { kind: "rat", v: rat(truth) },
      got: { kind: "rat", v: got },
    };
  },
};

/** ⑤ 단위 환산 `$A\,\mathrm{u}=\square\,\mathrm{v}$`. 같은 무리 안에서만 읽는다. */
const readUnitConv: Reader = {
  name: "단위 환산",
  read(content, answer) {
    const hit = content.match(
      /\$(\d+(?:\.\d+)?)\\,\\mathrm\{(\w+)\}=\\square\\,\\mathrm\{(\w+)\}\$/,
    );
    if (!hit) return null;
    const from = UNITS[hit[2]!];
    const to = UNITS[hit[3]!];
    if (!from || !to || from.group !== to.group) return null;
    const v = parseTerm(hit[1]!);
    if (!v) return null;
    const got = ratAnswer(answer);
    if (got === null) return null;
    return {
      truth: { kind: "rat", v: div(mul(v, rat(from.scale)), rat(to.scale)) },
      got: { kind: "rat", v: got },
    };
  },
};

/** 복합 단위 덩어리(`6\,\mathrm{L}\ 894\,\mathrm{mL}`)를 가장 작은 단위 개수로. */
function compound(raw: string): { group: string; total: Rat } | null {
  const parts = [...raw.matchAll(/(\d+(?:\.\d+)?)\\,\\mathrm\{(\w+)\}/g)];
  if (parts.length === 0) return null;
  let group = "";
  let total = rat(0);
  for (const p of parts) {
    const u = UNITS[p[2]!];
    const v = parseTerm(p[1]!);
    if (!u || !v) return null;
    if (group && group !== u.group) return null;
    group = u.group;
    total = add(total, mul(v, rat(u.scale)));
  }
  return { group, total };
}

/** ⑥ 복합 단위의 합·차 `$A L B mL - C L D mL=\square$`. */
const readCompound: Reader = {
  name: "복합 단위 합·차",
  read(content, answer) {
    const hits = [...content.matchAll(/\$([^$]*?)=\\square\$/g)];
    if (hits.length !== 1) return null;
    const lhs = hits[0]![1]!;
    if (!/\\mathrm\{/.test(lhs)) return null;
    const at = Math.max(lhs.indexOf("+", 1), lhs.indexOf("-", 1));
    if (at <= 0) return null;
    const op = lhs[at]!;
    const l = compound(lhs.slice(0, at));
    const r = compound(lhs.slice(at + 1));
    if (!l || !r || l.group !== r.group) return null;
    const a = compound(answer.replace(/\$/g, ""));
    if (!a || a.group !== l.group) return null;
    return {
      truth: {
        kind: "rat",
        v: op === "+" ? add(l.total, r.total) : sub(l.total, r.total),
      },
      got: { kind: "rat", v: a.total },
    };
  },
};

/** ⑦ 여럿 중 가장 큰·작은 것 고르기. 정답이 **발문에 있는 값 중 하나**라 바깥 근거가 필요 없다. */
const readPickExtreme: Reader = {
  name: "크기 비교",
  read(content, answer) {
    const want = content.match(
      /중\s*(?:에서\s*)?(?:더|가장)\s*(큰|작은)\s*(?:수|분수|소수)?\s*를?\s*쓰시오/,
    );
    if (!want) return null;
    const terms = [...content.matchAll(/\$([^$]*)\$/g)].map((m) =>
      parseTerm(m[1]!),
    );
    if (terms.length < 2 || terms.length > 4 || terms.some((t) => t === null))
      return null;
    const list = terms as Rat[];
    let best = list[0]!;
    for (const t of list) {
      if (want[1] === "큰" ? cmp(t, best) > 0 : cmp(t, best) < 0) best = t;
    }
    const got = ratAnswer(answer);
    if (got === null) return null;
    return { truth: { kind: "rat", v: best }, got: { kind: "rat", v: got } };
  },
};

/** ⑧ 넓이·둘레·부피 — 공식이 도형 이름으로 정해지는 것만. */
type Formula = {
  when: RegExp;
  ask: RegExp;
  of: (c: string) => Rat | null;
};
const FORMULAS: Formula[] = [
  {
    when: /직사각형/,
    ask: /넓이는 몇/,
    of: (c) => {
      const a = labeledRat(c, "가로");
      const b = labeledRat(c, "세로");
      return a && b ? mul(a, b) : null;
    },
  },
  {
    when: /정사각형/,
    ask: /넓이는 몇/,
    of: (c) => {
      const a = labeledRat(c, "한 변의 길이가") ?? labeledRat(c, "한 변이");
      return a ? mul(a, a) : null;
    },
  },
  {
    when: /삼각형/,
    ask: /넓이는 몇/,
    of: (c) => {
      const a = labeledRat(c, "밑변의 길이가") ?? labeledRat(c, "밑변이");
      const h = labeledRat(c, "높이가");
      return a && h ? div(mul(a, h), rat(2)) : null;
    },
  },
  {
    when: /평행사변형/,
    ask: /넓이는 몇/,
    of: (c) => {
      const a = labeledRat(c, "밑변의 길이가") ?? labeledRat(c, "밑변이");
      const h = labeledRat(c, "높이가");
      return a && h ? mul(a, h) : null;
    },
  },
  {
    when: /마름모/,
    ask: /넓이는 몇/,
    of: (c) => {
      const hit = c.match(
        /두 대각선의 길이가 \$?(\d+)\$?[^0-9$]{0,12}\$?(\d+)/,
      );
      return hit
        ? div(mul(rat(Number(hit[1])), rat(Number(hit[2]))), rat(2))
        : null;
    },
  },
  {
    when: /사다리꼴/,
    ask: /넓이는 몇/,
    of: (c) => {
      const a = labeledRat(c, "윗변의 길이가") ?? labeledRat(c, "윗변이");
      const b = labeledRat(c, "아랫변의 길이가") ?? labeledRat(c, "아랫변이");
      const h = labeledRat(c, "높이가");
      return a && b && h ? div(mul(add(a, b), h), rat(2)) : null;
    },
  },
  {
    when: /직육면체/,
    ask: /부피는 몇/,
    of: (c) => {
      const a = labeledRat(c, "가로");
      const b = labeledRat(c, "세로");
      const h = labeledRat(c, "높이");
      return a && b && h ? mul(mul(a, b), h) : null;
    },
  },
  {
    when: /직육면체/,
    ask: /겉넓이는 몇/,
    of: (c) => {
      const a = labeledRat(c, "가로");
      const b = labeledRat(c, "세로");
      const h = labeledRat(c, "높이");
      if (!a || !b || !h) return null;
      return mul(rat(2), add(add(mul(a, b), mul(b, h)), mul(a, h)));
    },
  },
  {
    when: /평행사변형/,
    ask: /둘레는 몇/,
    of: (c) => {
      const hit = c.match(
        /이웃한 두 변의 길이가 \$?(\d+)\$?[^0-9$]{0,12}\$?(\d+)/,
      );
      return hit
        ? mul(rat(2), add(rat(Number(hit[1])), rat(Number(hit[2]))))
        : null;
    },
  },
];

const readFormula: Reader = {
  name: "넓이·둘레·부피",
  read(content, answer) {
    for (const f of FORMULAS) {
      if (!f.when.test(content) || !f.ask.test(content)) continue;
      const truth = f.of(content);
      if (!truth) continue;
      const got = ratAnswer(answer);
      if (got === null) return null;
      return { truth: { kind: "rat", v: truth }, got: { kind: "rat", v: got } };
    }
    return null;
  },
};

/** ⑨ 정다각형·정육면체의 «길이의 합» — 변·모서리 개수가 이름으로 정해진다. */
const readEdgeSum: Reader = {
  name: "변·모서리 길이의 합",
  read(content, answer) {
    let sides: number | null = null;
    const poly = content.match(/정([삼사오육칠팔구십])각형/);
    if (
      poly &&
      /모든 변의 길이의 합|네 변의 길이의 합|세 변의 길이의 합/.test(content)
    ) {
      sides = SIDES[poly[1]!]!;
    }
    if (/마름모/.test(content) && /네 변의 길이의 합/.test(content)) sides = 4;
    if (
      /정육면체/.test(content) &&
      /모든 모서리 길이의 합|모든 모서리의 길이의 합/.test(content)
    ) {
      sides = 12;
    }
    if (sides === null) return null;
    const one =
      labeledRat(content, "한 변이") ??
      labeledRat(content, "한 변의 길이가") ??
      labeledRat(content, "한 모서리의 길이가");
    if (!one) return null;
    const got = ratAnswer(answer);
    if (got === null) return null;
    return {
      truth: { kind: "rat", v: mul(one, rat(sides)) },
      got: { kind: "rat", v: got },
    };
  },
};

const READERS: Reader[] = [
  readQuotRem,
  readCompound,
  readUnitConv,
  readSquare,
  readQuotient,
  readAngleSum,
  readPickExtreme,
  readFormula,
  readEdgeSum,
];

function readAny(
  content: string,
  answer: string,
): { r: Reader; got: Reading } | null {
  for (const r of READERS) {
    const got = r.read(content, answer);
    if (got) return { r, got };
  }
  return null;
}

function judge(content: string, answer: string): "맞음" | "틀림" | "못읽음" {
  const hit = readAny(content, answer);
  if (!hit || !hit.got) return "못읽음";
  return same(hit.got.truth, hit.got.got) ? "맞음" : "틀림";
}

// ── 눈금 ───────────────────────────────────────────────────────────────
type Fixture = {
  content: string;
  answer: string;
  want: "맞음" | "틀림" | "못읽음";
  why: string;
};
const FIXTURES: Fixture[] = [
  // ── 틀린 것을 틀리다고 하는가 (양성)
  {
    content: "몫을 구하시오.  $27.2\\div4=\\square$",
    answer: "$4$",
    want: "틀림",
    why: "정답이 몫이 아니라 **나누는 수**다 — 편집 중간 상태에서 실제로 본 값",
  },
  {
    content: "$2\\frac{6}{7}+1\\frac{2}{7}=\\square$",
    answer: "$4\\frac{2}{7}$",
    want: "틀림",
    why: "$4\\frac17$ 이다 — 대분수 받아올림을 틀린 모양",
  },
  {
    content: "$\\frac{3}{6}\\times\\frac{6}{9}=\\square$",
    answer: "$\\frac{1}{2}$",
    want: "틀림",
    why: "$\\frac13$ 이다 — 한쪽만 약분하고 곱한 모양",
  },
  {
    content: "$26\\div3$ 의 몫과 나머지를 쓰시오.",
    answer: "몫 $9$, 나머지 $2$",
    want: "틀림",
    why: "몫은 $8$ 이다",
  },
  {
    content: "$3\\times5\\div3=\\square$",
    answer: "$3$",
    want: "틀림",
    why: "왼쪽부터 계산하면 $5$ 다",
  },
  {
    content: "$2+3\\times4=\\square$",
    answer: "$20$",
    want: "틀림",
    why: "**왼쪽부터 읽으면** $20$ 이다 — 우선순위를 안 지키면 이 자리가 초록이 된다",
  },
  {
    content: "$49+8\\times6-20\\div4=\\square$",
    answer: "$87$",
    want: "틀림",
    why: "$49+48-5=92$ 다",
  },
  {
    content:
      "□ 안에 알맞은 수를 쓰시오.  $2\\,\\mathrm{L}=\\square\\,\\mathrm{mL}$",
    answer: "$200$",
    want: "틀림",
    why: "$2000$ 이다 — 자릿수를 하나 놓친 모양",
  },
  {
    content:
      "삼각형의 두 각의 크기가 $44^\\circ$, $72^\\circ$입니다. 나머지 한 각의 크기는 몇 도인가?",
    answer: "$54^\\circ$",
    want: "틀림",
    why: "$180-44-72=64$ 다",
  },
  {
    content:
      "밑변의 길이가 $16$ cm, 높이가 $6$ cm인 삼각형의 넓이는 몇 cm²인가?",
    answer: "$96$",
    want: "틀림",
    why: "$2$ 로 나누는 것을 빠뜨린 모양 — $48$ 이다",
  },
  {
    content:
      "다음을 계산하시오.  $6\\,\\mathrm{L}\\ 894\\,\\mathrm{mL}-3\\,\\mathrm{L}\\ 552\\,\\mathrm{mL}=\\square$",
    answer: "$3\\,\\mathrm{L}\\ 442\\,\\mathrm{mL}$",
    want: "틀림",
    why: "$342\\,\\mathrm{mL}$ 다",
  },
  {
    content:
      "다음 두 분수 중 더 큰 분수를 쓰시오.  $\\frac{3}{5}$,  $\\frac{4}{5}$",
    answer: "$\\frac{3}{5}$",
    want: "틀림",
    why: "작은 쪽을 골랐다",
  },
  {
    content:
      "한 변이 $7\\,\\mathrm{cm}$인 정팔각형의 모든 변의 길이의 합은 몇 cm인가?",
    answer: "$49\\,\\mathrm{cm}$",
    want: "틀림",
    why: "변이 $8$ 개다 — $56$ 이다",
  },

  // ── 맞는 것을 맞다고 하는가 (음성) — 이게 없으면 「지어냄」이 구조적으로 0이 된다
  {
    content: "몫을 구하시오.  $27.2\\div4=\\square$",
    answer: "$6.8$",
    want: "맞음",
    why: "소수 몫",
  },
  {
    content: "$2\\frac{6}{7}+1\\frac{2}{7}=\\square$",
    answer: "$4\\frac{1}{7}$",
    want: "맞음",
    why: "대분수 덧셈",
  },
  {
    content: "$\\frac{9}{4}\\div\\frac{3}{5}=\\square$",
    answer: "$3\\frac{3}{4}$",
    want: "맞음",
    why: "분수 나눗셈 → 대분수",
  },
  {
    content: "$\\frac{1}{10}+\\frac{5}{9}=\\square$",
    answer: "$\\frac{59}{90}$",
    want: "맞음",
    why: "부동소수로 재면 흔들리는 자리",
  },
  {
    content: "$3\\frac{3}{9}-2\\frac{5}{9}=\\square$",
    answer: "$\\frac{7}{9}$",
    want: "맞음",
    why: "받아내림",
  },
  {
    content: "$26\\div3$ 의 몫과 나머지를 쓰시오.",
    answer: "몫 $8$, 나머지 $2$",
    want: "맞음",
    why: "자연수 나눗셈의 몫·나머지",
  },
  {
    content: "$3\\times5\\div3=\\square$",
    answer: "$5$",
    want: "맞음",
    why: "같은 층이면 왼쪽부터",
  },
  {
    content: "$46+9\\times5-13=\\square$",
    answer: "$78$",
    want: "맞음",
    why: "괄호 없는 혼합 계산 — ×÷ 를 먼저 접는다",
  },
  {
    content:
      "□ 안에 알맞은 수를 쓰시오.  $90\\,\\mathrm{mm}=\\square\\,\\mathrm{cm}$",
    answer: "$9$",
    want: "맞음",
    why: "단위 환산",
  },
  {
    content:
      "사각형의 세 각의 크기가 $96^\\circ$, $73^\\circ$, $70^\\circ$입니다. 나머지 한 각의 크기는 몇 도인가?",
    answer: "$121^\\circ$",
    want: "맞음",
    why: "사각형 내각의 합",
  },
  {
    content: "두 대각선의 길이가 $18$ cm, $6$ cm인 마름모의 넓이는 몇 cm²인가?",
    answer: "$54$",
    want: "맞음",
    why: "마름모 넓이",
  },
  {
    content:
      "다음을 계산하시오.  $6\\,\\mathrm{L}\\ 894\\,\\mathrm{mL}-3\\,\\mathrm{L}\\ 552\\,\\mathrm{mL}=\\square$",
    answer: "$3\\,\\mathrm{L}\\ 342\\,\\mathrm{mL}$",
    want: "맞음",
    why: "복합 단위 뺄셈",
  },
  {
    content: "$37050$과 $37414$ 중 더 큰 수를 쓰시오.",
    answer: "$37414$",
    want: "맞음",
    why: "큰 수 고르기",
  },
  {
    content:
      "한 변이 $7\\,\\mathrm{cm}$인 정팔각형의 모든 변의 길이의 합은 몇 cm인가?",
    answer: "$56\\,\\mathrm{cm}$",
    want: "맞음",
    why: "정다각형 둘레",
  },
  {
    content: "$105\\div21$의 몫을 구하시오.",
    answer: "$5$",
    want: "맞음",
    why: "나누어떨어지는 몫",
  },

  // ── 못 읽어야 하는 것 — 묻는 것이 «값»이 아니거나 뜻이 갈린다
  {
    content:
      "다음 나눗셈식을 곱셈식으로 나타내시오.  $\\frac{2}{3}\\div\\frac{5}{6}$",
    answer: "$\\frac{2}{3}\\times\\frac{6}{5}$",
    want: "못읽음",
    why: "묻는 것이 몫이 아니다 — 대면 멀쩡한 문항이 빨개진다",
  },
  {
    content:
      "$223\\div24$의 몫을 어림하려고 합니다. $24$를 몇십으로 어림하여 몫을 어림하시오.",
    answer: "$11$",
    want: "못읽음",
    why: "**어림**은 정확한 몫이 아니다 — 대면 멀쩡한 문항이 빨개진다",
  },
  {
    content: "$26\\div3$ 의 몫을 구하시오.",
    answer: "$8$",
    want: "못읽음",
    why: "나누어떨어지지 않으면 «내림 몫»인지 «정확한 몫»인지 발문마다 다르다",
  },
  {
    content: "$(2+3)\\times4=\\square$",
    answer: "$20$",
    want: "못읽음",
    why: "괄호가 있으면 읽지 않는다 — 묶음을 잘못 풀면 조용히 틀리게 읽는다",
  },
  {
    content: "$3\\,\\mathrm{km}=\\square\\,\\mathrm{L}$",
    answer: "$3000$",
    want: "못읽음",
    why: "무리가 다른 단위는 환산하지 않는다",
  },
];

if (process.argv.includes("--selftest")) {
  let failed = 0;
  const tally = { 맞음: 0, 틀림: 0, 못읽음: 0 };
  for (const f of FIXTURES) {
    const got = judge(f.content, f.answer);
    const ok = got === f.want;
    tally[f.want] += 1;
    if (!ok) failed += 1;
    console.log(`  ${ok ? "✅" : "❌"} ${f.want} — ${f.why}`);
    if (!ok)
      console.log(
        `       실제로는 「${got}」\n       ${f.content}  →  ${f.answer}`,
      );
  }
  console.log(
    failed === 0
      ? `\n✅ 눈금 ${FIXTURES.length}건 전부 맞다 (틀림 ${tally.틀림} · 맞음 ${tally.맞음} · 못읽음 ${tally.못읽음})`
      : `\n❌ 눈금 ${failed}건 어긋남 — **가드를 믿을 수 없다**`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

// ── 전량 ───────────────────────────────────────────────────────────────
const gradeArg = process.argv.slice(2).find((a) => a.startsWith("초"));
const units = elementaryUnits().filter(
  (u) => !gradeArg || u.grade === gradeArg,
);

/**
 * **과녁이 움직이는 동안 잰 값은 못 쓴다** (2026-08-22, 이 저장소에서 네 번 났다).
 *
 * 오르카 다중 세션이 같은 워크트리에서 `g3~g6.ts` 를 동시에 고친다. 재는 도중에 저장되면
 * 「정답 어긋남 0」이 «깨끗해서 0»인지 «반쯤 저장된 파일을 봐서 0»인지 구분되지 않는다.
 * 그래서 **재기 전과 후의 파일 지문을 견주고, 달라졌으면 수치를 내지 않고 멈춘다.**
 */
const GEN_DIR = path.join(process.cwd(), "src", "lib", "elementary");
function generatorFingerprint(): string {
  const h = createHash("sha1");
  for (const f of readdirSync(GEN_DIR).sort()) {
    if (!f.endsWith(".ts")) continue;
    h.update(f);
    h.update(readFileSync(path.join(GEN_DIR, f)));
  }
  return h.digest("hex");
}
const fingerprintBefore = generatorFingerprint();

const wrong: string[] = [];
const byReader = new Map<string, number>();
let readable = 0;
let unreadable = 0;

for (const unit of units) {
  const results = SEEDS.map((s) => {
    const p = generateElementaryProblem(unit, s);
    return { seed: s, p, kind: judge(p.content, p.answer) };
  });
  if (results.every((r) => r.kind === "못읽음")) {
    unreadable += 1;
    continue;
  }
  readable += 1;
  const first = results.find((r) => r.kind !== "못읽음")!;
  const who = readAny(first.p.content, first.p.answer)?.r.name ?? "?";
  byReader.set(who, (byReader.get(who) ?? 0) + 1);

  const bad = results.filter((r) => r.kind === "틀림");
  if (bad.length > 0) {
    const b = bad[0]!;
    const t = readAny(b.p.content, b.p.answer)?.got;
    wrong.push(
      `${unit.grade} ${unit.section}\n      씨앗 ${bad.length}/${SEEDS.length} 틀림\n` +
        `      ${b.p.content.replace(/\n/g, " ")}\n` +
        `      정답 ${b.p.answer}   ·   참값 ${t ? showVal(t.truth) : "?"}`,
    );
  }
}

console.log(
  `식을 읽은 소단원 ${readable}${gradeArg ? ` (${gradeArg})` : ""} · 못 읽음 ${unreadable}\n`,
);
if (byReader.size > 0 && !process.argv.includes("--unreadable")) {
  for (const [k, v] of [...byReader].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(v).padStart(3)}  ${k}`);
  }
  console.log("");
}

/**
 * `--unreadable` — **못 읽은 것을 부류로 묶어 보여 준다.**
 *
 * 「못 읽음 N」만 찍으면 그 N 이 «값을 안 묻는 문항»인지 «넓히면 읽을 수 있는 문항»인지
 * 구분이 안 된다. 넓힐 자리를 고르려면 무엇이 남았는지 눈으로 봐야 한다.
 */
if (process.argv.includes("--unreadable")) {
  const groups = new Map<
    string,
    { unit: string; content: string; answer: string }[]
  >();
  for (const unit of units) {
    const p = generateElementaryProblem(unit, SEEDS[0]!);
    const readableHere = SEEDS.some((s) => {
      const q = generateElementaryProblem(unit, s);
      return judge(q.content, q.answer) !== "못읽음";
    });
    if (readableHere) continue;
    const c = p.content;
    const key = NOT_A_VALUE.test(c)
      ? "A. 묻는 것이 «값»이 아니다 (일부러 안 읽음)"
      : /=\\square/.test(c)
        ? "B. `=\\square` 는 있는데 항·연산자를 못 읽음"
        : /그래프/.test(c)
          ? "C. 그래프 읽기 (참이 그림 스펙에 있다)"
          : /무엇이라고 하는가|이름을 쓰시오|무엇인가|기호를 쓰시오|어떤 도형인가/.test(
                c,
              )
            ? "D. 용어·이름·고르기 (정답이 수가 아니다)"
            : "Z. 낱개 문장제";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({
      unit: `${unit.grade} ${unit.section}`,
      content: c,
      answer: p.answer,
    });
  }
  for (const [k, rows] of [...groups].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    console.log(`\n━━ ${k}  (${rows.length}개)`);
    const full = process.argv.includes("--full");
    const shown = rows.slice(0, full ? rows.length : 5);
    for (const r of shown) {
      console.log(`   ${r.unit}`);
      console.log(`     문 ${r.content.replace(/\n/g, " ").slice(0, 140)}`);
      console.log(`     답 ${r.answer}`);
    }
    // ⚠️ **잘렸다는 것을 반드시 찍는다.** 안 찍으면 이 목록을 `grep` 으로 훑는 사람이
    //    「안 뜬다 → 이 소단원은 목록에서도 눈이 멀었다」로 **거짓 결론**을 낸다.
    //    2026-08-22 에 실제로 그렇게 읽혔다(2-6-2 는 22개 안에 있었는데 5개만 찍혔다).
    //    「(22개)」를 옆에 적어 두는 것만으로는 부족했다 — grep 은 그 줄을 안 본다.
    if (shown.length < rows.length) {
      console.log(
        `   … 외 ${rows.length - shown.length}개 — 전부 보려면 \`--full\`. ` +
          `**이 목록을 grep 으로 훑지 마라.**`,
      );
    }
  }
  process.exit(0);
}

/**
 * 이 울타리는 **시험할 수 있어야** 한다. 재는 창이 tsx 컴파일보다 훨씬 짧아서, 밖에서
 * 타이밍을 맞춰 파일을 건드리는 방식으로는 「안 걸렸다」가 «울타리가 없다»인지
 * «창을 못 맞췄다»인지 갈리지 않는다 — 그래서 창을 늘리는 손잡이를 둔다.
 * 시험 전용이며 평소에는 한 줄도 돌지 않는다.
 */
const fenceDelay = Number(process.env.ELEM_PROBE_FENCE_DELAY_MS ?? 0);
if (fenceDelay > 0) {
  const until = Date.now() + fenceDelay;
  while (Date.now() < until) {
    /* 창을 열어 둔다 */
  }
}

if (generatorFingerprint() !== fingerprintBefore) {
  console.log(
    "⛔ 재는 동안 `src/lib/elementary/` 가 바뀌었다 — **이 수치는 못 쓴다.**\n" +
      "   다른 세션이 생성기를 고치는 중이다. 그 세션이 끝난 뒤 다시 돌려라.",
  );
  process.exit(2);
}

if (wrong.length === 0) {
  console.log("✅ 정답 어긋남 0");
} else {
  console.log(`❌ 정답 어긋남 ${wrong.length}건`);
  for (const w of wrong) console.log(`  · ${w}`);
}
process.exitCode = wrong.length === 0 ? 0 : 1;
