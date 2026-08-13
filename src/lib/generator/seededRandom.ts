/**
 * 시드 기반 결정론적 유틸리티 — 출제 엔진 전용 내부 헬퍼(외부/DB/AI 의존성 없음).
 *
 * 같은 시드 문자열은 항상 같은 난수열/셔플 결과를 만든다. `Math.random()`이나
 * `Date.now()`는 절대 쓰지 않는다 — 이게 selectProblems의 "결정론" 요구(T4.1 인수 조건,
 * docs/planning/06-tasks.md)를 지키는 유일한 방법이다.
 *
 * sumaek `packages/core/src/shared/deterministic.ts`의 mulberry32 + Fisher–Yates 조합을
 * 참고해 이 프로젝트에 필요한 두 함수만 남겨 재구성했다(그대로 복사가 아님).
 */

/** FNV-1a 32bit 해시 — 문자열 시드를 정수 시드로 변환한다(외부 의존성 없는 안정 해시). */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 시드 난수 생성기 — 같은 시드는 같은 수열을 낸다. */
export function createSeededRandom(seed: string): () => number {
  let state = fnv1a(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 시드 기반 Fisher–Yates 셔플 — 원본 배열은 변경하지 않고 새 배열을 반환한다. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const random = createSeededRandom(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const temp = result[i] as T;
    result[i] = result[j] as T;
    result[j] = temp;
  }
  return result;
}
