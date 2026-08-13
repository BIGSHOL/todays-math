/**
 * T0.4 인프라 검증용 순수 함수 — 실제 기능 로직 아님.
 * 목적: Vitest 실행 + "@/*" 별칭 해석을 확인하는 샘플 테스트 전용 픽스처.
 * 실제 출제 엔진 등 기능 단위 테스트는 T0.5.3에서 작성한다.
 */
export function sum(a: number, b: number): number {
  return a + b;
}
