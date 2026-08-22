import type { UnitSeed } from "../../../prisma/seed-data/units";

import { fracSpec } from "./fracFig";
import { fig, make } from "./make";
import { addFrac, fmtDec, fmtFrac, subFrac } from "./math";
import { intBetween, pick } from "./rng";
import type { ChapterHandler, ElemProblem, Rng } from "./types";

function bigNum(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("1000이 10개") || s.includes("다섯 자리")) {
    const n = intBetween(rng, 2, 9);
    return make(unit, `1000이 ${n}개인 수를 쓰시오.`, String(n * 1000), `1000×${n}=${n * 1000}`);
  }
  if (s.includes("억")) {
    return make(unit, "10000이 10000개인 수의 이름을 쓰시오.", "억", "10000×10000=1억");
  }
  if (s.includes("조")) {
    return make(unit, "1억이 10000개인 수의 이름을 쓰시오.", "조", "1억×10000=1조");
  }
  if (s.includes("뛰어서")) {
    const a = intBetween(rng, 3, 8) * 10000;
    return make(unit, `${a}부터 10000씩 3번 뛰어 센 수를 쓰시오.`, String(a + 30000), `${a}+10000×3=${a + 30000}`);
  }
  if (s.includes("크기 비교")) {
    const a = intBetween(rng, 12000, 45000);
    const b = a + intBetween(rng, 200, 8000);
    return make(unit, `${a}과 ${b} 중 더 큰 수를 쓰시오.`, String(b), "높은 자리부터 비교합니다.");
  }
  const n = intBetween(rng, 2, 9);
  return make(unit, `10000이 ${n}개인 수를 쓰시오.`, String(n * 10000), `10000×${n}=${n * 10000}`);
}

function angle(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("비교")) {
    return make(unit, "더 큰 각의 기호를 쓰시오.", "가", "벌어진 정도가 큰 쪽이 큰 각입니다.", fig("anglePick", {}));
  }
  if (s.includes("재기") || s.includes("분류")) {
    const deg = pick(rng, [30, 45, 60, 120, 135, 150]);
    const kind = deg < 90 ? "예각" : deg === 90 ? "직각" : "둔각";
    return make(unit, `각도가 ${deg}°이면 예각, 직각, 둔각 중 무엇인가?`, kind, "90°보다 작으면 예각, 같으면 직각, 크면 둔각입니다.", fig("protractor", { deg }));
  }
  if (s.includes("삼각형")) {
    const a = intBetween(rng, 30, 70);
    const b = intBetween(rng, 30, 70);
    const c = 180 - a - b;
    return make(unit, `삼각형의 두 각이 ${a}°, ${b}°일 때 나머지 한 각은 몇 도인가?`, String(c), `삼각형 내각의 합은 180°입니다. 180-${a}-${b}=${c}`);
  }
  if (s.includes("사각형")) {
    const a = intBetween(rng, 70, 110);
    const b = intBetween(rng, 70, 110);
    const c = intBetween(rng, 70, 110);
    const d = 360 - a - b - c;
    return make(unit, `사각형의 세 각이 ${a}°, ${b}°, ${c}°일 때 나머지 한 각은 몇 도인가?`, String(d), `사각형 내각의 합은 360°입니다.`);
  }
  const x = intBetween(rng, 20, 70);
  const y = intBetween(rng, 15, 50);
  return make(unit, `${x}°+${y}°=\\square°`, String(x + y), `${x}+${y}=${x + y}`);
}

function mulDiv(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("나눗셈의 어림") || s.includes("곱셈의 어림")) {
    const a = intBetween(rng, 210, 480);
    const b = intBetween(rng, 19, 31);
    if (s.includes("곱셈")) {
      const bb = Math.round(b / 10) * 10;
      const aa = Math.round(a / 100) * 100;
      return make(unit, `${a}×${b}을 어림하면 얼마인가? (백의 자리, 십의 자리로 어림)`, String(aa * bb), `${aa}×${bb}=${aa * bb}`);
    }
    return make(unit, `${a}÷${b}의 몫에 가까운 자연수를 쓰시오.`, String(Math.floor(a / b)), `${b}×${Math.floor(a / b)}=${b * Math.floor(a / b)}`);
  }
  if (s.includes("나누기") || s.includes("나눗셈")) {
    const b = s.includes("몇십으로") ? intBetween(rng, 2, 9) * 10 : intBetween(rng, 12, 28);
    const q = intBetween(rng, 11, 24);
    const a = b * q;
    return make(unit, `$${a}\\div${b}=\\square$`, String(q), `$${a}\\div${b}=${q}$`);
  }
  const a = intBetween(rng, 123, 486);
  const b = s.includes("몇십)") ? intBetween(rng, 2, 8) * 10 : intBetween(rng, 12, 28);
  return make(unit, `$${a}\\times${b}=\\square$`, String(a * b), `$${a}\\times${b}=${a * b}$`, fig("columnOp", { top: String(a), op: "×", bottom: String(b) }));
}

