/**
 * 대상 문항(소단원 힌트 없음)에 소단원을 판정해 **파일로만** 낸다.
 * 트랙 G 는 DB 에 쓰지 않는다 — 적재는 트랙 F 가 이 파일을 받아서 한다.
 *
 *   npx tsx scripts/classify/predict-units.ts            # 학년별 보정 문턱(권장)
 *   npx tsx scripts/classify/predict-units.ts 0.5        # 전 학년 공통 문턱
 *
 * 문턱은 `evaluate-classifier.ts` 가 **학년마다 따로** 실측해 둔 값을 쓴다
 * (calibration.json — 목표 소단원 정확도 90%). 학년마다 난도가 달라
 * 한 문턱을 쓰면 중1 은 지나치게 보수적이고 고등은 90% 를 못 지킨다.
 *
 * 90% 를 지키는 문턱이 없는 학년은 **전부 미분류로 남긴다.** 억지로 붙이지 않는다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { LABELED_FILE, OUT_DIR, TARGET_FILE, UNITS_FILE, Unit } from "./paths";
import { LabeledDoc, classify, rangeKey, train } from "../../src/lib/classify/unitClassifier";

type Calibration = { 학년: string; 문턱: number | null; 소단원정확도: number | null };

type Target = {
  externalId: string; examId: string; number: number; gradeKey: string;
  semester: number | null; round: string | null; school: string; year: number | null; text: string;
};

function main() {
  const override = process.argv[2] === undefined ? null : Number(process.argv[2]);
  if (override !== null && (!Number.isFinite(override) || override < 0 || override > 1)) {
    throw new Error(`문턱은 0~1 이어야 합니다: ${process.argv[2]}`);
  }
  const calibration: Calibration[] = JSON.parse(readFileSync(`${OUT_DIR}/calibration.json`, "utf8"));
  const thresholdByGrade = new Map(calibration.map((c) => [c.학년, c.문턱]));
  const precisionByGrade = new Map(calibration.map((c) => [c.학년, c.소단원정확도]));
  /** 보정값이 없는 학년은 붙이지 않는다(문턱 1 초과 = 절대 채택 안 됨). */
  const thresholdFor = (gradeKey: string): number =>
    override ?? thresholdByGrade.get(gradeKey) ?? Number.POSITIVE_INFINITY;
  const units: Unit[] = JSON.parse(readFileSync(UNITS_FILE, "utf8"));
  const unitById = new Map(units.map((u) => [u.id, u]));
  const labeled: LabeledDoc[] = readFileSync(LABELED_FILE, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const targets: Target[] = readFileSync(TARGET_FILE, "utf8").trim().split("\n").map((l) => JSON.parse(l));

  const model = train(labeled);

  // 분포 어긋남 진단 — 학습셋은 '시험지가 소단원명을 적어 준 편', 대상셋은 '안 적어 준 편'이다.
  // 범위 조합이 학습셋에 없으면 학년 사전으로 물러서므로 판정이 약해진다.
  let unseenRange = 0;
  for (const t of targets) if (!model.rangePrior.has(rangeKey(t.gradeKey, t.semester, t.round))) unseenRange += 1;

  const accepted: string[] = [];
  const byGrade = new Map<string, { 대상: number; 채택: number }>();
  const confidences: number[] = [];
  let unclassified = 0;

  for (const t of targets) {
    const stat = byGrade.get(t.gradeKey) ?? { 대상: 0, 채택: 0 };
    stat.대상 += 1;
    const result = classify(model, t, thresholdFor(t.gradeKey));
    if (result.status === "mapped") {
      const unit = unitById.get(result.unitId);
      stat.채택 += 1;
      confidences.push(result.confidence);
      accepted.push(JSON.stringify({
        externalId: t.externalId,
        examId: t.examId,
        questionNumber: t.number,
        unitId: result.unitId,
        confidence: Number(result.confidence.toFixed(4)),
        근거: {
          방법: "범위사전(학년·학기·회차) + 본문 나이브베이즈",
          문턱: thresholdFor(t.gradeKey),
          실측_소단원정확도: override === null ? precisionByGrade.get(t.gradeKey) ?? null : null,
          학년: t.gradeKey, 학기: t.semester, 회차: t.round, 학교: t.school, 연도: t.year,
          후보수: result.candidateCount,
          단원: unit ? `${unit.grade} / ${unit.chapter} / ${unit.section}` : null,
          차점단원: result.runnerUpId && unitById.get(result.runnerUpId)
            ? `${unitById.get(result.runnerUpId)!.chapter} / ${unitById.get(result.runnerUpId)!.section}` : null,
        },
      }));
    } else {
      unclassified += 1;
    }
    byGrade.set(t.gradeKey, stat);
  }

  writeFileSync(`${OUT_DIR}/unit-predictions.jsonl`, accepted.join("\n") + "\n", "utf8");
  confidences.sort((a, b) => a - b);
  const summary = {
    문턱방식: override === null ? "학년별 보정(calibration.json, 목표 90%)" : `전 학년 공통 ${override}`,
    실측근거: "편 단위 5겹 교차검증 — evaluation.json / calibration.json",
    대상문항: targets.length,
    채택: accepted.length,
    미분류로_남김: unclassified,
    채택률: Number(((accepted.length / targets.length) * 100).toFixed(1)),
    확신_중앙값: confidences.length ? Number(confidences[Math.floor(confidences.length / 2)].toFixed(3)) : null,
    학습셋에_없는_범위조합_문항: unseenRange,
    학년별: [...byGrade.entries()].map(([학년, s]) => ({
      학년, ...s,
      채택률: Number(((s.채택 / s.대상) * 100).toFixed(1)),
      문턱: Number.isFinite(thresholdFor(학년)) ? thresholdFor(학년) : null,
      실측_소단원정확도: override === null ? precisionByGrade.get(학년) ?? null : null,
    })).sort((a, b) => b.대상 - a.대상),
  };
  writeFileSync(`${OUT_DIR}/prediction-summary.json`, JSON.stringify(summary, null, 1), "utf8");

  console.log(`${summary.문턱방식} — 대상 ${targets.length} 중 채택 ${accepted.length} (${summary.채택률}%), 미분류 ${unclassified}`);
  console.log(`학습셋에 없는 범위 조합에 걸린 문항: ${unseenRange}`);
  console.log("\n학년 | 대상 | 채택 | 채택률 | 문턱 | 실측 소단원 정확도");
  for (const g of summary.학년별)
    console.log(
      `  ${g.학년} | ${g.대상} | ${g.채택} | ${g.채택률}% | ${g.문턱 ?? "—"} | ${g.실측_소단원정확도 ?? "—"}%`,
    );
}

main();
