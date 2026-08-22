import type { UnitSeed } from "../../../prisma/seed-data/units";

import type { ElemTierMap } from "./difficulty";

import { expr, fracLatex, n, unitNum } from "./format";
import { fracSpec } from "./fracFig";
import { fig, make } from "./make";
import { intBetween, pick } from "./rng";
import type { ChapterHandler, ElemProblem, Rng } from "./types";

/**
 * 소단원 번호(`1-2-4`). 이름만으로는 못 가르는 자리가 있다 —
 * `1-2-3`·`1-2-4` 는 units.ts 에 **이름이 똑같이** `직각삼각형 알아보기` 로 적혀 있다.
 */
function secNo(unit: UnitSeed): string {
  return unit.section.split(" ")[0] ?? "";
}

/**
 * 한글 낱말 뒤 조사. 받침이 있으면 앞쪽(`은`·`이`·`을`).
 *
 * ⚠️ **수 뒤에는 쓰지 않는다.** 수는 읽는 소리로 갈리므로($4$→사→「가」, $3$→삼→「이」)
 * 글자만 봐서는 못 정한다 — 그런 자리는 조사가 붙지 않게 문장을 바꾼다.
 */
function josa(word: string, withBatchim: string, without: string): string {
  const w = word.trim();
  const code = w.charCodeAt(w.length - 1);
  if (!(code >= 0xac00 && code <= 0xd7a3)) return without;
  return (code - 0xac00) % 28 !== 0 ? withBatchim : without;
}

function digits(n3: number): [number, number, number] {
  return [Math.floor(n3 / 100) % 10, Math.floor(n3 / 10) % 10, n3 % 10];
}

function addWithCarries(
  rng: Rng,
  minCarries: number,
  maxCarries: number,
): [number, number] {
  // 「세 번」은 백의 자리에서 천의 자리로 넘어가는 받아올림이다 — 합이 네 자리라야
  // 나온다. 예전에는 `a + b < 1000` 으로 묶고 받아올림을 일·십에서만 세어,
  // 소단원 이름이 약속한 「세 번」이 **구조적으로 0** 이었다(1-1-2).
  const wantThird = maxCarries >= 3;
  for (let k = 0; k < 80; k += 1) {
    // 「세 번」이 없는 소단원은 예전처럼 합을 세 자리로 **구성으로** 묶는다.
    // ⚠️ `b` 의 아래끝이 101 이므로 `a` 상한은 798 — 799 를 뽑으면 `b` 범위가
    // `[101, 100]` 으로 뒤집혀 던진다(실측: 씨앗의 0.55%에서 문항이 아예 안 나왔다).
    // 문턱으로 걸러 내지 않고 뽑는 범위를 막는다: 가드가 걸러 낼 값을 생성기가
    // 만들면 안 된다.
    const a = intBetween(rng, 101, wantThird ? 898 : 798);
    const b = wantThird
      ? intBetween(rng, 101, 898)
      : intBetween(rng, 101, 899 - a);
    const [a2, a1, a0] = digits(a);
    const [b2, b1, b0] = digits(b);
    let carries = 0;
    let c = 0;
    if (a0 + b0 >= 10) {
      carries += 1;
      c = 1;
    }
    if (a1 + b1 + c >= 10) {
      carries += 1;
      c = 1;
    } else {
      c = 0;
    }
    if (a2 + b2 + c >= 10) carries += 1;
    if (carries >= minCarries && carries <= maxCarries) return [a, b];
  }
  return minCarries === 0 ? [123, 45] : [567, 278];
}

function subWithBorrows(
  rng: Rng,
  minB: number,
  maxB: number,
): [number, number] {
  for (let k = 0; k < 80; k += 1) {
    const a = intBetween(rng, 200, 980);
    const b = intBetween(rng, 11, a - 10);
    const [, a1, a0] = digits(a);
    const [, b1, b0] = digits(b);
    let borrows = 0;
    let a0x = a0;
    let a1x = a1;
    if (a0x < b0) {
      borrows += 1;
      a0x += 10;
      a1x -= 1;
    }
    if (a1x < b1) borrows += 1;
    if (borrows >= minB && borrows <= maxB) return [a, b];
  }
  return minB === 0 ? [586, 243] : [503, 278];
}

function addSub(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const heavy = s.includes("두 번") || s.includes("세 번");
  if (s.includes("+")) {
    const [a, b] = addWithCarries(rng, heavy ? 2 : 0, heavy ? 3 : 1);
    return make(
      unit,
      `다음을 계산하시오.\n\n$${a}+${b}=\\square$`,
      n(a + b),
      expr(`${a}+${b}=${a + b}`),
      fig("columnOp", { top: String(a), op: "+", bottom: String(b) }),
    );
  }
  const [a, b] = subWithBorrows(rng, heavy ? 2 : 0, heavy ? 3 : 1);
  return make(
    unit,
    `다음을 계산하시오.\n\n$${a}-${b}=\\square$`,
    n(a - b),
    expr(`${a}-${b}=${a - b}`),
    fig("columnOp", { top: String(a), op: "−", bottom: String(b) }),
  );
}

// ── 평면도형: 점격자 도형 ──────────────────────────────────────────────
//
// 처음 점격자를 고른 까닭은 `namedShapes` 의 `rightTri` 가 **직각 표시를 함께 그려서**
// 「직각삼각형을 찾으시오」의 답이 새기 때문이었다(원장님 검수 ⑤ 와 같은 자리).
// **그 전제는 2026-08-22 에 사라졌다** — 표시는 이제 `marks: true` 를 줘야 나오고 기본은 꺼져
// 있다(그림 엔진 세션). 그래도 점격자를 그대로 둔다. 두 가지 까닭이다.
//
//  ㄱ. 「직각인가」를 **칸을 세어** 판단하게 한다 — 초3 교과서의 점종이 방식이고,
//     `namedShapes` 의 그려진 도형은 눈대중밖에 안 된다.
//  ㄴ. 3×3 점 안의 삼각형 84가지에서 뽑으므로 도형이 실제로 갈린다. 씨앗 200개로 재니
//     서로 다른 그림이 1-2-2 163 · 1-2-3 168 · 1-2-4 192 · 1-2-5 66 이다.
//     `namedShapes` 의 도형 목록은 10가지뿐이라 이만큼 안 갈린다.

type Pt = [number, number];

/** 점격자 도형 하나. `lines` 만 그리고 `pts` 에 점을 찍는다. */
type GridShape = {
  pts: Pt[];
  lines: [Pt, Pt][];
  label: string;
  anchor?: Pt;
  side?: string;
};

const SHAPE_LABELS = ["가", "나", "다"] as const;

function onGrid(p: Pt, cols: number, rows: number): Pt {
  if (p[0] < 0 || p[0] > cols || p[1] < 0 || p[1] > rows) {
    throw new Error(
      `점격자 밖입니다: (${p[0]}, ${p[1]}) — cols ${cols}, rows ${rows}`,
    );
  }
  return p;
}

function pointGridSpec(
  cols: number,
  rows: number,
  shapes: GridShape[],
): Record<string, unknown> {
  const dots: Record<string, unknown>[] = [];
  const lines: [Pt, Pt][] = [];
  for (const shape of shapes) {
    for (const [a, b] of shape.lines) {
      lines.push([onGrid(a, cols, rows), onGrid(b, cols, rows)]);
    }
    const anchor =
      shape.anchor ??
      [...shape.pts].sort((p, q) => q[1] - p[1] || p[0] - q[0])[0]!;
    for (const p of shape.pts) {
      onGrid(p, cols, rows);
      const isAnchor = p[0] === anchor[0] && p[1] === anchor[1];
      dots.push({
        c: p[0],
        r: p[1],
        label: isAnchor ? shape.label : "",
        side: isAnchor ? (shape.side ?? "down") : "down",
      });
    }
  }
  return fig("pointGrid", { cols, rows, dots, lines });
}

function closedShape(pts: Pt[], label: string): GridShape {
  return {
    pts,
    lines: pts.map((p, i) => [p, pts[(i + 1) % pts.length]!] as [Pt, Pt]),
    label,
  };
}

function vecDot(v: Pt, p: Pt, q: Pt): number {
  return (p[0] - v[0]) * (q[0] - v[0]) + (p[1] - v[1]) * (q[1] - v[1]);
}

function cosAt(v: Pt, p: Pt, q: Pt): number {
  const l =
    Math.hypot(p[0] - v[0], p[1] - v[1]) * Math.hypot(q[0] - v[0], q[1] - v[1]);
  return l === 0 ? 1 : vecDot(v, p, q) / l;
}