function move(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const cells = pick(rng, [
    [
      [1, 1],
      [1, 2],
      [2, 2],
    ],
    [
      [0, 1],
      [1, 1],
      [1, 2],
      [2, 1],
    ],
  ]);
  const op = s.includes("뒤집") ? pick(rng, ["flipH", "flipV"] as const) : s.includes("돌리") ? pick(rng, ["rot90", "rot180", "rot270"] as const) : "rot90";
  const name = op.startsWith("flip") ? (op === "flipH" ? "좌우로 뒤집기" : "위아래로 뒤집기") : op === "rot90" ? "시계 방향으로 90° 돌리기" : op === "rot180" ? "180° 돌리기" : "시계 방향으로 270° 돌리기";
  return make(
    unit,
    `왼쪽 도형을 ${name}한 결과는 오른쪽과 같습니다. 빈칸에 알맞은 말을 쓰시오. $\\square$`,
    name,
    "점격자 위의 칸을 같은 규칙으로 옮깁니다.",
    fig("rotateFlip", { cells, op, n: 4 }),
  );
}

const BAR_THEMES = [
  { unit: "명", labels: ["사과", "배", "포도", "딸기"] },
  { unit: "명", labels: ["축구", "농구", "배구", "야구"] },
  { unit: "권", labels: ["동화", "과학", "역사", "만화"] },
  { unit: "마리", labels: ["개", "고양이", "토끼", "햄스터"] },
  { unit: "명", labels: ["1반", "2반", "3반", "4반"] },
  { unit: "mm", labels: ["3월", "4월", "5월", "6월"] },
  { unit: "명", labels: ["월", "화", "수", "목"] },
] as const;

function distinctFour(rng: Rng): number[] {
  const seen = new Set<number>();
  while (seen.size < 4) seen.add(intBetween(rng, 3, 16));
  return [...seen];
}

function barGraph(unit: UnitSeed, rng: Rng): ElemProblem {
  const theme = BAR_THEMES[unit.orderIndex % BAR_THEMES.length]!;
  const nums = distinctFour(rng);
  const vals = theme.labels.map((label, i) => ({ label, value: nums[i]! }));
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const maxName = vals.find((v) => v.value === max)!.label;
  const minName = vals.find((v) => v.value === min)!.label;
  const pickOne = vals[intBetween(rng, 0, 3)]!;
  const yMax = 18;
  const figure = fig("barChart", { values: vals, yMax, yLabel: theme.unit });
  const s = unit.section;
  if (s.includes("활용") || s.includes("그리기")) {
    const kind = intBetween(rng, 0, 2);
    if (kind === 0) {
      const sum = nums.reduce((a, b) => a + b, 0);
      return make(unit, `막대그래프의 값을 모두 더하면 몇 ${theme.unit}인가?`, String(sum), vals.map((v) => v.value).join("+") + `=${sum}`, figure);
    }
    if (kind === 1) {
      return make(unit, `가장 큰 값과 가장 작은 값의 차는 몇 ${theme.unit}인가?`, String(max - min), `${max}-${min}=${max - min}`, figure);
    }
    return make(unit, `${pickOne.label}의 값은 몇 ${theme.unit}인가?`, String(pickOne.value), `${pickOne.label} 막대를 읽으면 ${pickOne.value}입니다.`, figure);
  }
  if (intBetween(rng, 0, 1) === 0) {
    return make(unit, "막대그래프에서 값이 가장 작은 항목을 쓰시오.", minName, `${minName}이 ${min}으로 가장 작습니다.`, figure);
  }
  return make(unit, "막대그래프에서 값이 가장 큰 항목을 쓰시오.", maxName, `${maxName}이 ${max}으로 가장 큽니다.`, figure);
}

function pattern(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("도형")) {
    return make(unit, "정사각형, 정삼각형, 정사각형, 정삼각형, … 다섯째는 무엇인가?", "정사각형", "두 개가 반복됩니다. 홀수 번째는 정사각형입니다.");
  }
  if (s.includes("계산식") || s.includes("등호")) {
    const a = intBetween(rng, 3, 9);
    return make(unit, `$${a}+${a}+${a}=${a}\\times\\square$`, "3", `${a}가 3번 더해지면 ${a}×3입니다.`);
  }
  const a = intBetween(rng, 2, 5);
  const start = intBetween(rng, 3, 9);
  return make(unit, `${start}, ${start + a}, ${start + 2 * a}, ${start + 3 * a}, $\\square$`, String(start + 4 * a), `${a}씩 늘어납니다.`);
}

