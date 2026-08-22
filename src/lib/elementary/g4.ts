/**
 * 초4 생성기. 소단원 **번호**로 갈라 쓴다 — 이름 `includes` 로 가르면 두 소단원이 같은 가지에
 * 떨어져 발문이 통째로 겹친다(2026-08-22 원장님 검수 R5, 초4 에서 7쌍).
 *
 * 표기는 `format.ts` 한 곳을 거친다(R1 모든 수는 KaTeX · R4 한자 수사).
 * 해설은 그 학년까지 배운 연산만 쓴다(R3) — 소수의 곱셈·나눗셈은 초5 다.
 */
import {
  CURRICULUM_UNITS,
  type UnitSeed,
} from "../../../prisma/seed-data/units";

import { expr, n, polyName, unitNum } from "./format";
import { fracSpec } from "./fracFig";
import { fig, make } from "./make";
import { fmtFrac, gcd } from "./math";
import { intBetween, pick } from "./rng";
import type { ChapterHandler, ElemProblem, Rng } from "./types";

/** 각도. `45°` 같은 날 글자를 남기지 않는다(R1). */
function deg(value: number): string {
  return expr(`${value}^\\circ`);
}

/** 길이. `$8\,\mathrm{cm}$`. */
function cm(value: number): string {
  return unitNum(value, "cm");
}

/**
 * 소단원 번호(`2-3-1`). units.ts 에서 이름이 바뀌면 **던진다** —
 * 조용히 다른 가지로 떨어져 같은 발문을 두 번 내지 않게.
 */
function code(unit: UnitSeed): string {
  const head = unit.section.split(" ")[0] ?? "";
  if (!/^\d+-\d+-\d+$/.test(head)) {
    throw new Error(`초4 소단원 번호를 읽을 수 없습니다: ${unit.section}`);
  }
  return head;
}

/** 분기를 다 못 타면 던진다. 손대지 않은 소단원이 조용히 남으면 안 된다. */
function noBranch(unit: UnitSeed): never {
  throw new Error(`초4 생성기에 없는 소단원입니다: ${unit.section}`);
}

/**
 * 한 대단원 안에서 이 소단원이 몇 번째이고 형제가 몇인가.
 * `generate.ts` 가 g4 를 import 하므로 되부르면 순환이다 — 시드에서 바로 센다.
 */
function chapterSlot(unit: UnitSeed): { index: number; total: number } {
  const siblings = CURRICULUM_UNITS.filter(
    (u) => u.grade === unit.grade && u.chapter === unit.chapter,
  );
  const index = siblings.findIndex((u) => u.orderIndex === unit.orderIndex);
  if (index < 0) {
    throw new Error(`대단원에서 소단원을 못 찾았습니다: ${unit.section}`);
  }
  return { index, total: siblings.length };
}

/**
 * 소재를 소단원끼리 **나눠 갖는다** — 소단원 `i` 는 `j % total === i` 인 소재만 쓴다.
 *
 * ⚠️ 예전에는 `FAMILIES[orderIndex % FAMILIES.length]` 로 무리를 골랐다. 무리가 소단원보다
 * 많으면 **남는 무리가 영영 안 걸린다** — 실측으로 막대 소재 14개 중 **8개**, 꺾은선 8개 중
 * **2개**가 한 번도 안 나오고 있었다(2026-08-22, 소단원 3 × 씨앗 400 = 표본 1,200).
 * 원장님의 「소재는 다양할수록 좋다」에 정면으로 어긋나는데, **「소단원마다·씨앗마다 갈린다」
 * 가드는 이걸 구조적으로 못 본다** — 살아남은 것만으로도 그 조건은 참이기 때문이다.
 *
 * 나눠 갖기는 **수를 맞추는 것이 아니라 성질로 막는다**: 소단원 수가 몇으로 바뀌든 모든
 * 소재는 어느 한 몫에 반드시 들어가므로 **죽는 소재가 생길 수 없다.**
 * 몫이 서로 겹치지 않으므로 「소단원마다 다른 소재」도 저절로 지켜진다.
 */
function themeShare<T>(unit: UnitSeed, themes: readonly T[]): readonly T[] {
  const { index, total } = chapterSlot(unit);
  const mine = themes.filter((_, j) => j % total === index);
  if (mine.length < 2) {
    throw new Error(
      `소재가 모자랍니다: ${unit.chapter} — 소단원 ${total}개에 소재 ${themes.length}개. ` +
        `씨앗을 바꿔도 소재가 안 갈립니다(소단원마다 2개 이상 필요).`,
    );
  }
  return mine;
}

/** 받침에 따라 조사를 고른다 — 「사과을」 이 지면에 나가지 않게. */
function josa(word: string, withEnd: string, withoutEnd: string): string {
  const last = word.charCodeAt(word.length - 1);
  const has = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  return `${word}${has ? withEnd : withoutEnd}`;
}

/**
 * 수 뒤에 오는 조사는 **소리**로 정해진다 — `4`는 「사」라 받침이 없고 `8`은 「팔」이라 있다.
 * 「$321$를 $300$으로」·「$71$가 됩니다」 같은 말이 지면에 나가지 않게 여기 한 곳을 거친다.
 */
const NUM_BATCHIM: Record<string, boolean> = {
  "0": true,
  "1": true,
  "2": false,
  "3": true,
  "4": false,
  "5": false,
  "6": true,
  "7": true,
  "8": true,
  "9": false,
};

/** 조사만 고른다. 수가 KaTeX 식 끝에 있을 때 쓴다. */
function tail(
  value: number | string,
  withEnd: string,
  withoutEnd: string,
): string {
  const digits = String(value).replace(/\D/g, "");
  return (NUM_BATCHIM[digits.slice(-1)] ?? true) ? withEnd : withoutEnd;
}

/** 수 + 조사. `josaNum(4, "을", "를")` → `$4$를`. */
function josaNum(
  value: number | string,
  withEnd: string,
  withoutEnd: string,
): string {
  return `${n(value)}${tail(value, withEnd, withoutEnd)}`;
}

/** 소수는 **정수로 계산해서 찍는다** — 부동소수점이 지면으로 새면 R2 다. */
function dec1(tenths: number): string {
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}
function dec2(hundredths: number): string {
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
}
function dec3(thousandths: number): string {
  return `${Math.floor(thousandths / 1000)}.${String(thousandths % 1000).padStart(3, "0")}`;
}

/** 끝자리가 `0` 이 아닌 한 자리 소수(`3.7`)의 십분위 정수. `4.0`·`0.10` 을 안 만든다. */
function tenths(rng: Rng, lo: number, hi: number): number {
  return intBetween(rng, lo, hi) * 10 + intBetween(rng, 1, 9);
}
function hundredths(rng: Rng, lo: number, hi: number): number {
  return intBetween(rng, lo, hi) * 10 + intBetween(rng, 1, 9);
}

/* ────────────────────────────── 1-1 큰 수 ────────────────────────────── */

const PLACE5 = ["만", "천", "백", "십", "일"] as const;

function bigNum(unit: UnitSeed, rng: Rng): ElemProblem {
  const c = code(unit);

  if (c === "1-1-1") {
    const kind = intBetween(rng, 0, 3);
    if (kind === 0) {
      return make(
        unit,
        `${n(1000)}이 ${n(10)}개인 수를 쓰시오.`,
        n(10000),
        `${n(1000)}이 ${n(10)}개이면 ${n(10000)}입니다. ${n(10000)}은 만이라고 읽습니다.`,
      );
    }
    if (kind === 1) {
      return make(
        unit,
        `${n(10000)}은 ${n(1000)}이 몇 개인 수인가?`,
        n(10),
        `${n(10000)}은 ${n(1000)}이 ${n(10)}개 모인 수입니다.`,
      );
    }
    if (kind === 2) {
      return make(
        unit,
        `${n(1000)}원짜리 지폐 ${n(10)}장은 모두 얼마인가?`,
        `${n(10000)}원`,
        `${expr("1000\\times10=10000")} 이므로 ${n(10000)}원입니다.`,
      );
    }
    const less = intBetween(rng, 1, 9) * 100;
    return make(
      unit,
      `${n(10000 - less)}보다 ${n(less)} 큰 수를 쓰시오.`,
      n(10000),
      `${expr(`${10000 - less}+${less}=10000`)} 입니다.`,
    );
  }

  if (c === "1-1-2") {
    const digits = [
      intBetween(rng, 1, 9),
      intBetween(rng, 0, 9),
      intBetween(rng, 0, 9),
      intBetween(rng, 0, 9),
      intBetween(rng, 0, 9),
    ];
    const at = intBetween(rng, 0, 4);
    digits[at] = intBetween(rng, 1, 9);
    const value = Number(digits.join(""));
    const place = PLACE5[at]!;
    const worth = digits[at]! * 10 ** (4 - at);
    if (intBetween(rng, 0, 1) === 0) {
      return make(
        unit,
        `${n(value)}에서 ${place}의 자리 숫자를 쓰시오.`,
        n(digits[at]!),
        `${n(value)}의 ${place}의 자리 숫자는 ${n(digits[at]!)}입니다.`,
      );
    }
    return make(
      unit,
      `${n(value)}에서 ${place}의 자리 숫자가 나타내는 값을 쓰시오.`,
      n(worth),
      `${place}의 자리 숫자가 ${n(digits[at]!)}이므로 ${josaNum(worth, "을", "를")} 나타냅니다.`,
    );
  }

  if (c === "1-1-3") {
    const scale = pick(rng, [10, 100, 1000]);
    const count = intBetween(rng, 2, 9) * scale;
    const value = 10000 * count;
    if (intBetween(rng, 0, 1) === 0) {
      return make(
        unit,
        `${n(10000)}이 ${n(count)}개인 수를 쓰시오.`,
        n(value),
        `${expr(`10000\\times${count}=${value}`)} 입니다.`,
      );
    }
    return make(
      unit,
      `${n(value)}은 ${n(10000)}이 몇 개인 수인가?`,
      n(count),
      `${expr(`${value}\\div10000=${count}`)} 이므로 ${n(10000)}이 ${n(count)}개인 수입니다.`,
    );
  }

  if (c === "1-1-4") {
    const a = intBetween(rng, 2, 9);
    const kind = intBetween(rng, 0, 2);
    if (kind === 0) {
      return make(
        unit,
        `${n(1000)}만이 ${n(10 * a)}개인 수는 몇 억인가?`,
        `${n(a)}억`,
        `${n(1000)}만이 ${n(10)}개이면 ${n(1)}억입니다. ${n(10 * a)}개이면 ${n(a)}억입니다.`,
      );
    }
    if (kind === 1) {
      return make(
        unit,
        `${n(a)}억은 ${n(1000)}만이 몇 개인 수인가?`,
        n(10 * a),
        `${n(1)}억은 ${n(1000)}만이 ${n(10)}개인 수이므로 ${n(a)}억은 ${n(10 * a)}개입니다.`,
      );
    }
    return make(
      unit,
      `${n(a)}억을 숫자로 쓰면 ${n(0)}은 모두 몇 개인가?`,
      n(8),
      `${n(1)}억은 ${n(1)} 다음에 ${n(0)}이 ${n(8)}개인 수입니다.`,
    );
  }

  if (c === "1-1-5") {
    const a = intBetween(rng, 2, 9);
    const kind = intBetween(rng, 0, 2);
    if (kind === 0) {
      return make(
        unit,
        `${n(1000)}억이 ${n(10 * a)}개인 수는 몇 조인가?`,
        `${n(a)}조`,
        `${n(1000)}억이 ${n(10)}개이면 ${n(1)}조입니다. ${n(10 * a)}개이면 ${n(a)}조입니다.`,
      );
    }
    if (kind === 1) {
      return make(
        unit,
        `${n(a)}조는 ${n(1)}억이 몇 개인 수인가?`,
        n(10000 * a),
        `${n(1)}조는 ${n(1)}억이 ${n(10000)}개인 수이므로 ${n(a)}조는 ${n(10000 * a)}개입니다.`,
      );
    }
    return make(
      unit,
      `${n(a)}조를 숫자로 쓰면 ${n(0)}은 모두 몇 개인가?`,
      n(12),
      `${n(1)}조는 ${n(1)} 다음에 ${n(0)}이 ${n(12)}개인 수입니다.`,
    );
  }

  if (c === "1-1-6") {
    const step = pick(rng, [1000, 10000, 100000]);
    const times = intBetween(rng, 2, 5);
    const start = intBetween(rng, 12, 89) * 10000;
    const end = start + step * times;
    if (intBetween(rng, 0, 1) === 0) {
      return make(
        unit,
        `${n(start)}부터 ${n(step)}씩 ${n(times)}번 뛰어 센 수를 쓰시오.`,
        n(end),
        `${expr(`${start}+${step}\\times${times}=${end}`)} 입니다.`,
      );
    }
    return make(
      unit,
      `${n(end)}에서 ${n(step)}씩 거꾸로 ${n(times)}번 뛰어 센 수를 쓰시오.`,
      n(start),
      `${expr(`${end}-${step}\\times${times}=${start}`)} 입니다.`,
    );
  }

  if (c === "1-1-7") {
    const a = intBetween(rng, 10000, 98999);
    const b = a + intBetween(rng, 101, 900);
    const sa = String(a);
    const sb = String(b);
    let at = 0;
    while (at < 5 && sa[at] === sb[at]) at += 1;
    const place = PLACE5[Math.min(at, 4)]!;
    const wantBig = intBetween(rng, 0, 1) === 0;
    return make(
      unit,
      `${josaNum(a, "과", "와")} ${n(b)} 중 더 ${wantBig ? "큰" : "작은"} 수를 쓰시오.`,
      n(wantBig ? b : a),
      `두 수 모두 다섯 자리 수입니다. 높은 자리부터 비교하면 ${place}의 자리 숫자가 ` +
        `${josaNum(Number(sa[Math.min(at, 4)]), "과", "와")} ${n(Number(sb[Math.min(at, 4)]))}이므로 ` +
        `${josaNum(b, "이", "가")} 더 큽니다.` +
        (wantBig ? "" : ` 그러므로 더 작은 수는 ${n(a)}입니다.`),
    );
  }

  return noBranch(unit);
}

/* ────────────────────────────── 1-2 각도 ────────────────────────────── */

function angleKind(d: number): string {
  return d < 90 ? "예각" : d === 90 ? "직각" : "둔각";
}

