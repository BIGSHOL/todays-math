import { notFound } from "next/navigation";
import { connection } from "next/server";

import { EywaDailyWireClient } from "./EywaDailyWireClient";
import day0810 from "./data-2026-08-10.json";
import day0820 from "./data-2026-08-20.json";

/**
 * eywa 연계 2단계 — **학생별 확인테스트 출제 화면** 와이어 5안 (D-07 1단계).
 *
 * 🔴 실데이터로 세운다(2026-08-19 범위 시안 교훈 — 데이터의 크기가 모양을 정한다).
 *    데이터는 `scripts/qa/measure-eywa-daily-groups.ts` 가 제품 함수 그대로
 *    (`getCurrentProgress`·`resolveDefaultReviewRange`·`findEligibleProblems`)
 *    계산해 뽑은 두 날이다:
 *      · 2026-08-10 — 최근 14일 중 **가장 많던 날** (92명·73갈래)
 *      · 2026-08-20 — **시험기간 학생이 많던 날** (78명 중 39명이 진도 대신 시험대비)
 *    학생 이름만 가명이다 — 저장소에 실명을 남기지 않는다.
 *
 * 가드는 이웃 dev 페이지와 동일 — 없으면 프로덕션에 프리렌더돼 명단이 번들에 실린다.
 */
export default async function EywaDailyWirePage() {
  await connection();

  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_RENDER_QA !== "1"
  ) {
    notFound();
  }

  return <EywaDailyWireClient days={[day0810, day0820]} />;
}
