import type { DailyReviewResponse } from "@/contracts/test.contract";

/**
 * 오늘의 학생별 확인테스트 조회 (2단계 화면, D-63·D-64).
 *
 * 계약 스키마는 동적 import — 메인 대시보드 로더(C-1)와 같은 이유다.
 * 검증은 하나도 줄이지 않는다.
 */
export async function loadDailyReview(): Promise<DailyReviewResponse["data"]> {
  const [res, contract] = await Promise.all([
    fetch("/api/tests/daily-review"),
    import("@/contracts/test.contract"),
  ]);
  if (!res.ok) throw new Error("오늘의 확인테스트를 불러오지 못했습니다");
  return contract.dailyReviewResponseSchema.parse(await res.json()).data;
}