function angle(unit: UnitSeed, rng: Rng): ElemProblem {
  const c = code(unit);

  if (c === "1-2-1") {
    if (intBetween(rng, 0, 2) === 0) {
      return make(
        unit,
        "변의 길이가 더 긴 각이 항상 더 큰 각인가? 맞으면 '예', 아니면 '아니요'를 쓰시오.",
        "아니요",
        "각의 크기는 두 변이 벌어진 정도로 정해집니다. 변의 길이와는 관계가 없습니다.",
      );
    }
    const x = intBetween(rng, 20, 80);
    const y = x + intBetween(rng, 10, 60);
    return make(
      unit,
      `크기가 ${deg(x)}인 각과 ${deg(y)}인 각 중 더 큰 각의 크기를 쓰시오.`,
      deg(y),
      `${expr(`${x}<${y}`)} 이므로 ${deg(y)}인 각이 더 큽니다.`,
    );
  }

  if (c === "1-2-2") {
    const d = pick(
      rng,
      [25, 35, 40, 50, 55, 65, 70, 80, 100, 110, 115, 125, 130, 140, 145, 155],
    );
    if (intBetween(rng, 0, 3) === 0) {
      return make(
        unit,
        `직각을 ${n(90)}등분한 것 중 하나의 크기가 ${deg(1)}입니다. ${deg(d)}는 ${deg(1)}가 몇 개 모인 각인가?`,
        n(d),
        `${deg(1)}가 ${n(d)}개 모이면 ${deg(d)}입니다.`,
      );
    }
    return make(
      unit,
      "각도기로 잰 각의 크기는 몇 도인가?",
      deg(d),
      `각도기의 중심을 각의 꼭짓점에, 밑금을 각의 한 변에 맞추고 눈금을 읽으면 ${deg(d)}입니다.`,
      fig("protractor", { deg: d }),
    );
  }

  if (c === "1-2-3") {
    const pool = [
      15, 25, 35, 45, 55, 65, 75, 85, 95, 105, 115, 125, 135, 145, 155, 165,
    ];
    if (intBetween(rng, 0, 2) === 0) {
      const three = [pick(rng, pool), pick(rng, pool), pick(rng, pool)];
      const wide = three.filter((d) => d > 90).length;
      return make(
        unit,
        `크기가 ${deg(three[0]!)}, ${deg(three[1]!)}, ${deg(three[2]!)}인 세 각 중 둔각은 모두 몇 개인가?`,
        n(wide),
        `${deg(90)}보다 큰 각이 둔각입니다. 둔각은 ${n(wide)}개입니다.`,
      );
    }
    const d = pick(rng, pool);
    return make(
      unit,
      `${deg(d)}인 각은 예각과 둔각 중 무엇인가?`,
      angleKind(d),
      `${deg(90)}보다 작으면 예각, ${deg(90)}보다 크면 둔각입니다. ` +
        `${deg(d)}는 ${deg(90)}보다 ${d < 90 ? "작으므로 예각" : "크므로 둔각"}입니다.`,
    );
  }

  if (c === "1-2-4") {
    const x = intBetween(rng, 25, 75);
    const y = intBetween(rng, 15, 60);
    const kind = intBetween(rng, 0, 2);
    if (kind === 0) {
      return make(
        unit,
        expr(`${x}^\\circ+${y}^\\circ=\\square`),
        deg(x + y),
        `${expr(`${x}+${y}=${x + y}`)} 이므로 ${deg(x + y)}입니다.`,
      );
    }
    if (kind === 1) {
      const big = Math.max(x, y) + 20;
      const small = Math.min(x, y);
      return make(
        unit,
        expr(`${big}^\\circ-${small}^\\circ=\\square`),
        deg(big - small),
        `${expr(`${big}-${small}=${big - small}`)} 이므로 ${deg(big - small)}입니다.`,
      );
    }
    const gap = intBetween(rng, 3, 12);
    return make(
      unit,
      `각의 크기를 ${deg(x)}쯤으로 어림하고 각도기로 재었더니 ${deg(x + gap)}였습니다. 어림한 각도와 잰 각도의 차는 몇 도인가?`,
      deg(gap),
      `${expr(`${x + gap}-${x}=${gap}`)} 이므로 ${deg(gap)} 차이가 납니다.`,
    );
  }

  if (c === "1-2-5") {
    if (intBetween(rng, 0, 3) === 0) {
      return make(
        unit,
        "삼각형의 세 각의 크기의 합은 몇 도인가?",
        deg(180),
        `삼각형의 세 각을 잘라 한 점에 모으면 직선이 됩니다. 직선이 이루는 각은 ${deg(180)}입니다.`,
      );
    }
    const a = intBetween(rng, 25, 80);
    const b = intBetween(rng, 25, 135 - a);
    const rest = 180 - a - b;
    return make(
      unit,
      `삼각형의 두 각의 크기가 ${deg(a)}, ${deg(b)}입니다. 나머지 한 각의 크기는 몇 도인가?`,
      deg(rest),
      `삼각형의 세 각의 크기의 합은 ${deg(180)}입니다. ${expr(`180-${a}-${b}=${rest}`)}`,
    );
  }

  if (c === "1-2-6") {
    if (intBetween(rng, 0, 3) === 0) {
      return make(
        unit,
        "사각형의 네 각의 크기의 합은 몇 도인가?",
        deg(360),
        `사각형은 대각선으로 삼각형 ${n(2)}개로 나눌 수 있으므로 ${expr("180\\times2=360")} 입니다.`,
      );
    }
    const a = intBetween(rng, 70, 110);
    const b = intBetween(rng, 70, 110);
    const c3 = intBetween(rng, 70, 110);
    const rest = 360 - a - b - c3;
    return make(
      unit,
      `사각형의 세 각의 크기가 ${deg(a)}, ${deg(b)}, ${deg(c3)}입니다. 나머지 한 각의 크기는 몇 도인가?`,
      deg(rest),
      `사각형의 네 각의 크기의 합은 ${deg(360)}입니다. ${expr(`360-${a}-${b}-${c3}=${rest}`)}`,
    );
  }

  return noBranch(unit);
}

/* ─────────────────────── 1-3 곱셈과 나눗셈 ─────────────────────── */

function mulDiv(unit: UnitSeed, rng: Rng): ElemProblem {
  const c = code(unit);

  if (c === "1-3-1") {
    const a = intBetween(rng, 123, 897);
    const tens = intBetween(rng, 2, 9);
    const b = tens * 10;
    return make(
      unit,
      expr(`${a}\\times${b}=\\square`),
      n(a * b),
      `${expr(`${a}\\times${tens}=${a * tens}`)} 이므로 ${expr(`${a}\\times${b}=${a * b}`)} 입니다.`,
      fig("columnOp", { top: String(a), op: "×", bottom: String(b) }),
    );
  }

  if (c === "1-3-2") {
    const a = intBetween(rng, 123, 897);
    const b = intBetween(rng, 1, 8) * 10 + intBetween(rng, 1, 9);
    const ones = b % 10;
    const tens = b - ones;
    return make(
      unit,
      expr(`${a}\\times${b}=\\square`),
      n(a * b),
      `${expr(`${a}\\times${tens}=${a * tens}`)}, ${expr(`${a}\\times${ones}=${a * ones}`)} 이므로 ` +
        `${expr(`${a * tens}+${a * ones}=${a * b}`)} 입니다.`,
      fig("columnOp", { top: String(a), op: "×", bottom: String(b) }),
    );
  }

  if (c === "1-3-3") {
    // 어림할 것이 남아 있어야 한다 — 끝자리가 0이면 「$80$을 $80$으로 어림」이 되어 문항이 죽는다.
    const a = intBetween(rng, 1, 8) * 100 + intBetween(rng, 11, 89);
    const b = intBetween(rng, 1, 8) * 10 + intBetween(rng, 1, 9);
    const aa = Math.round(a / 100) * 100;
    const bb = Math.round(b / 10) * 10;
    return make(
      unit,
      `${expr(`${a}\\times${b}`)}${tail(b, "을", "를")} 어림셈으로 구하려고 합니다. ` +
        `${josaNum(a, "은", "는")} 몇백으로, ${josaNum(b, "은", "는")} 몇십으로 어림하여 곱을 구하시오.`,
      n(aa * bb),
      `${josaNum(a, "을", "를")} ${josaNum(aa, "으로", "로")}, ${josaNum(b, "을", "를")} ${josaNum(bb, "으로", "로")} ` +
        `어림하면 ${expr(`${aa}\\times${bb}=${aa * bb}`)} 입니다.`,
    );
  }

  if (c === "1-3-4") {
    const b = intBetween(rng, 2, 9) * 10;
    const q = intBetween(rng, 2, 9);
    if (intBetween(rng, 0, 1) === 0) {
      return make(
        unit,
        expr(`${b * q}\\div${b}=\\square`),
        n(q),
        `${expr(`${b}\\times${q}=${b * q}`)} 이므로 몫은 ${n(q)}입니다.`,
      );
    }
    const r = intBetween(rng, 1, b - 1);
    const a = b * q + r;
    return make(
      unit,
      `${expr(`${a}\\div${b}`)}의 몫과 나머지를 구하시오.`,
      `몫 ${n(q)}, 나머지 ${n(r)}`,
      `${expr(`${b}\\times${q}=${b * q}`)}, ${expr(`${a}-${b * q}=${r}`)} 이므로 ` +
        `몫은 ${n(q)}, 나머지는 ${n(r)}입니다.`,
    );
  }

  if (c === "1-3-5") {
    const b = intBetween(rng, 12, 39);
    const q = intBetween(rng, 3, 9);
    return make(
      unit,
      `${expr(`${b * q}\\div${b}`)}의 몫을 구하시오.`,
      n(q),
      `${expr(`${b}\\times${q}=${b * q}`)} 이므로 몫은 ${n(q)}입니다.`,
    );
  }

  if (c === "1-3-6") {
    const b = intBetween(rng, 12, 29);
    const q = intBetween(rng, 11, 34);
    const r = intBetween(rng, 1, b - 1);
    const a = b * q + r;
    return make(
      unit,
      `${expr(`${a}\\div${b}`)}의 몫과 나머지를 구하시오.`,
      `몫 ${n(q)}, 나머지 ${n(r)}`,
      `몫의 십의 자리부터 구합니다. ${expr(`${b}\\times${q}=${b * q}`)}, ` +
        `${expr(`${a}-${b * q}=${r}`)} 이므로 몫은 ${n(q)}, 나머지는 ${n(r)}입니다.`,
    );
  }

  if (c === "1-3-7") {
    // 끝자리 0은 뺀다 — 어림해도 그대로면 「몇십으로 어림하라」가 아무 일도 안 한다.
    const b = pick(
      rng,
      [
        17, 18, 19, 21, 22, 23, 24, 26, 27, 28, 29, 31, 32, 33, 34, 36, 37, 38,
        39, 41, 42,
      ],
    );
    const q = intBetween(rng, 6, 19);
    const a = b * q + intBetween(rng, 0, b - 1);
    const bb = Math.round(b / 10) * 10;
    const approx = Math.floor(a / bb);
    return make(
      unit,
      `${expr(`${a}\\div${b}`)}의 몫을 어림하려고 합니다. ${josaNum(b, "을", "를")} 몇십으로 어림하여 몫을 어림하시오.`,
      n(approx),
      `${josaNum(b, "을", "를")} ${josaNum(bb, "으로", "로")} 어림하면 ` +
        `${expr(`${bb}\\times${approx}=${bb * approx}`)} 이므로 몫은 약 ${n(approx)}입니다.`,
    );
  }

  return noBranch(unit);
}

/* ───────────────────── 1-4 평면도형의 이동 ───────────────────── */

/** 좌우로 뒤집은 것과 위아래로 뒤집은 것이 **다르게** 나오는 조각만 쓴다. */
const MOVE_SHAPES = [
  {
    cells: [
      [0, 0],
      [0, 1],
      [1, 1],
    ],
    n: 4,
  },
  {
    cells: [
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 2],
    ],
    n: 4,
  },
  {
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
    ],
    n: 4,
  },
  {
    cells: [
      [1, 1],
      [2, 1],
      [2, 2],
      [3, 2],
    ],
    n: 5,
  },
  {
    cells: [
      [0, 2],
      [1, 2],
      [1, 1],
      [2, 1],
      [2, 0],
    ],
    n: 5,
  },
  {
    cells: [
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    n: 4,
  },
] as const;

const TURN_NAME: Record<string, number> = {
  rot90: 90,
  rot180: 180,
  rot270: 270,
};

function move(unit: UnitSeed, rng: Rng): ElemProblem {
  const c = code(unit);

  if (c === "1-4-1") {
    const a = intBetween(rng, 3, 8);
    const b = intBetween(rng, 1, a - 1);
    if (intBetween(rng, 0, 1) === 0) {
      return make(
        unit,
        `모눈에서 점 ㄱ을 왼쪽으로 ${n(a)}칸 옮긴 다음 오른쪽으로 ${n(b)}칸 옮겼습니다. ` +
          `점 ㄱ은 처음 자리에서 어느 쪽으로 몇 칸 옮겨진 것인가?`,
        `왼쪽으로 ${n(a - b)}칸`,
        `${expr(`${a}-${b}=${a - b}`)} 이므로 왼쪽으로 ${n(a - b)}칸 옮겨진 것입니다.`,
      );
    }
    return make(
      unit,
      `모눈에서 점 ㄴ을 위쪽으로 ${n(a)}칸, 오른쪽으로 ${n(b)}칸 옮겼습니다. ` +
        `처음 자리로 되돌아오려면 아래쪽으로 ${n(a)}칸 옮긴 뒤 어느 쪽으로 몇 칸 더 옮겨야 하는가?`,
      `왼쪽으로 ${n(b)}칸`,
      `오른쪽으로 ${n(b)}칸 옮겼으므로 되돌아오려면 왼쪽으로 ${n(b)}칸 옮겨야 합니다.`,
    );
  }

  if (c === "1-4-2") {
    const side = intBetween(rng, 3, 9);
    const dist = intBetween(rng, 2, 8);
    if (intBetween(rng, 0, 1) === 0) {
      return make(
        unit,
        `한 변이 ${cm(side)}인 정사각형을 오른쪽으로 ${cm(dist)} 밀었습니다. 민 도형의 한 변은 몇 cm인가?`,
        cm(side),
        `도형을 밀면 모양과 크기는 변하지 않고 위치만 바뀝니다. 한 변은 그대로 ${cm(side)}입니다.`,
      );
    }
    return make(
      unit,
      `직사각형을 왼쪽으로 ${cm(dist)} 민 다음 다시 오른쪽으로 ${cm(dist)} 밀었습니다. ` +
        `처음 도형과 위치가 같은가? 같으면 '예', 다르면 '아니요'를 쓰시오.`,
      "예",
      `왼쪽으로 ${cm(dist)} 민 것을 오른쪽으로 ${cm(dist)} 다시 밀면 처음 자리로 돌아옵니다.`,
    );
  }

  if (c === "1-4-3") {
    if (intBetween(rng, 0, 2) === 0) {
      const times = intBetween(rng, 2, 7);
      const same = times % 2 === 0;
      return make(
        unit,
        `도형을 위쪽으로 ${n(times)}번 뒤집었습니다. 처음 도형과 모양이 같은가? 같으면 '예', 다르면 '아니요'를 쓰시오.`,
        same ? "예" : "아니요",
        `위쪽으로 ${n(2)}번 뒤집으면 처음 도형과 같아집니다. ${josaNum(times, "은", "는")} ` +
          `${same ? `${n(2)}로 나누어떨어지므로 처음 도형과 같습니다.` : `홀수이므로 ${n(1)}번 뒤집은 것과 같습니다.`}`,
      );
    }
    const shape = pick(rng, MOVE_SHAPES);
    const op = pick(rng, ["flipH", "flipV"] as const);
    return make(
      unit,
      "왼쪽 도형을 뒤집어 오른쪽 도형을 만들었습니다. 어떻게 뒤집은 것인지 쓰시오.",
      op === "flipH" ? "좌우로 뒤집기" : "위아래로 뒤집기",
      op === "flipH"
        ? "색칠한 칸이 왼쪽과 오른쪽이 서로 바뀌었습니다. 좌우로 뒤집은 것입니다."
        : "색칠한 칸이 위쪽과 아래쪽이 서로 바뀌었습니다. 위아래로 뒤집은 것입니다.",
      fig("rotateFlip", { cells: shape.cells, op, n: shape.n }),
    );
  }

  if (c === "1-4-4") {
    const kind = intBetween(rng, 0, 3);
    if (kind === 0) {
      const times = intBetween(rng, 2, 4);
      return make(
        unit,
        `도형을 시계 방향으로 ${deg(90)}씩 ${n(times)}번 돌렸습니다. 모두 몇 도 돌린 것인가?`,
        deg(90 * times),
        `${expr(`90\\times${times}=${90 * times}`)} 이므로 ${deg(90 * times)} 돌린 것입니다.`,
      );
    }
    if (kind === 1) {
      const d = pick(rng, [90, 180, 270]);
      return make(
        unit,
        `도형을 시계 방향으로 ${deg(d)} 돌린 것은 시계 반대 방향으로 몇 도 돌린 것과 같은가?`,
        deg(360 - d),
        `한 바퀴는 ${deg(360)}입니다. ${expr(`360-${d}=${360 - d}`)}`,
      );
    }
    const shape = pick(rng, MOVE_SHAPES);
    const op = pick(rng, ["rot90", "rot180", "rot270"] as const);
    return make(
      unit,
      "왼쪽 도형을 시계 방향으로 돌려 오른쪽 도형을 만들었습니다. 몇 도 돌린 것인가?",
      deg(TURN_NAME[op]!),
      `색칠한 칸의 방향이 시계 방향으로 ${deg(TURN_NAME[op]!)}만큼 돌아갔습니다.`,
      fig("rotateFlip", { cells: shape.cells, op, n: shape.n }),
    );
  }

  return noBranch(unit);
}

