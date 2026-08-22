import type { Rng } from "./types";

export function createRng(seed: number): Rng {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function intBetween(rng: Rng, min: number, max: number): number {
  if (max < min) throw new Error("intBetween 범위가 뒤집혔습니다");
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick 대상이 없습니다");
  return items[intBetween(rng, 0, items.length - 1)]!;
}
