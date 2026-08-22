import type { UnitSeed } from "../../../prisma/seed-data/units";

import { fracSpec } from "./fracFig";
import { fig, make } from "./make";
import { addFrac, divisors, fmtDec, fmtFrac, gcd, lcm, mulFrac, simplify, subFrac } from "./math";
import { intBetween, pick } from "./rng";
import type { ChapterHandler, ElemProblem, Rng } from "./types";

function mixed(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const a = intBetween(rng, 2, 9);
  const b = intBetween(rng, 2, 9);
  const cands = [2, 3, 4, 5, 6, 7, 8, 9].filter((n) => (a * b) % n === 0);
  const c = pick(rng, cands.length > 0 ? cands : [a]);
  if (s.includes("덧셈과 뺄셈 / 곱셈과 나눗셈") || s.includes("곱셈과 나눗셈이 섞여")) {
    return make(unit, `$${a}\\times${b}\\div${c}=\\square$`, String((a * b) / c), `곱셈과 나눗셈은 앞에서부터 계산합니다. ${a * b}÷${c}=${(a * b) / c}`);
  }
  if (s.includes("곱셈(나눗셈)")) {
    return make(unit, `$${a}+${b}\\times${c}=\\square$`, String(a + b * c), `곱셈을 먼저 합니다. ${b}×${c}=${b * c}, ${a}+${b * c}=${a + b * c}`);
  }
  const d = intBetween(rng, 2, 6);
  return make(unit, `$${a}+${b}\\times${c}-${d}=\\square$`, String(a + b * c - d), `곱셈을 먼저: ${b}×${c}=${b * c}. 그다음 ${a}+${b * c}-${d}=${a + b * c - d}`);
}

function factor(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const a = pick(rng, [12, 18, 24, 30, 36]);
  const b = pick(rng, [8, 12, 16, 20, 24]);
  if (s.includes("최대공약수") || s.includes("공약수")) {
    const g = gcd(a, b);
    if (s.includes("방법") || s.includes("최대공약수")) {
      return make(unit, `${a}과 ${b}의 최대공약수를 구하시오.`, String(g), `공약수 중 가장 큰 수는 ${g}입니다.`);
    }
    return make(unit, `${a}과 ${b}의 공약수 중 1이 아닌 가장 작은 수를 구하시오.`, String(divisors(g).filter((x) => x > 1)[0] ?? g), `공약수는 ${divisors(g).join(", ")}입니다.`);
  }
  if (s.includes("최소공배수") || s.includes("공배수")) {
    const m = lcm(a, b);
    return make(unit, `${a}과 ${b}의 최소공배수를 구하시오.`, String(m), `${a}과 ${b}의 공배수 중 가장 작은 수는 ${m}입니다.`);
  }
  if (s.includes("관계")) {
    const n = intBetween(rng, 4, 12);
    const k = intBetween(rng, 2, 6);
    return make(unit, `${n}의 배수 중 ${n * k}의 약수인 가장 큰 수를 구하시오.`, String(n * k), `${n * k}는 ${n}의 배수이면서 자기 자신의 약수입니다.`);
  }
  const n = intBetween(rng, 6, 18);
  return make(unit, `${n}의 약수의 개수를 구하시오.`, String(divisors(n).length), `약수: ${divisors(n).join(", ")}`);
}

function correspond(unit: UnitSeed, rng: Rng): ElemProblem {
  const k = intBetween(rng, 2, 6);
  const x = intBetween(rng, 3, 9);
  return make(
    unit,
    `대응 관계가 $y=${k}x$일 때, $x=${x}$이면 $y$는 얼마인가?`,
    String(k * x),
    `y=${k}×${x}=${k * x}`,
    fig("table", {
      headers: ["x", "y"],
      rows: [
        ["1", String(k)],
        ["2", String(2 * k)],
        [String(x), ""],
      ],
    }),
  );
}

const EQ_FRAC_PAIRS = [
  [1, 2],
  [1, 3],
  [2, 3],
  [1, 4],
  [3, 4],
  [1, 5],
  [2, 5],
] as const;

