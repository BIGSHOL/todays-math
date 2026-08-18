/**
 * `displayWidth` 가 **보기 조각에서 어디를 부풀리는가**를 실측과 대조해 찾는다.
 *
 * 왜: 2열 판정(`TWO_COLUMN_WIDTH_LIMIT = 24`)의 «과잉» — 1열로 내려갔지만 실제로는
 * 2열 칸(147px)에 다 들어가는 문항 — 이 실측 10.6% 다. 지면이 이유 없이 세로로
 * 길어지고, 자습 지면은 장당 2문항 고정이라 그 높이가 곧 넘침이다.
 * **문턱이 아니라 자가 문제다**(적대적 리뷰 ③ §7).
 *
 *   npx tsx scripts/qa/measure-choice-columns.tsx --take 1500 --json .measure/choices.json
 *   npx tsx scripts/qa/analyze-choice-width-bias.ts
 *
 * ⚠️ 이 스크립트는 **제품을 고치지 않는다.** `displayWidth` 를 고치면 보기 열 수가
 *    바뀌어 **인쇄물 출력 결과가 달라진다**(절대 규칙 6 — 실물 프린터 검수 대상).
 *    그래서 여기서는 후보안의 효과를 실측으로 재서 **제안 근거만** 만든다.
 */
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { displayWidth } from "../../src/lib/math/displayWidth";
import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";

const prisma = new PrismaClient();

/** 2열 한 칸의 글자 폭(실측 147px) — 표시폭 24 가 가리킨다고 가정한 폭. */
const CELL_PX = 147;
const LIMIT = 24;

interface Piece {
  pid: string;
  index: number;
  px: number;
  twoCol: boolean;
}

const MATH_ATOM = /\$[^$]*\$/g;
const SPACED_OPERATOR_RE =
  /\\(?:times|div|pm|mp|cdot|le|ge|ne|neq|leq|geq|approx|equiv|sim|to|Rightarrow|rightarrow|in|subset|supset|cup|cap)\b|[+=<>×÷≤≥≠±∈⊂⊃∪∩⇨→]/g;