/**
 * 3×3 점 안의 삼각형을 **전부 세어** 「직각이 있는가」로 가른다.
 *
 * 손으로 고른 목록을 쓰지 않는다 — 목록을 손으로 쓰면 그리는 쪽과 답을 정하는 쪽이
 * 같이 눈이 먼다(CLAUDE.md 2026-08-18). 직각 여부는 정수 내적이라 반올림도 없다.
 * 직각이 아닌 쪽은 **뚜렷이** 아니어야 한다(`|cos| >= 0.3`, 약 72°~108° 를 뺀다).
 */
function triPools(): { right: Pt[][]; other: Pt[][] } {
  const pts: Pt[] = [];
  for (let c = 0; c <= 2; c += 1)
    for (let r = 0; r <= 2; r += 1) pts.push([c, r]);
  const right: Pt[][] = [];
  const other: Pt[][] = [];
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      for (let k = j + 1; k < pts.length; k += 1) {
        const t: Pt[] = [pts[i]!, pts[j]!, pts[k]!];
        const cross =
          (t[1]![0] - t[0]![0]) * (t[2]![1] - t[0]![1]) -
          (t[1]![1] - t[0]![1]) * (t[2]![0] - t[0]![0]);
        if (Math.abs(cross) < 2) continue; // 넓이 1 미만은 납작해서 못 읽는다
        const cs = t.map((p) => p[0]);
        const rs = t.map((p) => p[1]);
        if (Math.max(...cs) - Math.min(...cs) < 2) continue;
        if (Math.max(...rs) - Math.min(...rs) < 2) continue;
        const coss = [
          cosAt(t[0]!, t[1]!, t[2]!),
          cosAt(t[1]!, t[0]!, t[2]!),
          cosAt(t[2]!, t[0]!, t[1]!),
        ];
        if (coss.some((v) => Math.abs(v) < 1e-9)) right.push(t);
        else if (Math.min(...coss.map((v) => Math.abs(v))) >= 0.3)
          other.push(t);
      }
    }
  }
  if (!right.length || !other.length) throw new Error("삼각형 풀이 비었습니다");
  return { right, other };
}

const TRI_POOLS = triPools();

/** 3×3 점 안의 각. 꼭짓점은 아래 가운데, 뒤에서 뒤집어 방향을 바꾼다. */
function anglePools(): { right: [Pt, Pt][]; other: [Pt, Pt][] } {
  const v: Pt = [1, 2];
  const ends: Pt[] = [
    [0, 2],
    [2, 2],
    [1, 0],
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
  ];
  const right: [Pt, Pt][] = [];
  const other: [Pt, Pt][] = [];
  for (let i = 0; i < ends.length; i += 1) {
    for (let j = i + 1; j < ends.length; j += 1) {
      const c = cosAt(v, ends[i]!, ends[j]!);
      if (Math.abs(c) < 1e-9) right.push([ends[i]!, ends[j]!]);
      else if (Math.abs(c) >= 0.3 && c > -0.95)
        other.push([ends[i]!, ends[j]!]);
    }
  }
  if (!right.length || !other.length) throw new Error("각 풀이 비었습니다");
  return { right, other };
}

const ANGLE_V: Pt = [1, 2];
const ANGLE_POOLS = anglePools();

function flipPt(p: Pt, fx: boolean, fy: boolean): Pt {
  return [fx ? 2 - p[0] : p[0], fy ? 2 - p[1] : p[1]];
}

function lineNames(unit: UnitSeed, rng: Rng): ElemProblem {
  const letters = ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ"] as const;
  const i = intBetween(rng, 0, letters.length - 2);
  const a = letters[i]!;
  const b = letters[i + 1]!;
  const kind = pick(rng, ["선분", "반직선", "직선"] as const);
  if (kind === "선분") {
    const left = intBetween(rng, 0, 1);
    return make(
      unit,
      `점 ${a}과 점 ${b}을 곧게 이은 선의 이름을 쓰시오.`,
      `선분 ${a}${b}`,
      `두 점을 곧게 이은 선은 선분입니다. 점 ${a}과 점 ${b}을 이었으므로 선분 ${a}${b}입니다.`,
      fig("pointGrid", {
        cols: 6,
        rows: 2,
        dots: [
          { c: left, r: 1, label: a, side: "up" },
          { c: left + 5, r: 1, label: b, side: "up" },
        ],
        lines: [
          [
            [left, 1],
            [left + 5, 1],
          ],
        ],
      }),
    );
  }
  if (kind === "반직선") {
    return make(
      unit,
      `점 ${a}에서 시작하여 점 ${b}을 지나 끝없이 늘인 곧은 선의 이름을 쓰시오.`,
      `반직선 ${a}${b}`,
      `한 점에서 시작하여 한쪽으로 끝없이 늘인 곧은 선은 반직선입니다. 시작하는 점을 먼저 읽어 반직선 ${a}${b}입니다.`,
    );
  }
  return make(
    unit,
    `점 ${a}과 점 ${b}을 지나 양쪽으로 끝없이 늘인 곧은 선의 이름을 쓰시오.`,
    `직선 ${a}${b}`,
    `선분을 양쪽으로 끝없이 늘인 곧은 선은 직선입니다. 두 점을 지나므로 직선 ${a}${b}입니다.`,
  );
}

function rightAnglePick(unit: UnitSeed, rng: Rng): ElemProblem {
  const count = intBetween(rng, 2, 3);
  const gap = count === 3 ? 4 : 5;
  const cols = (count - 1) * gap + 2;
  const answerAt = intBetween(rng, 0, count - 1);
  const shapes: GridShape[] = [];
  for (let i = 0; i < count; i += 1) {
    const pair =
      i === answerAt
        ? pick(rng, ANGLE_POOLS.right)
        : pick(rng, ANGLE_POOLS.other);
    // 좌우로만 뒤집는다. 위아래로 뒤집으면 꼭짓점이 위로 올라가 **기호 높이가 도형마다 달라진다**
    // — 09 §4-7 「라벨은 도형 아래 같은 높이」. 방향 다양성은 변의 기울기 풀이 이미 준다.
    const fx = intBetween(rng, 0, 1) === 1;
    const c0 = i * gap;
    const move = (p: Pt): Pt => {
      const f = flipPt(p, fx, false);
      return [f[0] + c0, f[1]];
    };
    const v = move(ANGLE_V);
    const p = move(pair[0]);
    const q = move(pair[1]);
    shapes.push({
      pts: [v, p, q],
      lines: [
        [v, p],
        [v, q],
      ],
      label: SHAPE_LABELS[i]!,
      anchor: v,
      side: "down",
    });
  }
  const labels = SHAPE_LABELS.slice(0, count).join(", ");
  const answer = SHAPE_LABELS[answerAt]!;
  const ask = pick(rng, [
    `${labels} 중에서 직각인 각의 기호를 쓰시오.`,
    `${labels} 중에서 두 변이 직각으로 만나는 각의 기호를 쓰시오.`,
    `직각을 찾아 기호를 쓰시오. (${labels})`,
  ]);
  return make(
    unit,
    ask,
    answer,
    `직각은 종이를 반듯하게 두 번 접었을 때 생기는 각입니다. 삼각자의 직각 부분을 대었을 때 꼭 맞는 각은 ${answer} 입니다.`,
    pointGridSpec(cols, 2, shapes),
  );
}

/** 삼각형 여러 개를 나란히. `rightCount` 개만 직각삼각형이다. */
function triangleRow(rng: Rng, count: number, rightCount: number) {
  const gap = count === 3 ? 4 : 5;
  const cols = (count - 1) * gap + 2;
  const slots = SHAPE_LABELS.slice(0, count).map((label, i) => ({ label, i }));
  const rightSlots = new Set<number>();
  while (rightSlots.size < rightCount)
    rightSlots.add(intBetween(rng, 0, count - 1));
  const shapes: GridShape[] = [];
  for (const slot of slots) {
    const tri = rightSlots.has(slot.i)
      ? pick(rng, TRI_POOLS.right)
      : pick(rng, TRI_POOLS.other);
    const c0 = slot.i * gap;
    shapes.push(
      closedShape(
        tri.map((p) => [p[0] + c0, p[1]] as Pt),
        slot.label,
      ),
    );
  }
  const rightLabels = slots
    .filter((s) => rightSlots.has(s.i))
    .map((s) => s.label);
  return { cols, shapes, rightLabels, labels: slots.map((s) => s.label) };
}

function rightTriPick(unit: UnitSeed, rng: Rng): ElemProblem {
  const count = intBetween(rng, 2, 3);
  const row = triangleRow(rng, count, 1);
  const answer = row.rightLabels[0]!;
  const list = row.labels.join(", ");
  const ask = pick(rng, [
    `${list} 중에서 직각삼각형의 기호를 쓰시오.`,
    `${list} 중에서 한 각이 직각인 삼각형의 기호를 쓰시오.`,
    `직각삼각형을 찾아 기호를 쓰시오. (${list})`,
  ]);
  return make(
    unit,
    ask,
    answer,
    `한 각이 직각인 삼각형을 직각삼각형이라고 합니다. 삼각자의 직각 부분을 대어 보면 ${answer} 의 한 각이 꼭 맞습니다.`,
    pointGridSpec(row.cols, 2, row.shapes),
  );
}

