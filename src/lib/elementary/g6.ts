import type { UnitSeed } from "../../../prisma/seed-data/units";

import { fig, make } from "./make";
import { divFrac, fmtDec, fmtFrac, gcd, mulFrac, roundTo } from "./math";
import { intBetween, pick } from "./rng";
import type { ChapterHandler, ElemProblem, Rng } from "./types";

function fracDiv61(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const n = intBetween(rng, 1, 5);
  const d = intBetween(rng, n + 1, 9);
  const k = intBetween(rng, 2, 6);
  if (s.includes("(자연수)÷(자연수)")) {
    const a = intBetween(rng, 2, 8);
    const b = intBetween(rng, a + 1, 12);
    return make(unit, `$${a}\\div${b}$의 몫을 분수로 쓰시오.`, `$${fmtFrac(a, b)}$`, `${a}÷${b}=\\frac{${a}}{${b}}`);
  }
  if (s.includes("대분수")) {
    const whole = intBetween(rng, 1, 3);
    const [p, q] = divFrac(whole * d + n, d, k, 1);
    return make(unit, `$${whole}\\frac{${n}}{${d}}\\div${k}=\\square$`, `$${fmtFrac(p, q)}$`, "가분수로 바꿔 나눕니다.");
  }
  const [p, q] = divFrac(n, d, k, 1);
  return make(unit, `$\\frac{${n}}{${d}}\\div${k}=\\square$`, `$${fmtFrac(p, q)}$`, `분자에 1/${k}를 곱합니다. $\\frac{${n}}{${d}\\times${k}}$`);
}

function prismPyr(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const n = intBetween(rng, 3, 6);
  if (s.includes("각뿔")) {
    const faces = n + 1;
    const verts = n + 1;
    if (s.includes("이름") || s.includes("구성")) {
      return make(unit, `밑면이 정${n}각형인 각뿔의 꼭짓점은 몇 개인가?`, String(verts), `밑면 꼭짓점 ${n}개 + 꼭대기 1개 = ${verts}`, fig("pyramid", { sides: n, h: 3 }));
    }
    return make(unit, `밑면이 ${n}각형인 각뿔의 면의 수는 몇인가?`, String(faces), `밑면 1 + 옆면 ${n} = ${faces}`, fig("pyramid", { sides: n, h: 3 }));
  }
  if (s.includes("전개도")) {
    return make(unit, `밑면이 정${n}각형인 각기둥 전개도에서 옆면은 몇 개인가?`, String(n), `옆면은 밑면의 변의 개수와 같습니다.`, fig("prism", { sides: n, h: 3, net: true }));
  }
  const faces = n + 2;
  return make(unit, `밑면이 ${n}각형인 각기둥의 면의 수는 몇인가?`, String(faces), `밑면 2 + 옆면 ${n} = ${faces}`, fig("prism", { sides: n, h: 3 }));
}

function decDiv61(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const b = intBetween(rng, 2, 9);
  if (s.includes("어림") || s.includes("소수점 위치")) {
    return make(unit, "$15\\div4$의 몫을 소수 첫째 자리까지 구하시오.", "3.8", "15÷4=3.75 → 소수 첫째 자리 3.8");
  }
  if (s.includes("몫이 1보다 작은") || s.includes("소수 첫째 자리에 0")) {
    const a = intBetween(rng, 12, 36) / 100;
    const q = fmtDec(a / b, 3);
    return make(unit, `$${fmtDec(a, 2)}\\div${b}=\\square$`, q, `${fmtDec(a, 2)}÷${b}=${q}`);
  }
  const a = intBetween(rng, 15, 80) / 10;
  const q = fmtDec(a / b, 2);
  return make(unit, `$${fmtDec(a, 1)}\\div${b}=\\square$`, q, `${fmtDec(a, 1)}÷${b}=${q}`);
}

function ratio(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const a = intBetween(rng, 2, 9);
  const b = intBetween(rng, a + 1, 15);
  const g = gcd(a, b);
  if (s.includes("백분율")) {
    const n = pick(rng, [20, 25, 40, 50, 75]);
    return make(unit, `${n}%를 분수로 나타내시오.`, `$${fmtFrac(n, 100)}$`, `${n}%=\\frac{${n}}{100}`);
  }
  if (s.includes("비율")) {
    return make(unit, `${a}에 대한 ${b}의 비율을 분수로 쓰시오.`, `$${fmtFrac(b, a)}$`, `비율 = \\frac{${b}}{${a}}`);
  }
  return make(unit, `${a}와 ${b}의 비를 가장 간단한 자연수의 비로 나타내시오.`, `${a / g}:${b / g}`, `${g}로 나눕니다.`);
}