/* ───────────────────────── 1-5 막대그래프 ─────────────────────────
 *
 * ## 엔진이 못 해서 **미뤄 둔 것 셋** (2026-08-22) · 그리고 **설계 과제 하나**
 *
 * ⑴~⑶ 은 「우리가 안 하는 것」이 아니라 **「그림 엔진이 아직 못 하는 것」**이다.
 * 조건이 풀리면 되살린다. 되살리는 법까지 여기 적는다 — 「나중에」만 적으면
 * 다음 사람은 무엇을 해야 하는지 모른다.
 *
 * **⑷ 는 성격이 다르다** — 엔진 한계가 아니라 **나눔 규칙의 설계 과제**다.
 * 엔진이 풀린다고 저절로 풀리지 않으니 섞어 읽지 말 것.
 *
 * ### ⑴ 꺾은선 소재 「박물관에 온 관람객 수」
 * 월 관람객은 수백~수천이라야 자연스러운데 `_y_step` 이 걸음 5에서 멈춰 **눈금이
 * 수백 줄**이 된다(실측: y_max 1153 → 231줄, 세로축이 검은 얼룩).
 * → **되살리는 법**: `LINE_THEMES` 에 아래를 넣고 `MAX_READABLE` 상한을 올린다.
 *   `{ topic: "박물관에 온 관람객 수", unit: "명", labels: timeLabels([1,2,3,4,5], "월"),
 *      base: [8, 14], step: 50 }`
 *   ⚠️ **한계 검사 자체는 지우지 말 것** — 숫자만 올린다.
 *
 * ### ⑵ 막대 규모 「전교 학생들」 — **폐기 (D-69)**. 단, 걸음 10 은 열렸다.
 * 원장님: 「막대그래프는 **너무 광범위한 숫자 할 필요 없음**」(2026-08-22 확정).
 * 「⑴ 이 풀리면 총원 300~500 으로 넣는다」던 계획은 폐기됐다 — 엔진이 못 그려서 미룬 것이
 * 아니라 **교재가 원하지 않는 크기**이기 때문이다. **전교(총원 300~500)는 되살리지 말 것.**
 *
 * 같은 날 정정: 「막대그래프는 **눈금당 10명까지 허용**」. 폐기된 것은 «전교라는 크기»이지
 * «걸음 10»이 아니다. 그래서 걸음 10 규모를 **두 학년(총원 180~220)**으로 넣었다 —
 * 규모는 넷이다. 이 둘을 섞어 읽지 말 것: **걸음이 커도 되지만 총원은 커지면 안 된다.**
 *
 * ### ⑶ 눈금 문항 — **구현됨 (D-70)**
 * 원장님: 「눈금 몇칸 유형도 넣어. **유형은 다양할수록 환영**」(2026-08-22 확정).
 *
 * 한때 이 유형을 통째로 뺐던 까닭은 **선언에 기대고 있어서**였다 — 발문은 「한 칸 $1$명」이라
 * 우기는데 그림은 `_y_step(y_max)` 가 고른 걸음(대개 5)으로 그렸다. 이제 걸음을 `yStep` 으로
 * **스펙에 실어** 파이썬이 그 값 그대로 긋는다(못 그리면 던진다). 발문이 말하는 걸음과
 * 그려지는 걸음이 **한 값**이다.
 *
 * ⚠️ **막대와 꺾은선이 물을 수 있는 것이 다르다.**
 *  · 막대 — 값이 걸음의 배수라(`barSplits`) 「한 칸은 몇 명 / 몇 칸 / 칸→명」 셋 다 된다.
 *  · 꺾은선 — 값은 `theme.step` 의 배수인데 걸음(`theme.yStep`)은 그보다 성기다.
 *    `theme.step` 을 그대로 걸음으로 실으면 눈금이 24~33줄이 되어 엔진이 던진다
 *    (`MAX_Y_TICKS = 9`, 즉 **최댓값 ≤ 8 × 걸음**. 실측: 기온 33줄 · 강낭콩 24줄 ·
 *    박물관 33줄). 그래서 점이 눈금선 위에 없고, **「한 칸은 몇 …인가」만** 묻는다.
 *
 * ### ⑷ 걸음 2 규모 「방과후 교실」 — 수 조합이 **5벌뿐** (설계 과제, 미착수)
 * 총원 다섯 각각에 나눔이 **정확히 1가지**뿐이라, 씨앗을 바꿔도 값 넷이 **총원으로
 * 완전히 결정**된다(소재와 자리는 갈리므로 문항은 같아 보이지 않는다 — 그래서 눈에 안 띈다).
 * 실측: `20:1 · 22:1 · 24:1 · 26:1 · 28:1`.
 * 견줌: 「우리 반」 1~4가지 · 「$4$학년」 5~8가지 · 「두 학년」 5~8가지.
 * 원장님 다양성 원칙(「유형은 다양할수록 환영」)에 걸리는 자리다.
 *
 * → **고치는 법**: `barSplits` 의 조건 넷(서로 다름 · 총원의 절반 이하 · 걸음의 배수 ·
 *   띠 안) 가운데 **무엇을 완화할지 설계**가 필요하다. 걸음 2 는 띠가 `8~10` 으로 좁아
 *   네 값이 사실상 한 벌로 굳는다 — 띠를 넓히는 쪽이 먼저 볼 자리다.
 *   ⚠️ 지금 시험은 「나눔이 **≥1가지**」만 본다. 그래서 이 결함을 **구조적으로 못 본다** —
 *   조건을 완화할 때 「총원마다 **≥N가지**」로 **시험을 같이 올려야** 한다.
 *   ⚠️ **파일럿 확정이 먼저다**(team-lead 2026-08-23). 지금 건드리지 말 것.
 */

/**
 * 막대그래프 소재.
 *
 * `unit` 은 **필수**다 — 지금은 열넷이 전부 「좋아하는 것을 고른 **학생 수(명)**」라
 * 값 범위를 **한 벌**로 함께 써도 된다. 꺾은선은 소재마다 단위가 달라(kg·℃·cm·mm)
 * 소재별로 갈랐지만, 여기서 똑같이 갈랐다면 **안 갈라도 되는 축을 가르는** 것이다.
 *
 * 그래서 「언제 갈라야 하는가」를 시험이 알려 주게 한다 — 단위가 「명」이 아닌 소재가
 * 하나라도 들어오면 빨개진다. 그때가 나눌 때다. **지금이 아니라.**
 * (`unit` 을 필수로 둔 것은 그래야 새 소재를 넣는 사람이 반드시 선언하기 때문이다.
 *  전에는 「명」이 문구 안에 박혀 있어 **시험이 볼 수 있는 값이 아예 없었다.**)
 */
type BarTheme = { item: string; unit: string; labels: readonly string[] };

/**
 * 조사 **규모**. 값의 크기를 정하는 축은 소재가 아니라 이쪽이다.
 *
 * 초4 는 **눈금 한 칸이 1·2·5·10명**인 그래프를 읽는 학년이다(10명은 원장님이
 * 2026-08-22 에 「눈금당 10명까지 허용」으로 열어 주셨다). 그런데 한때는 늘 1칸=5로만
 * 그려졌다 — 걸음을 `_y_step` 이 **축 맨 위만 보고** 정했기 때문이다.
 * 지금은 걸음을 `yStep` 으로 **스펙에 실어** 파이썬이 그 값 그대로 긋는다(D-70).
 *
 * 그래도 규모를 「총원」이 아니라 **값의 크기**로 가르는 것은 그대로다. 이유가 바뀌었을
 * 뿐이다 — 예전에는 사다리가 걸음을 고르니 값을 그 띠에 맞춰야 했고, 지금은 걸음마다
 * **그릴 수 있는 최댓값 상한**(`8 × 걸음`)이 달라서 값을 그 안에 두어야 한다.
 *
 * ⚠️ `who` 는 **그 총원에서 참인 이름**이어야 한다. 「전교」를 60명 안에 넣으면
 * 학교 전체가 100명이 되어 버린다 — 박물관·전교가 걸린 자리와 같다.
 */
type BarScale = {
  who: string;
  totals: readonly number[];
  minTop: number;
  maxTop: number;
  /**
   * 이 규모에서 **실제로 그려지는** 세로 눈금 한 칸.
   *
   * ⚠️ 이 값을 정하는 것은 우리가 아니라 `_y_step(y_max)` 다. 여기 적은 것은 «선언»이고,
   * 시험이 **실제로 그려진 SVG 의 눈금 간격**과 맞대어 확인한다 — 문턱을 여기 옮겨 적으면
   * 두 곳이 같은 것을 정하게 되므로, 참은 **그려진 그림**에서 가져온다.
   * 어긋나면 「눈금 한 칸을 $1$명으로」 같은 발문이 그림과 다른 말을 하게 된다.
   */
  step: number;
};

const BAR_SCALES: readonly BarScale[] = [
  // 한 반 스무 명 남짓. 최댓값 ≤7 이라 축이 8 이하 → 눈금 한 칸 1명.
  {
    who: "우리 반 학생들",
    totals: [18, 19, 20, 21, 22],
    minTop: 1,
    maxTop: 7,
    step: 1,
  },
  // 방과후 교실 서른 명 남짓. 최댓값 8~11 → 축이 9~12 → 눈금 한 칸 2명.
  {
    who: "방과후 교실 학생들",
    totals: [20, 22, 24, 26, 28],
    minTop: 8,
    maxTop: 10,
    step: 2,
  },
  // 한 학년 백 명 남짓. 최댓값 12 이상 → 눈금 한 칸 5명.
  // 「4학년」의 `4` 도 수다 — 날 글자로 두면 R1 에 걸린다(`probe-elem-rules` 가 잡았다).
  //
  // ⚠️ **`maxTop` 을 40 위로 올리지 말 것.** 실측(2026-08-22): 최댓값 `20~40` 은 걸음 5로
  // 그려지고 **`41` 부터 엔진이 던진다** — 「yStep 5 으로는 눈금이 10줄이 됩니다 (9줄
  // 이하여야 합니다. 축 맨 위 45)」. **지금 40이라 여유가 0이다.**
  //
  // 옛 주석은 「43 까지」였다. 그때는 걸음을 안 실어 `_y_step` **사다리**가 골랐고
  // (`yMax ≤ 44` 면 5, `45~49` 면 10), 넘기면 **조용히** 걸음 10으로 그려 발문이 그림과
  // 다른 말을 했다. D-70 으로 걸음을 스펙에 실은 뒤로는 기준이 **눈금 줄 수**로 바뀌어
  // 조용히 틀리는 대신 던진다. **기준이 바뀌면 잰 값도 다시 재야 한다** — 옛 숫자를
  // 물려받으면 「여유 3」처럼 있지도 않은 여유를 믿게 된다.
  // 아래 「선언한 눈금이 실제로 그려진다」 시험이 이 자리를 지킨다.
  {
    who: "$4$학년 학생들",
    totals: [90, 95, 100, 105, 110],
    // 실효 하한은 **20** 이다 — 걸음 5 에서 값 넷이 서로 다른 배수라야 하므로 나눔
    // 규칙상 최댓값이 `4 × 5` 이상이다. 즉 이 `15` 는 한 번도 걸리지 않는다(죽은 값).
    minTop: 15,
    maxTop: 40,
    step: 5,
  },
  // 두 학년 이백 명 남짓. 눈금 한 칸 10명 — 걸음은 `yStep` 으로 **싣는다**(D-70).
  // (위 세 규모의 「최댓값 N 이상 → 한 칸 M명」은 걸음을 `_y_step` 이 **고르던** 때의 말이다.
  //  지금은 고르는 것이 아니라 싣는 것이므로, 값의 크기가 정하는 것은 걸음이 아니라 **상한**이다.)
  // 원장님 정정(2026-08-22): 「막대그래프는 **눈금당 10명까지 허용**」. D-69 로 폐기한 것은
  // 「전교(총원 300~500)」이지 걸음 10 자체가 아니다 — 그래서 규모는 여기까지 넷이다.
  // `who` 는 그 총원에서 참이어야 하므로 **두 학년**으로 잡았다(위 「$4$학년」이 90~110 이니
  // 두 학년이면 180~220 이다). 「전교」로 적으면 학교 전체가 200명이 되어 D-69 가 걸린 자리다.
  //
  // ⚠️ **`maxTop` 을 80 위로 올리지 말 것.** 실측(2026-08-22): 최댓값 `40~80` 은 걸음 10으로
  // 그려지고 **`81` 부터 엔진이 던진다** — 「yStep 10 으로는 눈금이 10줄이 됩니다 (9줄
  // 이하여야 합니다. 축 맨 위 90)」. 축 맨 위가 `ceil(최댓값 / 걸음) × 걸음` 이라 눈금은
  // `최댓값 / 걸음 + 1` 줄이고, 그래서 상한이 **`8 × 걸음`** 이다.
  //
  // `minTop` 40 은 엔진이 아니라 **나눔 규칙**에서 온다 — 값 넷이 서로 다른 걸음의 배수라야
  // 하므로 최댓값은 적어도 `4 × 10` 이다. (그래서 이 규모는 상한과 하한이 딱 붙어 있다:
  // 쓸 수 있는 최댓값이 `40·50·60·70·80` 다섯뿐이다.)
  {
    who: "$3$학년과 $4$학년 전체 학생",
    totals: [180, 190, 200, 210, 220],
    minTop: 40,
    maxTop: 80,
    step: 10,
  },
];

/**
 * 총원을 **먼저 정하고 넷으로 나눈다.**
 *
 * 「조사한 학생은 모두 몇 명인가」의 답이 곧 그 규모의 인원이므로, 합계는 상한으로
 * **막는** 것이 아니라 구성으로 **참이 되어야** 한다. 값 넷이 각각 그럴듯해도 합이
 * 40이면 그런 반은 없다 — 가드가 걸릴 값을 생성기가 만들면 그건 가드가 아니라 사고다.
 *
 * 조건 넷을 **동시에** 만족해야 한다: 합이 총원 · 넷이 서로 다름(「가장 많은 것」의 답이
 * 하나여야 하므로) · 최댓값이 규모의 띠 안 · 최댓값이 총원의 절반 이하(한 항목 쏠림 금지).
 * 그래서 **세어 본다** — 못 푸는 총원은 애초에 후보에서 빠져야 한다(시험이 잠근다).
 */
function barSplits(total: number, scale: BarScale): number[][] {
  const out: number[][] = [];
  const half = Math.floor(total / 2);
  const k = scale.step;
  // 값은 **눈금의 배수**여야 한다 — 「몇 칸인가」의 답이 자연수여야 하기 때문이다.
  for (let a = k; a <= scale.maxTop; a += k) {
    for (let b = a + k; b <= scale.maxTop; b += k) {
      for (let c = b + k; c <= scale.maxTop; c += k) {
        const d = total - a - b - c;
        if (d <= c) continue;
        if (d % k !== 0) continue;
        if (d > scale.maxTop || d < scale.minTop || d > half) continue;
        out.push([a, b, c, d]);
      }
    }
  }
  return out;
}

/**
 * 막대그래프 소재. **한 줄로 편다** — 소단원끼리 `themeShare` 로 나눠 가지므로
 * 여기 적은 소재는 **전부 언젠가 나온다**(무리로 묶으면 남는 무리가 죽는다).
 * 이웃한 항목이 서로 다른 소단원으로 가도록 같은 갈래를 **붙여서** 적는다.
 */
const BAR_THEMES: readonly BarTheme[] = [
  { item: "과일", unit: "명", labels: ["사과", "배", "포도", "딸기"] },
  { item: "과일", unit: "명", labels: ["수박", "참외", "감", "귤"] },
  { item: "운동", unit: "명", labels: ["축구", "농구", "배구", "야구"] },
  { item: "운동", unit: "명", labels: ["줄넘기", "수영", "달리기", "태권도"] },
  { item: "책", unit: "명", labels: ["동화책", "과학책", "역사책", "만화책"] },
  { item: "책", unit: "명", labels: ["위인전", "시집", "사전", "잡지"] },
  { item: "동물", unit: "명", labels: ["개", "고양이", "토끼", "햄스터"] },
  { item: "동물", unit: "명", labels: ["닭", "오리", "염소", "돼지"] },
  { item: "간식", unit: "명", labels: ["빵", "과자", "사탕", "젤리"] },
  { item: "간식", unit: "명", labels: ["김밥", "만두", "떡", "튀김"] },
  { item: "계절", unit: "명", labels: ["봄", "여름", "가을", "겨울"] },
  { item: "장소", unit: "명", labels: ["산", "바다", "계곡", "공원"] },
  { item: "색", unit: "명", labels: ["빨강", "파랑", "노랑", "초록"] },
  { item: "색", unit: "명", labels: ["보라", "주황", "분홍", "연두"] },
];

