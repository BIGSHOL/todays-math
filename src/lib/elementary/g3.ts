import type { UnitSeed } from "../../../prisma/seed-data/units";

import { fracSpec } from "./fracFig";
import { fig, make } from "./make";
import { intBetween, pick } from "./rng";
import type { ChapterHandler, ElemProblem, Rng } from "./types";

function digits(n: number): [number, number, number] {
  return [Math.floor(n / 100) % 10, Math.floor(n / 10) % 10, n % 10];
}

function addWithCarries(rng: Rng, minCarries: number, maxCarries: number): [number, number] {
  for (let k = 0; k < 80; k += 1) {
    const a = intBetween(rng, 101, 799);
    const b = intBetween(rng, 101, 899 - a);
    const [, a1, a0] = digits(a);
    const [, b1, b0] = digits(b);
    let carries = 0;
    let c0 = 0;
    if (a0 + b0 >= 10) {
      carries += 1;
      c0 = 1;
    }
    if (a1 + b1 + c0 >= 10) carries += 1;
    if (carries >= minCarries && carries <= maxCarries && a + b < 1000) return [a, b];
  }
  return minCarries === 0 ? [123, 45] : [567, 278];
}

function subWithBorrows(rng: Rng, minB: number, maxB: number): [number, number] {
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
      String(a + b),
      `$${a}+${b}=${a + b}$`,
      fig("columnOp", { top: String(a), op: "+", bottom: String(b) }),
    );
  }
  const [a, b] = subWithBorrows(rng, heavy ? 2 : 0, heavy ? 3 : 1);
  return make(
    unit,
    `다음을 계산하시오.\n\n$${a}-${b}=\\square$`,
    String(a - b),
    `$${a}-${b}=${a - b}$`,
    fig("columnOp", { top: String(a), op: "−", bottom: String(b) }),
  );
}

function plane(unit: UnitSeed, rng: Rng): ElemProblem {
  void rng;
  const s = unit.section;
  if (s.includes("선분")) {
    return make(
      unit,
      "다음 중 양끝이 있는 곧은 선의 이름을 쓰시오.",
      "선분",
      "양끝이 있으면 선분, 한 쪽만 있으면 반직선, 양끝이 없으면 직선입니다.",
      fig("geoLine", {}),
    );
  }
  if (s.includes("각") && !s.includes("직각삼각형")) {
    return make(unit, "직각인 도형의 기호를 쓰시오.", "나", "직각은 네모 표시가 있는 각입니다.", fig("anglePick", {}));
  }
  if (s.includes("정사각형")) {
    return make(
      unit,
      "그림에서 네 각이 모두 직각이고 네 변의 길이가 같은 사각형의 기호를 쓰시오.",
      "가",
      "가는 네 각이 직각이고 네 변이 같습니다. 정사각형입니다.",
      fig("namedShapes", { items: [{ shape: "square", label: "가" }, { shape: "rect", label: "나" }] }),
    );
  }
  return make(
    unit,
    "직각삼각형의 기호를 쓰시오.",
    "가",
    "직각이 있는 삼각형이 직각삼각형입니다.",
    fig("namedShapes", { items: [{ shape: "rightTri", label: "가" }, { shape: "isoTri", label: "나" }, { shape: "wideTri", label: "다" }] }),
  );
}

function division(unit: UnitSeed, rng: Rng): ElemProblem {
  const b = intBetween(rng, 2, 9);
  const q = intBetween(rng, 2, 9);
  const a = b * q;
  const s = unit.section;
  if (s.includes("똑같이")) {
    return make(
      unit,
      `사탕 ${a}개를 ${b}묶음으로 똑같이 나누면 한 묶음은 몇 개인가?`,
      String(q),
      `$${a}\\div${b}=${q}$`,
      fig("groupDots", { groups: b, each: q }),
    );
  }
  if (s.includes("관계")) {
    return make(unit, `$${a}\\div${b}=\\square$ 일 때, 곱셈식으로 나타내면 $${b}\\times\\square=${a}$ 입니다. $\\square$에 알맞은 수를 쓰시오.`, String(q), `나눗셈의 몫은 곱셈의 한 인수입니다. $${b}\\times${q}=${a}$`);
  }
  return make(unit, `$${a}\\div${b}=\\square$`, String(q), `$${b}\\times${q}=${a}$이므로 몫은 ${q}입니다.`);
}

function mul31(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("(몇십)×(몇)")) {
    const a = intBetween(rng, 2, 9) * 10;
    const b = intBetween(rng, 2, 9);
    return make(unit, `$${a}\\times${b}=\\square$`, String(a * b), `$${a}\\times${b}=${a * b}$`);
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
  return make(unit, `$${a}\\times${b}=\\square$`, String(a * b), `$${a}\\times${b}=${a * b}$`, fig("columnOp", { top: String(a), op: "×", bottom: String(b) }));
}

