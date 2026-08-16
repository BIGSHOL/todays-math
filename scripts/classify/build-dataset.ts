/**
 * 학습셋(이미 분류된 문항) · 대상셋(힌트 없는 문항) 을 만든다.
 *
 *   npx tsx scripts/classify/build-dataset.ts
 *
 * ⚠️ **정렬 감사가 핵심이다.** 라벨은 DB 행(`db-content.jsonl`)에 있고 본문은
 * 트랙 D 재추출본(`hwp-latex/`)에 있다. 둘을 `externalId = {examId}-{번호}` 로 잇는데,
 * 재추출본의 문항 번호가 원래 적재분과 어긋난 편이 실제로 있었다(7편/102문항).
 * 그대로 두면 **본문과 라벨이 어긋난 채로 학습**해 정확도 실측이 통째로 거짓이 된다.
 * 그래서 편마다 DB 본문 ↔ 재추출 본문의 한글 유사도를 재고, 낮은 편은 버린다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  DATASET_SUMMARY, ExamMeta, LABELED_FILE, OUT_DIR, TARGET_FILE, TRACK_D_REPORTS,
  UNITS_FILE, Unit, gradeKeyOf,
} from "./paths";
import { problemText } from "../../src/lib/classify/features";

/** 2023 이전 기출은 제외한다(08 §1.3 제외 규칙). */
const MIN_YEAR = 2023;
/** 미주 순번 등 인공물을 걸러내는 본문 하한 — 원장 §1.1 의 '실체 문항' 정의와 같다. */
const MIN_STEM_LENGTH = 40;
/** 편 평균 본문유사도가 이 아래면 번호 정렬이 깨진 것으로 보고 학습셋에서 뺀다. */
const ALIGN_FLOOR = 0.4;

const hasTopic = (raw: unknown): boolean => {
  const value = String(raw ?? "").trim();
  return value !== "" && value !== "None";
};

/** 한글 bigram Dice — 옛 적재분의 수식 깨짐에 덜 흔들린다. */
function koreanBigrams(value: unknown): Set<string> {
  const text = String(value ?? "").replace(/\$[^$]*\$/g, " ").replace(/[^가-힣]/g, "");
  const out = new Set<string>();
  for (let i = 0; i + 2 <= text.length; i += 1) out.add(text.slice(i, i + 2));
  return out;
}
function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return -1;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const gram of small) if (large.has(gram)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

type Question = { number: unknown; stem?: unknown; choices?: unknown; topic?: unknown };
const readQuestions = (examId: string): Question[] => {
  const file = `${TRACK_D_REPORTS}/hwp-latex/${examId}.json`;
  if (!existsSync(file)) return [];
  try {
    return (JSON.parse(readFileSync(file, "utf8")).questions ?? []) as Question[];
  } catch {
    return [];
  }
};

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const units: Unit[] = JSON.parse(readFileSync(UNITS_FILE, "utf8"));
  const unitById = new Map(units.map((u) => [u.id, u]));
  const metas: ExamMeta[] = JSON.parse(readFileSync(`${TRACK_D_REPORTS}/final-pairs.json`, "utf8")).pairs;
  const metaById = new Map(metas.map((m) => [String(m.examId), m]));

  const dbRows = readFileSync(`${TRACK_D_REPORTS}/db-content.jsonl`, "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
  const dbByExam = new Map<string, Map<string, { content: unknown; unitId: string }>>();
  for (const row of dbRows) {
    const examId = String(row.examId);
    if (!row.unitId || !unitById.has(row.unitId) || !metaById.has(examId)) continue;
    if (!dbByExam.has(examId)) dbByExam.set(examId, new Map());
    dbByExam.get(examId)!.set(String(row.n), { content: row.content, unitId: row.unitId });
  }

  // ── 정렬 감사 ────────────────────────────────────────────────────────────
  const alignment: { examId: string; matched: number; meanSimilarity: number }[] = [];
  for (const [examId, byNumber] of dbByExam) {
    let sum = 0, n = 0;
    for (const question of readQuestions(examId)) {
      const row = byNumber.get(String(question.number));
      if (!row) continue;
      const score = dice(koreanBigrams(row.content), koreanBigrams(question.stem));
      if (score < 0) continue;
      sum += score; n += 1;
    }
    if (n > 0) alignment.push({ examId, matched: n, meanSimilarity: sum / n });
  }
  const misaligned = alignment.filter((a) => a.meanSimilarity < ALIGN_FLOOR);
  const dropped = new Set(misaligned.map((a) => a.examId));

  // ── 학습셋 ───────────────────────────────────────────────────────────────
  const labeled: string[] = [];
  let labeledDropped = 0;
  for (const [examId, byNumber] of dbByExam) {
    const meta = metaById.get(examId)!;
    const gradeKey = gradeKeyOf(meta);
    for (const question of readQuestions(examId)) {
      const row = byNumber.get(String(question.number));
      if (!row) continue;
      if (dropped.has(examId)) { labeledDropped += 1; continue; }
      const unit = unitById.get(row.unitId)!;
      labeled.push(JSON.stringify({
        externalId: `${examId}-${question.number}`,
        examId,
        number: Number(question.number),
        unitId: row.unitId,
        gradeKey: unit.grade,
        metaGradeKey: gradeKey,
        semester: meta.semester,
        round: meta.round,
        text: problemText(question.stem, question.choices),
      }));
    }
  }

  // ── 대상셋: DB 에 없는 편 · 소단원 힌트 없음 ────────────────────────────
  const target: string[] = [];
  const skipped = { 힌트있음: 0, 본문짧음: 0, 학년미상: 0, 파일없음: 0, 편2022이전: 0 };
  for (const meta of metas) {
    const examId = String(meta.examId);
    if (dbByExam.has(examId)) continue;
    if ((meta.year ?? 0) < MIN_YEAR) { skipped.편2022이전 += 1; continue; }
    const questions = readQuestions(examId);
    if (questions.length === 0) { skipped.파일없음 += 1; continue; }
    const gradeKey = gradeKeyOf(meta);
    for (const question of questions) {
      if (String(question.stem ?? "").trim().length < MIN_STEM_LENGTH) { skipped.본문짧음 += 1; continue; }
      if (hasTopic(question.topic)) { skipped.힌트있음 += 1; continue; }
      if (!gradeKey) { skipped.학년미상 += 1; continue; }
      target.push(JSON.stringify({
        externalId: `${examId}-${question.number}`,
        examId,
        number: Number(question.number),
        gradeKey,
        semester: meta.semester,
        round: meta.round,
        school: meta.school,
        year: meta.year,
        text: problemText(question.stem, question.choices),
      }));
    }
  }

  writeFileSync(LABELED_FILE, labeled.join("\n") + "\n", "utf8");
  writeFileSync(TARGET_FILE, target.join("\n") + "\n", "utf8");
  const summary = {
    생성시각기준: "트랙 D 추출본 + 공유 DB 단원 트리",
    학습셋: { 문항: labeled.length, 편: new Set(labeled.map((l) => JSON.parse(l).examId)).size },
    정렬감사: {
      검사한편: alignment.length,
      정렬깨진편: misaligned.length,
      버린문항: labeledDropped,
      목록: misaligned.map((m) => ({ ...m, meanSimilarity: Number(m.meanSimilarity.toFixed(3)) })),
    },
    대상셋: { 문항: target.length, 편: new Set(target.map((l) => JSON.parse(l).examId)).size, 제외: skipped },
  };
  writeFileSync(DATASET_SUMMARY, JSON.stringify(summary, null, 1), "utf8");
  console.log(JSON.stringify(summary, null, 1));
}

main();
