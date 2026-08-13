import {
  progressResponseSchema,
  type ProgressEntity,
} from "@/contracts/class.contract";

export async function advanceProgress(
  classId: string,
): Promise<ProgressEntity> {
  const res = await fetch("/api/progress/advance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ classId }),
  });
  if (!res.ok) {
    throw new Error("다음 소단원이 없습니다");
  }
  const body = progressResponseSchema.parse(await res.json());
  return body.data;
}