function lengthTime(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("1cm보다")) {
    const cm = intBetween(rng, 2, 9);
    const mm = cm * 10;
    return make(unit, `$${mm}\\,\\text{mm}=\\square\\,\\text{cm}$`, String(cm), `$1\\,\\text{cm}=10\\,\\text{mm}$이므로 ${mm} mm는 ${cm} cm입니다.`, fig("tape", { length: cm, label: `${cm} cm` }));
  }
  if (s.includes("1m보다")) {
    const km = intBetween(rng, 2, 8);
    return make(unit, `$${km}\\,\\text{km}=\\square\\,\\text{m}$`, String(km * 1000), `$1\\,\\text{km}=1000\\,\\text{m}$`);
  }
  if (s.includes("어림") || s.includes("재어")) {
    const a = intBetween(rng, 12, 28);
    const b = intBetween(rng, 3, 9);
    return make(unit, `길이가 ${a} cm인 색 테이프에서 ${b} cm를 자르면 남은 길이는 몇 cm인가?`, String(a - b), `${a}-${b}=${a - b}`);
  }
  if (s.includes("1분보다")) {
    const m = intBetween(rng, 2, 5);
    return make(unit, `$${m}\\,\\text{분}=\\square\\,\\text{초}$`, String(m * 60), `$1\\,\\text{분}=60\\,\\text{초}$`);
  }
  if (s.includes("덧셈")) {
    const h1 = intBetween(rng, 1, 4);
    const m1 = intBetween(rng, 10, 40);
    const h2 = intBetween(rng, 1, 3);
    const m2 = intBetween(rng, 10, 50);
    const total = h1 * 60 + m1 + h2 * 60 + m2;
    const hh = Math.floor(total / 60);
    const mm = total % 60;
    return make(
      unit,
      `${h1}시간 ${m1}분 + ${h2}시간 ${m2}분은 몇 시간 몇 분인가?`,
      `${hh}시간 ${mm}분`,
      `${h1 * 60 + m1}+${h2 * 60 + m2}=${total}분=${hh}시간 ${mm}분`,
      fig("timeAdd", { start: { h: h1, m: m1, s: 0 }, add: { h: h2, m: m2, s: 0 } }),
    );
  }
  const h = intBetween(rng, 4, 8);
  const m = intBetween(rng, 20, 50);
  const subh = intBetween(rng, 1, 2);
  const subm = intBetween(rng, 5, 15);
  const tot = h * 60 + m - (subh * 60 + subm);
  return make(unit, `${h}시간 ${m}분에서 ${subh}시간 ${subm}분을 빼면 몇 시간 몇 분인가?`, `${Math.floor(tot / 60)}시간 ${tot % 60}분`, "시간을 분으로 바꿔 뺀 뒤 다시 시간으로 나타냅니다.");
}

function fracDec31(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const d = intBetween(rng, 3, 8);
  const n = intBetween(rng, 1, d - 1);
  if (s.includes("똑같이 나누기") || s.includes("분수 알아보기")) {
    return make(
      unit,
      `색칠한 부분은 전체의 얼마인지 분수로 쓰시오.`,
      `$\\frac{${n}}{${d}}$`,
      `전체를 ${d}등분하고 ${n}칸을 색칠했습니다.`,
      fracSpec(rng, d, n),
    );
  }
  if (s.includes("단위분수")) {
    const a = intBetween(rng, 3, 7);
    const b = a + intBetween(rng, 1, 4);
    return make(unit, `$\\frac{1}{${a}}$과 $\\frac{1}{${b}}$ 중 더 큰 분수를 쓰시오.`, `$\\frac{1}{${a}}$`, `단위분수는 분모가 작을수록 큽니다.`);
  }
  if (s.includes("분모가 같은")) {
    const den = intBetween(rng, 5, 9);
    const a = intBetween(rng, 2, den - 2);
    const b = intBetween(rng, a + 1, den - 1);
    return make(
      unit,
      `$\\frac{${a}}{${den}}$과 $\\frac{${b}}{${den}}$ 중 더 큰 분수를 쓰시오.`,
      `$\\frac{${b}}{${den}}$`,
      `분모가 같으면 분자가 큰 쪽이 큽니다.`,
      fracSpec(rng, den, b),
    );
  }
  if (s.includes("소수 알아보기")) {
    return make(unit, `색칠한 부분을 소수로 쓰시오.`, "0.3", `$\\frac{3}{10}=0.3$`, fig("fracBars", { cols: 10, rows: 1, filled: 3 }));
  }
  const x = intBetween(rng, 12, 45);
  const y = intBetween(rng, x + 3, 89);
  return make(unit, `$0.${x}$과 $0.${y}$ 중 더 큰 수를 쓰시오.`, `0.${y}`, "소수 첫째 자리부터 비교합니다.");
}

function mul32(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("세 자리") && s.includes("한 자리")) {
    const a = intBetween(rng, 102, 486);
    const b = intBetween(rng, 2, 8);
    return make(unit, `$${a}\\times${b}=\\square$`, String(a * b), `$${a}\\times${b}=${a * b}$`, fig("columnOp", { top: String(a), op: "×", bottom: String(b) }));
  }
  if (s.includes("(몇십)×(몇십)")) {
    const a = intBetween(rng, 2, 9) * 10;
    const b = intBetween(rng, 2, 9) * 10;
    return make(unit, `$${a}\\times${b}=\\square$`, String(a * b), `$${a}\\times${b}=${a * b}$`);
  }
  const a = intBetween(rng, 12, 28);
  const b = intBetween(rng, 12, 19);
  return make(unit, `$${a}\\times${b}=\\square$`, String(a * b), `$${a}\\times${b}=${a * b}$`, fig("columnOp", { top: String(a), op: "×", bottom: String(b) }));
}

