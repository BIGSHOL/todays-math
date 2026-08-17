const FALLBACK = "저장하지 못했습니다.";

export async function readApiError(res: Response): Promise<string> {
  try {
    // 계약 스키마는 응답이 온 뒤에만 쓰이므로 여기서 불러온다 (성능 수리 C-1).
    // 정적 import 면 zod + 계약 모듈(279KB)이 온보딩 초기 번들에 실린다.
    const { errorResponseSchema } = await import("@/contracts/common.contract");
    const parsed = errorResponseSchema.safeParse(await res.json());
    if (parsed.success) return parsed.data.error.message;
  } catch {
    // 본문이 JSON이 아니면 공통 문구로 접는다.
  }
  return FALLBACK;
}