function barGraph(unit: UnitSeed, rng: Rng): ElemProblem {
  const c = code(unit);
  const theme = pick(rng, themeShare(unit, BAR_THEMES));
  const scale = pick(rng, BAR_SCALES);
  const total = pick(rng, scale.totals);
  const parts = barSplits(total, scale);
  if (parts.length === 0) {
    throw new Error(
      `나눌 수 없는 총원입니다: ${scale.who} ${total} (최댓값 ${scale.minTop}~${scale.maxTop})`,
    );
  }
  const picked = [...pick(rng, parts)];
  // 늘 오름차순이면 마지막 항목이 항상 가장 크다 — 자리를 섞는다.
  for (let i = picked.length - 1; i > 0; i -= 1) {
    const j = intBetween(rng, 0, i);
    [picked[i], picked[j]] = [picked[j]!, picked[i]!];
  }
  const values = theme.labels.map((label, i) => ({ label, value: picked[i]! }));
  const max = Math.max(...picked);
  const min = Math.min(...picked);
  const top = values.find((v) => v.value === max)!.label;
  const bottom = values.find((v) => v.value === min)!.label;
  const one = values[intBetween(rng, 0, 3)]!;
  // 두 번째로 많은 것 — 값이 서로 다르므로(나눔 조건) 순위가 하나로 정해진다.
  const ranked = [...values].sort((x, y) => y.value - x.value);
  const second = ranked[1]!.label;
  const secondValue = ranked[1]!.value;
  // 두 항목을 견주는 문항용. `1-5-3` 이 「가장 많은 것과 가장 적은 것의 차」를 묻고 있으므로
  // 여기서는 **최대·최소가 아닌 두 항목**을 골라 같은 것을 두 번 묻지 않는다(R5).
  const pairA = ranked[1]!;
  const pairB = ranked[2]!;
  const intro = `${josa(scale.who, "이", "가")} 좋아하는 ${josa(theme.item, "을", "를")} 조사하여 나타낸 막대그래프입니다.`;
  // 축 맨 위는 **걸음을 아는 쪽**(파이썬 `_y_step`)이 올린다. 여기서는 «하한»만 준다 —
  // 상수 `18` 은 규모가 커지면 막대가 칸을 뚫고, 넉넉한 상수는 작은 그래프를 바닥에 깐다.
  // `yStep` 을 실으면 그림이 **그 걸음 그대로** 긋는다(D-70) — 그래서 발문이 걸음을
  // 말할 수 있다. 막대는 값이 걸음의 배수라 「몇 칸인가」까지 물을 수 있다.
  const figure = fig("barChart", {
    values,
    yMax: max + 1,
    yStep: scale.step,
    yLabel: theme.unit,
  });

  if (c === "1-5-1") {
    if (intBetween(rng, 0, 1) === 0) {
      return make(
        unit,
        `${intro} 학생 수가 가장 많은 것은 어느 ${theme.item}인가?`,
        top,
        `${josa(top, "의", "의")} 막대가 가장 높습니다. ${n(max)}명입니다.`,
        figure,
      );
    }
    return make(
      unit,
      `${intro} ${josa(one.label, "을", "를")} 좋아하는 학생은 몇 명인가?`,
      `${n(one.value)}명`,
      `${josa(one.label, "의", "의")} 막대가 눈금 ${n(one.value)}에 닿아 있으므로 ${n(one.value)}명입니다.`,
      figure,
    );
  }

  if (c === "1-5-2") {
    // 원장님(D-70): 「눈금 몇 칸 유형도 넣어. **유형은 다양할수록 환영**」.
    //
    // 걸음을 `yStep` 으로 그림에 실었으므로 발문이 걸음을 말할 수 있다 — 단 **실은 그 값**만
    // 말한다(`scale.step`). D-67 이 이 유형을 통째로 뺐던 까닭은 발문이 «$1$명» 이라 우기는데
    // 그림은 `_y_step` 이 고른 걸음으로 그려서였다. 이제 한 값이다.
    const kind = intBetween(rng, 0, 4);
    if (kind === 0) {
      return make(
        unit,
        `${intro} 세로 눈금 한 칸은 몇 명을 나타내는가?`,
        `${n(scale.step)}명`,
        `세로축 눈금이 ${n(0)}, ${n(scale.step)}, ${n(scale.step * 2)}, … 로 매겨져 있으므로 ` +
          `한 칸은 ${n(scale.step)}명입니다.`,
        figure,
      );
    }
    if (kind === 1) {
      return make(
        unit,
        `${intro} ${josa(one.label, "은", "는")} 눈금 몇 칸인가?`,
        `${n(one.value / scale.step)}칸`,
        `한 칸이 ${n(scale.step)}명이고 ${josa(one.label, "은", "는")} ${n(one.value)}명이므로 ` +
          `${expr(`${one.value}\\div${scale.step}=${one.value / scale.step}`)} 칸입니다.`,
        figure,
      );
    }
    if (kind === 2) {
      // 칸 → 명. 앞 두 유형과 **방향이 반대**라 곱셈이 된다.
      return make(
        unit,
        `${intro} 세로 눈금 한 칸은 ${n(scale.step)}명입니다. ` +
          `막대가 ${n(pairA.value / scale.step)}칸인 것은 몇 명인가?`,
        `${n(pairA.value)}명`,
        `${expr(`${scale.step}\\times${pairA.value / scale.step}=${pairA.value}`)} 이므로 ${n(pairA.value)}명입니다.`,
        figure,
      );
    }
    if (kind === 3) {
      return make(
        unit,
        `${intro} 학생 수가 두 번째로 많은 것은 어느 ${theme.item}인가?`,
        second,
        `${josa(top, "이", "가")} ${n(max)}명으로 가장 많고, 그다음이 ` +
          `${josa(second, "으로", "로")} ${n(secondValue)}명입니다.`,
        figure,
      );
    }
    return make(
      unit,
      `${intro} ${josa(pairA.label, "은", "는")} ${pairB.label}보다 몇 명 더 많은가?`,
      `${n(pairA.value - pairB.value)}명`,
      `${josa(pairA.label, "이", "가")} ${n(pairA.value)}명, ${josa(pairB.label, "이", "가")} ` +
        `${n(pairB.value)}명이므로 ${expr(`${pairA.value}-${pairB.value}=${pairA.value - pairB.value}`)} 입니다.`,
      figure,
    );
  }

  if (c === "1-5-3") {
    const kind = intBetween(rng, 0, 2);
    if (kind === 0) {
      return make(
        unit,
        `${intro} 학생 수가 가장 많은 ${theme.item}과 가장 적은 ${theme.item}의 학생 수의 차는 몇 명인가?`,
        `${n(max - min)}명`,
        `가장 많은 것은 ${josa(top, "으로", "로")} ${n(max)}명, 가장 적은 것은 ` +
          `${josa(bottom, "으로", "로")} ${n(min)}명입니다. ${expr(`${max}-${min}=${max - min}`)}`,
        figure,
      );
    }
    if (kind === 1) {
      // 원장님 예시(동아 「실력」): 「학생 수가 $1$반보다 많고 $5$반보다 적은 반을 모두 찾아
      // 써 보세요.」 기준 **둘**을 읽고 나머지 전부와 범위를 견주어 **답이 여럿**인 부류다 —
      // 지금까지의 값 읽기·순위·차·합·눈금 어디에도 없다.
      //
      // ⚠️ 기준 쌍을 아무렇게나 뽑으면 **답이 「없음」**이 된다. 값 넷은 서로 다르므로
      // (`barSplits` 의 나눔 조건) 오름차순 `v1<v2<v3<v4` 에서 «사이에 드는 것»이 있는 쌍은
      // **정확히 셋뿐**이다:
      //     (v1,v4) → {v2,v3} **둘**  ·  (v1,v3) → {v2} 하나  ·  (v2,v4) → {v3} 하나
      // 나머지 셋((v1,v2)·(v2,v3)·(v3,v4))은 **반드시 0개**다. 그래서 뽑고 나서 거르지 않고
      // **고를 때부터 이 셋에서만** 뽑는다 — 뽑고 거르면 「없음」이 새어 나갈 길이 남고,
      // 가드가 걸릴 값을 생성기가 만들면 그건 가드가 아니라 사고다.
      //
      // ⚠️ 값이 넷뿐이라 **답이 둘인 경우는 기준이 반드시 최소·최대**가 된다(그때 답은
      // 「나머지 둘」이다). 「범위 밖이라 빠지는 항목」의 맛은 답이 하나인 두 쌍에만 있다.
      // 둘 다 나오게 섞는 까닭이 이것이다 — 한쪽만 쓰면 유형이 반쪽이 된다.
      const asc = [...values].sort((x, y) => x.value - y.value);
      const [loAt, hiAt] = pick(rng, [
        [0, 3],
        [0, 2],
        [1, 3],
      ] as const);
      const lo = asc[loAt]!;
      const hi = asc[hiAt]!;
      // 답은 **지면 순서**(왼쪽부터)로 적는다 — `values` 가 곧 지면 차례다. 채점이 갈리면 안 된다.
      const inRange = values.filter(
        (v) => v.value > lo.value && v.value < hi.value,
      );
      const steps = values
        .filter((v) => v !== lo && v !== hi)
        .map((v) =>
          v.value > lo.value && v.value < hi.value
            ? `${josa(v.label, "은", "는")} ${n(v.value)}명으로 ${n(lo.value)}명보다 많고 ${n(hi.value)}명보다 적습니다.`
            : v.value < lo.value
              ? `${josa(v.label, "은", "는")} ${n(v.value)}명으로 ${n(lo.value)}명보다 적습니다.`
              : `${josa(v.label, "은", "는")} ${n(v.value)}명으로 ${n(hi.value)}명보다 많습니다.`,
        );
      return make(
        unit,
        `${intro} 좋아하는 학생 수가 ${lo.label}보다 많고 ${hi.label}보다 적은 ` +
          `${josa(theme.item, "을", "를")} 모두 찾아 쓰시오.`,
        inRange.map((v) => v.label).join(", "),
        `${josa(lo.label, "은", "는")} ${n(lo.value)}명, ${josa(hi.label, "은", "는")} ` +
          `${n(hi.value)}명입니다. ${steps.join(" ")} ` +
          `따라서 ${inRange.map((v) => v.label).join(", ")}입니다.`,
        figure,
      );
    }
    // 합계는 «막는 문턱»이 아니라 **구성으로 참이 되는 값**이다 — 곧 그 규모의 총원이다.
    return make(
      unit,
      `${intro} 조사한 학생은 모두 몇 명인가?`,
      `${n(total)}명`,
      `${expr(`${picked.join("+")}=${total}`)} 이므로 모두 ${n(total)}명입니다.`,
      figure,
    );
  }

  return noBranch(unit);
}

/* ─────────────── 1-5 곁가지: 두 그래프 결합 (수 × 개당 가격) ───────────────
 *
 * 원장님 예시: 「팔린 종류별 아이스크림의 **수**와 아이스크림 한 개의 **가격**을 조사하여
 * 나타낸 막대그래프입니다. 오늘 멜론 아이스크림을 팔고 받은 돈은 얼마인가?」
 * → 같은 항목 목록을 공유하는 **두 자료**에서 지목된 항목의 값을 각각 읽어 **곱한다.**
 *
 * ⚠️ **아직 배선하지 않았다.** 가로 막대 + 두 그래프를 나란히 그리는 스펙 계약을
 * elem-figures 가 만드는 중이고, 계약이 오기 전에 갈래를 열면 **발문이 「막대그래프입니다」라고
 * 하는데 그림이 없는 문항**이 나간다 — 이 저장소가 1,420건으로 겪은 바로 그 부류다
 * (`report-missing-figures.ts`). 그래서 지금은 **값·발문·해설만** 만들어 두고 시험으로
 * 잠가 둔다. 계약이 오면 `fig(...)` 를 붙여 `1-5` 의 한 갈래에서 이 함수를 부르면 된다.
 * 「그래프를 가리키면 그림이 있어야 한다」 시험이 그때 배선을 지킨다.
 */
type SaleTheme = {
  /** 「어느 편의점」 — 발문 첫머리. */
  place: string;
  /** 「아이스크림」 — 「한 개의 가격」과 항목 이름 뒤에 붙는다. */
  goods: string;
  /** 세는 말. 「개」·「자루」·「줄」 — 「한 자루의 가격」이 되어야 한다. */
  counter: string;
  /**
   * 가로축 항목. **꾸밈말**이라 뒤에 `goods` 를 붙이면 이름이 된다(「멜론」→「멜론 아이스크림」).
   * 홀로 서는 이름(「단팥빵」)을 넣으면 「단팥빵 빵」이 되므로 넣지 말 것.
   */
  labels: readonly [string, string, string];
};

/**
 * 「개당 가격 × 판 수」가 **참인** 소재만 — 좋아하는 과일을 «팔고 받은 돈»은 말이 안 된다.
 * 세는 말이 항목마다 같아야 한다(연필 자루 · 김밥 줄).
 */
const SALE_THEMES: readonly SaleTheme[] = [
  {
    place: "어느 편의점",
    goods: "아이스크림",
    counter: "개",
    labels: ["체리", "멜론", "바닐라"],
  },
  {
    place: "어느 분식집",
    goods: "붕어빵",
    counter: "개",
    labels: ["팥", "슈크림", "초코"],
  },
  {
    place: "어느 문구점",
    goods: "연필",
    counter: "자루",
    labels: ["빨강", "파랑", "검정"],
  },
  {
    place: "어느 김밥집",
    goods: "김밥",
    counter: "줄",
    labels: ["참치", "치즈", "야채"],
  },
  {
    place: "어느 빵집",
    goods: "도넛",
    counter: "개",
    labels: ["딸기", "초코", "설탕"],
  },
  {
    place: "어느 편의점",
    goods: "우유",
    counter: "개",
    labels: ["딸기", "초코", "바나나"],
  },
];

/**
 * 두 그래프의 걸음. **값이 눈금 위에 있어야** 「읽어서 곱한다」가 성립한다.
 *
 * 상한을 정하는 것이 **둘**이다. 둘 다 실측이고, **작은 쪽이 이긴다.**
 *
 * ㉠ **엔진** — 걸음을 스펙에 실으면 눈금이 `최댓값 / 걸음 + 1` 줄이고 `MAX_Y_TICKS` 가 9라
 *   **최댓값 ≤ `8 × 걸음`** 이다(실측 2026-08-22). 이것만 보면 수는 `80` 까지다.
 * ㉡ **지면** — 판매 그래프는 **가로형**이라 눈금이 옆으로 늘어선다. 줄이 늘수록 눈금 글자가
 *   좁아지는데, 겹침 없이 성립하는 것은 **5줄까지**다(elem-figures 실측 2026-08-23).
 *   세로형인 가격 쪽은 9줄이어도 무관하므로 `800` 그대로다.
 *
 * ⚠️ **한때 「6줄까지」로 적혀 있었다. 그 수는 틀렸다** — 시안의 라벨 **겹침 결함** 때문에
 * 6줄이 12.50px 로 «합격»처럼 보였고, 겹침을 고치고 다시 재니 **12.303px 로 기준 미달**이었다.
 * 결함이 지표를 좋게 만든 자리다. 그러니 이 수를 다시 올리려거든 **겹침이 고쳐진 판에서 잰
 * 값인지부터** 확인할 것.
 *
 * ⚠️ **걸음을 `5` 로 되돌리지 말 것.** 「교재는 `15`·`25` 도 쓰던데」가 되돌리는 이유가 되는데,
 * 걸음 5로는 조건 셋을 **동시에** 만족할 수 없다:
 *   · 5줄 상한 → 최댓값 ≤ `4 × 5 = 20`
 *   · 값은 **두 자리** → `10` 이상
 *   · 풀은 **넷 이상**(아래 하한 가드 — 셋이면 `pickDistinct(3/3)` 이라 매번 같은 집합이고
 *     축 다양성 가드도 잠잠해진다)
 *   → 남는 값이 `{10, 15, 20}` **셋뿐**이라 세 번째 조건에서 막힌다. 걸음 10이면 넷이 된다.
 *
 * 걸음 10의 값: 두 자리 유지 · 풀 4(하한 경계) · 최악 5줄(최대 40) · 전형 4줄(최대 30) ·
 * D-69 가 「눈금당 10 허용」을 **명시**했고 · 교재 원본의 값 범위(40까지)도 지킨다.
 * 대가는 곱셈이 순해지는 것이다(`30 × 700`) — 세로셈의 **꼴**은 (세 자리)×(두 자리) 그대로이나
 * 자릿수 난도는 내려간다. 지면 제약에서 온 결과지 고른 것이 아니다.
 */
const SALE_COUNT_STEP = 10; // 두 자리 → 10·20·30·40 (5줄 상한)
const SALE_PRICE_STEP = 100; // 세 자리 · 100원 단위 → 300·…·800

const SALE_COUNTS = [10, 20, 30, 40] as const;
const SALE_PRICES = [300, 400, 500, 600, 700, 800] as const;

/**
 * 자료마다 **그려도 되는 눈금 줄 수**. 위 ㉡ 의 실측을 수로 옮긴 것이다.
 * 시험이 **실제로 그린 SVG 의 줄 수**를 이 값과 맞대므로, 풀을 넓히면 여기서 걸린다.
 */
