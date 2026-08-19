/**
 * 출제에서 뺀 **269건을 무엇으로 채울지** 목록을 만든다 (읽기 전용).
 *
 *   npx tsx scripts/qa/plan-ai-replacements.ts            요약
 *   npx tsx scripts/qa/plan-ai-replacements.ts --json     scripts/qa/reports/ai-replacement-plan.json
 *
 * 원장님 확정(2026-08-19): 「AI로 새로 내자. 내부 요금제 이용하면 비용 0」
 * → **이 세션(Claude 구독)에서 직접 만든다.** DeepSeek API 는 부르지 않는다.
 *
 * ## 무엇을 채우는가 — **같은 자리로 채운다**
 *
 * 뺀 문항의 **단원 · 난이도 · 출제 형식(`questionType`) · 유형(`problemType`)** 을
 * 그대로 목표로 삼는다. 그래야 출제 엔진이 보는 분포가 뺀 만큼만 회복된다.
 * (`balanceDifficulty` 는 난이도를, `arrangeByType` 은 유형을 본다.)
 *
 * ## 🔴 새 문항은 **그 문항들을 잡아낸 바로 그 검사**를 통과해야 한다
 *
 * 269건이 빠진 이유는 「학생이 정답을 고를 수 없다」였다. 새로 만든 것이 같은 결함을
 * 가지면 아무것도 고친 게 아니다. 그래서 적재기는 `report-unusable-problems.ts` 가
 * 쓰는 판정을 **그대로 불러서** 통과한 것만 넣는다 — 새 규칙을 옮겨 적지 않는다.
 *
 * ## 원본을 베끼지 않는다
 *
 * 뺀 문항의 본문은 **깨져 있다**(보기가 안 찍혔거나 정답이 어긋났다). 그것을 AI 에게
 * 보여 주면 깨진 것을 흉내 낸다. 목록은 **단원·난이도·유형만** 넘긴다.
 */
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const LEDGER = "scripts/qa/reports/unusable-discard-lock.json";
const OUT = "scripts/qa/reports/ai-replacement-plan.json";

interface LockedRow {
  id: string;
  unitId: string | null;
  판정: string;
}

interface Need {
  unitId: string;
  unitName: string;
  difficulty: string;
  questionType: string | null;
  problemType: string;
  개수: number;
  /** 그 단원에 지금 남아 있는 출제 가능 문항 수 — 급한 정도를 본다. */
  단원풀: number;
}

async function main(): Promise<void> {
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as {
    이전상태: LockedRow[];
  };
  const ids = ledger.이전상태.map((r) => r.id);

  const rows = new Map<
    string,
    {
      unitId: string | null;
      difficulty: string;
      questionType: string | null;
      problemType: string;
    }
  >();
  for (let i = 0; i < ids.length; i += 500)
    for (const r of await prisma.problem.findMany({
      where: { id: { in: ids.slice(i, i + 500) } },
      select: {
        id: true,
        unitId: true,
        difficulty: true,
        questionType: true,
        problemType: true,
      },
    }))
      rows.set(r.id, r);

  const units = (await prisma.$queryRawUnsafe(
    `SELECT id::text AS id, grade, chapter, section FROM unit`,
  )) as { id: string; grade: string; chapter: string; section: string }[];
  const name = new Map(
    units.map((u) => [u.id, `${u.grade} ${u.chapter} > ${u.section}`]),
  );

  const pool = new Map<string, number>();
  for (const r of (await prisma.$queryRawUnsafe(
    `SELECT unit_id::text AS "unitId", count(*)::int AS n
       FROM problem
      WHERE pool = 'shared' AND review_status = 'approved'
        AND direct_use_allowed AND answer <> '(정답 없음)' AND unit_id IS NOT NULL
      GROUP BY 1`,
  )) as { unitId: string; n: number }[])
    pool.set(r.unitId, r.n);

  const need = new Map<string, Need>();
  let noUnit = 0;
  for (const id of ids) {
    const r = rows.get(id);
    if (!r?.unitId) {
      noUnit += 1;
      continue;
    }
    const key = `${r.unitId}|${r.difficulty}|${r.questionType ?? ""}|${r.problemType}`;
    const cur = need.get(key);
    if (cur) cur.개수 += 1;
    else
      need.set(key, {
        unitId: r.unitId,
        unitName: name.get(r.unitId) ?? r.unitId,
        difficulty: r.difficulty,
        questionType: r.questionType,
        problemType: r.problemType,
        개수: 1,
        단원풀: pool.get(r.unitId) ?? 0,
      });
  }

  const list = [...need.values()].sort(
    (a, b) => a.단원풀 - b.단원풀 || b.개수 - a.개수,
  );
  const total = list.reduce((s, n) => s + n.개수, 0);

  console.log(`── AI 대체 목록 (읽기 전용) ──`);
  console.log(`  뺀 문항        ${ids.length}건`);
  console.log(
    `  단원이 없는 것  ${noUnit}건 (목록에서 뺀다 — 어디를 채울지 모른다)`,
  );
  console.log(`  만들 것        ${total}건 · 묶음 ${list.length}개`);

  const byGrade = new Map<string, number>();
  const byDiff = new Map<string, number>();
  const byQType = new Map<string, number>();
  for (const n of list) {
    const g = n.unitName.split(" ")[0] ?? "?";
    byGrade.set(g, (byGrade.get(g) ?? 0) + n.개수);
    byDiff.set(n.difficulty, (byDiff.get(n.difficulty) ?? 0) + n.개수);
    byQType.set(
      n.questionType ?? "(없음)",
      (byQType.get(n.questionType ?? "(없음)") ?? 0) + n.개수,
    );
  }
  const show = (t: string, m: Map<string, number>) => {
    console.log(`\n  [${t}]`);
    for (const [k, v] of [...m].sort((a, b) => b[1] - a[1]))
      console.log(`  ${String(v).padStart(5)}  ${k}`);
  };
  show("학년·과목별", byGrade);
  show("난이도별", byDiff);
  show("출제 형식별", byQType);

  console.log(`\n  [급한 순 — 단원 풀이 얇은 곳부터]`);
  console.log(`  | 단원 | 지금 풀 | 만들 것 | 난이도 | 형식 |`);
  console.log(`  | --- | ---: | ---: | --- | --- |`);
  for (const n of list.slice(0, 15))
    console.log(
      `  | ${n.unitName} | ${n.단원풀} | ${n.개수} | ${n.difficulty} | ${n.questionType ?? "-"} |`,
    );

  if (process.argv.includes("--json")) {
    writeFileSync(
      OUT,
      JSON.stringify(
        {
          만든이유:
            "출제에서 뺀 269건을 같은 자리(단원·난이도·형식·유형)로 채운다 — 원장님 확정 2026-08-19",
          기준시각: new Date().toISOString(),
          총개수: total,
          단원없음: noUnit,
          묶음: list,
        },
        null,
        1,
      ),
      "utf8",
    );
    console.log(`\n  → ${OUT}`);
  }
  await prisma.$disconnect();
}

void main();