function rightTriCount(unit: UnitSeed, rng: Rng): ElemProblem {
  const count = 3;
  const rightCount = intBetween(rng, 1, 2);
  const row = triangleRow(rng, count, rightCount);
  const list = row.labels.join(", ");
  const ask = pick(rng, [
    `${list} 중에서 직각삼각형은 모두 몇 개인지 쓰시오.`,
    `${list} 중에서 직각삼각형의 수를 쓰시오.`,
    `다음 삼각형 ${list} 가운데 직각삼각형은 모두 몇 개인가?`,
  ]);
  return make(
    unit,
    ask,
    n(rightCount),
    `한 각이 직각인 삼각형이 직각삼각형입니다. 직각삼각형은 ${row.rightLabels.join(", ")} 이므로 모두 ${n(rightCount)}개입니다.`,
    pointGridSpec(row.cols, 2, row.shapes),
  );
}

function squarePick(unit: UnitSeed, rng: Rng): ElemProblem {
  const count = intBetween(rng, 2, 3);
  const gap = count === 3 ? 4 : 5;
  const maxW = count === 3 ? 2 : 3;
  const cols = (count - 1) * gap + maxW;
  const rows = 3;
  const side = intBetween(rng, 2, maxW);
  const answerAt = intBetween(rng, 0, count - 1);
  const oblong: [number, number][] = [];
  for (let w = 1; w <= maxW; w += 1) {
    for (let h = 1; h <= rows; h += 1) {
      if (w !== h) oblong.push([w, h]);
    }
  }
  const shapes: GridShape[] = [];
  for (let i = 0; i < count; i += 1) {
    const [w, h] = i === answerAt ? [side, side] : pick(rng, oblong);
    const c0 = i * gap;
    const r0 = rows - h!;
    shapes.push(
      closedShape(
        [
          [c0, r0],
          [c0 + w!, r0],
          [c0 + w!, r0 + h!],
          [c0, r0 + h!],
        ],
        SHAPE_LABELS[i]!,
      ),
    );
  }
  const list = SHAPE_LABELS.slice(0, count).join(", ");
  const answer = SHAPE_LABELS[answerAt]!;
  const ask = pick(rng, [
    `${list} 중에서 정사각형의 기호를 쓰시오.`,
    `${list} 중에서 네 변의 길이가 모두 같은 사각형의 기호를 쓰시오.`,
    `정사각형을 찾아 기호를 쓰시오. (${list})`,
  ]);
  return make(
    unit,
    ask,
    answer,
    `네 각이 모두 직각이고 네 변의 길이가 같은 사각형이 정사각형입니다. ${answer} 는 가로와 세로가 모두 ${n(side)}칸으로 같습니다.`,
    pointGridSpec(cols, rows, shapes),
  );
}

function plane(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("선분")) return lineNames(unit, rng);
  if (s.includes("정사각형")) return squarePick(unit, rng);
  if (s.includes("직각삼각형")) {
    return secNo(unit) === "1-2-4"
      ? rightTriCount(unit, rng)
      : rightTriPick(unit, rng);
  }
  return rightAnglePick(unit, rng);
}

function division(unit: UnitSeed, rng: Rng): ElemProblem {
  const b = intBetween(rng, 2, 9);
  // 몫과 나누는 수가 같으면 발문에 이미 답이 적힌 것처럼 읽힌다($25\div5$ 의 몫 $5$).
  let q = intBetween(rng, 2, 9);
  for (let k = 0; k < 8 && q === b; k += 1) q = intBetween(rng, 2, 9);
  const a = b * q;
  const s = unit.section;
  if (s.includes("똑같이")) {
    return make(
      unit,
      `사탕 ${n(a)}개를 ${n(b)}묶음으로 똑같이 나누면 한 묶음은 몇 개인가?`,
      n(q),
      `${n(a)}개를 ${n(b)}묶음으로 똑같이 나누면 한 묶음은 ${n(q)}개입니다. 식으로 쓰면 ${expr(`${a}\\div${b}=${q}`)} 입니다.`,
      fig("groupDots", { groups: b, each: q }),
    );
  }
  if (s.includes("관계")) {
    return make(
      unit,
      `$${a}\\div${b}=\\square$ 를 곱셈식으로 나타내면 $${b}\\times\\square=${a}$ 입니다. $\\square$ 에 알맞은 수를 쓰시오.`,
      n(q),
      `곱셈식과 나눗셈식은 같은 수를 씁니다. $${b}\\times${q}=${a}$ 이므로 $\\square$ 에 알맞은 수는 ${n(q)} 입니다.`,
    );
  }
  if (s.includes("곱셈식")) {
    return make(
      unit,
      `곱셈식 $\\square\\times${b}=${a}$ 를 이용하여 $${a}\\div${b}$ 의 몫을 구하시오.`,
      n(q),
      `$${q}\\times${b}=${a}$ 이므로 $${a}\\div${b}$ 의 몫은 ${n(q)} 입니다.`,
    );
  }
  return make(
    unit,
    `$${a}\\div${b}$ 의 몫을 곱셈구구로 구하시오.`,
    n(q),
    `${n(b)}단 곱셈구구에서 $${b}\\times${q}=${a}$ 이므로 몫은 ${n(q)} 입니다.`,
  );
}

function mul31(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("(몇십)×(몇)")) {
    const a = intBetween(rng, 2, 9) * 10;
    const b = intBetween(rng, 2, 9);
    return make(
      unit,
      `다음을 계산하시오.\n\n$${a}\\times${b}=\\square$`,
      n(a * b),
      expr(`${a}\\times${b}=${a * b}`),
    );
  }
  let tens = intBetween(rng, 1, 8);
  let ones = intBetween(rng, 1, 8);
  const b = intBetween(rng, 2, 5);
  if (s.includes("일의 자리") && s.includes("십의 자리")) {
    ones = intBetween(rng, 5, 9);
    tens = intBetween(rng, 5, 9);
  } else if (s.includes("일의 자리")) {
    ones = intBetween(rng, 5, 9);
    tens = intBetween(rng, 1, 3);
  } else if (s.includes("십의 자리")) {
    ones = intBetween(rng, 1, 3);
    tens = intBetween(rng, 5, 9);
  } else {
    ones = intBetween(rng, 1, 3);
    tens = intBetween(rng, 1, 3);
  }
  const a = tens * 10 + ones;
  return make(
    unit,
    `다음을 계산하시오.\n\n$${a}\\times${b}=\\square$`,
    n(a * b),
    expr(`${a}\\times${b}=${a * b}`),
    fig("columnOp", { top: String(a), op: "×", bottom: String(b) }),
  );
}