const SALE_MAX_TICKS = { 수: 5, 가격: 9 } as const;

/** 겹치지 않게 `k` 개를 뽑는다. 값이 겹치면 두 막대가 같은 높이라 그래프가 헷갈린다. */
function pickDistinct<T>(rng: Rng, pool: readonly T[], k: number): T[] {
  const rest = [...pool];
  const out: T[] = [];
  for (let i = 0; i < k; i += 1) {
    const j = intBetween(rng, 0, rest.length - 1);
    out.push(rest[j]!);
    rest.splice(j, 1);
  }
  return out;
}

export type SaleCombo = {
  theme: SaleTheme;
  /** 항목별 팔린 수 — `theme.labels` 와 같은 차례(지면 차례). */
  counts: number[];
  /** 항목별 한 개의 가격 — 같은 차례. */
  prices: number[];
  /** 묻는 항목의 자리. */
  at: number;
  content: string;
  answer: string;
  solution: string;
};

/**
 * 값·발문·해설을 만든다. **그림은 아직 안 붙인다**(위 ⚠️ 참조).
 * 두 자료가 **같은 항목 목록**을 쓰는 것이 이 유형의 뼈대다 — 그래서 `labels` 하나로 둘을 만든다.
 */
function buildSaleCombo(rng: Rng): SaleCombo {
  const theme = pick(rng, SALE_THEMES);
  const counts = pickDistinct(rng, SALE_COUNTS, 3);
  const prices = pickDistinct(rng, SALE_PRICES, 3);
  const at = intBetween(rng, 0, 2);
  const count = counts[at]!;
  const price = prices[at]!;
  const money = count * price;
  const name = `${theme.labels[at]} ${theme.goods}`;
  return {
    theme,
    counts,
    prices,
    at,
    content:
      `${theme.place}에서 오늘 팔린 종류별 ${josa(theme.goods, "의", "의")} 수와 ` +
      `${theme.goods} 한 ${theme.counter}의 가격을 조사하여 나타낸 막대그래프입니다. ` +
      `오늘 ${josa(name, "을", "를")} 팔고 받은 돈은 얼마인가?`,
    answer: `${n(money)}원`,
    solution:
      `${josa(name, "은", "는")} ${n(count)}${theme.counter} 팔렸고, ` +
      `한 ${theme.counter}의 가격은 ${n(price)}원입니다. ` +
      `${expr(`${count}\\times${price}=${money}`)} 이므로 ${n(money)}원입니다.`,
  };
}

/**
 * 두 자료를 **안쪽 그래프 스펙 둘**로 만든다.
 *
 * 계약(2026-08-23 확정 방향): `chartPair` 는 `charts` 배열로 감싸고 **각 안쪽 스펙은 단독
 * `barChart` 와 동일**하다. 그래서 «감싸는 것»(아직 미확정)과 «안쪽»(확정)을 갈라 두고,
 * 여기서는 **안쪽만** 만든다. 배선할 때 이 결과를 `charts` 에 그대로 넣으면 된다.
 *
 * 배선 때 붙일 `title` 은 **짧은 형**으로 확정됐다(원장님 2026-08-23) — 수 쪽은 「팔린 수」,
 * 가격 쪽은 「한 ${counter}의 가격」(최장 「한 자루의 가격」 8글자). 긴 정보는 **발문이 이미
 * 말하므로** 제목에 넣지 않는다. 렌더러에 제목 폭 가드가 생기면 「소재 전량의 제목이 그 안」을
 * 시험으로 잠근다 — 그때 네 가지를 열거하지 말고 `SALE_THEMES` 를 **읽어서** 돌릴 것.
 *
 * ⚠️ 이 함수를 시험이 **직접** 부른다. 시험이 스펙을 따로 만들면 규칙이 두 벌이 되어
 * 「자와 조판이 다른 것을 본다」가 된다 — 지면 값(`yMax`·`yStep`)은 한 곳에서만 정한다.
 */
function saleChartSpecs(c: SaleCombo): {
  role: string;
  step: number;
  spec: Record<string, unknown>;
}[] {
  return [
    {
      role: "수",
      vals: c.counts,
      step: SALE_COUNT_STEP,
      unit: c.theme.counter,
    },
    { role: "가격", vals: c.prices, step: SALE_PRICE_STEP, unit: "원" },
  ].map(({ role, vals, step, unit }) => ({
    role,
    step,
    // `yMax` 는 «하한»만 준다 — 축 맨 위는 엔진이 `ceil(최댓값 / 걸음) × 걸음` 으로 올린다.
    spec: fig("barChart", {
      values: c.theme.labels.map((label, i) => ({ label, value: vals[i]! })),
      yMax: Math.max(...vals) + 1,
      yStep: step,
      yLabel: unit,
    }),
  }));
}

/* ───────────────────────── 1-6 규칙 찾기 ───────────────────────── */

function pattern(unit: UnitSeed, rng: Rng): ElemProblem {
  const c = code(unit);

  if (c === "1-6-1") {
    if (intBetween(rng, 0, 2) === 0) {
      const a = intBetween(rng, 2, 6);
      return make(
        unit,
        `수의 배열에서 규칙을 찾아 $\\square$에 알맞은 수를 쓰시오. ` +
          `${n(a)}, ${n(a * 2)}, ${n(a * 4)}, ${n(a * 8)}, $\\square$`,
        n(a * 16),
        `${n(2)}배씩 커지는 규칙입니다. ${expr(`${a * 8}\\times2=${a * 16}`)}`,
      );
    }
    const start = intBetween(rng, 3, 40);
    const step = intBetween(rng, 2, 9);
    return make(
      unit,
      `수의 배열에서 규칙을 찾아 $\\square$에 알맞은 수를 쓰시오. ` +
        `${n(start)}, ${n(start + step)}, ${n(start + step * 2)}, ${n(start + step * 3)}, $\\square$`,
      n(start + step * 4),
      `${n(step)}씩 커지는 규칙입니다. ${expr(`${start + step * 3}+${step}=${start + step * 4}`)}`,
    );
  }

  if (c === "1-6-2") {
    if (intBetween(rng, 0, 2) === 0) {
      return make(
        unit,
        `모형을 정사각형 모양으로 늘어놓았습니다. 첫째는 ${n(1)}개, 둘째는 ${n(4)}개, 셋째는 ${n(9)}개일 때 다섯째는 몇 개인가?`,
        n(25),
        `${expr("1\\times1=1")}, ${expr("2\\times2=4")}, ${expr("3\\times3=9")} 이므로 ` +
          `다섯째는 ${expr("5\\times5=25")} 입니다.`,
      );
    }
    const start = intBetween(rng, 1, 4);
    const step = intBetween(rng, 2, 5);
    return make(
      unit,
      `도형을 규칙에 따라 늘어놓았습니다. 첫째는 모형이 ${n(start)}개, 둘째는 ${n(start + step)}개, ` +
        `셋째는 ${n(start + step * 2)}개일 때 다섯째는 몇 개인가?`,
      n(start + step * 4),
      `${n(step)}개씩 늘어나는 규칙입니다. ${expr(`${start + step * 2}+${step}+${step}=${start + step * 4}`)}`,
    );
  }

  if (c === "1-6-3") {
    const u = intBetween(rng, 1, 6);
    const row = (k: number) => [100 * k + u, 100 * k + u + 1] as const;
    const sum = (k: number) => row(k)[0] + row(k)[1];
    return make(
      unit,
      `계산식의 배열에서 규칙을 찾아 $\\square$에 알맞은 수를 쓰시오. ` +
        `${expr(`${row(1)[0]}+${row(1)[1]}=${sum(1)}`)}, ${expr(`${row(2)[0]}+${row(2)[1]}=${sum(2)}`)}, ` +
        `${expr(`${row(3)[0]}+${row(3)[1]}=\\square`)}`,
      n(sum(3)),
      `더하는 두 수가 각각 ${n(100)}씩 커지므로 합은 ${n(200)}씩 커집니다. ` +
        `${expr(`${sum(2)}+200=${sum(3)}`)}`,
    );
  }

  if (c === "1-6-4") {
    if (intBetween(rng, 0, 1) === 0) {
      const a = intBetween(rng, 12, 48);
      const b = intBetween(rng, 3, 9);
      return make(
        unit,
        `계산식의 배열에서 규칙을 찾아 $\\square$에 알맞은 수를 쓰시오. ` +
          `${expr(`${a}\\times${b}=${a * b}`)}, ${expr(`${a}\\times${b * 10}=${a * b * 10}`)}, ` +
          `${expr(`${a}\\times${b * 100}=\\square`)}`,
        n(a * b * 100),
        `곱하는 수가 ${n(10)}배가 되면 곱도 ${n(10)}배가 됩니다. ${expr(`${a * b * 10}\\times10=${a * b * 100}`)}`,
      );
    }
    const a = intBetween(rng, 40, 90);
    const b = intBetween(rng, 11, 30);
    return make(
      unit,
      `계산식의 배열에서 규칙을 찾아 $\\square$에 알맞은 수를 쓰시오. ` +
        `${expr(`${a}-${b}=${a - b}`)}, ${expr(`${a + 10}-${b + 10}=${a - b}`)}, ` +
        `${expr(`${a + 20}-${b + 20}=\\square`)}`,
      n(a - b),
      `빼지는 수와 빼는 수가 똑같이 ${n(10)}씩 커지면 차는 변하지 않습니다.`,
    );
  }

  if (c === "1-6-5") {
    const a = intBetween(rng, 12, 48);
    const b = intBetween(rng, 12, 48);
    const gap = intBetween(rng, 2, 9);
    if (intBetween(rng, 0, 1) === 0) {
      return make(
        unit,
        `등호(=)의 양쪽이 같아지도록 $\\square$에 알맞은 수를 쓰시오. ${expr(`${a}+${b}=${a + gap}+\\square`)}`,
        n(b - gap),
        `왼쪽의 ${josaNum(a, "이", "가")} ${n(gap)}만큼 커졌으므로 ${josaNum(b, "은", "는")} ${n(gap)}만큼 작아져야 합니다. ` +
          `${expr(`${b}-${gap}=${b - gap}`)}`,
      );
    }
    const big = a + b;
    return make(
      unit,
      `등호(=)의 양쪽이 같아지도록 $\\square$에 알맞은 수를 쓰시오. ${expr(`${big}-${b}=${big + gap}-\\square`)}`,
      n(b + gap),
      `빼지는 수가 ${n(gap)}만큼 커졌으므로 빼는 수도 ${n(gap)}만큼 커져야 차가 같습니다. ` +
        `${expr(`${b}+${gap}=${b + gap}`)}`,
    );
  }

  return noBranch(unit);
}

/* ───────────────── 2-1 분수의 덧셈과 뺄셈 ───────────────── */

const FRAC_DENS = [5, 6, 7, 8, 9, 10, 12] as const;

/**
 * 분모가 같은 분수 계산에서 **약분이 필요 없는** 짝만 고른다 — 약분은 초5(1-4 약분과 통분)다.
 * 답의 분자를 분모로 나눈 나머지가 분모와 서로소면 `fmtFrac` 이 약분하지 않는다.
 */
function fracPairs(den: number, op: "add" | "sub"): [number, number][] {
  const out: [number, number][] = [];
  for (let a = 1; a < den; a += 1) {
    for (let b = 1; b < den; b += 1) {
      const raw = op === "add" ? a + b : a - b;
      if (raw <= 0) continue;
      const rest = raw % den;
      if (rest === 0 || gcd(rest, den) !== 1) continue;
      out.push([a, b]);
    }
  }
  return out;
}

/** 대분수 뺄셈 짝. `borrow` 는 분수끼리 뺄 수 없어 자연수에서 받아내림하는 경우다. */
function mixedSubPairs(
  den: number,
): { a: number; b: number; borrow: boolean }[] {
  const out: { a: number; b: number; borrow: boolean }[] = [];
  for (let a = 1; a < den; a += 1) {
    for (let b = 1; b < den; b += 1) {
      if (a === b) continue;
      const rest = a > b ? a - b : a - b + den;
      if (gcd(rest, den) !== 1) continue;
      out.push({ a, b, borrow: a < b });
    }
  }
  return out;
}

function fracAdd42(unit: UnitSeed, rng: Rng): ElemProblem {
  const c = code(unit);
  const den = pick(rng, FRAC_DENS);

  if (c === "2-1-1") {
    const drawable = fracPairs(den, "add").filter(([a, b]) => a + b < den);
    if (drawable.length > 0 && intBetween(rng, 0, 2) === 0) {
      const [a, b] = pick(rng, drawable);
      return make(
        unit,
        `색칠한 부분은 전체의 ${expr(`\\frac{${a}}{${den}}`)}입니다. ` +
          `여기에 ${expr(`\\frac{${b}}{${den}}`)}만큼 더 색칠하면 색칠한 부분은 전체의 얼마인가?`,
        expr(`\\frac{${a + b}}{${den}}`),
        `전체를 ${josaNum(den, "으로", "로")} 똑같이 나눈 것 중 ${n(a)}칸에 ${n(b)}칸을 더 색칠하면 ${n(a + b)}칸입니다. ` +
          `${expr(`\\frac{${a}}{${den}}+\\frac{${b}}{${den}}=\\frac{${a + b}}{${den}}`)}`,
        fracSpec(rng, den, a),
      );
    }
    const [a, b] = pick(rng, fracPairs(den, "add"));
    const carried = a + b >= den;
    return make(
      unit,
      expr(`\\frac{${a}}{${den}}+\\frac{${b}}{${den}}=\\square`),
      expr(fmtFrac(a + b, den)),
      `분모가 같은 분수의 덧셈은 분자끼리 더합니다. ` +
        `${expr(`\\frac{${a}}{${den}}+\\frac{${b}}{${den}}=\\frac{${a + b}}{${den}}`)}` +
        (carried
          ? ` 가분수이므로 대분수로 고치면 ${expr(fmtFrac(a + b, den))} 입니다.`
          : " 입니다."),
    );
  }

  if (c === "2-1-2") {
    const pairs = fracPairs(den, "sub");
    const [a, b] = pick(rng, pairs);
    if (intBetween(rng, 0, 2) === 0) {
      return make(
        unit,
        `색칠한 부분은 전체의 ${expr(`\\frac{${a}}{${den}}`)}입니다. ` +
          `여기에서 ${expr(`\\frac{${b}}{${den}}`)}만큼 지우면 남은 부분은 전체의 얼마인가?`,
        expr(`\\frac{${a - b}}{${den}}`),
        `색칠한 ${n(a)}칸에서 ${n(b)}칸을 지우면 ${n(a - b)}칸이 남습니다. ` +
          `${expr(`\\frac{${a}}{${den}}-\\frac{${b}}{${den}}=\\frac{${a - b}}{${den}}`)}`,
        fracSpec(rng, den, a),
      );
    }
    return make(
      unit,
      expr(`\\frac{${a}}{${den}}-\\frac{${b}}{${den}}=\\square`),
      expr(`\\frac{${a - b}}{${den}}`),
      `분모가 같은 분수의 뺄셈은 분자끼리 뺍니다. ` +
        `${expr(`\\frac{${a}}{${den}}-\\frac{${b}}{${den}}=\\frac{${a - b}}{${den}}`)} 입니다.`,
    );
  }

  if (c === "2-1-3") {
    const [a, b] = pick(rng, fracPairs(den, "add"));
    const w1 = intBetween(rng, 1, 4);
    const plain = intBetween(rng, 0, 1) === 0;
    if (plain) {
      const total = w1 * den + a + b;
      return make(
        unit,
        expr(`${w1}\\frac{${a}}{${den}}+\\frac{${b}}{${den}}=\\square`),
        expr(fmtFrac(total, den)),
        `자연수는 그대로 두고 분수끼리 더합니다. ` +
          `${expr(`\\frac{${a}}{${den}}+\\frac{${b}}{${den}}=\\frac{${a + b}}{${den}}`)} 이므로 ` +
          `답은 ${expr(fmtFrac(total, den))} 입니다.`,
      );
    }
    const w2 = intBetween(rng, 1, 3);
    const total = w1 * den + a + (w2 * den + b);
    const carried = a + b >= den;
    return make(
      unit,
      expr(`${w1}\\frac{${a}}{${den}}+${w2}\\frac{${b}}{${den}}=\\square`),
      expr(fmtFrac(total, den)),
      `자연수는 자연수끼리, 분수는 분수끼리 더합니다. ` +
        `${expr(`${w1}+${w2}=${w1 + w2}`)}, ` +
        `${expr(`\\frac{${a}}{${den}}+\\frac{${b}}{${den}}=\\frac{${a + b}}{${den}}`)}` +
        (carried
          ? ` 입니다. 분수 부분이 가분수이므로 자연수에 ${n(1)}을 받아올려 ${expr(fmtFrac(total, den))} 입니다.`
          : ` 이므로 답은 ${expr(fmtFrac(total, den))} 입니다.`),
    );
  }

  if (c === "2-1-4") {
    const { a, b, borrow } = pick(rng, mixedSubPairs(den));
    const w2 = intBetween(rng, 1, 3);
    const w1 = w2 + intBetween(rng, 1, 3);
    const total = w1 * den + a - (w2 * den + b);
    return make(
      unit,
      expr(`${w1}\\frac{${a}}{${den}}-${w2}\\frac{${b}}{${den}}=\\square`),
      expr(fmtFrac(total, den)),
      borrow
        ? `분수끼리 뺄 수 없으므로 ${expr(`${w1}\\frac{${a}}{${den}}=${w1 - 1}\\frac{${a + den}}{${den}}`)} ` +
            `으로 고칩니다. ${expr(`${w1 - 1}-${w2}=${w1 - 1 - w2}`)}, ` +
            `${expr(`\\frac{${a + den}}{${den}}-\\frac{${b}}{${den}}=\\frac{${a + den - b}}{${den}}`)} 이므로 ` +
            `답은 ${expr(fmtFrac(total, den))} 입니다.`
        : `자연수는 자연수끼리, 분수는 분수끼리 뺍니다. ${expr(`${w1}-${w2}=${w1 - w2}`)}, ` +
            `${expr(`\\frac{${a}}{${den}}-\\frac{${b}}{${den}}=\\frac{${a - b}}{${den}}`)} 이므로 ` +
            `답은 ${expr(fmtFrac(total, den))} 입니다.`,
    );
  }

  return noBranch(unit);
}
/* ───────────────────────── 2-2 삼각형 ───────────────────────── */

