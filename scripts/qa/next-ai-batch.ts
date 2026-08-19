/**
 * 다음 배치에 **무엇을 만들지**만 한 화면으로 뽑는다 (읽기 전용).
 *
 *   npx tsx scripts/qa/next-ai-batch.ts            남은 자리 요약
 *   npx tsx scripts/qa/next-ai-batch.ts --n 12     묶음 12개까지
 *   npx tsx scripts/qa/next-ai-batch.ts --sample   단원마다 실제 문항 1건(잘라서)
 *
 * ## 왜 스크립트인가 — **토큰을 아끼려고**
 *
 * 원장님 지시(2026-08-19): 「무작정 생성하면 토큰 낭비」. 남은 것이 259건이라
 * 배치를 스무 번 넘게 더 만든다. 그때마다 269행짜리 계획 JSON 과 지난 배치를
 * 통째로 읽으면 **문항을 쓰기도 전에** 문맥이 찬다.
 *
 * 그래서 이 스크립트가 **뺄셈을 대신한다** — 계획에서 이미 만든 것을 빼고,
 * 남은 자리만 한 줄씩 찍는다. 만드는 쪽은 그 몇 줄만 보면 된다.
 *
 * ## `--sample` 이 오히려 토큰을 아낀다
 *
 * 단원명만 보고 쓰면 학년 수준·표기가 어긋나 배치가 통째로 막힐 수 있고,
 * 그러면 **다시 쓰는 값이 훨씬 비싸다.** 단원마다 기존 문항 1건을 110자로 잘라
 * 보여 주는 값(단원당 ~0.1KB)이 그 위험을 막는다. 적게 써서 크게 아낀다.
 *
 * ## 뺄셈의 함정 — 계획의 `questionType` 이 빈 값인 자리가 있다
 *
 * 계획 269건 중 39건은 원본의 출제 형식이 **비어 있다.** 그 자리는 우리가
 * 형식을 정해서 만들므로(1차는 객관식) 키가 정확히 안 맞는다. 형식까지 맞는
 * 짝이 없으면 **(단원·난이도·유형)** 으로 한 번 더 맞춰 뺀다. 안 그러면 이미
 * 만든 것을 «아직 안 만든 것»으로 읽어 같은 문항을 두 번 만든다.
 */
import { readdirSync, readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const PLAN = "scripts/qa/reports/ai-replacement-plan.json";
const DIR = "scripts/qa/ai-batches";

interface Group {
  unitId: string;
  unitName: string;
  difficulty: string;
  questionType: string | null;
  problemType: string;
  개수: number;
  단원풀: number;
}

interface Made {
  unitId: string;
  difficulty: string;
  questionType: string;
  problemType: string;
}

const argN = process.argv.indexOf("--n");
const N = argN >= 0 ? Number(process.argv[argN + 1]) : 10;
const SAMPLE = process.argv.includes("--sample");

/** 이미 만든 것을 뺀다. 형식이 빈 자리는 형식을 빼고 한 번 더 맞춘다. */
export function subtract(
  groups: readonly Group[],
  made: readonly Made[],
): Group[] {
  const left = groups.map((g) => ({ ...g }));
  const loose = (m: {
    unitId: string;
    difficulty: string;
    problemType: string;
  }) => `${m.unitId}|${m.difficulty}|${m.problemType}`;

  for (const m of made) {
    // ① 형식까지 맞는 자리 먼저.
    const exact = left.find(
      (g) =>
        g.개수 > 0 &&
        g.unitId === m.unitId &&
        g.difficulty === m.difficulty &&
        g.problemType === m.problemType &&
        (g.questionType ?? "") === m.questionType,
    );
    if (exact) {
      exact.개수 -= 1;
      continue;
    }
    // ② 없으면 «형식이 빈» 자리에서 뺀다 — 우리가 형식을 정한 자리다.
    const blank = left.find(
      (g) =>
        g.개수 > 0 && loose(g) === loose(m) && !(g.questionType ?? "").trim(),
    );
    if (blank) blank.개수 -= 1;
    // ③ 둘 다 없으면 계획에 없는 것을 만든 것이다 — 아래에서 세어 찍는다.
  }
  return left.filter((g) => g.개수 > 0);
}

async function main(): Promise<void> {
  const plan = JSON.parse(readFileSync(PLAN, "utf8")) as { 묶음: Group[] };
  const made: Made[] = [];
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".json") && !f.endsWith("-ledger.json"))
    .sort();
  for (const f of files)
    for (const d of JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")) as Made[])
      made.push(d);

  const left = subtract(plan.묶음, made);
  const 남은개수 = left.reduce((s, g) => s + g.개수, 0);
  const 계획 = plan.묶음.reduce((s, g) => s + g.개수, 0);

  console.log(`── 남은 자리 ──`);
  console.log(
    `  계획 ${계획}건 · 만든 것 ${made.length}건 (배치 ${files.length}개)`,
  );
  console.log(`  남은 것 ${남은개수}건 · 묶음 ${left.length}개`);
  if (계획 - made.length !== 남은개수)
    console.log(
      `  ⚠ 뺄셈이 안 맞는다: ${계획} - ${made.length} ≠ ${남은개수}` +
        ` — 계획에 없는 자리를 ${계획 - made.length - 남은개수}건 만들었다.`,
    );

  // 급한 순(풀이 얇은 곳) → 같은 단원이 몰린 순. 한 단원을 몰아 쓰면 토큰이 싸다.
  const perUnit = new Map<string, number>();
  for (const g of left)
    perUnit.set(g.unitId, (perUnit.get(g.unitId) ?? 0) + g.개수);
  const sorted = [...left].sort(
    (a, b) =>
      a.단원풀 - b.단원풀 ||
      (perUnit.get(b.unitId) ?? 0) - (perUnit.get(a.unitId) ?? 0) ||
      b.개수 - a.개수,
  );

  console.log(`\n  [다음에 만들 자리 — 풀이 얇은 곳 · 같은 단원이 몰린 곳]`);
  const top = sorted.slice(0, N);
  for (const g of top)
    console.log(
      `  ${g.개수}건  ${g.unitName}  [${g.difficulty}/${g.questionType || "형식빈값"}/${g.problemType}]` +
        `  풀${g.단원풀}  ${g.unitId}`,
    );

  if (!SAMPLE) return;

  const prisma = new PrismaClient();
  console.log(`\n  [수준·표기 맞추기용 표본 — 단원마다 1건]`);
  for (const id of [...new Set(top.map((g) => g.unitId))]) {
    const r = await prisma.problem.findFirst({
      where: {
        unitId: id,
        pool: "shared",
        reviewStatus: "approved",
        directUseAllowed: true,
      },
      select: { content: true },
      orderBy: { createdAt: "asc" },
    });
    const t = (r?.content ?? "(없다)").replace(/\s+/gu, " ").slice(0, 110);
    console.log(`  ${id.slice(0, 8)}  ${t}`);
  }
  await prisma.$disconnect();
}

if (process.argv[1]?.includes("next-ai-batch")) void main();
