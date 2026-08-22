import { notFound } from "next/navigation";
import { connection } from "next/server";

import chapter0810 from "../eywa-daily-wire/data-chapter-2026-08-10.json";
import chapter0820 from "../eywa-daily-wire/data-chapter-2026-08-20.json";
import { EywaDailyHifiClient } from "./EywaDailyHifiClient";

/**
 * eywa 연계 2단계 — 학생별 확인테스트 출제 화면 **Hi-fi 4안** (D-07 2단계).
 *
 * 와이어에서 원장님이 고른 **D(예외 우선)** 골격에, 같은 날 확정된 정책 둘을
 * 반영한 데이터로 그린다:
 *   · 첫 회 범위 = **현재 대단원 처음~현재** (data-chapter-*.json — 8/10 이
 *     73갈래 → 51갈래·범위 폭주 0, 대신 문항 부족 14갈래가 드러난다)
 *   · 시험기간 학생 = **표시만, 자동 출제 제외**
 *
 * 네 안은 같은 골격의 **시각 처리**만 다르다. 실제 토큰·Button 컴포넌트를 쓴다.
 */
export default async function EywaDailyHifiPage() {
  await connection();

  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_RENDER_QA !== "1"
  ) {
    notFound();
  }

  return <EywaDailyHifiClient days={[chapter0810, chapter0820]} />;
}