function lengthTime(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("1cm보다")) {
    const cm = intBetween(rng, 2, 9);
    const extra = intBetween(rng, 0, 9);
    const mm = cm * 10 + extra;
    if (extra === 0) {
      return make(
        unit,
        `□ 안에 알맞은 수를 쓰시오.\n\n$${mm}\\,\\mathrm{mm}=\\square\\,\\mathrm{cm}$`,
        n(cm),
        `$1\\,\\mathrm{cm}=10\\,\\mathrm{mm}$ 이므로 ${unitNum(mm, "mm")} 는 ${unitNum(cm, "cm")} 입니다.`,
        fig("tape", { length: cm, label: `${mm} mm` }),
      );
    }
    return make(
      unit,
      `${unitNum(mm, "mm")} 는 몇 cm 몇 mm인지 쓰시오.`,
      mixedUnit(cm, extra, "cm", "mm"),
      `$10\\,\\mathrm{mm}=1\\,\\mathrm{cm}$ 이므로 ${unitNum(mm, "mm")} 는 ${mixedUnit(cm, extra, "cm", "mm")} 입니다.`,
      fig("tape", { length: cm, label: `${mm} mm` }),
    );
  }
  if (s.includes("1m보다")) {
    const km = intBetween(rng, 2, 8);
    const m = intBetween(rng, 0, 9) * 100;
    if (m === 0) {
      return make(
        unit,
        `□ 안에 알맞은 수를 쓰시오.\n\n$${km}\\,\\mathrm{km}=\\square\\,\\mathrm{m}$`,
        n(km * 1000),
        `$1\\,\\mathrm{km}=1000\\,\\mathrm{m}$ 이므로 ${unitNum(km, "km")} 는 ${unitNum(km * 1000, "m")} 입니다.`,
      );
    }
    return make(
      unit,
      `${mixedUnit(km, m, "km", "m")} 는 몇 m인지 쓰시오.`,
      n(km * 1000 + m),
      `$1\\,\\mathrm{km}=1000\\,\\mathrm{m}$ 이므로 $${km}\\,\\mathrm{km}=${km * 1000}\\,\\mathrm{m}$ 입니다. ${expr(`${km * 1000}+${m}=${km * 1000 + m}`)} 이므로 ${unitNum(km * 1000 + m, "m")} 입니다.`,
    );
  }
  if (s.includes("어림") || s.includes("재어")) {
    const thing = pick(rng, ["지우개", "풀", "가위", "색연필", "머리핀"]);
    const guessCm = intBetween(rng, 5, 9);
    // 차가 어림한 cm 값과 같으면 「발문이 답을 말한 것」처럼 읽힌다 — 겹치지 않게 고른다.
    const off = pick(
      rng,
      [-4, -3, -2, 2, 3, 4].filter((v) => Math.abs(v) !== guessCm),
    );
    const realMm = guessCm * 10 + off;
    const gap = Math.abs(realMm - guessCm * 10);
    return make(
      unit,
      `${thing}의 길이를 약 ${unitNum(guessCm, "cm")} 로 어림했습니다. 자로 재었더니 ${unitNum(realMm, "mm")} 였습니다. 어림한 길이와 잰 길이의 차는 몇 mm인지 쓰시오.`,
      n(gap),
      `어림한 ${unitNum(guessCm, "cm")} 는 ${unitNum(guessCm * 10, "mm")} 입니다. ${expr(`${Math.max(realMm, guessCm * 10)}-${Math.min(realMm, guessCm * 10)}=${gap}`)} 이므로 차는 ${unitNum(gap, "mm")} 입니다.`,
    );
  }
  if (s.includes("1분보다")) {
    const m = intBetween(rng, 2, 5);
    const sec = intBetween(rng, 0, 9) * 5;
    if (sec === 0) {
      return make(
        unit,
        `${n(m)}분은 몇 초인지 쓰시오.`,
        n(m * 60),
        `$1$ 분은 $60$ 초이므로 ${expr(`60\\times${m}=${m * 60}`)} 입니다.`,
      );
    }
    return make(
      unit,
      `${n(m)}분 ${n(sec)}초는 몇 초인지 쓰시오.`,
      n(m * 60 + sec),
      `$1$ 분은 $60$ 초이므로 ${n(m)}분은 ${n(m * 60)}초입니다. ${expr(`${m * 60}+${sec}=${m * 60 + sec}`)} 이므로 ${n(m * 60 + sec)}초입니다.`,
    );
  }
  if (s.includes("덧셈")) {
    const h1 = intBetween(rng, 1, 4);
    const h2 = intBetween(rng, 1, 3);
    const m1 = intBetween(rng, 15, 50);
    const m2 = intBetween(rng, Math.max(11, 61 - m1), 55);
    const hh = h1 + h2 + 1;
    const mm = m1 + m2 - 60;
    return make(
      unit,
      `${n(h1)}시간 ${n(m1)}분과 ${n(h2)}시간 ${n(m2)}분을 더하면 몇 시간 몇 분인지 쓰시오.`,
      `${n(hh)}시간 ${n(mm)}분`,
      `분끼리 더하면 ${expr(`${m1}+${m2}=${m1 + m2}`)} 분이고, $60$ 분은 $1$ 시간이므로 ${n(m1 + m2)}분은 ${n(1)}시간 ${n(mm)}분입니다. 시간끼리 더하면 ${expr(`${h1}+${h2}=${h1 + h2}`)} 시간이므로 모두 ${n(hh)}시간 ${n(mm)}분입니다.`,
      fig("timeAdd", {
        start: { h: h1, m: m1, s: 0 },
        add: { h: h2, m: m2, s: 0 },
      }),
    );
  }
  const h = intBetween(rng, 4, 8);
  const subh = intBetween(rng, 1, h - 2);
  const m = intBetween(rng, 5, 25);
  const subm = intBetween(rng, m + 5, 55);
  const mm = m + 60 - subm;
  const hh = h - 1 - subh;
  return make(
    unit,
    `${n(h)}시간 ${n(m)}분에서 ${n(subh)}시간 ${n(subm)}분을 빼면 몇 시간 몇 분인지 쓰시오.`,
    `${n(hh)}시간 ${n(mm)}분`,
    `분끼리 뺄 수 없으므로 $1$ 시간을 $60$ 분으로 바꿉니다. ${expr(`${m}+60=${m + 60}`)} 이고 ${expr(`${m + 60}-${subm}=${mm}`)} 이므로 ${n(mm)}분입니다. 시간끼리 빼면 ${expr(`${h - 1}-${subh}=${hh}`)} 이므로 모두 ${n(hh)}시간 ${n(mm)}분입니다.`,
  );
}

/** 분수 그림 종류에 맞는 소재. 그림은 둥근데 말은 「색 테이프」면 어긋난다. */
function fracMaterial(rng: Rng, kind: string): string {
  if (kind === "fracPie") return pick(rng, ["피자", "케이크", "둥근 종이"]);
  if (kind === "triRow") return pick(rng, ["종이 띠", "색종이"]);
  if (kind === "trapFour") return pick(rng, ["색종이", "도화지"]);
  return pick(rng, ["색 테이프", "종이 띠", "색종이"]);
}

function fracDec31(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const parts = intBetween(rng, 3, 8);
  const filled = intBetween(rng, 1, parts - 1);
  if (s.includes("똑같이 나누기")) {
    const spec = fracSpec(rng, parts, filled);
    const material = fracMaterial(rng, String(spec.kind));
    return make(
      unit,
      `그림은 ${material}${josa(material, "을", "를")} 똑같이 나눈 것입니다. 나누어진 조각은 모두 몇 개인지 쓰시오.`,
      n(parts),
      `${material}${josa(material, "은", "는")} 크기가 같은 ${n(parts)}조각으로 나누어져 있습니다. 이때 한 조각은 전체를 똑같이 ${n(parts)}조각으로 나눈 것 중의 하나입니다.`,
      spec,
    );
  }
  if (s.includes("분수 알아보기(1)")) {
    const spec = fracSpec(rng, parts, filled);
    const material = fracMaterial(rng, String(spec.kind));
    return make(
      unit,
      `${material}에서 색칠한 부분은 전체의 얼마인지 분수로 쓰시오.`,
      expr(`\\frac{${filled}}{${parts}}`),
      `전체를 똑같이 ${n(parts)}조각으로 나눈 것 중 ${n(filled)}조각을 색칠했으므로 ${expr(`\\frac{${filled}}{${parts}}`)} 입니다.`,
      spec,
    );
  }
  if (s.includes("분수 알아보기(2)")) {
    const spec = fracSpec(rng, parts, filled);
    const material = fracMaterial(rng, String(spec.kind));
    const rest = parts - filled;
    return make(
      unit,
      `${material}에서 색칠하지 않은 부분은 전체의 얼마인지 분수로 쓰시오.`,
      expr(`\\frac{${rest}}{${parts}}`),
      `전체 ${n(parts)}조각 중 색칠한 것이 ${n(filled)}조각이므로 색칠하지 않은 것은 ${expr(`${parts}-${filled}=${rest}`)} 조각입니다. 따라서 ${expr(`\\frac{${rest}}{${parts}}`)} 입니다.`,
      spec,
    );
  }
  if (s.includes("단위분수")) {
    const a = intBetween(rng, 3, 7);
    const b = a + intBetween(rng, 1, 4);
    return make(
      unit,
      `다음 두 분수 중 더 큰 분수를 쓰시오.\n\n$\\frac{1}{${a}}$,  $\\frac{1}{${b}}$`,
      expr(`\\frac{1}{${a}}`),
      `단위분수는 전체를 똑같이 나눈 조각 수가 적을수록 한 조각이 큽니다. 분모가 더 작은 쪽이 크므로 답은 ${expr(`\\frac{1}{${a}}`)} 입니다.`,
    );
  }
  if (s.includes("분모가 같은")) {
    const den = intBetween(rng, 5, 9);
    const a = intBetween(rng, 1, den - 2);
    const b = intBetween(rng, a + 1, den - 1);
    return make(
      unit,
      `다음 두 분수 중 더 큰 분수를 쓰시오.\n\n$\\frac{${a}}{${den}}$,  $\\frac{${b}}{${den}}$`,
      expr(`\\frac{${b}}{${den}}`),
      `분모가 같으면 분자가 클수록 큽니다. 분자를 비교하면 ${expr(`${b}>${a}`)} 이므로 답은 ${expr(`\\frac{${b}}{${den}}`)} 입니다.`,
    );
  }
  if (s.includes("소수 알아보기")) {
    const k = intBetween(rng, 1, 9);
    const material = pick(rng, ["색 테이프", "종이 띠", "색종이"]);
    return make(
      unit,
      `${material}${josa(material, "을", "를")} 똑같이 ${n(10)}칸으로 나누고 ${n(k)}칸을 색칠했습니다. 색칠한 부분을 소수로 쓰시오.`,
      n(`0.${k}`),
      `전체를 똑같이 ${n(10)}칸으로 나눈 것 중 ${n(k)}칸이므로 ${expr(`\\frac{${k}}{10}`)} 이고, 이것을 소수로 쓰면 ${expr(`0.${k}`)} 입니다.`,
      fig("fracBars", { cols: 10, rows: 1, filled: k }),
    );
  }
  const w1 = intBetween(rng, 0, 6);
  const t1 = intBetween(rng, 1, 9);
  const sameWhole = intBetween(rng, 0, 1) === 1;
  const w2 = sameWhole ? w1 : w1 + intBetween(rng, 1, 3);
  const t2 = sameWhole
    ? t1 <= 5
      ? t1 + intBetween(rng, 1, 4)
      : t1 - intBetween(rng, 1, 4)
    : intBetween(rng, 1, 9);
  const left = w1 + t1 / 10;
  const right = w2 + t2 / 10;
  const bigger = left > right ? `${w1}.${t1}` : `${w2}.${t2}`;
  return make(
    unit,
    `다음 두 수 중 더 큰 수를 쓰시오.\n\n$${w1}.${t1}$,  $${w2}.${t2}$`,
    n(bigger),
    sameWhole
      ? `자연수 부분이 같으므로 소수 첫째 자리를 비교합니다. 답은 ${expr(bigger)} 입니다.`
      : `자연수 부분이 클수록 큰 수입니다. 답은 ${expr(bigger)} 입니다.`,
  );
}

