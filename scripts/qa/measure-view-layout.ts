/**
 * 「우리 문항이 지면에서 **기존과 비슷하게 앉는가**」 (읽기 전용).
 *
 *   npx tsx scripts/qa/measure-view-layout.ts
 *
 * 원장님 지시 2026-08-19: 「뷰가 현재 문제와 아주 유사한 수준으로 보여야함」.
 *
 * 표기 차이(보기 마커 `1.`↔`①`, `\dfrac`↔`\frac`)는 **화면을 안 바꾼다** —
 * 파서가 마커를 떼고 렌더러가 다시 붙이며(`CHOICE_MARKS`), `textPreprocess` 가
 * `\dfrac` 을 `\frac` 으로 고친다. `diff-view.ts` 로 실제 렌더를 대조해 확인했다.
 *
 * 그래서 **정말 보이는 것**을 잰다:
 *   ⑴ 보기가 2열로 앉는가 (`fitsTwoColumns`) — 1열이면 문항이 두 배로 길어진다
 *   ⑵ 문항이 차지하는 **지면 높이** (`estimateProblemPx`) 와 문항 칸을 넘는 비율
 *   ⑶ 발문 길이 · 보기 최대 길이
 * 셋 다 **제품 함수를 그대로 부른다** — 규칙을 여기 옮겨 적으면 갈린다.
 */
import { PrismaClient } from "@prisma/client";

import { fitsTwoColumns } from "../../src/lib/math/displayWidth";
import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";
import { estimateProblemPx } from "../../src/lib/printOverflow";
import { JASEUP_MEASURED_PX } from "../../src/lib/printGeometry";

const prisma = new PrismaClient();

interface Row {
  code: string;
  content: string;
}

const 칸 = JASEUP_MEASURED_PX.continuationSlot;

function shape(content: string) {
  const { question, choices } = parseProblemContent(content);
  return {
    twoCol: choices.length > 0 && fitsTwoColumns(choices),
    px: estimateProblemPx(content),
    qLen: question.length,
    maxChoice: choices.reduce((m, c) => Math.max(m, c.length), 0),
    nChoice: choices.length,
  };
}

const pct = (n: number, d: number) => ((100 * n) / d).toFixed(1).padStart(6);
const med = (xs: number[]) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : 0;

async function main(): Promise<void> {
  const q = (extra: string, limit: number) =>
    prisma.$queryRawUnsafe(
      `SELECT problem_code AS code, content FROM problem
        WHERE pool='shared' AND question_type='객관식' ${extra}
        ORDER BY random() LIMIT ${limit}`,
    ) as Promise<Row[]>;

  const 기존 = await q(
    `AND review_status='approved' AND direct_use_allowed AND source <> 'ai_generated'`,
    2000,
  );
  const 우리 = await q(`AND source='ai_generated'`, 500);

  console.log(`  문항 칸 ${칸}px 기준\n`);
  console.log(
    `            건수   2열%   칸초과%   높이중앙  발문중앙  보기최대중앙`,
  );
  const rows: { name: string; list: Row[] }[] = [
    { name: "기존", list: 기존 },
    { name: "우리(AI)", list: 우리 },
  ];
  const shapes = new Map<string, ReturnType<typeof shape>[]>();
  for (const { name, list } of rows) {
    const s = list.map((r) => shape(r.content));
    shapes.set(name, s);
    console.log(
      `  ${name.padEnd(9)} ${String(list.length).padStart(5)} ` +
        `${pct(s.filter((x) => x.twoCol).length, s.length)} ` +
        `${pct(s.filter((x) => x.px > 칸).length, s.length)}   ` +
        `${String(med(s.map((x) => Math.round(x.px)))).padStart(7)}   ` +
        `${String(med(s.map((x) => x.qLen))).padStart(6)}   ` +
        `${String(med(s.map((x) => x.maxChoice))).padStart(8)}`,
    );
  }

  // 우리 것 중 **기존과 어긋나는 것**을 이름으로 찍는다 — 「몇 %」로는 못 고친다.
  const 기준2열 =
    shapes.get("기존")!.filter((x) => x.twoCol).length / 기존.length;
  console.log(
    `\n  [고칠 것] 기존은 ${(100 * 기준2열).toFixed(1)}% 가 2열이다.` +
      ` 1열이거나 칸을 넘는 우리 문항:`,
  );
  let n = 0;
  for (const r of 우리) {
    const s = shape(r.content);
    if (s.twoCol && s.px <= 칸) continue;
    n += 1;
    if (n <= 25)
      console.log(
        `  ${r.code}  ${s.twoCol ? "2열" : "1열"}  ${Math.round(s.px)}px${s.px > 칸 ? " ← 칸 초과" : ""}` +
          `  보기최대 ${s.maxChoice}자`,
      );
  }
  console.log(`  ─ 모두 ${n}/${우리.length}건`);
  await prisma.$disconnect();
}

if (process.argv[1]?.includes("measure-view-layout")) void main();
