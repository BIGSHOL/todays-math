/**
 * 초등 문항의 **표기** 한 곳. 생성기는 여기를 거쳐 쓰고, 가드(`rules.ts`)는 여기 결과를 검사한다.
 *
 * 왜 한 곳인가 — 표기 규칙을 생성기 230개가 각자 손으로 쓰면, 세는 쪽과 고치는 쪽이 같이 눈이 먼다.
 * 원장님 육안 검수(2026-08-22)에서 걸린 것 대부분이 「어떤 생성기는 하고 어떤 생성기는 안 한」 부류다.
 */

/** 한자 수사 — 원장님: 「8각형이 아니라 **팔각형**」(2026-08-22). */
const SINO = [
  "",
  "일",
  "이",
  "삼",
  "사",
  "오",
  "육",
  "칠",
  "팔",
  "구",
  "십",
  "십일",
  "십이",
] as const;

/**
 * 도형 이름에 쓰는 한자 수사. `3` → `"삼"`.
 *
 * 표를 넘는 수는 **던진다**. 조용히 아라비아 숫자로 떨어지면 그 자리만 `13각형` 이 되고
 * 아무도 모른다 — 못 쓰는 것은 막는 쪽이 낫다(09 §4 와 같은 태도).
 */
export function sino(n: number): string {
  const name = SINO[n];
  if (!name) throw new Error(`한자 수사 표에 없는 수입니다: ${n}`);
  return name;
}

/** `5` → `"오각형"`. `정오각형` 은 `polyName(5, true)`. */
export function polyName(n: number, regular = false): string {
  return `${regular ? "정" : ""}${sino(n)}각형`;
}

/** 수 하나를 KaTeX 로. 원장님: 「모든 숫자는 일반텍스트 말고 KaTeX」(2026-08-22). */
export function n(value: number | string): string {
  return `$${value}$`;
}

/** 이미 LaTeX 인 식을 감싼다. `expr("3\\times4=12")` → `$3\times4=12$`. */
export function expr(latex: string): string {
  return `$${latex}$`;
}

/** 단위가 붙는 수. `unitNum(4000, "g")` → `$4000\,\mathrm{g}$`. */
export function unitNum(value: number | string, unit: string): string {
  return `$${value}\\,\\mathrm{${unit}}$`;
}

/**
 * 분수를 **대분수**로. 초등은 가분수를 대분수로 고쳐 답한다.
 *
 * ⚠️ 소수로 떨어뜨리지 않는다 — 원장님이 `19\times\frac13` 의 답이
 * `6.333333333333333` 으로 나간 것을 잡으셨다(2026-08-22). 부동소수점이 지면으로 샌 자리다.
 */
export function fracLatex(num: number, den: number): string {
  if (den === 0) throw new Error("분모 0");
  const sign = num * den < 0 ? "-" : "";
  const a = Math.abs(num);
  const b = Math.abs(den);
  if (b === 1) return `${sign}${a}`;
  if (a < b) return `${sign}\\frac{${a}}{${b}}`;
  const whole = Math.floor(a / b);
  const rem = a % b;
  if (rem === 0) return `${sign}${whole}`;
  return `${sign}${whole}\\frac{${rem}}{${b}}`;
}

/**
 * 소수를 자릿수만큼. **끝없는 소수를 여기에 넣지 않는다** — 분수는 `fracLatex` 로 간다.
 * 나누어떨어지지 않는 값을 받으면 던진다(조용히 반올림하면 틀린 답이 침묵한다).
 */
export function decLatex(value: number, digits: number): string {
  const p = 10 ** digits;
  const scaled = value * p;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-9) {
    throw new Error(
      `소수 ${digits}자리로 떨어지지 않습니다: ${value} — 분수로 답하십시오`,
    );
  }
  return (Math.round(scaled) / p).toFixed(digits);
}
