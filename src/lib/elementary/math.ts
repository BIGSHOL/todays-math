export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y !== 0) {
    const n = x % y;
    x = y;
    y = n;
  }
  return x === 0 ? 1 : x;
}

export function lcm(a: number, b: number): number {
  return Math.abs(Math.trunc(a) * Math.trunc(b)) / gcd(a, b);
}

export function simplify(n: number, d: number): [number, number] {
  if (d === 0) throw new Error("분모 0");
  const g = gcd(n, d);
  const den = d / g;
  const num = n / g;
  return den < 0 ? [-num, -den] : [num, den];
}

export function fmtFrac(n: number, d: number): string {
  const [num, den] = simplify(n, d);
  if (den === 1) return String(num);
  if (Math.abs(num) > den) {
    const whole = Math.trunc(num / den);
    const rem = Math.abs(num % den);
    if (rem === 0) return String(whole);
    return `${whole}\\frac{${rem}}{${den}}`;
  }
  return `\\frac{${num}}{${den}}`;
}

export function addFrac(n1: number, d1: number, n2: number, d2: number): [number, number] {
  return simplify(n1 * d2 + n2 * d1, d1 * d2);
}

export function subFrac(n1: number, d1: number, n2: number, d2: number): [number, number] {
  return simplify(n1 * d2 - n2 * d1, d1 * d2);
}

export function mulFrac(n1: number, d1: number, n2: number, d2: number): [number, number] {
  return simplify(n1 * n2, d1 * d2);
}

export function divFrac(n1: number, d1: number, n2: number, d2: number): [number, number] {
  if (n2 === 0) throw new Error("0으로 나눔");
  return simplify(n1 * d2, d1 * n2);
}

export function roundTo(value: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round((value + Number.EPSILON) * p) / p;
}

export function fmtDec(value: number, digits?: number): string {
  if (digits === undefined) {
    const s = String(roundTo(value, 6));
    return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
  }
  return roundTo(value, digits).toFixed(digits);
}

export function divisors(n: number): number[] {
  const a: number[] = [];
  const m = Math.abs(Math.trunc(n));
  for (let i = 1; i <= m; i += 1) {
    if (m % i === 0) a.push(i);
  }
  return a;
}