function reduce(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("소수")) {
    return make(unit, `$\\frac{1}{2}$과 $0.4$ 중 더 큰 수를 쓰시오.`, "$\\frac{1}{2}$", "0.5>0.4");
  }
  if (s.includes("통분") || s.includes("크기 비교")) {
    const a = intBetween(rng, 1, 3);
    const b = intBetween(rng, 1, 4);
    const d1 = 4;
    const d2 = 6;
    const left = (a * d2) / (d1 * d2);
    const right = (b * d1) / (d1 * d2);
    const bigger = left > right ? `\\frac{${a}}{${d1}}` : `\\frac{${b}}{${d2}}`;
    return make(unit, `$\\frac{${a}}{4}$과 $\\frac{${b}}{6}$ 중 더 큰 분수를 쓰시오.`, `$${bigger}$`, "통분하여 분자를 비교합니다.");
  }
  if (s.includes("크기가 같은")) {
    const g = pick(rng, [2, 3]);
    const pairs = EQ_FRAC_PAIRS.filter(([, sd]) => sd * g <= 12);
    const [sn, sd] = pick(rng, pairs);
    const n = sn * g;
    const d = sd * g;
    return make(
      unit,
      `그림에서 색칠한 부분은 $\\frac{${n}}{${d}}$입니다. 이와 크기가 같은 기약분수를 쓰시오.`,
      `$\\frac{${sn}}{${sd}}$`,
      `${g}로 약분하면 $\\frac{${sn}}{${sd}}$입니다.`,
      fracSpec(rng, d, n),
    );
  }
  const g = pick(rng, [2, 3, 4, 5]);
  const n = g * intBetween(rng, 2, 5);
  const d = g * intBetween(rng, n / g + 1, 8);
  const [sn, sd] = simplify(n, d);
  return make(
    unit,
    `$\\frac{${n}}{${d}}$를 기약분수로 나타내시오.`,
    `$\\frac{${sn}}{${sd}}$`,
    `${n}과 ${d}의 최대공약수 ${gcd(n, d)}로 약분합니다.`,
  );
}

function fracAdd51(unit: UnitSeed, rng: Rng): ElemProblem {
  const d1 = pick(rng, [3, 4, 5, 6]);
  let d2 = pick(rng, [4, 5, 6, 8]);
  if (d2 === d1) d2 = d1 + 1;
  const a = intBetween(rng, 1, d1 - 1);
  const b = intBetween(rng, 1, d2 - 1);
  const s = unit.section;
  if (s.includes("뺄셈")) {
    let n1 = a;
    const den1 = d1;
    if (a / d1 < b / d2) {
      n1 = a + d1;
    }
    const [n, d] = subFrac(n1, den1, b, d2);
    return make(unit, `$\\frac{${n1}}{${den1}}-\\frac{${b}}{${d2}}=\\square$`, `$${fmtFrac(n, d)}$`, "통분한 뒤 분자를 뺍니다.");
  }
  const [n, d] = addFrac(a, d1, b, d2);
  return make(unit, `$\\frac{${a}}{${d1}}+\\frac{${b}}{${d2}}=\\square$`, `$${fmtFrac(n, d)}$`, "통분한 뒤 분자를 더합니다.");
}

function area(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const b = intBetween(rng, 4, 12);
  const h = intBetween(rng, 3, 10);
  if (s.includes("둘레")) {
    const n = intBetween(rng, 3, 6);
    const side = intBetween(rng, 4, 12);
    return make(unit, `한 변의 길이가 ${side} cm인 정${n}각형의 둘레는 몇 cm인가?`, String(n * side), `${side}×${n}=${n * side}`);
  }
  if (s.includes("1cm²보다") || s.includes("직사각형과 정사각형")) {
    return make(unit, `가로 ${b} cm, 세로 ${h} cm인 직사각형의 넓이는 몇 cm²인가?`, String(b * h), `${b}×${h}=${b * h}`, fig("areaPoly", { shape: "rect", base: b, height: h }));
  }
  if (s.includes("평행사변형과 삼각형")) {
    if (pick(rng, [0, 1]) === 0) {
      return make(unit, `밑변 ${b} cm, 높이 ${h} cm인 삼각형의 넓이는 몇 cm²인가?`, String((b * h) / 2), `\\frac{${b}\\times${h}}{2}=${(b * h) / 2}`, fig("areaPoly", { shape: "tri", base: b, height: h }));
    }
    return make(unit, `밑변 ${b} cm, 높이 ${h} cm인 평행사변형의 넓이는 몇 cm²인가?`, String(b * h), `${b}×${h}=${b * h}`, fig("areaPoly", { shape: "para", base: b, height: h }));
  }
  const d1 = intBetween(rng, 6, 12);
  const d2 = intBetween(rng, 4, 10);
  if (s.includes("마름모")) {
    return make(unit, `두 대각선의 길이가 ${d1} cm, ${d2} cm인 마름모의 넓이는 몇 cm²인가?`, String((d1 * d2) / 2), `\\frac{${d1}\\times${d2}}{2}=${(d1 * d2) / 2}`, fig("areaPoly", { shape: "rhombus", base: d1, height: d2, d2 }));
  }
  const top = intBetween(rng, 3, 7);
  const bot = top + intBetween(rng, 2, 6);
  return make(unit, `윗변 ${top} cm, 아랫변 ${bot} cm, 높이 ${h} cm인 사다리꼴의 넓이는 몇 cm²인가?`, String(((top + bot) * h) / 2), `\\frac{(${top}+${bot})\\times${h}}{2}=${((top + bot) * h) / 2}`, fig("areaPoly", { shape: "trap", base: bot, height: h, top }));
}