/** (세 자리)×(한 자리) 에서 올림이 몇 번 나는가로 고른다. */
function mul3x1(rng: Rng, minC: number, maxC: number): [number, number] {
  for (let k = 0; k < 120; k += 1) {
    const a = intBetween(rng, 112, 498);
    const b = intBetween(rng, 2, 8);
    let carries = 0;
    let carry = 0;
    for (let d = 0; d < 3; d += 1) {
      const digit = Math.floor(a / 10 ** d) % 10;
      const v = digit * b + carry;
      carry = Math.floor(v / 10);
      if (carry > 0) carries += 1;
    }
    if (carries >= minC && carries <= maxC) return [a, b];
  }
  return minC === 0 ? [123, 2] : [387, 6];
}

function mul32(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("세 자리") && s.includes("한 자리")) {
    const heavy = s.includes("(2)");
    const [a, b] = mul3x1(rng, heavy ? 2 : 0, heavy ? 3 : 1);
    return make(
      unit,
      `다음을 계산하시오.\n\n$${a}\\times${b}=\\square$`,
      n(a * b),
      expr(`${a}\\times${b}=${a * b}`),
      fig("columnOp", { top: String(a), op: "×", bottom: String(b) }),
    );
  }
  if (s.includes("(몇십)×(몇십)")) {
    const form = intBetween(rng, 0, 2);
    if (form === 0) {
      const a = intBetween(rng, 2, 9) * 10;
      const b = intBetween(rng, 2, 9) * 10;
      return make(
        unit,
        `다음을 계산하시오.\n\n$${a}\\times${b}=\\square$`,
        n(a * b),
        expr(`${a}\\times${b}=${a * b}`),
      );
    }
    if (form === 1) {
      const a = intBetween(rng, 12, 48);
      const b = intBetween(rng, 2, 7) * 10;
      return make(
        unit,
        `다음을 계산하시오.\n\n$${a}\\times${b}=\\square$`,
        n(a * b),
        expr(`${a}\\times${b}=${a * b}`),
      );
    }
    const a = intBetween(rng, 3, 9);
    const b = intBetween(rng, 12, 48);
    return make(
      unit,
      `다음을 계산하시오.\n\n$${a}\\times${b}=\\square$`,
      n(a * b),
      expr(`${a}\\times${b}=${a * b}`),
    );
  }
  // 두 수 다 «몇십몇» 이어야 한다 — 일의 자리가 0 이면 (몇십)×(몇십몇) 이라 소단원이 달라진다.
  // 0 을 1 로 밀면 그 값만 두 배로 자주 나온다. 다시 뽑는다.
  let a = intBetween(rng, 12, 28);
  for (let k = 0; k < 8 && a % 10 === 0; k += 1) a = intBetween(rng, 12, 28);
  if (a % 10 === 0) a = 23;
  const b = intBetween(rng, 12, 19);
  return make(
    unit,
    `다음을 계산하시오.\n\n$${a}\\times${b}=\\square$`,
    n(a * b),
    expr(`${a}\\times${b}=${a * b}`),
    fig("columnOp", { top: String(a), op: "×", bottom: String(b) }),
  );
}

/** 두 자리 나눗셈. 십의 자리에서 내림이 있는지로 고른다. */
function div2(rng: Rng, wantCarryDown: boolean): [number, number, number] {
  for (let k = 0; k < 160; k += 1) {
    const b = intBetween(rng, 2, 9);
    const q = intBetween(rng, 11, 49);
    const a = b * q;
    if (a < 20 || a > 99) continue;
    if ((Math.floor(a / 10) % b !== 0) === wantCarryDown) return [a, b, q];
  }
  return wantCarryDown ? [52, 4, 13] : [48, 4, 12];
}

function div32(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("나머지")) {
    const b = intBetween(rng, 3, 9);
    const q = intBetween(rng, 3, 8);
    const r = intBetween(rng, 1, b - 1);
    const a = b * q + r;
    return make(
      unit,
      `$${a}\\div${b}$ 의 몫과 나머지를 쓰시오.`,
      `몫 ${n(q)}, 나머지 ${n(r)}`,
      `$${b}\\times${q}=${b * q}$ 이고 ${expr(`${a}-${b * q}=${r}`)} 이므로 몫은 ${n(q)}, 나머지는 ${n(r)} 입니다.`,
    );
  }
  if (s.includes("세 자리")) {
    const b = intBetween(rng, 3, 9);
    const q = intBetween(rng, 12, 48);
    const a = b * q;
    return make(
      unit,
      `다음을 계산하시오.\n\n$${a}\\div${b}=\\square$`,
      n(q),
      `$${b}\\times${q}=${a}$ 이므로 몫은 ${n(q)} 입니다.`,
    );
  }
  const [a, b, q] = div2(rng, s.includes("내림이 있는"));
  return make(
    unit,
    `다음을 계산하시오.\n\n$${a}\\div${b}=\\square$`,
    n(q),
    `$${b}\\times${q}=${a}$ 이므로 몫은 ${n(q)} 입니다.`,
  );
}

function circle32(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("중심")) {
    const which = pick(rng, ["원의 중심", "지름", "반지름"] as const);
    if (which === "원의 중심") {
      return make(
        unit,
        `원을 그릴 때 컴퍼스의 침을 꽂은 점, 곧 원의 한가운데 있는 점을 무엇이라고 하는지 쓰시오.`,
        "원의 중심",
        "원을 그릴 때 침을 꽂은 점이 원의 중심입니다. 원의 중심에서 원 위의 어느 점까지 재어도 길이가 같습니다.",
      );
    }
    if (which === "지름") {
      return make(
        unit,
        `원의 중심을 지나면서 원 위의 두 점을 이은 선분을 무엇이라고 하는지 쓰시오.`,
        "지름",
        "원의 중심을 지나 원 위의 두 점을 이은 선분이 지름입니다. 한 원에서 지름은 모두 길이가 같습니다.",
      );
    }
    return make(
      unit,
      `원의 중심과 원 위의 한 점을 이은 선분을 무엇이라고 하는지 쓰시오.`,
      "반지름",
      "원의 중심과 원 위의 한 점을 이은 선분이 반지름입니다. 한 원에서 반지름은 모두 길이가 같습니다.",
    );
  }
  if (s.includes("성질")) {
    const r = intBetween(rng, 2, 9);
    if (intBetween(rng, 0, 1) === 1) {
      return make(
        unit,
        `반지름이 ${unitNum(r, "cm")} 인 원의 지름은 몇 cm인지 쓰시오.`,
        n(r * 2),
        `한 원에서 지름은 반지름의 $2$ 배입니다. ${expr(`${r}\\times2=${r * 2}`)} 이므로 지름은 ${unitNum(r * 2, "cm")} 입니다.`,
      );
    }
    return make(
      unit,
      `지름이 ${unitNum(r * 2, "cm")} 인 원의 반지름은 몇 cm인지 쓰시오.`,
      n(r),
      `한 원에서 반지름은 지름의 반입니다. ${expr(`${r * 2}\\div2=${r}`)} 이므로 반지름은 ${unitNum(r, "cm")} 입니다.`,
    );
  }
  const r = intBetween(rng, 2, 9);
  return make(
    unit,
    `컴퍼스를 ${unitNum(r, "cm")} 만큼 벌려서 원을 그렸습니다. 이 원의 지름은 몇 cm인지 쓰시오.`,
    n(r * 2),
    `컴퍼스를 벌린 길이가 원의 반지름이 됩니다. 지름은 반지름의 $2$ 배이므로 ${expr(`${r}\\times2=${r * 2}`)} 입니다.`,
  );
}

