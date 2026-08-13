import { errorResponseSchema } from "@/contracts/common.contract";

const FALLBACK = "저장하지 못했습니다.";

export async function readApiError(res: Response): Promise<string> {
  try {
    const parsed = errorResponseSchema.safeParse(await res.json());
    if (parsed.success) return parsed.data.error.message;
  } catch {
    // 본문이 JSON이 아니면 공통 문구로 접는다.
  }
  return FALLBACK;
}