function estimate(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const n = intBetween(rng, 234, 876);
  if (s.includes("이상") || s.includes("이하")) {
    return make(unit, `${n} 이상 ${n + 10} 이하인 자연수는 몇 개인가?`, "11", "양쪽을 포함하면 11개입니다.");
  }
  if (s.includes("초과") || s.includes("미만")) {
    return make(unit, `${n} 초과 ${n + 10} 미만인 자연수는 몇 개인가?`, "9", "양쪽을 빼면 9개입니다.");
  }
  if (s.includes("올림")) {
    const x = intBetween(rng, 241, 249);
    return make(unit, `${x}를 십의 자리에서 올림한 수를 쓰시오.`, "250", "일의 자리가 0이 아니면 올리고 일의 자리를 0으로 합니다.");
  }
  if (s.includes("버림")) {
    const x = intBetween(rng, 241, 249);
    return make(unit, `${x}를 십의 자리에서 버림한 수를 쓰시오.`, "240", "일의 자리를 버립니다.");
  }
  const x = intBetween(rng, 135, 164);
  const rounded = Math.round(x / 10) * 10;
  return make(unit, `${x}를 일의 자리에서 반올림한 수를 쓰시오.`, String(rounded), `일의 자리가 5 이상이면 올리고 아니면 버립니다.`);
}

function fracMul(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const n = intBetween(rng, 1, 4);
  const d = intBetween(rng, n + 1, 8);
  const k = intBetween(rng, 2, 6);
  if (s.includes("(자연수)×(분수)")) {
    const [p, q] = mulFrac(k, 1, n, d);
    return make(unit, `$${k}\\times\\frac{${n}}{${d}}=\\square$`, `$${fmtFrac(p, q)}$`, `${k}×${n}=${k * n}, 분모 ${d}`);
  }
  if (s.includes("진분수의 곱셈") || s.includes("여러 가지")) {
    const n2 = intBetween(rng, 1, 4);
    const d2 = intBetween(rng, n2 + 1, 7);
    const [p, q] = mulFrac(n, d, n2, d2);
    return make(unit, `$\\frac{${n}}{${d}}\\times\\frac{${n2}}{${d2}}=\\square$`, `$${fmtFrac(p, q)}$`, `분자끼리, 분모끼리 곱한 뒤 약분합니다.`);
  }
  const [p, q] = mulFrac(n, d, k, 1);
  return make(unit, `$\\frac{${n}}{${d}}\\times${k}=\\square$`, `$${fmtFrac(p, q)}$`, `분자에 ${k}를 곱합니다.`, fig("fracBars", { cols: d, rows: k, filled: n * k, fill: "#7eb89a" }));
}

const LINE_MOTIFS = ["kite", "eqTri", "isoTrap", "arrow", "house", "rhombus", "hex", "heart"] as const;
const POINT_MOTIFS = ["para", "hourglass", "z", "hex", "rhombus"] as const;

function congSym(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("선대칭")) {
    const motif = pick(rng, LINE_MOTIFS);
    const upright = motif === "heart" || motif === "house" || motif === "arrow" || motif === "eqTri" || motif === "kite";
    const axis = upright ? "v" : pick(rng, ["v", "h"] as const);
    return make(
      unit,
      "점선이 대칭축일 때, 이 도형은 선대칭도형인가? (예/아니요)",
      "예",
      "대칭축을 기준으로 포개어집니다.",
      fig("symmetry", { axis, motif }),
    );
  }
  if (s.includes("점대칭")) {
    const motif = pick(rng, POINT_MOTIFS);
    return make(
      unit,
      "가운데 점을 중심으로 180° 돌렸을 때 겹치는 도형을 무엇이라고 하는가?",
      "점대칭도형",
      "한 점을 중심으로 180° 회전하여 겹치면 점대칭도형입니다.",
      fig("symmetry", { axis: "point", motif }),
    );
  }
  return make(
    unit,
    "모양과 크기가 같아서 포갤 수 있는 두 도형의 관계를 무엇이라고 하는가?",
    "합동",
    "모양과 크기가 같으면 합동입니다.",
    fig("namedShapes", { items: [{ shape: "rightTri", label: "가" }, { shape: "rightTri", label: "나" }] }),
  );
}