/**
 * 「정삼각형의 기호를 쓰시오」의 곁들이. **정삼각형이 아닌 것만** 넣는다 —
 * `eqTri` 를 곁들이에 넣으면 정답이 둘이 되어 문항이 깨진다(tick 유출과는 다른 축이다).
 *
 * 한때 `isoTri` 를 뺐다가 되돌린 자리다. 등변 tick 이 `marks` 옵트인이 되어 그림이 답을
 * 알려 주지 않게 되자(원장님 ⑤) 이번엔 **가릴 수가 없어졌다** — 그때 `isoTri` 는 밑변 44·
 * 높이 44 라 정삼각형(밑변 44·높이 38.1)과 윤곽 거리가 **3.93px** 뿐이었다.
 * elem-g5(합동 풀)·초3(점격자)도 같은 자리에서 각자 우회하고 있었으므로 **엔진에서** 고쳤다
 * (D-61) — `ISO_TRI_BASE = 0.58` 로 밑변을 좁혀 9.45px, 변 길이 비 1.12 → **1.80**.
 *
 * 그래서 지금 `isoTri` 는 「높이만 다른 이등변」이라 오히려 좋은 곁들이다. 실측(설정 뒤):
 * `eqTri` 1.000 · `wideTri` 1.306 · `rightTri` 1.414 · `isoTri` 1.795 (최장/최단 변 비).
 *
 * 「그림이 답을 알려 주면 안 된다」의 뒷면은 **「그림으로 답을 낼 수는 있어야 한다」**다.
 * 수치로는 12% 차이라 넘어갈 뻔했고 **PNG 로 뽑아 눈으로 보고서야** 드러났다.
 */
const TRI_DISTRACTORS = ["isoTri", "rightTri", "wideTri"] as const;

function triClass(a: number, b: number, c: number): string {
  const big = Math.max(a, b, c);
  return big > 90 ? "둔각삼각형" : big === 90 ? "직각삼각형" : "예각삼각형";
}

function triangle(unit: UnitSeed, rng: Rng): ElemProblem {
  const c = code(unit);

  if (c === "2-2-1") {
    // 그림 문항이 기본이다 — 씨앗 20260821 이 이 가지로 와야 한다
    // (`elementaryEngine.test.ts` 가 그 씨앗에서 `eqTri`·「가」·「기호」를 못 박아 두었다).
    if (intBetween(rng, 0, 3) !== 0) {
      const same = intBetween(rng, 4, 9);
      const other = same + intBetween(rng, 1, 4);
      const equilateral = intBetween(rng, 0, 1) === 0;
      const third = equilateral ? same : other;
      return make(
        unit,
        `세 변의 길이가 ${cm(same)}, ${cm(same)}, ${cm(third)}인 삼각형의 이름을 쓰시오.`,
        equilateral ? "정삼각형" : "이등변삼각형",
        equilateral
          ? `세 변의 길이가 모두 ${cm(same)}로 같습니다. 세 변의 길이가 같은 삼각형은 정삼각형입니다.`
          : `길이가 같은 변이 ${n(2)}개 있습니다. 두 변의 길이가 같은 삼각형은 이등변삼각형입니다.`,
      );
    }
    const others = [...TRI_DISTRACTORS];
    const second = others.splice(intBetween(rng, 0, others.length - 1), 1)[0]!;
    const third = others[intBetween(rng, 0, others.length - 1)]!;
    return make(
      unit,
      "그림에서 정삼각형의 기호를 쓰시오.",
      "가",
      "가는 세 변의 길이가 모두 같습니다. 세 변의 길이가 같은 삼각형을 정삼각형이라고 합니다.",
      fig("namedShapes", {
        items: [
          { shape: "eqTri", label: "가" },
          { shape: second, label: "나" },
          { shape: third, label: "다" },
        ],
      }),
    );
  }

  if (c === "2-2-2") {
    const kind = intBetween(rng, 0, 2);
    if (kind === 0) {
      const apex = intBetween(rng, 15, 40) * 2;
      const base = (180 - apex) / 2;
      return make(
        unit,
        `이등변삼각형의 꼭지각의 크기가 ${deg(apex)}입니다. 한 밑각의 크기는 몇 도인가?`,
        deg(base),
        `이등변삼각형은 두 밑각의 크기가 같습니다. ${expr(`(180-${apex})\\div2=${base}`)}`,
      );
    }
    if (kind === 1) {
      const base = intBetween(rng, 40, 75);
      return make(
        unit,
        `이등변삼각형의 한 밑각의 크기가 ${deg(base)}입니다. 꼭지각의 크기는 몇 도인가?`,
        deg(180 - base * 2),
        `두 밑각의 크기가 같으므로 ${expr(`180-${base}-${base}=${180 - base * 2}`)} 입니다.`,
      );
    }
    const same = intBetween(rng, 5, 12);
    const other = intBetween(rng, 3, 9);
    return make(
      unit,
      `이등변삼각형의 길이가 같은 두 변이 각각 ${cm(same)}이고 나머지 한 변이 ${cm(other)}입니다. ` +
        `세 변의 길이의 합은 몇 cm인가?`,
      cm(same * 2 + other),
      `${expr(`${same}+${same}+${other}=${same * 2 + other}`)} 이므로 ${cm(same * 2 + other)}입니다.`,
    );
  }

  if (c === "2-2-3") {
    const kind = intBetween(rng, 0, 2);
    if (kind === 0) {
      return make(
        unit,
        "정삼각형의 한 각의 크기는 몇 도인가?",
        deg(60),
        `정삼각형은 세 각의 크기가 모두 같고 세 각의 합은 ${deg(180)}입니다. ${expr("180\\div3=60")}`,
      );
    }
    const side = intBetween(rng, 4, 13);
    if (kind === 1) {
      return make(
        unit,
        `한 변이 ${cm(side)}인 정삼각형의 세 변의 길이의 합은 몇 cm인가?`,
        cm(side * 3),
        `정삼각형은 세 변의 길이가 같으므로 ${expr(`${side}\\times3=${side * 3}`)} 입니다.`,
      );
    }
    return make(
      unit,
      `세 변의 길이의 합이 ${cm(side * 3)}인 정삼각형의 한 변은 몇 cm인가?`,
      cm(side),
      `정삼각형은 세 변의 길이가 같으므로 ${expr(`${side * 3}\\div3=${side}`)} 입니다.`,
    );
  }

  if (c === "2-2-4") {
    // 세 부류가 골고루 나오게 각을 **부류부터 정하고** 만든다.
    const kind = intBetween(rng, 0, 2);
    let a: number;
    let b: number;
    if (kind === 0) {
      a = intBetween(rng, 20, 70);
      b = 90;
    } else if (kind === 1) {
      b = intBetween(rng, 100, 140);
      a = intBetween(rng, 20, 160 - b);
    } else {
      a = intBetween(rng, 55, 85);
      b = intBetween(rng, 55, 85);
    }
    const rest = 180 - a - b;
    const big = Math.max(a, b, rest);
    if (intBetween(rng, 0, 2) === 0) {
      return make(
        unit,
        `삼각형의 두 각의 크기가 ${deg(a)}, ${deg(b)}입니다. ` +
          `이 삼각형은 예각삼각형, 직각삼각형, 둔각삼각형 중 무엇인가?`,
        triClass(a, b, rest),
        `나머지 한 각은 ${expr(`180-${a}-${b}=${rest}`)} 입니다. ` +
          `가장 큰 각이 ${deg(big)}이므로 ${triClass(a, b, rest)}입니다.`,
      );
    }
    return make(
      unit,
      `세 각의 크기가 ${deg(a)}, ${deg(b)}, ${deg(rest)}인 삼각형은 ` +
        `예각삼각형, 직각삼각형, 둔각삼각형 중 무엇인가?`,
      triClass(a, b, rest),
      `가장 큰 각이 ${deg(big)}입니다. ${deg(90)}보다 ` +
        `${big > 90 ? "크므로 둔각삼각형" : big === 90 ? "같으므로 직각삼각형" : "작아 세 각이 모두 예각이므로 예각삼각형"}입니다.`,
    );
  }

  if (c === "2-2-5") {
    if (intBetween(rng, 0, 2) === 0) {
      return make(
        unit,
        "세 변의 길이가 모두 같은 삼각형은 예각삼각형, 직각삼각형, 둔각삼각형 중 무엇인가?",
        "예각삼각형",
        `세 변의 길이가 같은 삼각형은 정삼각형이고 세 각이 모두 ${deg(60)}입니다. ` +
          `세 각이 모두 ${deg(90)}보다 작으므로 예각삼각형입니다.`,
      );
    }
    const base = pick(rng, [25, 30, 35, 40, 55, 65, 70]);
    const apex = 180 - base * 2;
    return make(
      unit,
      `두 밑각의 크기가 각각 ${deg(base)}이고 나머지 한 각이 ${deg(apex)}인 삼각형을 ` +
        `변의 길이와 각의 크기 두 가지 기준으로 각각 무엇이라고 하는가?`,
      `이등변삼각형, ${triClass(base, base, apex)}`,
      `두 각의 크기가 같으므로 두 변의 길이도 같아 이등변삼각형입니다. ` +
        `가장 큰 각이 ${deg(Math.max(base, apex))}이므로 ${triClass(base, base, apex)}입니다.`,
    );
  }

  return noBranch(unit);
}
/* ───────────────── 2-3 소수의 덧셈과 뺄셈 ─────────────────
 *
 * ⚠️ 해설에 **소수의 곱셈·나눗셈을 쓰지 않는다**(R3). 그것은 초5-2 다.
 * 「$0.1$이 $10$개면 $1$」 처럼 **자릿값**으로 설명하고, $10$배는 「소수점이 옮겨진다」로 쓴다.
 */

const DEC_PLACE = ["첫", "둘", "셋"] as const;
/** 소수 자리마다 「무엇이 몇 개인지」를 나타내는 단위. 자릿값 설명의 밑천이다. */
const DEC_UNIT = ["0.1", "0.01", "0.001"] as const;

/** 두 소수가 처음으로 갈리는 자리 이름. 「자연수 부분」이 같으면 소수 자리를 짚는다. */
function firstDiffPlace(a: number, b: number): string {
  if (Math.floor(a / 100) !== Math.floor(b / 100)) return "자연수 부분";
  if (Math.floor(a / 10) % 10 !== Math.floor(b / 10) % 10)
    return "소수 첫째 자리";
  return "소수 둘째 자리";
}

function decAdd(unit: UnitSeed, rng: Rng): ElemProblem {
  const c = code(unit);

  if (c === "2-3-1") {
    const kind = intBetween(rng, 0, 2);
    if (kind === 0) {
      const count = intBetween(rng, 1, 9) * 10 + intBetween(rng, 1, 9);
      return make(
        unit,
        `${n("0.01")}이 ${n(count)}개인 수를 소수로 쓰시오.`,
        n(dec2(count)),
        `${n("0.01")}이 ${n(10)}개이면 ${n("0.1")}, ${n(100)}개이면 ${n(1)}입니다. ` +
          `${n("0.01")}이 ${n(count)}개이면 ${n(dec2(count))}입니다.`,
      );
    }
    const whole = intBetween(rng, 1, 9);
    const digits = [
      intBetween(rng, 1, 9),
      intBetween(rng, 1, 9),
      intBetween(rng, 1, 9),
    ];
    const value = `${whole}.${digits.join("")}`;
    const at = intBetween(rng, 0, 2);
    if (kind === 1) {
      return make(
        unit,
        `${n(value)}에서 소수 ${DEC_PLACE[at]}째 자리 숫자를 쓰시오.`,
        n(digits[at]!),
        `${n(value)}의 소수 ${DEC_PLACE[at]}째 자리 숫자는 ${n(digits[at]!)}입니다.`,
      );
    }
    const digit = digits[at]!;
    const worth = at === 0 ? dec1(digit) : at === 1 ? dec2(digit) : dec3(digit);
    return make(
      unit,
      `${n(value)}에서 소수 ${DEC_PLACE[at]}째 자리 숫자가 나타내는 수를 소수로 쓰시오.`,
      n(worth),
      `소수 ${DEC_PLACE[at]}째 자리는 ${josaNum(DEC_UNIT[at]!, "이", "가")} 몇 개인지를 나타내는 자리입니다. ` +
        `그 자리 숫자가 ${n(digit)}이므로 ${josaNum(DEC_UNIT[at]!, "이", "가")} ${n(digit)}개인 ${josaNum(worth, "을", "를")} 나타냅니다.`,
    );
  }

  if (c === "2-3-2") {
    const x = hundredths(rng, 10, 89);
    const y = x + intBetween(rng, 1, 40);
    const sx = dec2(x);
    const sy = dec2(y);
    const at = firstDiffPlace(x, y);
    if (intBetween(rng, 0, 1) === 0) {
      return make(
        unit,
        `${josaNum(sx, "과", "와")} ${n(sy)}의 크기를 비교하여 $\\square$ 안에 알맞은 기호를 써넣으시오. ` +
          `${expr(`${sx}\\ \\square\\ ${sy}`)}`,
        expr("<"),
        `높은 자리부터 차례로 비교하면 ${at}에서 ${josaNum(sy, "이", "가")} 더 큽니다. 그러므로 ${expr(`${sx}<${sy}`)} 입니다.`,
      );
    }
    return make(
      unit,
      `${josaNum(sx, "과", "와")} ${n(sy)} 중 더 큰 수를 쓰시오.`,
      n(sy),
      `소수의 크기는 높은 자리부터 차례로 비교합니다. ${at}에서 ${josaNum(sy, "이", "가")} 더 큽니다.`,
    );
  }

  if (c === "2-3-3") {
    const base = intBetween(rng, 1, 9) * 10 + intBetween(rng, 1, 9);
    const kind = intBetween(rng, 0, 2);
    if (kind === 0) {
      return make(
        unit,
        `${n(dec2(base))}의 ${n(10)}배는 얼마인가?`,
        n(dec1(base)),
        `${n(10)}배를 하면 각 자리의 숫자가 한 자리씩 왼쪽으로 옮겨져 ` +
          `소수점이 오른쪽으로 한 자리 옮겨집니다. 그래서 ${josaNum(dec2(base), "은", "는")} ${josaNum(dec1(base), "이", "가")} 됩니다.`,
      );
    }
    if (kind === 1) {
      return make(
        unit,
        `${n(dec2(base))}의 ${n(100)}배는 얼마인가?`,
        n(base),
        `${n(100)}배를 하면 소수점이 오른쪽으로 두 자리 옮겨집니다. ` +
          `그래서 ${josaNum(dec2(base), "은", "는")} ${josaNum(base, "이", "가")} 됩니다.`,
      );
    }
    return make(
      unit,
      `${n(dec1(base))}의 $\\frac{1}{10}$은 얼마인가?`,
      n(dec2(base)),
      `$\\frac{1}{10}$을 하면 각 자리의 숫자가 한 자리씩 오른쪽으로 옮겨져 ` +
        `소수점이 왼쪽으로 한 자리 옮겨집니다. 그래서 ${josaNum(dec1(base), "은", "는")} ${josaNum(dec2(base), "이", "가")} 됩니다.`,
    );
  }

  if (c === "2-3-4") {
    const x = tenths(rng, 1, 8);
    let y = tenths(rng, 1, 8);
    if ((x + y) % 10 === 0) y = y - (y % 10) + ((y % 10) % 9) + 1;
    const sum = x + y;
    return make(
      unit,
      expr(`${dec1(x)}+${dec1(y)}=\\square`),
      n(dec1(sum)),
      `소수점끼리 자리를 맞추어 같은 자리 수끼리 더합니다. ${expr(`${dec1(x)}+${dec1(y)}=${dec1(sum)}`)}`,
    );
  }

  if (c === "2-3-5") {
    const a = tenths(rng, 3, 9);
    let b = tenths(rng, 1, 2);
    if (a % 10 === b % 10) b = b - (b % 10) + ((b % 10) % 9) + 1;
    const diff = a - b;
    return make(
      unit,
      expr(`${dec1(a)}-${dec1(b)}=\\square`),
      n(dec1(diff)),
      `소수점끼리 자리를 맞추어 같은 자리 수끼리 뺍니다. ${expr(`${dec1(a)}-${dec1(b)}=${dec1(diff)}`)}`,
    );
  }

  if (c === "2-3-6") {
    const x = hundredths(rng, 10, 59);
    let y = hundredths(rng, 10, 39);
    if ((x + y) % 10 === 0) y = y - (y % 10) + ((y % 10) % 9) + 1;
    const sum = x + y;
    return make(
      unit,
      expr(`${dec2(x)}+${dec2(y)}=\\square`),
      n(dec2(sum)),
      `소수점끼리 자리를 맞추어 소수 둘째 자리부터 차례로 더합니다. ` +
        `${expr(`${dec2(x)}+${dec2(y)}=${dec2(sum)}`)}`,
    );
  }

  if (c === "2-3-7") {
    const a = hundredths(rng, 40, 89);
    let b = hundredths(rng, 10, 35);
    if (a % 10 === b % 10) b = b - (b % 10) + ((b % 10) % 9) + 1;
    const diff = a - b;
    return make(
      unit,
      expr(`${dec2(a)}-${dec2(b)}=\\square`),
      n(dec2(diff)),
      `소수점끼리 자리를 맞추어 소수 둘째 자리부터 차례로 뺍니다. ` +
        `${expr(`${dec2(a)}-${dec2(b)}=${dec2(diff)}`)}`,
    );
  }

  return noBranch(unit);
}
/* ───────────────────────── 2-4 사각형 ───────────────────────── */