function div32(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const b = intBetween(rng, 3, 9);
  if (s.includes("나머지")) {
    const q = intBetween(rng, 3, 8);
    const r = intBetween(rng, 1, b - 1);
    const a = b * q + r;
    return make(unit, `$${a}\\div${b}$의 몫과 나머지를 쓰시오.`, `몫 ${q}, 나머지 ${r}`, `$${b}\\times${q}+${r}=${a}$`);
  }
  if (s.includes("세 자리")) {
    const q = intBetween(rng, 12, 48);
    const a = b * q;
    return make(unit, `$${a}\\div${b}=\\square$`, String(q), `$${a}\\div${b}=${q}$`);
  }
  const q = intBetween(rng, 11, 28);
  const a = b * q;
  return make(unit, `$${a}\\div${b}=\\square$`, String(q), `$${a}\\div${b}=${q}$`);
}

function circle32(unit: UnitSeed, rng: Rng): ElemProblem {
  const r = intBetween(rng, 2, 9);
  const s = unit.section;
  if (s.includes("성질") || s.includes("그리기")) {
    return make(unit, `반지름이 ${r} cm인 원의 지름은 몇 cm인가?`, String(r * 2), `지름은 반지름의 2배입니다.`);
  }
  return make(unit, `지름이 ${r * 2} cm인 원의 반지름은 몇 cm인가?`, String(r), `반지름은 지름의 반입니다.`);
}

function frac32(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const whole = intBetween(rng, 12, 36);
  const d = pick(rng, [2, 3, 4, 6]);
  if (s.includes("분수만큼") || s.includes("나타내기")) {
    const n = 1;
    return make(
      unit,
      `${whole}의 $\\frac{${n}}{${d}}$은 얼마인가?`,
      String((whole * n) / d),
      `${whole}\\times\\frac{${n}}{${d}}=${(whole * n) / d}`,
      fracSpec(rng, d, n),
    );
  }
  if (s.includes("가분수") || s.includes("진분수")) {
    return make(unit, `$\\frac{7}{4}$은 진분수인가, 가분수인가?`, "가분수", "분자가 분모보다 크거나 같으면 가분수입니다.");
  }
  if (s.includes("대분수")) {
    return make(unit, `$\\frac{11}{4}$를 대분수로 쓰시오.`, "$2\\frac{3}{4}$", `$11\\div4=2$ 나머지 $3$`);
  }
  const den = intBetween(rng, 5, 9);
  const a = intBetween(rng, 1, den - 2);
  const b = intBetween(rng, a + 1, den - 1);
  return make(unit, `$\\frac{${a}}{${den}}$과 $\\frac{${b}}{${den}}$ 중 더 큰 분수를 쓰시오.`, `$\\frac{${b}}{${den}}$`, "분모가 같으면 분자가 큰 쪽이 큽니다.");
}

function capacity(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("들이의 단위") || s.includes("들이 비교")) {
    const l = intBetween(rng, 2, 8);
    return make(unit, `$${l}\\,\\text{L}=\\square\\,\\text{mL}$`, String(l * 1000), `$1\\,\\text{L}=1000\\,\\text{mL}$`);
  }
  if (s.includes("들이의 합") || s.includes("들이의 차")) {
    const a = intBetween(rng, 250, 800);
    const b = intBetween(rng, 100, 200);
    return make(unit, `${a} mL + ${b} mL = $\\square$ mL`, String(a + b), `${a}+${b}=${a + b}`);
  }
  if (s.includes("무게의 단위") || s.includes("무게 비교")) {
    const kg = intBetween(rng, 2, 9);
    return make(unit, `$${kg}\\,\\text{kg}=\\square\\,\\text{g}$`, String(kg * 1000), `$1\\,\\text{kg}=1000\\,\\text{g}$`);
  }
  const a = intBetween(rng, 400, 900);
  const b = intBetween(rng, 50, 200);
  return make(unit, `${a} g − ${b} g = $\\square$ g`, String(a - b), `${a}-${b}=${a - b}`);
}

function pictograph(unit: UnitSeed, rng: Rng): ElemProblem {
  const unitN = pick(rng, [2, 5, 10]);
  const a = intBetween(rng, 2, 6);
  const b = intBetween(rng, 2, 6);
  const c = intBetween(rng, 1, 5);
  return make(
    unit,
    `□ 한 칸이 ${unitN}명을 나타낼 때, 가 반 학생은 몇 명인가?`,
    String(a * unitN),
    `가 반 칸 수 ${a} × ${unitN} = ${a * unitN}`,
    fig("pictograph", {
      unit: unitN,
      items: [
        { label: "가", count: a },
        { label: "나", count: b },
        { label: "다", count: c },
      ],
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