const GRAPH_THEMES = [
  ["사과", "배", "포도"],
  ["축구", "농구", "배구", "야구"],
  ["버스", "지하철", "도보"],
  ["국어", "수학", "영어", "과학"],
  ["동화", "과학", "역사", "만화"],
  ["봄", "여름", "가을", "겨울"],
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

function graphQuestion(
  unit: UnitSeed,
  rng: Rng,
  kind: "stripChart" | "pieChart",
  name: string,
): ElemProblem {
  const k = pick(rng, [3, 4]);
  const theme = pick(
    rng,
    GRAPH_THEMES.filter((row) => row.length >= k),
  );
  const pcts = split100(rng, k);
  const items = theme.slice(0, k).map((label, i) => ({ label, pct: pcts[i]! }));
  const max = Math.max(...pcts);
  const min = Math.min(...pcts);
  const one = items[intBetween(rng, 0, k - 1)]!;
  const q = intBetween(rng, 0, 3);
  const figure =
    kind === "pieChart" ? fig("pieChart", { slices: items }) : fig("stripChart", { segments: items });
  if (q === 0) {
    return make(unit, `${name}에서 ${one.label}의 비율은 몇 %인가?`, String(one.pct), `${one.label} 구간을 읽으면 ${one.pct}%입니다.`, figure);
  }
  if (q === 1) {
    return make(unit, `${name}에서 가장 큰 항목의 비율은 몇 %인가?`, String(max), `가장 큰 비율은 ${max}%입니다.`, figure);
  }
  if (q === 2) {
    return make(unit, `${name}에서 가장 작은 항목의 비율은 몇 %인가?`, String(min), `가장 작은 비율은 ${min}%입니다.`, figure);
  }
  return make(unit, `${name}에서 가장 큰 비율과 가장 작은 비율의 차는 몇 %인가?`, String(max - min), `${max}-${min}=${max - min}`, figure);
}

function graphs61(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("원그래프")) {
    return graphQuestion(unit, rng, "pieChart", "원그래프");
  }
  return graphQuestion(unit, rng, "stripChart", "띠그래프");
}

function volume(unit: UnitSeed, rng: Rng): ElemProblem {
  const w = intBetween(rng, 2, 8);
  const d = intBetween(rng, 2, 6);
  const h = intBetween(rng, 2, 7);
  const s = unit.section;
  if (s.includes("겉넓이")) {
    const area = 2 * (w * d + d * h + h * w);
    return make(unit, `가로 ${w} cm, 세로 ${d} cm, 높이 ${h} cm인 직육면체의 겉넓이는 몇 cm²인가?`, String(area), `2(${w}×${d}+${d}×${h}+${h}×${w})=${area}`, fig("cuboid", { w, d, h }));
  }
  if (s.includes("㎥") || s.includes("m³")) {
    return make(unit, "$1\\,\\text{m}^3=\\square\\,\\text{cm}^3$", "1000000", "1 m = 100 cm이므로 부피는 100³=1,000,000");
  }
  const vol = w * d * h;
  return make(unit, `가로 ${w} cm, 세로 ${d} cm, 높이 ${h} cm인 직육면체의 부피는 몇 cm³인가?`, String(vol), `${w}×${d}×${h}=${vol}`, fig("cuboid", { w, d, h }));
}

function fracDiv62(unit: UnitSeed, rng: Rng): ElemProblem {
  const n1 = intBetween(rng, 1, 5);
  const d1 = intBetween(rng, n1 + 1, 8);
  const n2 = intBetween(rng, 1, 4);
  const d2 = intBetween(rng, n2 + 1, 7);
  const s = unit.section;
  if (s.includes("(자연수)÷(분수)")) {
    const k = intBetween(rng, 2, 6);
    const [p, q] = divFrac(k, 1, n2, d2);
    return make(unit, `$${k}\\div\\frac{${n2}}{${d2}}=\\square$`, `$${fmtFrac(p, q)}$`, `${k}\\times\\frac{${d2}}{${n2}}`);
  }
  if (s.includes("곱셈") || s.includes("가분수") || s.includes("대분수")) {
    const [p, q] = mulFrac(n1, d1, d2, n2);
    return make(unit, `$\\frac{${n1}}{${d1}}\\div\\frac{${n2}}{${d2}}=\\square$`, `$${fmtFrac(p, q)}$`, `나누는 수의 역수를 곱합니다.`);
  }
  const [p, q] = divFrac(n1, d1, n2, d2);
  return make(unit, `$\\frac{${n1}}{${d1}}\\div\\frac{${n2}}{${d2}}=\\square$`, `$${fmtFrac(p, q)}$`, `역수를 곱합니다.`);
}