function quad(unit: UnitSeed, rng: Rng): ElemProblem {
  const c = code(unit);

  if (c === "2-4-1") {
    const kind = intBetween(rng, 0, 3);
    if (kind === 3) {
      const count = intBetween(rng, 2, 3);
      return make(
        unit,
        `직선 ㄱㄴ과 직선 ㄷㄹ이 만나서 이루는 네 각 중 한 각이 ${deg(90)}입니다. ` +
          `나머지 ${n(3)}개의 각 중 ${n(count)}개의 각의 크기를 더하면 몇 도인가?`,
        deg(90 * count),
        `두 직선이 수직으로 만나면 네 각이 모두 ${deg(90)}입니다. ${expr(`90\\times${count}=${90 * count}`)}`,
      );
    }
    if (kind === 0) {
      return make(
        unit,
        "두 직선이 만나서 이루는 각이 직각일 때 이 두 직선은 서로 무엇이라고 하는가?",
        "수직",
        `두 직선이 ${deg(90)}로 만나면 두 직선은 서로 수직이라고 합니다.`,
      );
    }
    if (kind === 1) {
      return make(
        unit,
        "직선 ㄱㄴ에 대한 수선은 직선 ㄱㄴ과 몇 도를 이루며 만나는가?",
        deg(90),
        `한 직선에 대한 수선은 그 직선과 직각으로 만납니다. 직각은 ${deg(90)}입니다.`,
      );
    }
    return make(
      unit,
      "직사각형에서 한 변에 수직인 변은 몇 개인가?",
      n(2),
      `직사각형은 네 각이 모두 직각이므로 한 변과 만나는 두 변이 모두 그 변에 수직입니다.`,
    );
  }

  if (c === "2-4-2") {
    const kind = intBetween(rng, 0, 3);
    if (kind === 3) {
      return make(
        unit,
        "평행한 두 직선을 양쪽으로 아무리 길게 늘이면 두 직선이 만나는 점은 몇 개인가?",
        `${n(0)}개`,
        `평행한 두 직선은 아무리 늘여도 만나지 않습니다. 그러므로 만나는 점은 ${n(0)}개입니다.`,
      );
    }
    if (kind === 0) {
      return make(
        unit,
        "서로 만나지 않는 두 직선을 무엇이라고 하는가?",
        "평행선",
        "한 평면에서 아무리 늘여도 만나지 않는 두 직선을 평행하다고 하고, 그 두 직선을 평행선이라고 합니다.",
      );
    }
    if (kind === 1) {
      return make(
        unit,
        "한 직선에 수직인 두 직선은 서로 어떤 관계인가?",
        "평행",
        "한 직선에 수직인 두 직선은 아무리 늘여도 만나지 않으므로 서로 평행합니다.",
      );
    }
    return make(
      unit,
      "직사각형에서 서로 평행한 변은 몇 쌍인가?",
      n(2),
      `직사각형은 마주 보는 두 변끼리 평행하므로 평행한 변이 ${n(2)}쌍 있습니다.`,
    );
  }

  if (c === "2-4-3") {
    const dist = intBetween(rng, 3, 12);
    const kind = intBetween(rng, 0, 2);
    if (kind === 0) {
      return make(
        unit,
        `평행한 두 직선 사이에 수선을 그었더니 길이가 ${cm(dist)}였습니다. 이 평행선 사이의 거리는 몇 cm인가?`,
        cm(dist),
        `평행선 사이의 거리는 평행선 사이에 그은 수선의 길이입니다. 그러므로 ${cm(dist)}입니다.`,
      );
    }
    if (kind === 1) {
      const count = intBetween(rng, 2, 5);
      return make(
        unit,
        `평행한 두 직선 사이에 수선을 ${n(count)}개 그었습니다. 이 수선들의 길이는 서로 어떠한가?`,
        "모두 같다",
        "평행선 사이에 그은 수선의 길이는 어디에서 재어도 모두 같습니다.",
      );
    }
    return make(
      unit,
      `평행선 사이의 거리가 ${cm(dist)}일 때, 두 평행선 사이에 그은 수선이 아닌 비스듬한 선분의 길이는 ` +
        `${cm(dist)}보다 긴가, 짧은가?`,
      "길다",
      `평행선 사이에서 가장 짧은 선분이 수선입니다. 그러므로 비스듬한 선분은 ${cm(dist)}보다 깁니다.`,
    );
  }

  if (c === "2-4-4") {
    const kind = intBetween(rng, 0, 2);
    if (kind === 0) {
      return make(
        unit,
        "평행한 변이 한 쌍이라도 있는 사각형을 무엇이라고 하는가?",
        "사다리꼴",
        "평행한 변이 한 쌍이라도 있으면 사다리꼴입니다.",
      );
    }
    if (kind === 1) {
      return make(
        unit,
        "평행사변형은 사다리꼴이라고 할 수 있는가? 맞으면 '예', 아니면 '아니요'를 쓰시오.",
        "예",
        "평행사변형은 평행한 변이 두 쌍이므로 한 쌍이라도 평행하다는 조건을 만족합니다. 그러므로 사다리꼴입니다.",
      );
    }
    return make(
      unit,
      "그림에서 사다리꼴의 기호를 쓰시오.",
      "가",
      "가는 위쪽 변과 아래쪽 변이 서로 평행합니다. 나는 평행한 변이 한 쌍도 없습니다.",
      fig("namedShapes", {
        items: [
          { shape: "trap", label: "가" },
          { shape: "irregQuad", label: "나" },
        ],
      }),
    );
  }

  if (c === "2-4-5") {
    const kind = intBetween(rng, 0, 2);
    const a = pick(rng, [50, 55, 60, 65, 70, 75, 80, 110, 115, 120, 125, 130]);
    if (kind === 0) {
      return make(
        unit,
        `평행사변형의 한 각의 크기가 ${deg(a)}입니다. 이 각과 이웃한 각의 크기는 몇 도인가?`,
        deg(180 - a),
        `평행사변형에서 이웃한 두 각의 크기의 합은 ${deg(180)}입니다. ${expr(`180-${a}=${180 - a}`)}`,
      );
    }
    if (kind === 1) {
      return make(
        unit,
        `평행사변형의 한 각의 크기가 ${deg(a)}입니다. 이 각과 마주 보는 각의 크기는 몇 도인가?`,
        deg(a),
        `평행사변형은 마주 보는 두 각의 크기가 서로 같습니다. 그러므로 ${deg(a)}입니다.`,
      );
    }
    const x = intBetween(rng, 4, 12);
    const y = intBetween(rng, 3, 11);
    return make(
      unit,
      `평행사변형에서 이웃한 두 변의 길이가 ${cm(x)}, ${cm(y)}입니다. 네 변의 길이의 합은 몇 cm인가?`,
      cm((x + y) * 2),
      `평행사변형은 마주 보는 두 변의 길이가 같으므로 ${expr(`(${x}+${y})\\times2=${(x + y) * 2}`)} 입니다.`,
    );
  }

  if (c === "2-4-6") {
    const kind = intBetween(rng, 0, 2);
    if (kind === 0) {
      return make(
        unit,
        "네 변의 길이가 모두 같은 사각형을 무엇이라고 하는가?",
        "마름모",
        "네 변의 길이가 모두 같은 사각형을 마름모라고 합니다.",
      );
    }
    if (kind === 1) {
      const side = intBetween(rng, 4, 13);
      return make(
        unit,
        `한 변이 ${cm(side)}인 마름모의 네 변의 길이의 합은 몇 cm인가?`,
        cm(side * 4),
        `마름모는 네 변의 길이가 모두 같으므로 ${expr(`${side}\\times4=${side * 4}`)} 입니다.`,
      );
    }
    return make(
      unit,
      "그림에서 네 변의 길이가 모두 같은 사각형의 기호를 쓰시오.",
      "가",
      "가는 네 변의 길이가 모두 같습니다. 나는 이웃한 두 변의 길이가 다릅니다.",
      fig("namedShapes", {
        items: [
          { shape: "tallDiamond", label: "가" },
          { shape: "rect", label: "나" },
        ],
      }),
    );
  }

  if (c === "2-4-7") {
    const kind = intBetween(rng, 0, 3);
    if (kind === 0) {
      return make(
        unit,
        "네 각이 모두 직각이고 네 변의 길이도 모두 같은 사각형을 무엇이라고 하는가?",
        "정사각형",
        "네 각이 모두 직각인 사각형은 직사각형이고, 그중 네 변의 길이까지 같은 것이 정사각형입니다.",
      );
    }
    if (kind === 1) {
      return make(
        unit,
        "직사각형은 평행사변형이라고 할 수 있는가? 맞으면 '예', 아니면 '아니요'를 쓰시오.",
        "예",
        "직사각형은 마주 보는 두 쌍의 변이 서로 평행하므로 평행사변형입니다.",
      );
    }
    if (kind === 2) {
      return make(
        unit,
        "정사각형은 마름모라고 할 수 있는가? 맞으면 '예', 아니면 '아니요'를 쓰시오.",
        "예",
        "정사각형은 네 변의 길이가 모두 같으므로 마름모입니다.",
      );
    }
    const side = intBetween(rng, 4, 13);
    return make(
      unit,
      `한 변이 ${cm(side)}인 정사각형의 네 변의 길이의 합은 몇 cm인가?`,
      cm(side * 4),
      `정사각형은 네 변의 길이가 모두 같으므로 ${expr(`${side}\\times4=${side * 4}`)} 입니다.`,
    );
  }

  return noBranch(unit);
}
/* ─────────────────────── 2-5 꺾은선그래프 ─────────────────────── */

type TimeLabel = { text: string; math: string };
/**
 * 꺾은선 소재. **값의 크기는 소재마다 다르다** — 그래서 범위를 소재가 들고 있다.
 *
 * ⚠️ 예전에는 소재와 무관하게 한 범위(첫값 9~14)를 같이 썼다. 그래서 **「강아지의 무게가
 * 1개월에 9~14kg」** 이 표본의 100%, **「박물관 월 관람객이 9~32명」** 이 100% 였다
 * (2026-08-22 실측). 갓난 강아지는 그 무게가 아니고 박물관은 그 인원이 아니다.
 * 초5 평균이 「키 $33$cm」로 겪은 것과 **같은 뿌리**다(`AVG_TOPICS`).
 *
 * - `base` · `step` — 첫값은 `base` 에서 골라 `step` 을 곱한다. 이후 값도 `step` 의 배수라
 *   지면에 **읽히는 수**만 나온다(`237` 이 아니라 `250`). 원장님: 「큰 눈금 써도 된다」.
 * - `rising` — 키·무게처럼 **자라기만 하는** 것은 내려가지 않는다.
 *   기온·관람객 수·비의 양은 오르내려도 된다.
 */
type LineTheme = {
  topic: string;
  unit: string;
  labels: readonly TimeLabel[];
  base: readonly [number, number];
  step: number;
  rising?: boolean;
  /**
   * 그림에 그려질 **세로 눈금 한 칸**(D-70). `step`(값의 배수)과 **다른 것**이다.
   *
   * `step` 을 그대로 걸음으로 실으면 눈금이 24~33줄이 되어 엔진이 던진다
   * (`MAX_Y_TICKS = 9`, 즉 **최댓값 ≤ 8 × 걸음**이어야 한다).
   * 실측: 기온 33줄 · 강낭콩 24줄 · 박물관 **33줄**. 그래서 꺾은선은 걸음을 따로 정한다.
   *
   * ⚠️ 그 결과 **꺾은선 값은 눈금선 위에 없다**(`step` 이 `yStep` 보다 잘다).
   * 그래서 꺾은선에는 「몇 칸인가」를 묻지 않는다 — 「한 칸은 몇 …인가」만 묻는다.
   * 막대는 값이 걸음의 배수라 「몇 칸인가」까지 물을 수 있다.
   */
  yStep: number;
};

/** 그림의 축 이름은 `3월`, 본문은 `$3$월`. 본문에 날 숫자를 남기지 않는다(R1). */
function timeLabels(values: readonly number[], suffix: string): TimeLabel[] {
  return values.map((v) => ({
    text: `${v}${suffix}`,
    math: `${n(v)}${suffix}`,
  }));
}

/**
 * 꺾은선그래프 소재. 막대와 같은 이유로 **한 줄로 편다** — 무리로 묶었을 때
 * 「강낭콩의 키」·「고구마 싹의 키」가 한 번도 안 나오고 있었다(실측 0/1200).
 */
