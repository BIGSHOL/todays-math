/**
 * 분할이 **실제로 무엇을 내놓는가** — 변이 하네스가 「동작이 바뀌었나」를 보는 자리.
 *
 *   npx tsx scripts/qa/probe-pack-shape.ts
 *
 * ## 왜 필요한가
 *
 * 변이 시험의 순서는 ⑴ 파일이 바뀌었나 ⑵ **산출물이 바뀌었나** ⑶ 그제서야 시험이
 * 빨개지나 다. ⑵ 를 건너뛰면 **멀쩡한 가드를 의심하고 고치러 간다** — 가드가 없는
 * 것보다 나쁘다(CLAUDE.md 2026-08-21).
 *
 * 표본은 **네 부류를 다 건드린다.** 한 부류만 넣으면 그 부류를 안 건드리는 변이가
 * 「산출물이 그대로」로 나와 판정이 거부되는데, 그건 변이가 무해해서가 아니라
 * 표본이 그 자리를 안 봐서다(같은 날 배운 그 함정).
 */
import { packProblems, seatCapacities } from "../../src/lib/printOverflow";

const LINE =
  "다음 이차방정식의 해를 구하고 그 과정을 자세히 서술하시오 가나다라마바사아자";
const 본문 = (줄: number) =>
  Array.from({ length: 줄 }, () => LINE).join("\n\n");

/** 17 짧다 · 25 첫 장에서만 큼 · 30 반 칸 어디서도 큼 · 70 혼자 써도 넘침 */
const 표본 = [17, 25, 30, 17, 17, 70, 17, 25, 17, 30, 17];

const list = 표본.map((n, i) => ({ id: `p${i + 1}`, content: 본문(n) }));

console.log(
  JSON.stringify(packProblems(list).map((p) => p.problems.map((q) => q.id))),
);
console.log(JSON.stringify(seatCapacities(list)));
