/**
 * 실제 출제에 나오는 **그래프 스펙 전수**를 덤프한다.
 *
 * 「지금 잘 나오는 장은 한 픽셀도 안 바뀐다」를 증명하려면 분모가 «yMax 종류»가
 * 아니라 **«장»** 이어야 한다. 앞서 yMax 종류마다 첫 씨앗 하나만 담은 검산기가
 * 막대(yMax 18 · 데이터 최댓값 16)를 통째로 놓쳤다 — 같은 yMax 라도 값이 다르면
 * 다른 장이고, **뜨는지 안 뜨는지를 정하는 것은 yMax 가 아니라 값**이다.
 *
 *   npx tsx scripts/qa/probe-elem-charts.ts <씨앗수> <출력 json>
 */
import { writeFileSync } from "node:fs";
import {
  elementaryUnits,
  generateElementaryProblem,
} from "@/lib/elementary/generate";

const SEED_COUNT = Number(process.argv[2] ?? 400);
const OUT = process.argv[3] ?? "charts.json";
const SEEDS = Array.from({ length: SEED_COUNT }, (_, i) => 20260821 + i * 7);

type ChartSpec = {
  kind: string;
  values: { label: string; value: number }[];
  yMax?: number;
};

const seen = new Map<
  string,
  { spec: ChartSpec; where: string; hits: number }
>();
let total = 0;
for (const unit of elementaryUnits()) {
  for (const seed of SEEDS) {
    let spec: unknown;
    try {
      spec = generateElementaryProblem(unit, seed).figureSpec;
    } catch {
      continue;
    }
    const s = spec as ChartSpec | null;
    if (!s || (s.kind !== "barChart" && s.kind !== "lineChart")) continue;
    total += 1;
    const key = JSON.stringify(s);
    const hit = seen.get(key);
    if (hit) hit.hits += 1;
    else
      seen.set(key, {
        spec: s,
        where: `${unit.grade} ${unit.section}`,
        hits: 1,
      });
  }
}

const rows = [...seen.values()];
writeFileSync(OUT, JSON.stringify(rows), "utf8");
console.log(
  `씨앗 ${SEED_COUNT} · 그래프 ${total}장 · 서로 다른 스펙 ${rows.length}가지 → ${OUT}`,
);
const kinds = new Map<string, number>();
for (const r of rows) kinds.set(r.spec.kind, (kinds.get(r.spec.kind) ?? 0) + 1);
for (const [k, v] of [...kinds].sort()) console.log(`  ${k}: ${v}가지`);