function decDiv62(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const a = intBetween(rng, 15, 80) / 10;
  const b = intBetween(rng, 12, 25) / 10;
  if (s.includes("반올림")) {
    const q = a / b;
    return make(unit, `$${fmtDec(a, 1)}\\div${fmtDec(b, 1)}$의 몫을 소수 첫째 자리에서 반올림하시오.`, fmtDec(roundTo(q, 1), 1), `계산한 뒤 반올림합니다.`);
  }
  if (s.includes("남는")) {
    const x = intBetween(rng, 10, 20);
    const y = intBetween(rng, 3, 7);
    return make(unit, `${x}÷${y}의 몫이 자연수일 때 나머지는 얼마인가?`, String(x % y), `${y}×${Math.floor(x / y)}=${y * Math.floor(x / y)}, 나머지 ${x % y}`);
  }
  const q = fmtDec(a / b, 2);
  return make(unit, `$${fmtDec(a, 1)}\\div${fmtDec(b, 1)}=\\square$ (소수 둘째 자리까지)`, q, `${fmtDec(a, 1)}÷${fmtDec(b, 1)}=${q}`);
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
  const h = [
    [intBetween(rng, 1, 3), intBetween(rng, 1, 3)],
    [intBetween(rng, 0, 2), intBetween(rng, 1, 3)],
  ];
  const voxels = heightsToVoxels(h);
  if (s.includes("어느 방향")) {
    return make(
      unit,
      "쌓기나무를 위에서 본 모양에서 칸의 수는 몇인가?",
      String(h.flat().filter((n) => n > 0).length),
      "높이가 1 이상인 칸만 셉니다.",
      fig("stackCubes", { voxels, views: ["top"] }),
    );
  }
  return make(
    unit,
    "쌓기나무는 모두 몇 개인가?",
    String(voxels.length),
    `각 칸의 높이를 더하면 ${voxels.length}개입니다.`,
    fig("stackCubes", { voxels, views: ["iso", "top"] }),
  );
}

function proportion(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const a = intBetween(rng, 2, 8);
  const b = intBetween(rng, 3, 9);
  const k = intBetween(rng, 2, 5);
  if (s.includes("비례배분")) {
    const total = (a + b) * k;
    const left = a * k;
    return make(unit, `${total}을 ${a}:${b}로 나누면 앞의 몫은 얼마인가?`, String(left), `${total}×\\frac{${a}}{${a + b}}=${left}`);
  }
  if (s.includes("비례식")) {
    return make(unit, `${a}:${b}=${a * k}:\\square`, String(b * k), `비를 ${k}배 하면 ${b}×${k}=${b * k}`);
  }
  const g = gcd(a * k, b * k);
  return make(unit, `${a * k}:${b * k}을 가장 간단한 자연수의 비로 나타내시오.`, `${(a * k) / g}:${(b * k) / g}`, `${g}로 나눕니다.`);
}

function circle62(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const r = intBetween(rng, 2, 8);
  const pi = 3;
  if (s.includes("원주") && !s.includes("넓이")) {
    if (s.includes("원주율")) {
      return make(unit, "원주율은 원주를 무엇으로 나눈 값인가?", "지름", "원주율 = 원주 ÷ 지름");
    }
    return make(unit, `반지름이 ${r} cm인 원의 원주(원주율 ${pi})는 몇 cm인가?`, String(2 * r * pi), `2×${r}×${pi}=${2 * r * pi}`);
  }
  const area = r * r * pi;
  return make(unit, `반지름이 ${r} cm인 원의 넓이(원주율 ${pi})는 몇 cm²인가?`, String(area), `${r}×${r}×${pi}=${area}`);
}

const CYL_NET_LAYOUTS = ["opp", "oppFlip", "oppMid", "sameTop", "sameBot", "ends"] as const;

function cylCone(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const r = intBetween(rng, 2, 6);
  const h = intBetween(rng, 3, 9);
  if (s.includes("전개도")) {
    const layout = pick(rng, CYL_NET_LAYOUTS);
    return make(
      unit,
      `밑면의 반지름이 ${r} cm인 원기둥 전개도에서 옆면인 직사각형의 가로는 몇 cm인가? (원주율 3)`,
      String(2 * r * 3),
      `밑면의 둘레 2×${r}×3=${2 * r * 3}`,
      fig("netCylinder", { r, h, pi: 3, layout }),
    );
  }
  if (s.includes("원뿔")) {
    return make(unit, "원뿔의 밑면의 모양을 쓰시오.", "원", "원뿔의 밑면은 원입니다.", fig("cone", { r, h }));
  }
  if (s.includes("구")) {
    return make(unit, "구의 중심에서 구의 표면까지의 거리를 무엇이라고 하는가?", "반지름", "구의 반지름입니다.", fig("sphere", { r }));
  }
  return make(unit, `밑면의 반지름 ${r} cm, 높이 ${h} cm인 원기둥의 높이는 몇 cm인가?`, String(h), "그림의 높이를 읽습니다.", fig("cylinder", { r, h }));
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
