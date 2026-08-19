import { useEffect, useState } from "react";

/**
 * 값이 **멎은 뒤에만** 따라오는 사본.
 *
 * 왜 필요한가 — 문제은행 본문 검색은 서버에서 한 번에 **277~289ms**(Seq Scan)를
 * 쓴다(`id-find-review.md` 실측). 글자마다 조회하면 네 글자에 네 번이 나가고,
 * 늦게 온 옛 응답이 새 응답을 덮는 경합까지 생긴다.
 *
 * ⚠️ 타이머는 값이 바뀔 때마다 **갈아 끼운다**(정리 함수에서 지운다). 안 그러면
 * 앞 글자의 타이머가 살아남아 「멎기 전」에 한 번 더 나간다.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
