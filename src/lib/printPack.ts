/**
 * 문제지 지면 분할의 **부르는 자리**.
 *
 * 알맹이는 `@/lib/printOverflow` 에 있다 — 분할이 「이 문항이 이 칸에 들어가는가」를
 * 물어야 하고(원장님 확정 2026-08-21: 길면 한 장에 하나), 그 물음의 답은
 * `assessSeat` **한 곳**에서만 나와야 하기 때문이다. 분할이 제 손으로 다시 물으면
 * 조판과 판정이 다른 답을 낸다.
 *
 * 이 파일을 남겨 두는 이유는 부르는 자리(`TestPrint.tsx` 등)를 안 건드리려는 것이다.
 */
export {
  type PackedPage,
  type PackedProblemPage,
  packProblems,
} from "@/lib/printOverflow";
