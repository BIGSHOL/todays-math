/**
 * 단원 id → 소단원명.
 * 실제 GET /api/units 목록을 넘기면 그 목록을 쓰고, 없으면 MSW 픽스처 카탈로그로 폴백한다.
 */
import { unitId } from "@/mocks/data/ids";

const SECTIONS = [
  "유리수와 소수",
  "순환소수",
  "순환소수의 분수 표현",
  "순환소수를 포함한 식의 계산",
  "지수법칙",
  "단항식의 곱셈과 나눗셈",
  "다항식의 덧셈과 뺄셈",
  "다항식의 곱셈과 나눗셈",
  "부등식",
  "일차부등식의 풀이",
  "일차부등식의 응용",
  "일차부등식의 활용(수, 평균, 정가)",
  "일차부등식의 활용(개수, 예금액, 유리한 방법)",
  "일차부등식의 활용(속력, 도형, 기타)",
  "일차부등식의 활용(농도)",
] as const;

const BY_ID = new Map(
  SECTIONS.map((section, i) => [unitId(i + 1), section] as const),
);

export function unitSectionName(
  unitIdValue: string | null | undefined,
  units?: readonly { id: string; section: string }[],
): string {
  if (!unitIdValue) return "—";
  if (units) {
    return units.find((unit) => unit.id === unitIdValue)?.section ?? "—";
  }
  return BY_ID.get(unitIdValue) ?? "—";
}

export function adjacentUnitIds(
  selectedUnitId: string | null,
  units: readonly { id: string; orderIndex: number }[],
): { prevId: string | null; nextId: string | null } {
  if (!selectedUnitId || units.length === 0) {
    return { prevId: null, nextId: null };
  }
  const sorted = [...units].sort((a, b) => a.orderIndex - b.orderIndex);
  const index = sorted.findIndex((unit) => unit.id === selectedUnitId);
  if (index < 0) return { prevId: null, nextId: null };
  return {
    prevId: sorted[index - 1]?.id ?? null,
    nextId: sorted[index + 1]?.id ?? null,
  };
}
