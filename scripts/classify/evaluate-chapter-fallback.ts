/**
 * 세 안을 같은 자로 재서 한 표에 놓는다 (트랙 G, 코디네이터 지시 2026-08-16).
 *
 *   npx tsx scripts/classify/evaluate-chapter-fallback.ts
 *
 *   A) 소단원 직접 판정
 *   B) 중단원까지만 판정하고 그 안의 **대표 소단원**으로 붙이기
 *   C) 미분류로 두기
 *
 * ⚠️ 재는 것은 "중단원은 맞았다" 가 아니다. **대표 소단원으로 붙였을 때 진도 기준
 * 출제에서 얼마나 어긋나는가** 다. 그래서 붙인 소단원과 실제 소단원의
 * `orderIndex` 차이 분포를 낸다 — 0 이면 정확히 맞은 것이고, ±2 안이면 같은 주차쯤,
 * 멀리 벗어나면 엉뚱한 진도에 섞인 것이다.
 *
 * 결정은 원장님이 하신다. 이 스크립트는 고르지 않는다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { LABELED_FILE, OUT_DIR, TARGET_FILE, UNITS_FILE } from "./paths";
import type { Unit } from "../../src/lib/classify/types";
import { buildRepresentatives, chapterKey } from "../../src/lib/classify/chapterFallback";
import { LabeledDoc, scoreCandidates, train } from "../../src/lib/classify/unitClassifier";

const FOLDS = 5;
const TARGET_PRECISION = 0.9;
const MIN_ACCEPTED = 50;

type Doc = LabeledDoc & { number: number };

/** 판정기는 라벨을 불투명한 문자열로 다룬다 — 소단원 id 든 중단원 키든 그대로 쓴다. */
const withLabel = (doc: Doc, label: string): LabeledDoc => ({ ...doc, unitId: label });

const confidenceOf = (ranked: { score: number }[]): number => {
  if (ranked.length === 0) return 0;
  const top = ranked[0].score;
  let partition = 0;
  for (const item of ranked) partition += Math.exp(item.score - top);
  return 1 / partition;
};

type Row = {
  gradeKey: string;
  trueUnitId: string;
  trueOrder: number;
  trueChapter: string;
  unitPred: string | null;
  unitConf: number;
  chapterPred: string | null;
  chapterConf: number;
  repUnitId: string | null;
  repOrder: number | null;
};

/** 문턱을 낮춰 가며 목표 정확도를 지키는 가장 낮은 문턱을 찾는다. */
function calibrate(
  ranked: { conf: number; correct: boolean }[],
): { threshold: number; accepted: number } | null {
  const sorted = [...ranked].sort((a, b) => b.conf - a.conf);
  let correct = 0;
  let chosen: { threshold: number; accepted: number } | null = null;
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i].correct) correct += 1;
    const accepted = i + 1;
    if (accepted >= MIN_ACCEPTED && correct / accepted >= TARGET_PRECISION) {
      chosen = { threshold: sorted[i].conf, accepted };
    }
  }
  return chosen;
}

/**
 * 어긋남 기준으로 보정한다 — "붙인 것의 90% 가 진도 ±2 안" 을 지키는 가장 낮은 문턱.
 * B 를 중단원 정확도로 보정하면 A(소단원 90%)와 위험 수준이 달라 나란히 못 놓는다.
 */
function calibrateByDrift(
  ranked: { conf: number; delta: number }[],
): { threshold: number; accepted: number } | null {
  const sorted = [...ranked].sort((a, b) => b.conf - a.conf);
  let within = 0;
  let chosen: { threshold: number; accepted: number } | null = null;
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i].delta <= 2) within += 1;
    const accepted = i + 1;
    if (accepted >= MIN_ACCEPTED && within / accepted >= TARGET_PRECISION) {
      chosen = { threshold: sorted[i].conf, accepted };
    }
  }
  return chosen;
}

/** 진도 어긋남 — 붙인 소단원과 실제 소단원의 교육과정 순서 차이. */
function drift(rows: { assignedOrder: number; trueOrder: number; sameChapter: boolean }[]) {
  const deltas = rows.map((r) => Math.abs(r.assignedOrder - r.trueOrder)).sort((a, b) => a - b);
  const pct = (n: number) => (deltas.length ? Number(((n / deltas.length) * 100).toFixed(1)) : null);
  return {
    채택: deltas.length,
    정확히맞음_차0: pct(deltas.filter((d) => d === 0).length),
    차2이내: pct(deltas.filter((d) => d <= 2).length),
    차5이내: pct(deltas.filter((d) => d <= 5).length),
    차5초과: pct(deltas.filter((d) => d > 5).length),
    차_중앙값: deltas.length ? deltas[Math.floor(deltas.length / 2)] : null,
    차_90분위: deltas.length ? deltas[Math.floor(deltas.length * 0.9)] : null,
    다른중단원으로_샘: pct(rows.filter((r) => !r.sameChapter).length),
  };
}

