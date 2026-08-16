/**
 * 트랙 F — **그 과목의 빈 단원을 채울 원본이 우리 손에 있는가.**
 *
 *   npx tsx scripts/qa/load-subject-gap.ts            # 기본 기하
 *   npx tsx scripts/qa/load-subject-gap.ts 공통수학2
 *
 * 읽기 전용. 쓰지 않는다.
 *
 * ## 왜 가르는가
 *
 * "빈 단원" 은 두 종류인데 무게가 전혀 다르다.
 *
 * | | 뜻 | 누구 일인가 |
 * |---|---|---|
 * | **이관하면 되는 것** | 트랙 D 가 뽑아 둔 원본에 그 단원 문항이 있다 | 우리가 하면 된다 |
 * | **자작해야 하는 것** | 원본 자체에 없다 | 원장님 시간이 든다 |
 *
 * 그래서 트랙 D 산출물 3,302편을 전수로 훑어 그 과목 시험지를 찾고, 그 문항의 소단원
 * 힌트를 실제 `mapUnitHint` 로 붙여 본다. 붙는 단원이 앞쪽, 안 붙는 단원이 뒤쪽이다.
 *
 * ## 이미 DB 에 있는 몫을 빼야 한다
 *
 * 원본에 있어도 이미 적재됐으면 새로 얻을 게 없다. `externalId` 로 DB 를 대조해
 * **아직 안 들어간 몫**만 "이관하면 되는 것" 으로 센다.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { mapUnitHint } from "../../src/lib/import/mapUnit";
import type { UnitLike } from "../../src/lib/import/types";
import { isDirectScript } from "../import/isDirectScript";
import { TRACK_D } from "./load-candidates";
import { unitGrade, type HwpQuestion, type Pair } from "./load-survey";

const MIN_REAL = 40;
const MISSING_ANSWER = "(정답 없음)";
/** 시험지 한 장 기본 문항 수. 이 아래는 그 단원만으로 시험지가 안 나온다. */
const TEST_SIZE = 8;

interface UnitRow {
  unit: UnitLike & { chapter: string; section: string; orderIndex: number };
  현재자격: number;
  코퍼스: number;
  코퍼스_미적재: number;
  코퍼스_미적재_정답있음: number;
}