function fracAdd42(unit: UnitSeed, rng: Rng): ElemProblem {
  const den = pick(rng, [5, 6, 8, 10]);
  const a = intBetween(rng, 1, 3);
  const b = intBetween(rng, 1, den - a - 1);
  const s = unit.section;
  if (s.includes("뺄셈")) {
    const [n, d] = subFrac(a + den, den, b, den);
    if (s.includes("대분수")) {
      return make(unit, `$1\\frac{${a}}{${den}}-\\frac{${b}}{${den}}=\\square$`, `$${fmtFrac(n, d)}$`, `가분수로 바꿔 분자를 뺍니다.`);
    }
    const [n2, d2] = subFrac(a + 2, den, b, den);
    return make(unit, `$\\frac{${a + 2}}{${den}}-\\frac{${b}}{${den}}=\\square$`, `$${fmtFrac(n2, d2)}$`, `분모가 같으면 분자를 뺍니다.`, fracSpec(rng, den, a + 2));
  }
  if (s.includes("대분수")) {
    const [n, d] = addFrac(1 * den + a, den, b, den);
    return make(unit, `$1\\frac{${a}}{${den}}+\\frac{${b}}{${den}}=\\square$`, `$${fmtFrac(n, d)}$`, `자연수와 진분수를 더합니다.`);
  }
  const [n, d] = addFrac(a, den, b, den);
  return make(unit, `$\\frac{${a}}{${den}}+\\frac{${b}}{${den}}=\\square$`, `$${fmtFrac(n, d)}$`, `분모가 같으면 분자를 더합니다.`, fracSpec(rng, den, a + b));
}

function triangle(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("각의 크기") || s.includes("두 가지")) {
    return make(
      unit,
      "그림에서 세 각이 모두 예각인 삼각형의 기호를 쓰시오.",
      "가",
      "가는 세 각이 모두 90°보다 작습니다. 예각삼각형입니다.",
      fig("namedShapes", {
        items: [
          { shape: "isoTri", label: "가" },
          { shape: "rightTri", label: "나" },
          { shape: "wideTri", label: "다" },
        ],
      }),
    );
  }
  if (s.includes("정삼각형")) {
    return make(unit, "정삼각형의 한 각의 크기는 몇 도인가?", "60", "180÷3=60");
  }
  if (s.includes("이등변")) {
    const base = intBetween(rng, 40, 80);
    const rest = (180 - base) / 2;
    return make(unit, `이등변삼각형의 꼭지각이 ${base}°일 때 밑각의 크기는 몇 도인가?`, String(rest), `(180-${base})÷2=${rest}`);
  }
  return make(
    unit,
    "그림에서 세 변의 길이가 모두 같은 삼각형의 기호를 쓰시오.",
    "가",
    "가의 세 변의 길이가 같습니다. 세 변이 같으면 정삼각형입니다.",
    fig("namedShapes", { items: [{ shape: "eqTri", label: "가" }, { shape: "rightTri", label: "나" }] }),
  );
}

function decAdd(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  if (s.includes("알아보기") || s.includes("관계")) {
    return make(unit, "$0.1$이 $10$개인 수를 소수로 쓰시오.", "1", "0.1×10=1");
  }
  if (s.includes("크기 비교")) {
    const a = intBetween(rng, 12, 45);
    const b = a + intBetween(rng, 3, 20);
    return make(unit, `$0.${a}$과 $0.${b}$ 중 더 큰 수를 쓰시오.`, `0.${b}`, "소수 첫째 자리부터 비교합니다.");
  }
  const da = s.includes("두 자리") ? 2 : 1;
  const a = intBetween(rng, 11, 48) / 10 ** da;
  const b = intBetween(rng, 11, 48) / 10 ** da;
  if (s.includes("뺄셈")) {
    const x = Math.max(a, b);
    const y = Math.min(a, b);
    const z = fmtDec(x - y, da);
    return make(unit, `$${fmtDec(x, da)}-${fmtDec(y, da)}=\\square$`, z, `${fmtDec(x, da)}-${fmtDec(y, da)}=${z}`);
  }
  const z = fmtDec(a + b, da);
  return make(unit, `$${fmtDec(a, da)}+${fmtDec(b, da)}=\\square$`, z, `${fmtDec(a, da)}+${fmtDec(b, da)}=${z}`);
}