function main() {
  const units: Unit[] = JSON.parse(readFileSync(UNITS_FILE, "utf8"));
  const unitById = new Map(units.map((u) => [u.id, u]));
  const docs: Doc[] = readFileSync(LABELED_FILE, "utf8").trim().split("\n").map((l) => JSON.parse(l));

  const examIds = [...new Set(docs.map((d) => d.examId))].sort();
  const foldOf = new Map(examIds.map((examId, i) => [examId, i % FOLDS]));
  const rows: Row[] = [];

  for (let fold = 0; fold < FOLDS; fold += 1) {
    const trainDocs = docs.filter((d) => foldOf.get(d.examId) !== fold);
    const testDocs = docs.filter((d) => foldOf.get(d.examId) === fold);

    const unitModel = train(trainDocs);
    const chapterModel = train(
      trainDocs.map((d) => {
        const u = unitById.get(d.unitId)!;
        return withLabel(d, chapterKey(u.grade, u.chapter));
      }),
    );
    // 대표 소단원도 **학습 폴드에서만** 뽑는다 — 평가 폴드를 보면 점수가 부풀려진다.
    const representatives = buildRepresentatives(trainDocs, unitById);

    for (const doc of testDocs) {
      const truth = unitById.get(doc.unitId)!;
      const unitRanked = scoreCandidates(unitModel, doc);
      const chapterRanked = scoreCandidates(chapterModel, doc);
      const chapterPred = chapterRanked[0]?.unitId ?? null;
      const repUnitId = chapterPred ? representatives.get(chapterPred) ?? null : null;
      rows.push({
        gradeKey: doc.gradeKey,
        trueUnitId: doc.unitId,
        trueOrder: truth.orderIndex,
        trueChapter: chapterKey(truth.grade, truth.chapter),
        unitPred: unitRanked[0]?.unitId ?? null,
        unitConf: confidenceOf(unitRanked),
        chapterPred,
        chapterConf: confidenceOf(chapterRanked),
        repUnitId,
        repOrder: repUnitId ? unitById.get(repUnitId)?.orderIndex ?? null : null,
      });
    }
  }

  const grades = [...new Set(rows.map((r) => r.gradeKey))];
  const report = grades.map((gradeKey) => {
    const g = rows.filter((r) => r.gradeKey === gradeKey);

    // A) 소단원 직접 — 소단원 정확도 90% 를 지키는 문턱
    const aCal = calibrate(g.filter((r) => r.unitPred).map((r) => ({ conf: r.unitConf, correct: r.unitPred === r.trueUnitId })));
    const aTaken = aCal ? g.filter((r) => r.unitPred && r.unitConf >= aCal.threshold) : [];
    const aDrift = drift(aTaken.map((r) => ({
      assignedOrder: unitById.get(r.unitPred!)!.orderIndex,
      trueOrder: r.trueOrder,
      sameChapter: chapterKey(unitById.get(r.unitPred!)!.grade, unitById.get(r.unitPred!)!.chapter) === r.trueChapter,
    })));

    // B) 중단원 + 대표 소단원 — 중단원 정확도 90% 를 지키는 문턱
    const bCal = calibrate(g.filter((r) => r.chapterPred).map((r) => ({ conf: r.chapterConf, correct: r.chapterPred === r.trueChapter })));
    const bTaken = bCal ? g.filter((r) => r.repUnitId && r.repOrder !== null && r.chapterConf >= bCal.threshold) : [];
    const bDrift = drift(bTaken.map((r) => ({
      assignedOrder: r.repOrder!,
      trueOrder: r.trueOrder,
      sameChapter: r.chapterPred === r.trueChapter,
    })));

    // B2) 같은 B 방식이되 문턱을 **어긋남 ±2 이내 90%** 로 잡은 경우
    const b2Cal = calibrateByDrift(
      g.filter((r) => r.repUnitId && r.repOrder !== null)
        .map((r) => ({ conf: r.chapterConf, delta: Math.abs(r.repOrder! - r.trueOrder) })),
    );
    const b2Taken = b2Cal ? g.filter((r) => r.repUnitId && r.repOrder !== null && r.chapterConf >= b2Cal.threshold) : [];
    const b2Drift = drift(b2Taken.map((r) => ({
      assignedOrder: r.repOrder!,
      trueOrder: r.trueOrder,
      sameChapter: r.chapterPred === r.trueChapter,
    })));

    return {
      학년: gradeKey,
      평가문항: g.length,
      A_소단원직접: { 문턱: aCal ? Number(aCal.threshold.toFixed(4)) : null, ...aDrift },
      B_중단원_대표소단원: { 문턱: bCal ? Number(bCal.threshold.toFixed(4)) : null, ...bDrift },
      B2_중단원_대표_어긋남보정: { 문턱: b2Cal ? Number(b2Cal.threshold.toFixed(4)) : null, ...b2Drift },
    };
  }).sort((a, b) => b.평가문항 - a.평가문항);

  // ── 실제 대상 24,446문항에 투영 — 안마다 몇 문항이 열리는가 ──────────────
  const fullUnitModel = train(docs);
  const fullChapterModel = train(docs.map((d) => {
    const u = unitById.get(d.unitId)!;
    return withLabel(d, chapterKey(u.grade, u.chapter));
  }));
  const fullReps = buildRepresentatives(docs, unitById);
  const targets: Doc[] = readFileSync(TARGET_FILE, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const thresholdOf = new Map(report.map((r) => [r.학년, {
    A: r.A_소단원직접.문턱, B: r.B_중단원_대표소단원.문턱, B2: r.B2_중단원_대표_어긋남보정.문턱,
  }]));
  const opened = new Map<string, { 대상: number; A: number; B: number; B2: number }>();
  for (const t of targets) {
    const stat = opened.get(t.gradeKey) ?? { 대상: 0, A: 0, B: 0, B2: 0 };
    stat.대상 += 1;
    const th = thresholdOf.get(t.gradeKey);
    if (th) {
      const uConf = confidenceOf(scoreCandidates(fullUnitModel, t));
      const cRanked = scoreCandidates(fullChapterModel, t);
      const cConf = confidenceOf(cRanked);
      const hasRep = cRanked.length > 0 && fullReps.has(cRanked[0].unitId);
      if (th.A !== null && uConf >= th.A) stat.A += 1;
      if (th.B !== null && hasRep && cConf >= th.B) stat.B += 1;
      if (th.B2 !== null && hasRep && cConf >= th.B2) stat.B2 += 1;
    }
    opened.set(t.gradeKey, stat);
  }
  const projection = [...opened.entries()].map(([학년, s]) => ({ 학년, ...s })).sort((a, b) => b.대상 - a.대상);

  writeFileSync(`${OUT_DIR}/chapter-fallback.json`,
    JSON.stringify({ 교차검증: report, 대상투영: projection }, null, 1), "utf8");

  const fmt = (v: number | null) => (v === null ? "—" : String(v));
  console.log("=== 세 안 비교 (편 단위 5겹 교차검증, 목표 정확도 90%) ===");
  console.log("A = 소단원 직접 / B = 중단원+대표 소단원 / C = 미분류(항상 0문항·어긋남 없음)\n");
  console.log("학년 | 안 | 채택 | 차0 | 차2이내 | 차5초과 | 중앙값 | 90분위 | 다른중단원");
  for (const r of report) {
    for (const [name, o] of [["A ", r.A_소단원직접], ["B ", r.B_중단원_대표소단원], ["B2", r.B2_중단원_대표_어긋남보정]] as const) {
      console.log(
        `${r.학년} | ${name} | ${o.채택} | ${fmt(o.정확히맞음_차0)}% | ${fmt(o.차2이내)}% | ` +
        `${fmt(o.차5초과)}% | ${fmt(o.차_중앙값)} | ${fmt(o.차_90분위)} | ${fmt(o.다른중단원으로_샘)}%`,
      );
    }
  }

  console.log("\n=== 실제 대상 문항에 투영했을 때 열리는 수 ===");
  console.log("학년 | 대상 | A 소단원직접 | B 중단원+대표 | B2 어긋남보정");
  for (const p of projection)
    console.log(`  ${p.학년} | ${p.대상} | ${p.A} | ${p.B} | ${p.B2}`);
  const sum = (k: "A" | "B" | "B2") => projection.reduce((a, b) => a + b[k], 0);
  console.log(`  합계 | ${projection.reduce((a, b) => a + b.대상, 0)} | ${sum("A")} | ${sum("B")} | ${sum("B2")}`);
}

main();
