/**
 * 본문과 소단원 라벨이 서로 어긋난 DB 행을 찾는다. **읽기 전용 · 보고만 한다.**
 *
 *   npx tsx scripts/classify/audit-label-content.ts
 *
 * 왜 필요한가: 트랙 D 가 문항 번호를 열쇠로 `content` 를 재추출본으로 교체했는데,
 * 번호 정렬이 어긋난 편에서는 **본문만 바뀌고 라벨은 옛 본문 기준으로 남는다.**
 * 그러면 그 행은 "본문은 연립부등식인데 단원은 행렬" 인 상태로 조용히 살아 있고,
 * 그 단원으로 출제할 때 엉뚱한 문제가 섞여 나간다.
 *
 * 판정: 본문이 그 번호의 재추출 본문과 **일치**하는데(=본문은 그 번호가 맞다),
 * 그 번호의 `topic` 을 `mapUnitHint` 로 붙인 단원이 DB 라벨과 **다르면** 의심한다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { OUT_DIR, TRACK_D_REPORTS, UNITS_FILE, Unit, gradeKeyOf, ExamMeta } from "./paths";
import { mapUnitHint } from "../../src/lib/import/mapUnit";

type LabelRow = { externalId: string; examId: string | null; n: number | null; unitId: string; content: string };
type Question = { number: unknown; stem?: unknown; topic?: unknown };
type Suspect = {
  externalId: string; examId: string; n: number | null; 본문유사도: number; topic: unknown;
  현재라벨: string; 본문이가리키는단원: string; 같은중단원: boolean;
};

/** 본문이 그 번호의 것이 맞다고 볼 하한. */
const CONTENT_MATCH_FLOOR = 0.6;

const koreanBigrams = (value: unknown): Set<string> => {
  const text = String(value ?? "").replace(/\$[^$]*\$/g, " ").replace(/[^가-힣]/g, "");
  const out = new Set<string>();
  for (let i = 0; i + 2 <= text.length; i += 1) out.add(text.slice(i, i + 2));
  return out;
};
const dice = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return -1;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const gram of small) if (large.has(gram)) shared += 1;
  return (2 * shared) / (a.size + b.size);
};

function main() {
  const units: Unit[] = JSON.parse(readFileSync(UNITS_FILE, "utf8"));
  const unitById = new Map(units.map((u) => [u.id, u]));
  const metas: ExamMeta[] = JSON.parse(readFileSync(`${TRACK_D_REPORTS}/final-pairs.json`, "utf8")).pairs;
  let extraMetas: ExamMeta[] = [];
  try {
    extraMetas = JSON.parse(readFileSync(`${TRACK_D_REPORTS}/final-pairs-extra.json`, "utf8")).pairs;
  } catch { /* 없으면 그냥 진행한다 */ }
  const metaById = new Map([...metas, ...extraMetas].map((m) => [String(m.examId), m]));
  const rows = readFileSync(`${OUT_DIR}/db-labels.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));

  const byExam = new Map<string, LabelRow[]>();
  for (const row of rows) {
    const examId = String(row.examId);
    if (!metaById.has(examId) || !unitById.has(row.unitId)) continue;
    if (!byExam.has(examId)) byExam.set(examId, []);
    byExam.get(examId)!.push(row);
  }

  const suspects: Suspect[] = [];
  let checked = 0;
  for (const [examId, examRows] of byExam) {
    let questions: Question[];
    try {
      questions = (JSON.parse(readFileSync(`${TRACK_D_REPORTS}/hwp-latex/${examId}.json`, "utf8")).questions ?? []) as Question[];
    } catch { continue; }
    const byNumber = new Map(questions.map((q) => [String(q.number), q]));
    const gradeKey = gradeKeyOf(metaById.get(examId)!);
    for (const row of examRows) {
      const question = byNumber.get(String(row.n));
      if (!question) continue;
      const similarity = dice(koreanBigrams(row.content), koreanBigrams(question.stem));
      if (similarity < CONTENT_MATCH_FLOOR) continue;   // 본문이 그 번호의 것이 아니면 판단 보류
      checked += 1;
      const unit = unitById.get(row.unitId)!;
      const expected = mapUnitHint(String(question.topic ?? ""), units, gradeKey ?? unit.grade);
      if (expected.status !== "mapped" || expected.unitId === row.unitId) continue;
      const should = unitById.get(expected.unitId)!;
      suspects.push({
        externalId: row.externalId, examId, n: row.n,
        본문유사도: Number(similarity.toFixed(3)),
        topic: question.topic,
        현재라벨: `${unit.grade} / ${unit.chapter} / ${unit.section}`,
        본문이가리키는단원: `${should.grade} / ${should.chapter} / ${should.section}`,
        같은중단원: unit.grade === should.grade && unit.chapter === should.chapter,
      });
    }
  }

  const byExamCount = new Map<string, number>();
  for (const s of suspects) byExamCount.set(s.examId, (byExamCount.get(s.examId) ?? 0) + 1);
  const ranked = [...byExamCount.entries()].sort((a, b) => b[1] - a[1]);

  writeFileSync(`${OUT_DIR}/label-content-mismatch.json`,
    JSON.stringify({ 검사한행: checked, 의심행: suspects.length, 편별: ranked, 목록: suspects }, null, 1), "utf8");

  console.log(`본문이 번호와 맞는 행 ${checked}건 검사 → 라벨이 어긋난 것 ${suspects.length}건`);
  console.log(`그중 다른 중단원으로 어긋난 것 ${suspects.filter((s) => !s.같은중단원).length}건`);
  console.log("\n편별 (상위 15):");
  for (const [examId, count] of ranked.slice(0, 15)) console.log(`  편 ${examId}: ${count}건`);
}

main();
