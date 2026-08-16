/**
 * 트랙 D — 결손 문항이 **왜** 문제은행에 없는지 사유를 가른다.
 *
 * `audit-missing-questions.ts` 는 "몇 건 없는가" 까지만 답한다. 코디네이터가 물은 건
 * 그 숫자가 진짜냐다. 적재 파이프라인이 정당하게 뺀 것과 진짜 유실을 갈라야 한다.
 *
 * 가르는 방법: 결손 문항의 HWP 소단원을 **실제 단원 트리에 다시 매핑해 본다**
 * (`mapUnitHint` — 적재가 쓴 그 함수 그대로). 학년은 그 시험지의 **이미 적재된 행**이
 * 실제로 쓴 단원에서 가져온다 — 추측이 아니라 그 편에 적용된 값이다.
 *
 *   매핑 실패 → `unclassified` 로 빠진 것. 되살리려면 단원 별칭을 늘려야 한다.
 *   매핑 성공 → 단원 때문이 아니다. 그림 미적중(`skipped_figure`) 등 다른 사유다.
 *
 *   npx tsx scripts/qa/diagnose-missing-cause.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { mapUnitHint } from "../../src/lib/import/mapUnit";

const MISSING = "scripts/qa/reports/missing-questions.json";
const HWP_DIR = "scripts/qa/reports/hwp-latex";
const SNAPSHOT = "scripts/qa/reports/db-content.jsonl";
const FIGMAP = "scripts/qa/reports/hwpx-figures.json";
const OUT = "scripts/qa/handoff/missing-cause.json";

async function main(): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const units = await prisma.unit.findMany({
    select: { id: true, grade: true, chapter: true, section: true },
  });
  // 시험지별 학년 라벨 — 그 편의 이미 적재된 행이 실제로 쓴 단원에서 얻는다.
  const unitGrade = new Map(units.map((u) => [u.id, u.grade]));
  await prisma.$disconnect();

  const examGrade = new Map<string, Map<string, number>>();
  const rl = createInterface({
    input: createReadStream(SNAPSHOT, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.source !== "past_exam" || !r.unitId) continue;
    const g = unitGrade.get(r.unitId);
    if (!g) continue;
    const eid = String(r.examId);
    if (!examGrade.has(eid)) examGrade.set(eid, new Map());
    const m = examGrade.get(eid)!;
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  /** 그 편에서 가장 많이 쓰인 학년 라벨. */
  const gradeOf = (eid: string): string | undefined => {
    const m = examGrade.get(eid);
    if (!m) return undefined;
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };

  const { missing } = JSON.parse(await readFile(MISSING, "utf-8")) as {
    missing: Array<{ examId: string; n: number; position: string; real: boolean; hasTopic: boolean }>;
  };

  const hwpCache = new Map<string, Map<number, { topic: string | null }>>();
  const load = async (eid: string) => {
    if (!hwpCache.has(eid)) {
      const qs = JSON.parse(await readFile(`${HWP_DIR}/${eid}.json`, "utf-8")).questions ?? [];
      hwpCache.set(eid, new Map(qs.map((q: { number: number; topic: string | null }) => [q.number, q])));
    }
    return hwpCache.get(eid)!;
  };

  // HWPX 에서 센 문항별 그림(hwpx_figure_map.py). 적재는 그림 파일을 못 찾으면
  // `skipped_figure` 로 뺀다 — 그림 있는 문항이 결손이면 그 사유로 설명된다.
  const figmap: Record<string, Record<string, number>> = JSON.parse(
    await readFile(FIGMAP, "utf-8"),
  );
  const hasFigure = (eid: string, n: number) => Boolean(figmap[eid]?.[String(n)]);

  const cause = {
    생성시각: new Date().toISOString(),
    대상: 0,
    소단원없음: 0,
    학년미상: 0,
    단원매핑실패: 0,
    단원매핑성공: 0,
    실체있는중간_단원매핑성공: 0,
    그중_그림있음: 0,
    그중_그림없음: 0,
  };
  const unmappedHints = new Map<string, number>();
  const mappableRows: Array<{ examId: string; n: number; hasFig: boolean }> = [];

  for (const m of missing) {
    cause.대상 += 1;
    const q = (await load(m.examId)).get(m.n);
    const topic = (q?.topic ?? "").trim();
    if (!topic) {
      cause.소단원없음 += 1;
      continue;
    }
    const grade = gradeOf(m.examId);
    if (!grade) {
      cause.학년미상 += 1;
      continue;
    }
    const mapped = mapUnitHint(topic, units, grade);
    if (mapped.status === "unclassified") {
      cause.단원매핑실패 += 1;
      unmappedHints.set(topic, (unmappedHints.get(topic) ?? 0) + 1);
    } else {
      cause.단원매핑성공 += 1;
      if (m.real && m.position === "중간") {
        cause.실체있는중간_단원매핑성공 += 1;
        if (hasFigure(m.examId, m.n)) cause.그중_그림있음 += 1;
        else cause.그중_그림없음 += 1;
        mappableRows.push({ examId: m.examId, n: m.n, hasFig: hasFigure(m.examId, m.n) });
      }
    }
  }

  await writeFile(
    OUT,
    JSON.stringify(
      {
        cause,
        미매핑힌트상위: [...unmappedHints.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20),
        mappableRows,
      },
      null,
      1,
    ),
    "utf-8",
  );

  const pct = (a: number) => ((a * 100) / Math.max(1, cause.대상)).toFixed(1);
  console.log("── 결손 사유 진단 ──");
  console.log(`대상 ${cause.대상}건`);
  console.log(`  소단원 없음        ${cause.소단원없음} (${pct(cause.소단원없음)}%)`);
  console.log(`  학년 미상          ${cause.학년미상} (${pct(cause.학년미상)}%)`);
  console.log(`  단원 매핑 실패     ${cause.단원매핑실패} (${pct(cause.단원매핑실패)}%)  ← unclassified 로 빠진 것`);
  console.log(`  단원 매핑 성공     ${cause.단원매핑성공} (${pct(cause.단원매핑성공)}%)  ← 단원 때문이 아니다`);
  console.log(`\n**실체 있는 중간 결손 + 단원 매핑 성공 = ${cause.실체있는중간_단원매핑성공}**`);
  console.log(
    `  ├ 그림 있음 ${cause.그중_그림있음} → 적재의 \`skipped_figure\`(그림 못 찾음)로 설명된다.` +
      " 트랙 A 가 그림을 붙이면 되살아난다",
  );
  console.log(
    `  └ 그림 없음 ${cause.그중_그림없음} → **어떤 사유로도 설명 안 된다. 이게 진짜 유실의 하한이다**`,
  );
  console.log("→", OUT);
}

void main();
