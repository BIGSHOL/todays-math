/**
 * 별칭을 넣은 뒤 **의도한 문항 말고 다른 것까지 끌어당기지 않는지** 확인한다.
 *
 *   npx tsx scripts/classify/verify-alias-impact.ts <출력파일>
 *
 * 별칭 표는 전역이라 넓게 걸리면 엉뚱한 곳이 움직인다. 그래서 DB 에 있는
 * 모든 문항의 판정을 파일로 떠 두고, 별칭 추가 전후를 그대로 비교한다.
 *
 * 학년 힌트를 **두 가지**로 각각 잰다. 둘이 다르기 때문이다.
 *   - `meta` : 시험지 메타에서 level 을 반영해 만든 학년(중2 · 기하 …)
 *   - `loader` : 적재기가 실제로 넘기는 값(`meta.grade ?? meta.subject` — 맨숫자일 때가 많다)
 *
 * DB 는 이미 내려받은 덤프를 읽기만 한다. 쓰지 않는다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ExamMeta, OUT_DIR, TRACK_D_REPORTS, UNITS_FILE, Unit, gradeKeyOf } from "./paths";
import { mapUnitHint } from "../../src/lib/import/mapUnit";

type LabelRow = { externalId: string; examId: string | null; n: number | null; unitId: string };
type Question = { number: unknown; topic?: unknown };
type Paper = { meta?: { grade?: unknown; subject?: unknown }; questions?: Question[] };

function main() {
  const out = process.argv[2];
  if (!out) throw new Error("출력 파일 경로를 주십시오.");

  const units: Unit[] = JSON.parse(readFileSync(UNITS_FILE, "utf8"));
  const metas: ExamMeta[] = [
    ...JSON.parse(readFileSync(`${TRACK_D_REPORTS}/final-pairs.json`, "utf8")).pairs,
    ...JSON.parse(readFileSync(`${TRACK_D_REPORTS}/final-pairs-extra.json`, "utf8")).pairs,
  ];
  const metaById = new Map(metas.map((m) => [String(m.examId), m]));
  const rows: LabelRow[] = readFileSync(`${OUT_DIR}/db-labels.jsonl`, "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));

  const paperCache = new Map<string, Paper | null>();
  const paperOf = (examId: string): Paper | null => {
    if (!paperCache.has(examId)) {
      const file = `${TRACK_D_REPORTS}/hwp-latex/${examId}.json`;
      paperCache.set(examId, existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
    }
    return paperCache.get(examId)!;
  };

  const judged: Record<string, { meta: string | null; loader: string | null }> = {};
  let scope = 0;
  for (const row of rows) {
    const examId = String(row.examId);
    const paper = paperOf(examId);
    const meta = metaById.get(examId);
    if (!paper || !meta) continue;
    const question = (paper.questions ?? []).find((q) => String(q.number) === String(row.n));
    const topic = String(question?.topic ?? "").trim();
    if (!topic || topic === "None") continue;
    scope += 1;

    const byMeta = mapUnitHint(topic, units, gradeKeyOf(meta) ?? undefined);
    const loaderHint = (paper.meta?.grade ?? paper.meta?.subject) as string | number | undefined;
    const byLoader = mapUnitHint(topic, units, loaderHint);
    judged[row.externalId] = {
      meta: byMeta.status === "mapped" ? byMeta.unitId : null,
      loader: byLoader.status === "mapped" ? byLoader.unitId : null,
    };
  }

  // 아직 적재되지 않은 대상 문항도 같이 본다 — 별칭이 노리는 13문항이 여기 있다.
  const targets = readFileSync(`${OUT_DIR}/target.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const targetJudged: Record<string, string | null> = {};
  for (const t of targets) {
    const paper = paperOf(String(t.examId));
    const question = (paper?.questions ?? []).find((q) => String(q.number) === String(t.number));
    const topic = String(question?.topic ?? "").trim();
    if (!topic || topic === "None") continue;
    const r = mapUnitHint(topic, units, t.gradeKey);
    targetJudged[t.externalId] = r.status === "mapped" ? r.unitId : null;
  }

  // 힌트가 있는데 아직 안 들어간 문항 전량(트랙 F 가 넣을 후보)도 본다.
  const pending: Record<string, { grade: string | null; unitId: string | null; topic: string }> = {};
  const loaded = new Set<string>(JSON.parse(readFileSync(`${OUT_DIR}/loaded-external-ids.json`, "utf8")).ids);
  for (const meta of metas) {
    const examId = String(meta.examId);
    const paper = paperOf(examId);
    if (!paper) continue;
    const gradeKey = gradeKeyOf(meta);
    for (const q of paper.questions ?? []) {
      const externalId = `${examId}-${q.number}`;
      if (loaded.has(externalId)) continue;
      const topic = String(q.topic ?? "").trim();
      if (!topic || topic === "None") continue;
      const r = mapUnitHint(topic, units, gradeKey ?? undefined);
      pending[externalId] = { grade: gradeKey, unitId: r.status === "mapped" ? r.unitId : null, topic };
    }
  }

  writeFileSync(out, JSON.stringify({ 적재된행: scope, judged, targetJudged, pending }, null, 1), "utf8");
  console.log(`적재된 행 ${scope} · 대상 문항 ${Object.keys(targetJudged).length} · 미적재 힌트보유 ${Object.keys(pending).length} → ${out}`);
}

main();