function decMul(unit: UnitSeed, rng: Rng): ElemProblem {
  const a = intBetween(rng, 12, 48) / 10;
  const b = intBetween(rng, 2, 9);
  const s = unit.section;
  if (s.includes("소수점의 위치")) {
    return make(unit, "$1.2\\times0.3$의 소수점 자리는 소수 몇째 자리인가?", "2", "1.2는 소수 첫째, 0.3도 소수 첫째이므로 곱은 소수 둘째 자리입니다.");
  }
  if (s.includes("1보다 작은 소수)×(1보다 작은") || s.includes("1보다 큰 소수)×(1보다 큰")) {
    const x = intBetween(rng, 12, 25) / 10;
    const y = intBetween(rng, 12, 25) / 10;
    const z = fmtDec(x * y, 2);
    return make(unit, `$${fmtDec(x, 1)}\\times${fmtDec(y, 1)}=\\square$`, z, `${fmtDec(x, 1)}×${fmtDec(y, 1)}=${z}`);
  }
  if (s.includes("(자연수)×")) {
    const z = fmtDec(b * a, 1);
    return make(unit, `$${b}\\times${fmtDec(a, 1)}=\\square$`, z, `${b}×${fmtDec(a, 1)}=${z}`);
  }
  const z = fmtDec(a * b, 1);
  return make(unit, `$${fmtDec(a, 1)}\\times${b}=\\square$`, z, `${fmtDec(a, 1)}×${b}=${z}`);
}

function cuboid(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const w = intBetween(rng, 2, 8);
  const d = intBetween(rng, 2, 6);
  const h = intBetween(rng, 2, 7);
  if (s.includes("정육면체") && s.includes("전개도")) {
    return make(unit, "정육면체의 전개도는 면이 몇 개인가?", "6", "정육면체는 면이 6개입니다.", fig("netCuboid", { w: 1, d: 1, h: 1 }));
  }
  if (s.includes("전개도")) {
    return make(unit, `가로 ${w} cm, 세로 ${d} cm, 높이 ${h} cm인 직육면체 전개도에서 가장 긴 변의 길이는 몇 cm인가?`, String(Math.max(w, d, h)), "전개도의 변은 가로·세로·높이 중 하나입니다.", fig("netCuboid", { w, d, h }));
  }
  if (s.includes("겨냥도") || s.includes("성질") || s.includes("둘러싸인")) {
    return make(unit, `가로 ${w} cm, 세로 ${d} cm, 높이 ${h} cm인 직육면체의 모서리는 몇 개인가?`, "12", "직육면체의 모서리는 12개입니다.", fig("cuboid", { w, d, h }));
  }
  return make(unit, "정사각형 6개로 둘러싸인 입체도형의 이름을 쓰시오.", "정육면체", "여섯 면이 모두 정사각형이면 정육면체입니다.", fig("cuboid", { w: 3, d: 3, h: 3 }));
}

function average(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("가능성")) {
    return make(unit, "주사위를 던질 때 짝수의 눈이 나올 가능성을 분수로 쓰시오.", "$\\frac{1}{2}$", "짝수는 2, 4, 6으로 6개 중 3개입니다.");
  }
  const avg = intBetween(rng, 6, 14);
  const d = intBetween(rng, 1, 5);
  const e = intBetween(rng, 0, d);
  const a = avg + d;
  const b = avg + e - d;
  const c = avg - e;
  return make(unit, `${a}, ${b}, ${c}의 평균을 구하시오.`, String(avg), `(${a}+${b}+${c})÷3=${avg}`);
}

export const G5: Record<string, ChapterHandler> = {
  "초5|1-1 자연수의 혼합 계산": mixed,
  "초5|1-2 약수와 배수": factor,
  "초5|1-3 대응 관계": correspond,
  "초5|1-4 약분과 통분": reduce,
  "초5|1-5 분수의 덧셈과 뺄셈": fracAdd51,
  "초5|1-6 다각형의 둘레와 넓이": area,
  "초5|2-1 수의 범위와 어림하기": estimate,
  "초5|2-2 분수의 곱셈": fracMul,
  "초5|2-3 합동과 대칭": congSym,
  "초5|2-4 소수의 곱셈": decMul,
  "초5|2-5 직육면체": cuboid,
  "초5|2-6 평균과 가능성": average,
};
