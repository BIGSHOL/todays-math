export async function loadUnits() {
  const response = await fetch("/api/units");
  if (!response.ok) throw new Error("단원 목록을 불러오지 못했습니다");
  // 계약 검증은 그대로 유지하고 **위치만** 옮긴다 (성능 수리 C-1).
  // 정적 import 면 zod + 계약 스키마(279KB)가 첫 페인트를 막는 초기 번들에 실린다.
  // 검증은 응답이 온 뒤에나 쓰이므로 여기서 불러도 늦지 않다.
  const { unitListResponseSchema } = await import("@/contracts/unit.contract");
  return unitListResponseSchema.parse(await response.json());
}
