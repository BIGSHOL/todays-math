import { unitListResponseSchema } from "@/contracts/unit.contract";

export async function loadUnits() {
  const response = await fetch("/api/units");
  if (!response.ok) throw new Error("단원 목록을 불러오지 못했습니다");
  return unitListResponseSchema.parse(await response.json());
}
