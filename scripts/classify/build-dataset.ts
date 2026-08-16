/**
 * 학습셋(이미 분류된 문항) · 대상셋(힌트 없는 문항) 을 만든다.
 *
 *   npx tsx scripts/classify/build-dataset.ts
 *
 * ⚠️ **정렬 감사가 핵심이다.** 라벨은 현재 DB 덤프(`db-labels.jsonl`)에 있고 본문은
 * 트랙 D 재추출본(`hwp-latex/`)에 있다. 둘을 `externalId = {examId}-{번호}` 로 잇는데,
 * 재추출본의 문항 번호가 원래 적재분과 어긋난 편이 실제로 있었다(7편/102문항).
 * 그대로 두면 **본문과 라벨이 어긋난 채로 학습**해 정확도 실측이 통째로 거짓이 된다.
 * 그래서 편마다 DB 본문 ↔ 재추출 본문의 한글 유사도를 재고, 낮은 편은 버린다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
  // 학습에는 `final-pairs-extra`(완료본 목록 밖에서 찾은 358편)도 쓴다.
  // 그 편들은 **이미 DB 에 적재돼 있고** 학기·회차·과목 메타도 온전하다.
  // 여기서 쓰는 것은 적재가 아니라 **학습**이므로 D-37(추출은 완료본만)과 충돌하지 않는다.
  // 실측: 이걸 넣으면 공통수학1 이 1,410 → 3,547, 공통수학2 가 570 → 2,479 로 는다.
  let extraMetas: ExamMeta[] = [];
  try {
    extraMetas = JSON.parse(readFileSync(`${TRACK_D_REPORTS}/final-pairs-extra.json`, "utf8")).pairs;
  } catch { /* 없으면 그냥 진행한다 */ }
  const metaById = new Map([...metas, ...extraMetas].map((m) => [String(m.examId), m]));
  // 대상셋은 **완료본 목록만** 본다(보수적). extra 편의 힌트 없는 문항까지 대상에 넣을지는
  // 코디네이터·원장님 판단 사항이라 여기서 임의로 넓히지 않는다.

  // 라벨은 **현재 DB 덤프**를 쓴다(트랙 D 스냅샷이 아니다 — F 가 계속 적재해 낡는다).
  const dbRows = readFileSync(`${OUT_DIR}/db-labels.jsonl`, "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
  const loadedIds = new Set<string>(
    JSON.parse(readFileSync(`${OUT_DIR}/loaded-external-ids.json`, "utf8")).ids,
  );
  // 본문과 라벨이 어긋난 것으로 확인된 행은 학습에서 뺀다 — 틀린 정답지로 배우면
  // 실측치가 통째로 거짓이 된다. 목록은 audit-label-content.ts 가 만든다.
  let mismatched = new Set<string>();
  try {
    const audit = JSON.parse(readFileSync(`${OUT_DIR}/label-content-mismatch.json`, "utf8"));
    mismatched = new Set<string>(audit.목록.map((m: { externalId: string }) => m.externalId));
  } catch { /* 감사를 아직 안 돌렸으면 그냥 진행한다 */ }
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
  let gradeMismatch = 0;
  for (const [examId, byNumber] of dbByExam) {
    const meta = metaById.get(examId)!;
    const gradeKey = gradeKeyOf(meta);
    for (const question of readQuestions(examId)) {
      const row = byNumber.get(String(question.number));
      if (!row) continue;
      if (dropped.has(examId) || mismatched.has(`${examId}-${question.number}`)) { labeledDropped += 1; continue; }
      const unit = unitById.get(row.unitId)!;
      // 시험지 메타가 말하는 학년과 라벨의 학년이 다르면 뺀다. 실측 163행(0.46%, 43편)이
      // 그렇고, 대부분 **중2·중3 시험지 문항이 고등 공통수학2 단원에 붙은** 것이다.
      // 이런 행으로 배우면 학년별 모델이 서로 오염된다.
      if (gradeKey && gradeKey !== unit.grade) { gradeMismatch += 1; continue; }
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
  const skipped = { 이미적재: 0, 힌트있음: 0, 본문짧음: 0, 학년미상: 0, 파일없음: 0, 편2022이전: 0 };
  for (const meta of metas) {
    const examId = String(meta.examId);
    if ((meta.year ?? 0) < MIN_YEAR) { skipped.편2022이전 += 1; continue; }
    const questions = readQuestions(examId);
    if (questions.length === 0) { skipped.파일없음 += 1; continue; }
    const gradeKey = gradeKeyOf(meta);
    for (const question of questions) {
      // ⚠️ "편이 DB 에 없는가" 로 거르면 안 된다. F 가 그 편의 힌트 있는 문항만
      // 먼저 적재하면 나머지가 통째로 사라진다. 열쇠는 문항 단위 externalId 다.
      if (loadedIds.has(`${examId}-${question.number}`)) { skipped.이미적재 += 1; continue; }
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
  const fingerprint = (file: string) =>
    createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 16);
  const summary = {
    // 트랙 F 가 입력 corpus 지문을 기록해 두고 원본이 바뀌면 멈춘다 — 같은 지문을 여기서도 남긴다.
    corpus: {
      "db-labels.jsonl": fingerprint(`${OUT_DIR}/db-labels.jsonl`),
      "loaded-external-ids.json": fingerprint(`${OUT_DIR}/loaded-external-ids.json`),
      "units-db.json": fingerprint(UNITS_FILE),
      "final-pairs.json": fingerprint(`${TRACK_D_REPORTS}/final-pairs.json`),
      "label-content-mismatch.json": fingerprint(`${OUT_DIR}/label-content-mismatch.json`),
      "hwp-latex": `${TRACK_D_REPORTS}/hwp-latex`,
    },
    학습셋: { 문항: labeled.length, 편: new Set(labeled.map((l) => JSON.parse(l).examId)).size },
    정렬감사: {
      검사한편: alignment.length,
      정렬깨진편: misaligned.length,
      버린문항: labeledDropped,
      본문라벨불일치_제외: mismatched.size,
      학년불일치_제외: gradeMismatch,
      목록: misaligned.map((m) => ({ ...m, meanSimilarity: Number(m.meanSimilarity.toFixed(3)) })),
    },
    대상셋: { 문항: target.length, 편: new Set(target.map((l) => JSON.parse(l).examId)).size, 제외: skipped },
  };
  writeFileSync(DATASET_SUMMARY, JSON.stringify(summary, null, 1), "utf8");
  console.log(JSON.stringify(summary, null, 1));
}

main();