function quad(unit: UnitSeed, rng: Rng): ElemProblem {
  void rng;
  const s = unit.section;
  if (s.includes("수직") || s.includes("수선")) {
    return make(unit, "두 직선이 만나서 이루는 각이 직각일 때, 두 직선은 서로 무엇이라고 하는가?", "수직", "직각으로 만나면 수직입니다.", fig("anglePick", {}));
  }
  if (s.includes("평행")) {
    return make(unit, "만나지 않는 두 직선을 무엇이라고 하는가?", "평행선", "같은 평면에서 만나지 않으면 평행입니다.");
  }
  if (s.includes("사다리꼴")) {
    return make(
      unit,
      "그림에서 한 쌍의 변이 평행한 사각형의 기호를 쓰시오.",
      "가",
      "가의 위·아래 변이 평행합니다. 한 쌍이 평행하면 사다리꼴입니다.",
      fig("namedShapes", { items: [{ shape: "trap", label: "가" }, { shape: "irregQuad", label: "나" }] }),
    );
  }
  if (s.includes("평행사변형")) {
    return make(
      unit,
      "그림에서 두 쌍의 변이 평행한 사각형의 기호를 쓰시오.",
      "가",
      "가는 두 쌍이 평행합니다. 평행사변형입니다.",
      fig("namedShapes", { items: [{ shape: "para", label: "가" }, { shape: "trap", label: "나" }] }),
    );
  }
  if (s.includes("마름모")) {
    return make(
      unit,
      "그림에서 네 변의 길이가 모두 같은 사각형의 기호를 쓰시오.",
      "가",
      "가의 네 변의 길이가 같습니다. 네 변이 같으면 마름모입니다.",
      fig("namedShapes", { items: [{ shape: "tallDiamond", label: "가" }, { shape: "rect", label: "나" }] }),
    );
  }
  return make(
    unit,
    "그림에서 네 각이 모두 직각인 사각형의 기호를 쓰시오.",
    "가",
    "가의 네 각이 직각입니다. 직사각형입니다.",
    fig("namedShapes", { items: [{ shape: "rect", label: "가" }, { shape: "tallDiamond", label: "나" }] }),
  );
}

const LINE_THEMES = [
  { unit: "℃", labels: ["3월", "4월", "5월", "6월", "7월"] },
  { unit: "권", labels: ["1주", "2주", "3주", "4주", "5주"] },
  { unit: "명", labels: ["1반", "2반", "3반", "4반", "5반"] },
  { unit: "cm", labels: ["1년", "2년", "3년", "4년", "5년"] },
] as const;

function lineGraph(unit: UnitSeed, rng: Rng): ElemProblem {
  const theme = pick(rng, LINE_THEMES);
  const vals = theme.labels.map((label, i) => ({
    label,
    value: 4 + i + intBetween(rng, 0, 4),
  }));
  const last = vals[vals.length - 1]!.value;
  const first = vals[0]!.value;
  const yMax = Math.max(...vals.map((v) => v.value)) + 3;
  const figure = fig("lineChart", { values: vals, yMax, yLabel: theme.unit });
  if (intBetween(rng, 0, 1) === 0) {
    return make(
      unit,
      `꺾은선그래프에서 ${vals[vals.length - 1]!.label}의 값은 ${vals[0]!.label}보다 얼마 더 큰가?`,
      String(last - first),
      `${last}-${first}=${last - first}`,
      figure,
    );
  }
  const hit = vals[intBetween(rng, 1, vals.length - 2)]!;
  return make(
    unit,
    `꺾은선그래프에서 ${hit.label}의 값은 몇 ${theme.unit}인가?`,
    String(hit.value),
    `${hit.label}의 점은 ${hit.value}입니다.`,
    figure,
  );
}

function polygon(unit: UnitSeed, rng: Rng): ElemProblem {
  const s = unit.section;
  const n = intBetween(rng, 5, 8);
  if (s.includes("정다각형")) {
    return make(unit, `정${n}각형의 한 내각의 합을 구하는 식에서 변의 개수는 몇인가?`, String(n), `정n각형은 변과 각이 ${n}개입니다.`);
  }
  if (s.includes("대각선")) {
    const diag = (n * (n - 3)) / 2;
    return make(unit, `${n}각형의 대각선 개수를 구하시오.`, String(diag), `$\\frac{${n}\\times(${n}-3)}{2}=${diag}$`);
  }
  return make(unit, `${n}개의 선분으로 둘러싸인 도형의 이름을 쓰시오.`, `${n}각형`, `변이 ${n}개이면 ${n}각형입니다.`);
}

export const G4: Record<string, ChapterHandler> = {
  "초4|1-1 큰 수": bigNum,
  "초4|1-2 각도": angle,
  "초4|1-3 곱셈과 나눗셈": mulDiv,
  "초4|1-4 평면도형의 이동": move,
  "초4|1-5 막대그래프": barGraph,
  "초4|1-6 규칙 찾기": pattern,
  "초4|2-1 분수의 덧셈과 뺄셈": fracAdd42,
  "초4|2-2 삼각형": triangle,
  "초4|2-3 소수의 덧셈과 뺄셈": decAdd,
  "초4|2-4 사각형": quad,
  "초4|2-5 꺾은선그래프": lineGraph,
  "초4|2-6 다각형": polygon,
};