function frac32(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  // 「개」로 세는 것만 — 색종이는 「장」이라 발문이 어색해진다.
  const stuff = pick(rng, ["사탕", "구슬", "딱지", "쿠키", "귤"]);
  if (s.includes("분수로 나타내기")) {
    const groups = intBetween(rng, 3, 6);
    const each = intBetween(rng, 2, 8);
    const whole = groups * each;
    const take = intBetween(rng, 1, groups - 1);
    return make(
      unit,
      `${stuff} ${n(whole)}개를 똑같이 ${n(groups)}묶음으로 나누었습니다. ${n(take)}묶음은 전체의 얼마인지 분수로 쓰시오.`,
      expr(`\\frac{${take}}{${groups}}`),
      `전체를 똑같이 ${n(groups)}묶음으로 나눈 것 중 ${n(take)}묶음이므로 ${expr(`\\frac{${take}}{${groups}}`)} 입니다.`,
      fig("groupDots", { groups, each }),
    );
  }
  if (s.includes("분수만큼")) {
    // (2) 는 분자가 $2$ 이상이라 분모가 $3$ 보다 작으면 만들 수 없다.
    const many = s.includes("(2)");
    const den = intBetween(rng, many ? 3 : 2, 6);
    const each = intBetween(rng, 2, 8);
    const whole = den * each;
    // 약분되는 분수($\frac24$)는 초3-2 가 아직 안 배운 모양이다 — 기약인 것만 고른다.
    // 분모와 서로소인 분자는 $den-1$ 이 늘 있으므로 후보가 비지 않는다.
    const take = many
      ? pick(
          rng,
          Array.from({ length: den - 2 }, (_, i) => i + 2).filter(
            (v) => gcd(v, den) === 1,
          ),
        )
      : 1;
    const answer = each * take;
    if (take === 1) {
      return make(
        unit,
        `${stuff} ${n(whole)}개의 $\\frac{1}{${den}}$ 만큼은 몇 개인지 쓰시오.`,
        n(answer),
        `${n(whole)}개를 똑같이 ${n(den)}묶음으로 나누면 한 묶음은 ${n(each)}개입니다. 한 묶음이 전체의 $\\frac{1}{${den}}$ 만큼이므로 답은 ${n(answer)}개입니다.`,
        fig("groupDots", { groups: den, each }),
      );
    }
    return make(
      unit,
      `${stuff} ${n(whole)}개의 $\\frac{${take}}{${den}}$ 만큼은 몇 개인지 쓰시오.`,
      n(answer),
      `${n(whole)}개를 똑같이 ${n(den)}묶음으로 나누면 한 묶음은 ${n(each)}개입니다. ${n(take)}묶음이므로 ${expr(`${each}\\times${take}=${answer}`)} 개입니다.`,
      fig("groupDots", { groups: den, each }),
    );
  }
  if (s.includes("진분수")) {
    const den = intBetween(rng, 3, 9);
    const improper = intBetween(rng, 0, 1) === 1;
    const num = improper
      ? intBetween(rng, den, den + 5)
      : intBetween(rng, 1, den - 1);
    return make(
      unit,
      `다음 분수는 진분수와 가분수 중 무엇인지 쓰시오.\n\n$\\frac{${num}}{${den}}$`,
      improper ? "가분수" : "진분수",
      improper
        ? "분자가 분모와 같거나 분모보다 크면 가분수입니다."
        : "분자가 분모보다 작으면 진분수입니다.",
    );
  }
  if (s.includes("대분수")) {
    const den = intBetween(rng, 3, 8);
    const whole = intBetween(rng, 2, 5);
    const rest = pick(
      rng,
      Array.from({ length: den - 1 }, (_, i) => i + 1).filter(
        (v) => gcd(v, den) === 1,
      ),
    );
    const num = whole * den + rest;
    return make(
      unit,
      `다음 가분수를 대분수로 나타내시오.\n\n$\\frac{${num}}{${den}}$`,
      expr(fracLatex(num, den)),
      `$${num}\\div${den}=${whole}$ 이고 나머지가 ${n(rest)} 이므로 대분수로 나타내면 ${expr(fracLatex(num, den))} 입니다.`,
    );
  }
  const den = intBetween(rng, 6, 9);
  const picked = new Set<number>();
  while (picked.size < 3) picked.add(intBetween(rng, 1, den - 1));
  const three = [...picked];
  const top = Math.max(...three);
  return make(
    unit,
    `다음 세 분수 중 가장 큰 분수를 쓰시오.\n\n$\\frac{${three[0]}}{${den}}$,  $\\frac{${three[1]}}{${den}}$,  $\\frac{${three[2]}}{${den}}$`,
    expr(`\\frac{${top}}{${den}}`),
    `분모가 같은 분수는 분자가 클수록 큽니다. 분자 중 가장 큰 수가 ${n(top)} 이므로 답은 ${expr(`\\frac{${top}}{${den}}`)} 입니다.`,
  );
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** `$1\,\mathrm{L}\ 300\,\mathrm{mL}$` — 큰 단위와 작은 단위를 한 덩어리로. */
function mixedUnit(
  big: number,
  small: number,
  bigUnit: string,
  smallUnit: string,
): string {
  return `$${big}\\,\\mathrm{${bigUnit}}\\ ${small}\\,\\mathrm{${smallUnit}}$`;
}

function capacity(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const mass = s.includes("무게");
  const big = mass ? "kg" : "L";
  const small = mass ? "g" : "mL";
  // 단위를 소리내어 읽으면 조사가 갈린다 — 「그램**은**」·「리터**는**」.
  // 큰 단위와 작은 단위가 한 갈래에서 같은 소리로 끝나므로 한 벌이면 된다.
  const jNun = mass ? "은" : "는";
  const jReul = mass ? "을" : "를";
  const jRo = mass ? "으로" : "로";
  if (s.includes("비교")) {
    const b1 = intBetween(rng, 1, 4);
    const s1 = intBetween(rng, 100, 900);
    const total1 = b1 * 1000 + s1;
    const gap =
      intBetween(rng, 50, 400) * (intBetween(rng, 0, 1) === 1 ? 1 : -1);
    const total2 = total1 + gap;
    const answer = total1 > total2 ? "가" : "나";
    const noun = mass ? "상자" : "그릇";
    const nounNun = josa(noun, "은", "는");
    const nounGa = josa(noun, "이", "가");
    return make(
      unit,
      `가 ${noun}${nounNun} ${mixedUnit(b1, s1, big, small)}, 나 ${noun}${nounNun} ${unitNum(total2, small)} 입니다. 더 ${mass ? "무거운" : "많이 담기는"} ${noun}의 기호를 쓰시오.`,
      answer,
      `${mixedUnit(b1, s1, big, small)} ${jNun} ${unitNum(total1, small)} 입니다. ${expr(`${Math.max(total1, total2)}>${Math.min(total1, total2)}`)} 이므로 ${answer} ${noun}${nounGa} 더 ${mass ? "무겁습니다" : "많이 담깁니다"}.`,
    );
  }
  if (s.includes("단위")) {
    const b = intBetween(rng, 2, 9);
    if (intBetween(rng, 0, 1) === 1) {
      return make(
        unit,
        `□ 안에 알맞은 수를 쓰시오.\n\n$${b}\\,\\mathrm{${big}}=\\square\\,\\mathrm{${small}}$`,
        n(b * 1000),
        `$1\\,\\mathrm{${big}}=1000\\,\\mathrm{${small}}$ 이므로 ${unitNum(b, big)} ${jNun} ${unitNum(b * 1000, small)} 입니다.`,
      );
    }
    const rest = intBetween(rng, 1, 9) * 100;
    return make(
      unit,
      `${unitNum(b * 1000 + rest, small)} ${jNun} 몇 ${big} 몇 ${small}인지 쓰시오.`,
      mixedUnit(b, rest, big, small),
      `$1000\\,\\mathrm{${small}}=1\\,\\mathrm{${big}}$ 이므로 ${unitNum(b * 1000 + rest, small)} ${jNun} ${mixedUnit(b, rest, big, small)} 입니다.`,
    );
  }
  // 큰 단위는 $2$ 이상 — 받아내림이 나도 답이 `$0\,\mathrm{L}\ 372\,\mathrm{mL}$` 로 떨어지지 않는다.
  const b1 = intBetween(rng, 2, 4);
  const b2 = intBetween(rng, 1, 3);
  const s1 = intBetween(rng, 100, 900);
  const s2 = intBetween(rng, 100, 900);
  if (intBetween(rng, 0, 1) === 1) {
    const sumSmall = s1 + s2;
    const carry = sumSmall >= 1000 ? 1 : 0;
    const outSmall = sumSmall - carry * 1000;
    const outBig = b1 + b2 + carry;
    return make(
      unit,
      `다음을 계산하시오.\n\n$${b1}\\,\\mathrm{${big}}\\ ${s1}\\,\\mathrm{${small}}+${b2}\\,\\mathrm{${big}}\\ ${s2}\\,\\mathrm{${small}}=\\square$`,
      mixedUnit(outBig, outSmall, big, small),
      carry === 1
        ? `${small}끼리 더하면 ${expr(`${s1}+${s2}=${sumSmall}`)} 이고, $1000\\,\\mathrm{${small}}$ ${jNun} $1\\,\\mathrm{${big}}$ 이므로 받아올림합니다. ${big}끼리 더하면 ${expr(`${b1}+${b2}+1=${outBig}`)} 이므로 ${mixedUnit(outBig, outSmall, big, small)} 입니다.`
        : `${small}끼리 더하면 ${expr(`${s1}+${s2}=${outSmall}`)}, ${big}끼리 더하면 ${expr(`${b1}+${b2}=${outBig}`)} 이므로 ${mixedUnit(outBig, outSmall, big, small)} 입니다.`,
    );
  }
  const total1 = (b1 + b2) * 1000 + s1;
  const total2 = b2 * 1000 + s2;
  const diff = total1 - total2;
  const outBig = Math.floor(diff / 1000);
  const outSmall = diff % 1000;
  const borrow = s1 < s2;
  return make(
    unit,
    `다음을 계산하시오.\n\n$${b1 + b2}\\,\\mathrm{${big}}\\ ${s1}\\,\\mathrm{${small}}-${b2}\\,\\mathrm{${big}}\\ ${s2}\\,\\mathrm{${small}}=\\square$`,
    mixedUnit(outBig, outSmall, big, small),
    borrow
      ? `${small}끼리 뺄 수 없으므로 $1\\,\\mathrm{${big}}$ ${jReul} $1000\\,\\mathrm{${small}}$ ${jRo} 바꿉니다. ${expr(`${s1 + 1000}-${s2}=${outSmall}`)} 이고 ${expr(`${b1 + b2 - 1}-${b2}=${outBig}`)} 이므로 ${mixedUnit(outBig, outSmall, big, small)} 입니다.`
      : `${small}끼리 빼면 ${expr(`${s1}-${s2}=${outSmall}`)}, ${big}끼리 빼면 ${expr(`${b1 + b2}-${b2}=${outBig}`)} 이므로 ${mixedUnit(outBig, outSmall, big, small)} 입니다.`,
  );
}

/** 그림그래프 소재. 원장님: 「학생 말고 다양한 항목으로」(2026-08-22). */
const GRAPH_STUFF = [
  { name: "사과", unit: "개", places: ["마을", "과수원", "농장"] },
  { name: "나무", unit: "그루", places: ["마을", "공원", "농장"] },
  { name: "우유", unit: "개", places: ["반", "모둠", "마을"] },
  { name: "책", unit: "권", places: ["반", "모둠", "학교"] },
  { name: "자전거", unit: "대", places: ["마을", "반", "학교"] },
  { name: "감자", unit: "개", places: ["농장", "마을", "밭"] },
  { name: "어린이", unit: "명", places: ["마을", "반", "모둠"] },
  { name: "연필", unit: "자루", places: ["반", "모둠", "학교"] },
] as const;

/**
 * 소재와 자리를 함께 고른다 — 원장님: 「**학생 말고 다양한 항목**으로」(2026-08-22).
 *
 * 자리를 따로 뽑으면 「과수원의 자전거」 같은 짝이 나온다. 조사도 갈리므로
 * 이름 뒤에는 늘 「수는」을 붙여 «책은/사과는» 이 엇갈리지 않게 한다.
 */
function pictograph(unit: UnitSeed, rng: Rng): ElemProblem {
  const stuff = pick(rng, GRAPH_STUFF);
  const place = pick(rng, stuff.places);
  const labels = ["가", "나", "다"] as const;
  if (unit.section.includes("나타내기")) {
    // 작은 그림이 $0$ 개면 「작은 그림 $0$개」가 답이 된다 — 일의 자리를 비우지 않는다.
    const values = labels.map(
      () => intBetween(rng, 1, 4) * 10 + intBetween(rng, 1, 9),
    );
    const at = intBetween(rng, 0, labels.length - 1);
    const value = values[at]!;
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return make(
      unit,
      `표를 보고 그림그래프로 나타내려고 합니다. 큰 그림 한 개는 ${n(10)}${stuff.unit}, 작은 그림 한 개는 ${n(1)}${stuff.unit}입니다. ${labels[at]} ${place}${josa(place, "은", "는")} 큰 그림과 작은 그림을 각각 몇 개 그려야 하는지 쓰시오.`,
      `큰 그림 ${n(tens)}개, 작은 그림 ${n(ones)}개`,
      `${labels[at]} ${place}의 ${stuff.name} 수는 ${n(value)}${stuff.unit}입니다. ${expr(`${value}=10\\times${tens}+${ones}`)} 이므로 큰 그림 ${n(tens)}개, 작은 그림 ${n(ones)}개를 그립니다.`,
      fig("table", {
        headers: [place, ...labels],
        rows: [[stuff.name, ...values.map((v) => String(v))]],
      }),
    );
  }
  const step = pick(rng, [2, 5, 10]);
  const counts = labels.map(() => intBetween(rng, 2, 6));
  const at = intBetween(rng, 0, labels.length - 1);
  const count = counts[at]!;
  return make(
    unit,
    `□ 한 칸이 나타내는 ${stuff.name} 수는 ${n(step)}${stuff.unit}입니다. ${labels[at]} ${place}의 ${stuff.name} 수는 몇 ${stuff.unit}인지 쓰시오.`,
    n(count * step),
    `${labels[at]} ${place}${josa(place, "은", "는")} □가 ${n(count)}칸이므로 ${expr(`${step}\\times${count}=${count * step}`)} 입니다.`,
    fig("pictograph", {
      unit: step,
      items: labels.map((label, i) => ({ label, count: counts[i]! })),
    }),
  );
}

export const G3: Record<string, ChapterHandler> = {
  "초3|1-1 덧셈과 뺄셈": addSub,
  "초3|1-2 평면도형": plane,
  "초3|1-3 나눗셈": division,
  "초3|1-4 곱셈": mul31,
  "초3|1-5 길이와 시간": lengthTime,
  "초3|1-6 분수와 소수": fracDec31,
  "초3|2-1 곱셈": mul32,
  "초3|2-2 나눗셈": div32,
  "초3|2-3 원": circle32,
  "초3|2-4 분수": frac32,
  "초3|2-5 들이와 무게": capacity,
  "초3|2-6 그림그래프": pictograph,
};

// ── 난이도 갈래 (D-71) ────────────────────────────────────────────────
//
// 「받아올림이 두 번, 세 번」은 **나열**이다(둘 중 하나면 된다) — 곱이 아니다.
// `addWithCarries` 는 일→십·십→백 두 자리만 세므로 실제로는 늘 두 번이고,
// 그것으로 소단원 조건을 만족한다. 갈래를 넷으로 갈라도 **이 조건은 안 흔든다** —
// 「응용」의 둘째 덧셈·「심화」의 바른 덧셈까지 같은 조건을 걸어 확인한다.

/**
 * 세 자리 덧셈의 받아올림 횟수. `addWithCarries` 와 **같은 셈**이어야 한다 —
 * 일→십 · 십→백 · **백→천** 셋을 다 센다. 둘만 세면 「세 번」이 이 함수에서만
 * 구조적으로 0이 되어, 조건을 재는 쪽과 만드는 쪽이 서로 다른 것을 보게 된다.
 */
function carryCount(a: number, b: number): number {
  const [a2, a1, a0] = digits(a);
  const [b2, b1, b0] = digits(b);
  let carries = 0;
  let c = 0;
  if (a0 + b0 >= 10) {
    carries += 1;
    c = 1;
  }
  if (a1 + b1 + c >= 10) {
    carries += 1;
    c = 1;
  } else {
    c = 0;
  }
  if (a2 + b2 + c >= 10) carries += 1;
  return carries;
}

/**
 * 「응용」의 두 단계 — 처음 수 `base`, 더 많은 만큼 `more`.
 *
 * **두 덧셈이 모두 (세 자리)+(세 자리)** 여야 소단원 안이다. 그래서 첫 덧셈의 합
 * `second` 는 세 자리로 묶는다(네 자리가 되면 둘째 덧셈이 네 자리+세 자리가 된다).
 * 둘째 덧셈의 합은 네 자리여도 좋다 — 그게 「받아올림 세 번」이다.
 * 못 찾으면 **던진다** — 조건을 어긴 문항을 조용히 내보내지 않는다.
 */
function twoStepAdd(rng: Rng): [number, number] {
  for (let k = 0; k < 240; k += 1) {
    const [base, more] = addWithCarries(rng, 2, 2);
    const second = base + more;
    if (second > 999) continue;
    if (carryCount(base, second) < 2) continue;
    return [base, more];
  }
  throw new Error("응용 두 단계 수를 못 만들었습니다");
}

/** 자릿수 두 개를 맞바꾼다($278\to287$). 백의 자리가 $0$ 이 되면 그대로 돌려준다(호출자가 버린다). */
function swapDigits(value: number, rng: Rng): number {
  const d = digits(value);
  const [i, j] = pick(rng, [
    [0, 1],
    [1, 2],
    [0, 2],
  ] as const);
  const out = [...d];
  out[i] = d[j]!;
  out[j] = d[i]!;
  if (out[0] === 0) return value;
  return out[0]! * 100 + out[1]! * 10 + out[2]!;
}

/** 「심화」의 역산 — 어떤 수 · 바르게 더할 수 · 잘못 더한 수 · 잘못된 합 · 바른 합. */
function reverseAdd(rng: Rng): {
  some: number;
  right: number;
  wrong: number;
  wrongSum: number;
  rightSum: number;
} {
  for (let k = 0; k < 240; k += 1) {
    const [some, right] = addWithCarries(rng, 2, 3);
    const wrong = swapDigits(right, rng);
    if (wrong === right) continue;
    const rightSum = some + right;
    const wrongSum = some + wrong;
    // 어떤 수도 잘못된 합도 세 자리여야 학생이 아는 범위 안에서 되짚을 수 있다.
    if (some < 100 || wrongSum < 100 || wrongSum > 999) continue;
    // **잘못 더한 쪽도** 받아올림이 두 번이라야 한다. `addWithCarries` 는 바른 쪽만
    // 보장하는데, 학생이 실제로 푸는 것은 그 합을 되짚는 뺄셈이다 — 여기가 헐거우면
    // 심화인데 받아내림 없는 뺄셈이 나온다(실측: 씨앗 1 에서 $196+342$, 받아올림 0번).
    if (carryCount(some, wrong) < 2) continue;
    return { some, right, wrong, wrongSum, rightSum };
  }
  throw new Error("심화 역산 수를 못 만들었습니다");
}

/** 「기본」 — 두 갈래를 합치는 문장. 조사는 낱말마다 `josa()` 가 정한다. */
const ADD_PAIRS = [
  { left: "남학생", right: "여학생", unit: "명", whole: "학생" },
  { left: "사과", right: "배", unit: "개", whole: "과일" },
  { left: "동화책", right: "위인전", unit: "권", whole: "책" },
  { left: "빨간 색종이", right: "파란 색종이", unit: "장", whole: "색종이" },
  { left: "어른", right: "어린이", unit: "명", whole: "사람" },
  { left: "찹쌀떡", right: "송편", unit: "개", whole: "떡" },
] as const;

/** 「응용」 — 한쪽이 다른 쪽보다 더 많은 두 단계. */
const ADD_PEOPLE = [
  { a: "형", b: "동생", thing: "딱지", unit: "장" },
  { a: "지수", b: "현우", thing: "구슬", unit: "개" },
  { a: "서연", b: "도윤", thing: "붙임딱지", unit: "장" },
  { a: "준서", b: "윤아", thing: "우표", unit: "장" },
  { a: "민재", b: "하린", thing: "사탕", unit: "개" },
] as const;

/** 연산 — 식 그대로. 지금 기본 문항과 같은 모양이다. */
function add3Calc(unit: UnitSeed, rng: Rng): ElemProblem {
  const [a, b] = addWithCarries(rng, 2, 3);
  return make(
    unit,
    `다음을 계산하시오.\n\n$${a}+${b}=\\square$`,
    n(a + b),
    expr(`${a}+${b}=${a + b}`),
    fig("columnOp", { top: String(a), op: "+", bottom: String(b) }),
  );
}

/** 기본 — 문장 한 겹. 식을 학생이 세운다(그래서 세로셈 그림을 붙이지 않는다). */
function add3Word(unit: UnitSeed, rng: Rng): ElemProblem {
  const [a, b] = addWithCarries(rng, 2, 3);
  const p = pick(rng, ADD_PAIRS);
  return make(
    unit,
    `${p.left}${josa(p.left, "은", "는")} ${n(a)}${p.unit}이고, ${p.right}${josa(p.right, "은", "는")} ${n(b)}${p.unit}입니다. ${p.whole}${josa(p.whole, "은", "는")} 모두 몇 ${p.unit}입니까?`,
    n(a + b),
    `${p.left} 수와 ${p.right} 수를 더합니다. ${expr(`${a}+${b}=${a + b}`)} 이므로 모두 ${n(a + b)}${p.unit}입니다.`,
  );
}

/** 응용 — 두 단계. 「더 많은 쪽」을 먼저 구하고 둘을 합친다. */
function add3TwoStep(unit: UnitSeed, rng: Rng): ElemProblem {
  const [base, more] = twoStepAdd(rng);
  const second = base + more;
  const total = base + second;
  const p = pick(rng, ADD_PEOPLE);
  return make(
    unit,
    `${p.a}${josa(p.a, "은", "는")} ${p.thing}${josa(p.thing, "을", "를")} ${n(base)}${p.unit} 모았고, ${p.b}${josa(p.b, "은", "는")} ${p.a}보다 ${n(more)}${p.unit} 더 모았습니다. 두 사람이 모은 ${p.thing}${josa(p.thing, "은", "는")} 모두 몇 ${p.unit}입니까?`,
    n(total),
    `먼저 ${p.b}${josa(p.b, "이", "가")} 모은 수를 구합니다. ${expr(`${base}+${more}=${second}`)} 이므로 ${n(second)}${p.unit}입니다. 두 사람이 모은 수를 더하면 ${expr(`${base}+${second}=${total}`)} 이므로 모두 ${n(total)}${p.unit}입니다.`,
  );
}

/**
 * 심화 — 역산. 잘못 더한 수는 바른 수의 **자릿수를 맞바꾼** 것이라 그럴듯하다.
 *
 * ⚠️ 해설이 **세 자리 뺄셈**을 쓴다. 이 소단원(`1-1-2`, orderIndex 132)은 뺄셈
 * `1-1-3`(133)보다 **앞**이다. 그래도 두는 근거(리드 판단 2026-08-22): 받아내림은
 * 두 자리로 초2에서 배웠고 세 자리가 1-1-3 의 새 내용일 뿐이며, 교재들도 「어떤 수」
 * 유형을 덧셈 차시의 심화에 둔다. **갈릴 수 있는 판단이라 원장님 확정 자료에 표기해
 * 여쭙는다** — 「덧셈만으로」로 확정되면 역산 대신 다른 축을 찾아야 한다.
 */
function add3Reverse(unit: UnitSeed, rng: Rng): ElemProblem {
  const r = reverseAdd(rng);
  return make(
    unit,
    `어떤 수에 $${r.right}$ 만큼 더해야 할 것을 잘못하여 $${r.wrong}$ 만큼 더했더니 합이 $${r.wrongSum}$ 입니다. 바르게 계산한 값은 얼마입니까?`,
    n(r.rightSum),
    `잘못 더한 식에서 어떤 수를 먼저 구합니다. ${expr(`${r.wrongSum}-${r.wrong}=${r.some}`)} 이므로 어떤 수는 ${n(r.some)} 입니다. 바르게 계산하면 ${expr(`${r.some}+${r.right}=${r.rightSum}`)} 입니다.`,
  );
}

/**
 * 난이도 갈래 (D-71 파일럿) — 키는 `tierKey` 형식(`"초3|1-1-2"`), 값은 넷 전부.
 * 축은 시안(연산=식 그대로 · 기본=문장 한 겹 · 응용=두 단계 · 심화=역산·어떤 수)을 따른다.
 */
export const G3_TIERS: ElemTierMap = {
  "초3|1-1-2": {
    연산: add3Calc,
    기본: add3Word,
    응용: add3TwoStep,
    심화: add3Reverse,
  },
};