const BINARY_MINUS_RE = /(?<=[A-Za-z0-9)\]}])\s*-/g;
const REPEAT_DOT_RE = /\\dot\s*\{|\\overline\s*\{\s*\d/g;
const STACKED_RE = /\\(?:d|t)?frac\s*\{/g;
const MATRIX_RE =
  /\\begin\{(?:p|b|v|V|B)?matrix\}|\\begin\{array\}|\\begin\{cases\}/g;

function count(text: string, re: RegExp): number {
  re.lastIndex = 0;
  return text.match(re)?.length ?? 0;
}

/** 수식 안에서만 센다 — 평문의 `+`·`=` 는 그냥 한 글자다. */
function inMath(text: string, re: RegExp): number {
  MATH_ATOM.lastIndex = 0;
  let n = 0;
  for (const m of text.matchAll(MATH_ATOM)) n += count(m[0], re);
  return n;
}

interface Feature {
  pid: string;
  text: string;
  px: number;
  base: number;
  ops: number;
  dots: number;
  stacked: number;
  matrices: number;
}

/**
 * 후보 모형 — 현행 `displayWidth` 에서 «각 항의 계수만» 갈아 끼운다.
 * `base` 는 연산자 여백·순환소수 보정을 **뺀** 글리프 폭이다.
 */
function modelWidth(
  f: Feature,
  opExtra: number,
  dotExtra: number,
  stackedDiscount: number,
  matrixDiscount: number,
): number {
  return Math.max(
    0,
    f.base +
      opExtra * f.ops +
      dotExtra * f.dots -
      stackedDiscount * f.stacked -
      matrixDiscount * f.matrices,
  );
}

function judge(features: Feature[], width: (f: Feature) => number) {
  let over = 0; // 넘는다 했는데 실제로는 들어감 (→ 이유 없이 1열)
  let under = 0; // 들어간다 했는데 실제로는 넘침 (→ 원장님이 본 접힘)
  for (const f of features) {
    const predicted = width(f) > LIMIT;
    const actual = f.px > CELL_PX;
    if (predicted && !actual) over += 1;
    if (!predicted && actual) under += 1;
  }
  return { over, under, total: over + under };
}

async function main() {
  const pieces = JSON.parse(
    readFileSync(".measure/choices.json", "utf8"),
  ) as Piece[];
  const ids = [...new Set(pieces.map((p) => p.pid))];
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, content FROM problem WHERE id = ANY($1::uuid[])`,
    ids,
  )) as Array<{ id: string; content: string }>;
  const choicesById = new Map(
    rows.map((r) => [r.id, parseProblemContent(r.content ?? "").choices]),
  );

  const features: Feature[] = [];
  for (const p of pieces) {
    const text = choicesById.get(p.pid)?.[p.index];
    if (text === undefined) continue;
    const ops =
      inMath(text, SPACED_OPERATOR_RE) + inMath(text, BINARY_MINUS_RE);
    const dots = count(text, REPEAT_DOT_RE);
    features.push({
      pid: p.pid,
      text,
      px: p.px,
      // 현행 값(연산자 3 · 순환소수 6)을 되빼서 «글리프만» 남긴다.
      base: displayWidth(text) - 3 * ops - 6 * dots,
      ops,
      dots,
      stacked: inMath(text, STACKED_RE),
      matrices: inMath(text, MATRIX_RE),
    });
  }
  console.log(`보기 조각 ${features.length}개 (지면에서 nowrap 폭 실측)`);

  const current = judge(features, (f) => modelWidth(f, 3, 6, 0, 0));
  console.log(
    `\n현행 (연산자 +3 · 순환소수 +6) — 과잉 ${current.over} · 놓침 ${current.under} · 합 ${current.total}`,
  );

  /* ── ① 항목별로 «부풀린 몫»이 실측에 얼마나 있는가 ────────────────────────── */
  console.log("\n부풀림의 출처 — 과잉으로 판정된 조각의 성분");
  const overs = features.filter(
    (f) => modelWidth(f, 3, 6, 0, 0) > LIMIT && f.px <= CELL_PX,
  );
  const share = (pick: (f: Feature) => number) =>
    overs.filter((f) => pick(f) > 0).length;
  console.log(`  과잉 ${overs.length}개 중`);
  console.log(
    `    연산자 여백이 붙은 것   ${share((f) => f.ops)} (평균 ${(overs.reduce((s, f) => s + f.ops, 0) / Math.max(1, overs.length)).toFixed(2)}개 = ${((overs.reduce((s, f) => s + f.ops, 0) / Math.max(1, overs.length)) * 3).toFixed(1)}단위)`,
  );
  console.log(
    `    순환소수 보정이 붙은 것 ${share((f) => f.dots)} (평균 ${(overs.reduce((s, f) => s + f.dots, 0) / Math.max(1, overs.length)).toFixed(2)}개 = ${((overs.reduce((s, f) => s + f.dots, 0) / Math.max(1, overs.length)) * 6).toFixed(1)}단위)`,
  );
  console.log(
    `    분수(위아래로 쌓임)     ${share((f) => f.stacked)} (평균 ${(overs.reduce((s, f) => s + f.stacked, 0) / Math.max(1, overs.length)).toFixed(2)}개)`,
  );
  console.log(
    `    행렬·cases(쌓임)        ${share((f) => f.matrices)} (평균 ${(overs.reduce((s, f) => s + f.matrices, 0) / Math.max(1, overs.length)).toFixed(2)}개)`,
  );
  console.log(
    `  (전체 조각 평균 — 연산자 ${(features.reduce((s, f) => s + f.ops, 0) / features.length).toFixed(2)} · 순환소수 ${(features.reduce((s, f) => s + f.dots, 0) / features.length).toFixed(2)} · 분수 ${(features.reduce((s, f) => s + f.stacked, 0) / features.length).toFixed(2)} · 행렬 ${(features.reduce((s, f) => s + f.matrices, 0) / features.length).toFixed(2)})`,
  );

  /* ── ② 연산자 여백만 옮겨 본다 ─────────────────────────────────────────────── */
  console.log("\n연산자 여백만 바꿨을 때 (순환소수 6 고정)");
  for (const op of [0, 1, 1.5, 2, 2.5, 3, 4]) {
    const r = judge(features, (f) => modelWidth(f, op, 6, 0, 0));
    console.log(
      `  +${String(op).padStart(3)} → 과잉 ${String(r.over).padStart(3)} · 놓침 ${String(r.under).padStart(3)} · 합 ${String(r.total).padStart(3)}`,
    );
  }

  /* ── ③ «쌓이는 것»을 깎아 본다 — 분수·행렬은 가로로 안 늘어난다 ───────────── */
  console.log("\n쌓이는 수식을 깎았을 때 (연산자 3 · 순환소수 6 고정)");
  for (const st of [0, 1, 2]) {
    for (const mx of [0, 8, 16]) {
      const r = judge(features, (f) => modelWidth(f, 3, 6, st, mx));
      console.log(
        `  분수 −${st} · 행렬 −${String(mx).padStart(2)} → 과잉 ${String(r.over).padStart(3)} · 놓침 ${String(r.under).padStart(3)} · 합 ${String(r.total).padStart(3)}`,
      );
    }
  }

  /* ── ④ 순환소수 보정 ─────────────────────────────────────────────────────── */
  console.log("\n순환소수 보정만 바꿨을 때 (연산자 3 고정)");
  for (const dot of [0, 2, 4, 6, 8]) {
    const r = judge(features, (f) => modelWidth(f, 3, dot, 0, 0));
    console.log(
      `  +${String(dot).padStart(2)} → 과잉 ${String(r.over).padStart(3)} · 놓침 ${String(r.under).padStart(3)} · 합 ${String(r.total).padStart(3)}`,
    );
  }

  /* ── ⑤ 문항 단위 — 지면에 실제로 나타나는 몫 ─────────────────────────────── */
  // 열 수는 **문항 단위**로 정해진다(`fitsTwoColumns` 는 하나라도 넘으면 전부 1열).
  // 조각 오판이 줄어도 문항이 안 바뀌면 지면은 그대로다.
  const byProblem = new Map<string, Feature[]>();
  for (const f of features) {
    const list = byProblem.get(f.pid) ?? [];
    list.push(f);
    byProblem.set(f.pid, list);
  }
  const problemStat = (width: (f: Feature) => number) => {
    let oneCol = 0;
    let oneColButFits = 0;
    let twoColButFolds = 0;
    for (const [, list] of byProblem) {
      if (list.length < 2) continue;
      const predictedTwoCol = list.every((f) => width(f) <= LIMIT);
      const actuallyFits = list.every((f) => f.px <= CELL_PX);
      if (!predictedTwoCol) {
        oneCol += 1;
        if (actuallyFits) oneColButFits += 1;
      } else if (!actuallyFits) twoColButFolds += 1;
    }
    return { oneCol, oneColButFits, twoColButFolds };
  };
  const now = problemStat((f) => modelWidth(f, 3, 6, 0, 0));
  const proposed = problemStat((f) => modelWidth(f, 3, 0, 1, 16));
  console.log("\n문항 단위 — 지면에 실제로 나타나는 몫");
  console.log(
    `  현행   1열 ${now.oneCol}건 · 그중 2열에 다 들어감 ${now.oneColButFits} · 2열인데 접히는 문항 ${now.twoColButFolds}`,
  );
  console.log(
    `  제안   1열 ${proposed.oneCol}건 · 그중 2열에 다 들어감 ${proposed.oneColButFits} · 2열인데 접히는 문항 ${proposed.twoColButFolds}`,
  );

  /* ── ⑥ 격자 탐색 — 놓침을 늘리지 않는 선에서 과잉을 가장 줄이는 조합 ──────── */
  let best = {
    op: 3,
    dot: 6,
    st: 0,
    mx: 0,
    over: current.over,
    under: current.under,
  };
  for (const op of [1, 1.5, 2, 2.5, 3])
    for (const dot of [0, 2, 4, 6])
      for (const st of [0, 1, 2])
        for (const mx of [0, 8, 16]) {
          const r = judge(features, (f) => modelWidth(f, op, dot, st, mx));
          // 놓침(접힘)은 원장님이 직접 지적한 결함이라 **늘리지 않는다**.
          if (r.under <= current.under && r.over < best.over)
            best = { op, dot, st, mx, over: r.over, under: r.under };
        }
  console.log(
    `\n놓침을 늘리지 않으면서 과잉이 가장 적은 조합:\n` +
      `  연산자 +${best.op} · 순환소수 +${best.dot} · 분수 −${best.st} · 행렬 −${best.mx}\n` +
      `  → 과잉 ${current.over} → ${best.over} · 놓침 ${current.under} → ${best.under}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