const LINE_THEMES: readonly LineTheme[] = [
  {
    topic: "교실의 기온",
    unit: "℃",
    labels: timeLabels([3, 4, 5, 6, 7], "월"),
    base: [9, 14],
    step: 1,
    yStep: 5,
  },
  {
    topic: "운동장의 기온",
    unit: "℃",
    labels: timeLabels([9, 10, 11, 12, 1], "시"),
    base: [10, 15],
    step: 1,
    yStep: 5,
  },
  {
    topic: "강낭콩의 키",
    unit: "cm",
    labels: timeLabels([5, 10, 15, 20, 25], "일"),
    base: [3, 5],
    step: 2,
    yStep: 10,
    rising: true,
  },
  {
    topic: "고구마 싹의 키",
    unit: "cm",
    labels: timeLabels([1, 2, 3, 4, 5], "주"),
    base: [4, 7],
    step: 2,
    yStep: 10,
    rising: true,
  },
  {
    topic: "도서관에 온 학생 수",
    unit: "명",
    labels: ["월", "화", "수", "목", "금"].map((d) => ({
      text: `${d}요일`,
      math: `${d}요일`,
    })),
    base: [8, 12],
    step: 2,
    yStep: 10,
  },
  {
    // **되살렸다** (2026-08-22). 한때 뺐던 소재다 — 월 관람객은 수백~수천이라야
    // 자연스러운데 `_y_step` 이 5에서 멈춰 눈금이 231줄이 되어 지면을 못 읽었다.
    // 그림 세션이 `_axis_top` 으로 걸음을 사다리 삼게 고쳐, 실측으로 `yMax 1153` 이
    // **7줄**(`0·200·…·1200`)로 나온다. 원장님: 「큰 눈금 써도 된다」.
    topic: "박물관에 온 관람객 수",
    unit: "명",
    labels: timeLabels([1, 2, 3, 4, 5], "월"),
    base: [8, 14],
    step: 50,
    // 최댓값 1,600 · 걸음 200 → 눈금 9줄(`MAX_Y_TICKS`). **여유가 없다** —
    // `base` 나 `step` 을 키우면 엔진이 던진다. 아래 「눈금 줄 수」 시험이 먼저 잡는다.
    yStep: 200,
  },
  {
    // 박물관을 뺐던 동안 대신 넣었던 소재. 되살린 뒤에도 **함께 둔다** — 소재가 하나
    // 늘어 다양해지고, 규모가 작은 쪽도 있어야 지면이 한쪽으로 쏠리지 않는다.
    topic: "우리 반이 읽은 책 수",
    unit: "권",
    labels: timeLabels([1, 2, 3, 4, 5], "월"),
    base: [6, 10],
    step: 2,
    yStep: 10,
  },
  {
    topic: "강아지의 무게",
    unit: "kg",
    // 중형견 기준 — 1개월 2~4kg, 5개월에 20kg 안팎. 갓난 강아지가 9kg 이던 자리다.
    labels: timeLabels([1, 2, 3, 4, 5], "개월"),
    base: [2, 4],
    step: 1,
    yStep: 5,
    rising: true,
  },
  {
    topic: "하루 동안 내린 비의 양",
    unit: "mm",
    labels: timeLabels([6, 7, 8, 9, 10], "일"),
    base: [8, 12],
    step: 2,
    yStep: 10,
  },
];

/**
 * 시험이 **「적어 둔 소재가 전부 실제로 나오는가」**를 손 목록 없이 세도록 내보낸다.
 * 손으로 나열한 목록은 샌다 — 세는 쪽과 만드는 쪽이 **같은 배열**을 봐야 한다.
 */
export const G4_BAR_THEMES = BAR_THEMES;
/** 규모↔값 짝과 「해가 있는 총원」을 시험이 직접 세도록 내보낸다. */
export const G4_BAR_SCALES = BAR_SCALES;
export const G4_BAR_SPLITS = barSplits;
// 두 그래프 결합 — **아직 갈래에 배선하지 않았다**(그림 계약 대기). 시험이 여기를 직접 부른다.
export const G4_SALE_THEMES = SALE_THEMES;
export const G4_SALE_COMBO = buildSaleCombo;
export const G4_SALE_CHART_SPECS = saleChartSpecs;
export const G4_SALE_LIMITS = {
  countStep: SALE_COUNT_STEP,
  priceStep: SALE_PRICE_STEP,
  counts: SALE_COUNTS,
  prices: SALE_PRICES,
  maxTicks: SALE_MAX_TICKS,
} as const;
export const G4_LINE_THEMES = LINE_THEMES;

/**
 * 나눠 갖기를 시험이 **일부러 터뜨려 볼 수 있게** 내보낸다.
 * 「소재가 모자라면 던진다」는 가드는 터뜨려 보지 않으면 장식인지 알 수 없다.
 */
export const G4_THEME_SHARE = themeShare;

/**
 * 이웃한 값의 차가 **모두 다르게** 만든다 — 「가장 많이 변한 때」의 답이 하나여야 한다.
 *
 * 걸음은 서로 다른 넷(1~6)을 뽑아 **`step` 을 곱한다.** `step` 이 상수라 차도 서로 다름이
 * 그대로 보존되고, 모든 값이 `step` 의 배수라 지면에 읽히는 수만 나온다.
 * (자동으로 지켜지더라도 시험은 따로 둔다 — `step` 이 상수가 아니게 되면 조용히 깨진다.)
 */
function lineValues(rng: Rng, theme: LineTheme): number[] {
  const pool = [1, 2, 3, 4, 5, 6];
  const rest = [...pool];
  const steps: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    steps.push(rest.splice(intBetween(rng, 0, rest.length - 1), 1)[0]!);
  }
  const first = intBetween(rng, theme.base[0], theme.base[1]) * theme.step;
  // 자라는 것(키·무게)은 줄어들 수 없다. 기온·관람객 수는 오르내려도 된다.
  const dip = !theme.rising && intBetween(rng, 0, 1) === 0;
  const signs = [1, 1, dip ? -1 : 1, 1];
  const walk = (ss: number[]) => {
    const out = [first];
    for (let i = 0; i < 4; i += 1) {
      out.push(out[i]! + steps[i]! * ss[i]! * theme.step);
    }
    return out;
  };
  const vals = walk(signs);
  // 값이 겹치면 「가장 높은 때」의 답이 둘이 되고, 0 이하는 세상에 없는 값이다 — 오르막으로 다시.
  if (new Set(vals).size !== vals.length || Math.min(...vals) < theme.step) {
    return walk([1, 1, 1, 1]);
  }
  return vals;
}

function lineGraph(unit: UnitSeed, rng: Rng): ElemProblem {
  const c = code(unit);
  const theme = pick(rng, themeShare(unit, LINE_THEMES));
  const nums = lineValues(rng, theme);
  const values = theme.labels.map((label, i) => ({
    label: label.text,
    value: nums[i]!,
  }));
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const topLabel = theme.labels[nums.indexOf(max)]!;
  /** 값이 늘어난 구간 수. 이웃한 값이 같은 경우는 없다(나눔·걸음 조건이 막는다). */
  const rises = nums.slice(1).filter((v, i) => v > nums[i]!).length;
  const figure = fig("lineChart", {
    values,
    yMax: max + 3,
    yStep: theme.yStep,
    yLabel: theme.unit,
  });
  const intro = `${josa(theme.topic, "을", "를")} 조사하여 나타낸 꺾은선그래프입니다.`;

  if (c === "2-5-1") {
    if (intBetween(rng, 0, 1) === 0) {
      const at = intBetween(rng, 0, theme.labels.length - 1);
      const label = theme.labels[at]!;
      return make(
        unit,
        `${intro} ${label.math}의 ${josa(theme.topic, "은", "는")} 몇 ${theme.unit}인가?`,
        `${n(nums[at]!)}${theme.unit}`,
        // ⚠️ 「**눈금** ${v} 에 있으므로」 라고 쓰지 않는다. 꺾은선 값은 `theme.step` 의
        // 배수인데 **그려지는 눈금은 `_y_step` 이 따로 정하므로**(대개 더 성기다) 값이
        // 눈금선 위에 없는 경우가 대부분이다 — 실측 6,000점 중 4,760점.
        // 「눈금 사이를 읽는 것」이 오히려 이 학년이 배우는 것이라, 점의 값만 말한다.
        `${label.math}의 점이 가리키는 값은 ${n(nums[at]!)}${theme.unit}입니다.`,
        figure,
      );
    }
    return make(
      unit,
      `${intro} ${theme.topic}의 값이 가장 큰 때는 언제인가?`,
      topLabel.math,
      `점이 가장 높이 찍힌 때는 ${topLabel.math}이고 그때의 값은 ${n(max)}${theme.unit}입니다.`,
      figure,
    );
  }

  if (c === "2-5-2") {
    if (intBetween(rng, 0, 1) === 0) {
      let at = 0;
      for (let i = 1; i < nums.length - 1; i += 1) {
        if (
          Math.abs(nums[i + 1]! - nums[i]!) >
          Math.abs(nums[at + 1]! - nums[at]!)
        )
          at = i;
      }
      const change = Math.abs(nums[at + 1]! - nums[at]!);
      return make(
        unit,
        `${intro} ${theme.topic}의 값이 가장 많이 변한 때는 어느 때와 어느 때 사이인가?`,
        `${theme.labels[at]!.math}과 ${theme.labels[at + 1]!.math} 사이`,
        `${theme.labels[at]!.math}과 ${theme.labels[at + 1]!.math} 사이에서 선이 가장 가파릅니다. ` +
          `${expr(`${Math.max(nums[at]!, nums[at + 1]!)}-${Math.min(nums[at]!, nums[at + 1]!)}=${change}`)} 만큼 변했습니다.`,
        figure,
      );
    }
    const first = nums[0]!;
    const last = nums[nums.length - 1]!;
    const rise = last >= first;
    return make(
      unit,
      `${intro} ${theme.labels[theme.labels.length - 1]!.math}의 값은 ` +
        `${theme.labels[0]!.math}의 값보다 몇 ${theme.unit} 더 ${rise ? "큰가" : "작은가"}?`,
      `${n(Math.abs(last - first))}${theme.unit}`,
      `${expr(`${Math.max(first, last)}-${Math.min(first, last)}=${Math.abs(last - first)}`)} 이므로 ` +
        `${n(Math.abs(last - first))}${theme.unit} 더 ${rise ? "큽니다" : "작습니다"}.`,
      figure,
    );
  }

  if (c === "2-5-3") {
    const kind = intBetween(rng, 0, 2);
    if (kind === 0) {
      // D-70. 꺾은선은 **「한 칸은 몇 …인가」만** 묻는다 — 값이 `theme.step` 의 배수인데
      // 걸음은 그보다 성기어(`yStep`) **점이 눈금선 위에 없다.** 「몇 칸인가」는 답이 자연수가
      // 아니게 되므로 막대에서만 묻는다. 걸음 값은 그림에 실은 `theme.yStep` 그대로다.
      return make(
        unit,
        `${intro} 세로 눈금 한 칸은 몇 ${theme.unit}을 나타내는가?`,
        `${n(theme.yStep)}${theme.unit}`,
        `세로축 눈금이 ${n(0)}, ${n(theme.yStep)}, ${n(theme.yStep * 2)}, … 로 매겨져 있으므로 ` +
          `한 칸은 ${n(theme.yStep)}${theme.unit}입니다.`,
        figure,
      );
    }
    if (kind === 1) {
      return make(
        unit,
        `${intro} ${theme.topic}의 값이 늘어난 구간은 모두 몇 번인가?`,
        `${n(rises)}번`,
        `이웃한 두 점을 차례로 견주면 값이 늘어난 구간이 ${n(rises)}번, ` +
          `줄어든 구간이 ${n(nums.length - 1 - rises)}번입니다.`,
        figure,
      );
    }
    return make(
      unit,
      `${intro} ${theme.topic}의 값이 가장 큰 때와 가장 작은 때의 차는 몇 ${theme.unit}인가?`,
      `${n(max - min)}${theme.unit}`,
      `가장 큰 값이 ${n(max)}${theme.unit}, 가장 작은 값이 ${n(min)}${theme.unit}입니다. ` +
        `${expr(`${max}-${min}=${max - min}`)}`,
      figure,
    );
  }

  return noBranch(unit);
}
/* ───────────────────────── 2-6 다각형 ─────────────────────────
 *
 * 도형 이름은 **한자 수사**로만 쓴다(R4) — `polyName` 을 거치면 `8각형`·`정n각형` 이 나올 수 없다.
 * 초4 는 내각의 합을 배우지 않는다. 다루는 것은 변·꼭짓점·대각선의 **개수**와 길이의 합이다.
 */

function polygon(unit: UnitSeed, rng: Rng): ElemProblem {
  const c = code(unit);

  if (c === "2-6-1") {
    const sides = intBetween(rng, 5, 8);
    const kind = intBetween(rng, 0, 2);
    if (kind === 0) {
      return make(
        unit,
        `선분 ${n(sides)}개로 둘러싸인 도형의 이름을 쓰시오.`,
        polyName(sides),
        `선분으로만 둘러싸인 도형을 다각형이라고 하고, 변이 ${n(sides)}개이면 ${polyName(sides)}입니다.`,
      );
    }
    if (kind === 1) {
      return make(
        unit,
        `${polyName(sides)}의 꼭짓점은 모두 몇 개인가?`,
        `${n(sides)}개`,
        `${polyName(sides)}은 변이 ${n(sides)}개이고 꼭짓점도 ${n(sides)}개입니다.`,
      );
    }
    return make(
      unit,
      "곡선이 있는 도형도 다각형이라고 할 수 있는가? 맞으면 '예', 아니면 '아니요'를 쓰시오.",
      "아니요",
      "다각형은 선분으로만 둘러싸인 도형입니다. 곡선이 있으면 다각형이 아닙니다.",
    );
  }

  if (c === "2-6-2") {
    const sides = intBetween(rng, 5, 8);
    const side = intBetween(rng, 3, 9);
    const kind = intBetween(rng, 0, 2);
    if (kind === 0) {
      return make(
        unit,
        `한 변이 ${cm(side)}인 ${polyName(sides, true)}의 모든 변의 길이의 합은 몇 cm인가?`,
        cm(side * sides),
        `${polyName(sides, true)}은 변이 ${n(sides)}개이고 길이가 모두 같습니다. ` +
          `${expr(`${side}\\times${sides}=${side * sides}`)}`,
      );
    }
    if (kind === 1) {
      return make(
        unit,
        `모든 변의 길이의 합이 ${cm(side * sides)}인 ${polyName(sides, true)}의 한 변은 몇 cm인가?`,
        cm(side),
        `${polyName(sides, true)}은 변이 ${n(sides)}개이고 길이가 모두 같으므로 ` +
          `${expr(`${side * sides}\\div${sides}=${side}`)} 입니다.`,
      );
    }
    return make(
      unit,
      "변의 길이가 모두 같고 각의 크기도 모두 같은 다각형을 무엇이라고 하는가?",
      "정다각형",
      "변의 길이가 모두 같고 각의 크기도 모두 같은 다각형을 정다각형이라고 합니다.",
    );
  }

  if (c === "2-6-3") {
    const sides = intBetween(rng, 4, 8);
    const diag = (sides * (sides - 3)) / 2;
    const kind = intBetween(rng, 0, 2);
    if (kind === 0) {
      return make(
        unit,
        `${polyName(sides)}에 그을 수 있는 대각선은 모두 몇 개인가?`,
        `${n(diag)}개`,
        `한 꼭짓점에서 자기 자신과 이웃한 두 꼭짓점을 뺀 ${n(sides - 3)}개에 대각선을 그을 수 있습니다. ` +
          `꼭짓점이 ${n(sides)}개인데 대각선을 두 번씩 세었으므로 ` +
          `${expr(`${sides}\\times${sides - 3}\\div2=${diag}`)} 입니다.`,
      );
    }
    if (kind === 1) {
      return make(
        unit,
        `${polyName(sides)}의 한 꼭짓점에서 그을 수 있는 대각선은 몇 개인가?`,
        `${n(sides - 3)}개`,
        `자기 자신과 이웃한 두 꼭짓점에는 대각선을 그을 수 없으므로 ` +
          `${expr(`${sides}-3=${sides - 3}`)} 개입니다.`,
      );
    }
    return make(
      unit,
      "직사각형의 두 대각선의 길이는 서로 어떠한가?",
      "같다",
      "직사각형은 두 대각선의 길이가 서로 같고, 한 대각선이 다른 대각선을 반으로 나눕니다.",
    );
  }

  if (c === "2-6-4") {
    const side = intBetween(rng, 2, 6);
    const kind = intBetween(rng, 0, 2);
    if (kind === 0) {
      return make(
        unit,
        `한 변이 ${cm(side)}인 정삼각형 모양 조각으로 한 변이 ${cm(side * 2)}인 정삼각형을 ` +
          `빈틈없이 채우려면 조각이 몇 개 필요한가?`,
        n(4),
        `한 변이 ${n(2)}배가 되면 조각은 ${expr("2\\times2=4")} 개가 필요합니다.`,
      );
    }
    if (kind === 1) {
      return make(
        unit,
        `한 변이 ${cm(side)}인 정사각형 모양 조각으로 한 변이 ${cm(side * 3)}인 정사각형을 ` +
          `빈틈없이 채우려면 조각이 몇 개 필요한가?`,
        n(9),
        `한 변이 ${n(3)}배가 되면 조각은 ${expr("3\\times3=9")} 개가 필요합니다.`,
      );
    }
    return make(
      unit,
      `${polyName(6, true)} 모양은 정삼각형 모양 조각 몇 개로 빈틈없이 채울 수 있는가?`,
      `${n(6)}개`,
      `${polyName(6, true)}의 한가운데에서 각 꼭짓점으로 선분을 그으면 정삼각형이 ${n(6)}개 생깁니다.`,
    );
  }

  return noBranch(unit);
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
