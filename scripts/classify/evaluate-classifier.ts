/**
 * 정확도 실측 — 이 트랙의 핵심.
 *
 *   npx tsx scripts/classify/evaluate-classifier.ts
 *
 * 이미 소단원이 붙은 문항의 `topic` 을 **가리고**(학습·판정 어디에도 넣지 않는다)
 * 본문·학년·학기·회차만으로 원래 unitId 를 맞히는지 센다.
 *
 * **편 단위 5겹 교차검증**이다. 같은 시험지가 학습과 평가에 동시에 들어가면
 * 같은 문항이 양쪽에 걸려 점수가 부풀려진다 — 편으로 갈라 그것을 막는다.
 *
 * 기준선도 같이 낸다. 본문을 안 보고 그 범위에서 제일 흔한 단원을 찍는 것보다
 * 못하면 이 기준은 값어치가 없다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { LABELED_FILE, OUT_DIR, UNITS_FILE, Unit } from "./paths";
import { LabeledDoc, Model, rangeKey, scoreCandidates, train } from "../../src/lib/classify/unitClassifier";

const FOLDS = 5;
type Doc = LabeledDoc & { number: number };

const argmax = (table?: Map<string, number>): string | null => {
  if (!table || table.size === 0) return null;
  let best: string | null = null, bestCount = -1;
  for (const [unitId, count] of table) if (count > bestCount) { bestCount = count; best = unitId; }
  return best;
};

type Row = {
  gradeKey: string; truth: string; predicted: string | null; confidence: number;
  inCandidates: boolean; top3: boolean; baseGrade: string | null; baseRange: string | null;
};

function evaluate(docs: Doc[], units: Unit[]) {
  const unitById = new Map(units.map((u) => [u.id, u]));
  const examIds = [...new Set(docs.map((d) => d.examId))].sort();
  const foldOf = new Map(examIds.map((examId, i) => [examId, i % FOLDS]));
  const rows: Row[] = [];

  for (let fold = 0; fold < FOLDS; fold += 1) {
    const trainDocs = docs.filter((d) => foldOf.get(d.examId) !== fold);
    const testDocs = docs.filter((d) => foldOf.get(d.examId) === fold);
    const model: Model = train(trainDocs);

    for (const doc of testDocs) {
      const ranked = scoreCandidates(model, doc);
      const top = ranked[0]?.score ?? 0;
      let partition = 0;
      for (const item of ranked) partition += Math.exp(item.score - top);
      rows.push({
        gradeKey: doc.gradeKey,
        truth: doc.unitId,
        predicted: ranked[0]?.unitId ?? null,
        confidence: ranked.length > 0 ? 1 / partition : 0,
        inCandidates: ranked.some((r) => r.unitId === doc.unitId),
        top3: ranked.slice(0, 3).some((r) => r.unitId === doc.unitId),
        baseGrade: argmax(model.gradePrior.get(doc.gradeKey)),
        baseRange: argmax(
          model.rangePrior.get(rangeKey(doc.gradeKey, doc.semester, doc.round)) ??
            model.gradePrior.get(doc.gradeKey),
        ),
      });
    }
  }

  const n = rows.length;
  const pct = (x: number, d = n) => Number(((x / d) * 100).toFixed(1));
  const sameChapter = (a: string | null, b: string) => {
    if (!a) return false;
    const ua = unitById.get(a), ub = unitById.get(b);
    return !!ua && !!ub && ua.grade === ub.grade && ua.chapter === ub.chapter;
  };

  const headline = {
    문항수: n,
    기준선_학년최빈: pct(rows.filter((r) => r.baseGrade === r.truth).length),
    기준선_범위최빈: pct(rows.filter((r) => r.baseRange === r.truth).length),
    판정기_소단원: pct(rows.filter((r) => r.predicted === r.truth).length),
    판정기_중단원: pct(rows.filter((r) => sameChapter(r.predicted, r.truth)).length),
    상위3_소단원: pct(rows.filter((r) => r.top3).length),
    후보집합에_정답포함_상한: pct(rows.filter((r) => r.inCandidates).length),
  };

  // 확신 문턱별 채택률/정확도 — 실제 적용은 이 문턱으로 한다.
  const curve = [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99].map((threshold) => {
    const taken = rows.filter((r) => r.predicted && r.confidence >= threshold);
    return {
      문턱: threshold,
      채택: taken.length,
      채택률: pct(taken.length),
      소단원정확도: taken.length ? pct(taken.filter((r) => r.predicted === r.truth).length, taken.length) : null,
      중단원정확도: taken.length ? pct(taken.filter((r) => sameChapter(r.predicted, r.truth)).length, taken.length) : null,
    };
  });

  const byGrade = [...new Set(rows.map((r) => r.gradeKey))].map((gradeKey) => {
    const g = rows.filter((r) => r.gradeKey === gradeKey);
    const taken = g.filter((r) => r.predicted && r.confidence >= 0.9);
    return {
      학년: gradeKey, 문항: g.length,
      기준선_범위최빈: pct(g.filter((r) => r.baseRange === r.truth).length, g.length),
      전체채택_소단원: pct(g.filter((r) => r.predicted === r.truth).length, g.length),
      전체채택_중단원: pct(g.filter((r) => sameChapter(r.predicted, r.truth)).length, g.length),
      문턱0_9_채택률: pct(taken.length, g.length),
      문턱0_9_소단원정확도: taken.length ? pct(taken.filter((r) => r.predicted === r.truth).length, taken.length) : null,
    };
  }).sort((a, b) => b.문항 - a.문항);

  // 학년마다 난도가 달라 한 문턱을 쓰면 학년별 위험이 제각각이 된다.
  // 학년별로 "목표 정확도를 지키는 가장 낮은 문턱"을 실측해 둔다.
  const TARGET_PRECISION = 0.9;
  const MIN_ACCEPTED = 50;
  const calibration = [...new Set(rows.map((r) => r.gradeKey))].map((gradeKey) => {
    const ranked = rows
      .filter((r) => r.gradeKey === gradeKey && r.predicted)
      .sort((a, b) => b.confidence - a.confidence);
    let correct = 0, chosen: { threshold: number; accepted: number; precision: number } | null = null;
    for (let i = 0; i < ranked.length; i += 1) {
      if (ranked[i].predicted === ranked[i].truth) correct += 1;
      const accepted = i + 1;
      if (accepted >= MIN_ACCEPTED && correct / accepted >= TARGET_PRECISION) {
        chosen = { threshold: ranked[i].confidence, accepted, precision: correct / accepted };
      }
    }
    const takenChapter = chosen
      ? ranked.slice(0, chosen.accepted).filter((r) => sameChapter(r.predicted, r.truth)).length / chosen.accepted
      : null;
    return {
      학년: gradeKey,
      문턱: chosen ? Number(chosen.threshold.toFixed(4)) : null,
      채택률: chosen ? pct(chosen.accepted, ranked.length) : 0,
      소단원정확도: chosen ? Number((chosen.precision * 100).toFixed(1)) : null,
      중단원정확도: takenChapter === null ? null : Number((takenChapter * 100).toFixed(1)),
      비고: chosen ? null : `문항 ${MIN_ACCEPTED}건 이상에서 ${TARGET_PRECISION * 100}% 를 지키는 문턱이 없다 — 전부 미분류로 남긴다`,
    };
  }).sort((a, b) => b.채택률 - a.채택률);

  // 틀렸을 때 얼마나 멀리 틀리나 — 같은 중단원 안의 이웃이면 피해가 작다.
  const wrong = rows.filter((r) => r.predicted && r.predicted !== r.truth);
  const distances = wrong.map((r) => Math.abs(
    (unitById.get(r.predicted!)?.orderIndex ?? 0) - (unitById.get(r.truth)?.orderIndex ?? 0)));
  distances.sort((a, b) => a - b);
  const 오답거리 = {
    오답수: wrong.length,
    같은중단원: pct(wrong.filter((r) => sameChapter(r.predicted, r.truth)).length, wrong.length),
    단원순서차_중앙값: distances[Math.floor(distances.length / 2)] ?? null,
    단원순서차_1이내: pct(distances.filter((d) => d <= 1).length, distances.length),
    단원순서차_3이내: pct(distances.filter((d) => d <= 3).length, distances.length),
  };

  return { headline, curve, byGrade, calibration, 오답거리 };
}

function main() {
  const units: Unit[] = JSON.parse(readFileSync(UNITS_FILE, "utf8"));
  const docs: Doc[] = readFileSync(LABELED_FILE, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const result = evaluate(docs, units);
  writeFileSync(`${OUT_DIR}/evaluation.json`, JSON.stringify(result, null, 1), "utf8");

  console.log("=== 편 단위 5겹 교차검증 (topic 가림) ===");
  for (const [k, v] of Object.entries(result.headline)) console.log(`  ${k}: ${v}${k === "문항수" ? "" : "%"}`);
  console.log("\n=== 확신 문턱별 ===");
  console.log("  문턱 | 채택률 | 소단원 정확도 | 중단원 정확도");
  for (const c of result.curve) console.log(`  ${c.문턱} | ${c.채택률}% | ${c.소단원정확도}% | ${c.중단원정확도}%`);
  console.log("\n=== 학년별 ===");
  console.log("  학년 | 문항 | 범위최빈 | 소단원 | 중단원 | 문턱0.9 채택률/정확도");
  for (const g of result.byGrade)
    console.log(`  ${g.학년} | ${g.문항} | ${g.기준선_범위최빈}% | ${g.전체채택_소단원}% | ${g.전체채택_중단원}% | ${g.문턱0_9_채택률}% / ${g.문턱0_9_소단원정확도}%`);
  writeFileSync(`${OUT_DIR}/calibration.json`, JSON.stringify(result.calibration, null, 1), "utf8");
  console.log("\n=== 학년별 보정 문턱 (목표 소단원 정확도 90%) ===");
  console.log("  학년 | 문턱 | 채택률 | 소단원 | 중단원");
  for (const c of result.calibration)
    console.log(
      `  ${c.학년} | ${c.문턱 ?? "—"} | ${c.채택률}% | ${c.소단원정확도 ?? "—"}% | ${c.중단원정확도 ?? "—"}%` +
        (c.비고 ? `  ← ${c.비고}` : ""),
    );
  console.log("\n=== 오답의 성격 ===");
  for (const [k, v] of Object.entries(result.오답거리)) console.log(`  ${k}: ${v}`);
}

main();