export async function runSubjectGap(targetGrade: string): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const allUnits = await prisma.unit.findMany({
      select: { id: true, grade: true, chapter: true, section: true, orderIndex: true },
    });
    const units = allUnits.filter((u) => u.grade === targetGrade);
    if (units.length === 0) throw new Error(`'${targetGrade}' 학년 단원이 없습니다.`);

    // 현재 출제 자격 (findEligibleProblems 와 같은 조건)
    const 자격 = new Map<string, number>();
    for (const g of await prisma.problem.groupBy({
      by: ["unitId"],
      where: {
        unitId: { in: units.map((u) => u.id) },
        pool: "shared",
        reviewStatus: "approved",
        directUseAllowed: true,
        answer: { not: MISSING_ANSWER },
      },
      _count: { _all: true },
    })) {
      자격.set(g.unitId, g._count._all);
    }

    // 이미 DB 에 있는 externalId 전량 (대조용)
    const inDb = new Set<string>();
    for (let skip = 0; ; skip += 5000) {
      const page = await prisma.problem.findMany({
        skip,
        take: 5000,
        orderBy: { id: "asc" },
        where: { externalId: { not: null } },
        select: { externalId: true },
      });
      if (page.length === 0) break;
      for (const r of page) if (r.externalId) inDb.add(r.externalId);
      if (page.length < 5000) break;
    }

    // ── 코퍼스 전수 훑기 ──────────────────────────────────────────────────────
    const meta = new Map<string, Pair>();
    for (const file of ["final-pairs.json", "final-pairs-extra.json"]) {
      try {
        const j = JSON.parse(await readFile(path.join(TRACK_D, file), "utf8")) as {
          pairs: Pair[];
        };
        for (const p of j.pairs) meta.set(String(p.examId), p);
      } catch {
        // 없으면 파일 자체 meta 로 떨어진다
      }
    }

    const latexDir = path.join(TRACK_D, "hwp-latex");
    const files = (await readdir(latexDir)).filter((f) => f.endsWith(".json"));

    const perUnit = new Map<string, { total: number; missing: number; missingWithAnswer: number }>();
    const unmappedHints = new Map<string, number>();
    let papers = 0;
    let questions = 0;
    let real = 0;
    let withTopic = 0;
    let mapped = 0;
    let mappedElsewhere = 0;

    for (const file of files) {
      const examId = file.replace(/\.json$/, "");
      const paper = JSON.parse(
        await readFile(path.join(latexDir, file), "utf8"),
      ) as { questions?: HwpQuestion[]; meta?: Record<string, unknown> };
      const m = meta.get(examId);
      const level = (m?.level ?? paper.meta?.level ?? null) as string | null;
      const grade = (m?.grade ?? paper.meta?.grade ?? null) as number | null;
      const subject = (m?.subject ?? paper.meta?.subject ?? null) as string | null;
      if (unitGrade(level, grade, subject) !== targetGrade) continue;

      papers += 1;
      for (const q of paper.questions ?? []) {
        questions += 1;
        if ((q.stem ?? "").trim().length < MIN_REAL) continue;
        real += 1;
        const hint = (q.topic ?? "").trim();
        if (!hint) continue;
        withTopic += 1;
        const hit = mapUnitHint(hint, allUnits, targetGrade);
        if (hit.status !== "mapped") {
          unmappedHints.set(hint, (unmappedHints.get(hint) ?? 0) + 1);
          continue;
        }
        mapped += 1;
        const unit = allUnits.find((u) => u.id === hit.unitId);
        if (!unit || unit.grade !== targetGrade) {
          mappedElsewhere += 1;
          continue;
        }
        const slot = perUnit.get(hit.unitId) ?? { total: 0, missing: 0, missingWithAnswer: 0 };
        slot.total += 1;
        if (!inDb.has(`${examId}-${q.number}`)) {
          slot.missing += 1;
          if ((q.answer ?? "").trim()) slot.missingWithAnswer += 1;
        }
        perUnit.set(hit.unitId, slot);
      }
    }

    const rows: UnitRow[] = units
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((u) => {
        const c = perUnit.get(u.id) ?? { total: 0, missing: 0, missingWithAnswer: 0 };
        return {
          unit: u,
          현재자격: 자격.get(u.id) ?? 0,
          코퍼스: c.total,
          코퍼스_미적재: c.missing,
          코퍼스_미적재_정답있음: c.missingWithAnswer,
        };
      });

    const 못쓰는단원 = rows.filter((r) => r.현재자격 < TEST_SIZE);
    const 이관하면됨 = 못쓰는단원.filter((r) => r.코퍼스_미적재 > 0);
    const 자작필요 = 못쓰는단원.filter((r) => r.코퍼스_미적재 === 0);

    console.log(`── '${targetGrade}' 빈 단원을 채울 원본이 있는가 ──`);
    console.log(
      `코퍼스 ${files.length}편 중 '${targetGrade}' 시험지 **${papers}편** · 문항 ${questions}` +
        ` (실체 ${real} · 소단원 있음 ${withTopic} · 매핑 ${mapped})`,
    );
    console.log(
      `단원 ${rows.length} · 못 쓰는 단원(<${TEST_SIZE}) ${못쓰는단원.length}` +
        ` → **이관하면 됨 ${이관하면됨.length} · 자작 필요 ${자작필요.length}**`,
    );

    console.log(`\n[이관하면 되는 단원 ${이관하면됨.length}]  현재자격 → 코퍼스에 남은 몫`);
    for (const r of 이관하면됨.sort((a, b) => b.코퍼스_미적재 - a.코퍼스_미적재)) {
      console.log(
        `  ${String(r.현재자격).padStart(3)} → +${String(r.코퍼스_미적재).padStart(3)}` +
          ` (정답있음 ${r.코퍼스_미적재_정답있음})  ${r.unit.chapter} / ${r.unit.section}`,
      );
    }

    console.log(`\n[원본이 없어 자작해야 하는 단원 ${자작필요.length}]`);
    for (const r of 자작필요) {
      console.log(`  ${String(r.현재자격).padStart(3)}   ${r.unit.chapter} / ${r.unit.section}`);
    }

    if (unmappedHints.size > 0) {
      const top = [...unmappedHints.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      const totalUnmapped = [...unmappedHints.values()].reduce((a, b) => a + b, 0);
      console.log(
        `\n[힌트는 있는데 트리에 못 붙은 문항 ${totalUnmapped}] — 붙이면 위 숫자가 더 는다`,
      );
      for (const [hint, n] of top) console.log(`  ${String(n).padStart(4)}  ${hint}`);
    }
    if (mappedElsewhere > 0) {
      console.log(`\n⚠️ '${targetGrade}' 시험지인데 다른 학년 단원에 붙은 문항 ${mappedElsewhere}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  const arg = process.argv[2];
  runSubjectGap(arg && !arg.startsWith("-") ? arg : "기하").catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
