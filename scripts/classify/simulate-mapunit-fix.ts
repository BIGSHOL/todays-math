/**
 * `mapUnit.ts` 를 **고치지 않고**, 고쳤다고 가정했을 때 판정이 어떻게 달라지는지 잰다.
 *
 *   npx tsx scripts/classify/simulate-mapunit-fix.ts
 *
 * DB 는 이미 내려받은 덤프를 읽기만 한다. 쓰지 않는다.
 *
 * ## 기준선은 **DB 에 저장된 unitId** 다 (재현이 아니다)
 *
 * 적재 당시(2026-08-14~15) 추출본의 메타 모양이 지금 트랙 D 재추출본(08-16)과 달라서,
 * 지금 메타로 `mapUnitHint` 를 다시 돌린 결과는 **당시 적재기가 본 것과 같지 않다.**
 * (실제로 그렇게 재 봤더니 27,975행이 "달라진다" 고 나왔는데, DB 의 실제 오배정은
 * 163행뿐이다 — 재현이 틀린 것이다.) 그래서 "지금 판정" 은 **DB 에 실제로 저장된 값**으로
 * 잡고, 제안을 적용해 다시 판정한 값과 비교한다.
 *
 * ## 옳고 그름의 잣대
 *
 * 시험지 메타가 말하는 학년(`gradeKeyOf`). 이미 분류된 35,666행 중 99.54% 에서
 * 라벨 학년과 일치해 별도로 검증돼 있다.
 *
 * ## 재는 두 안
 *
 *   안1 «부분문자열 가드» — 학년이 트리의 실제 학년으로 풀릴 때만 부분문자열 단계를 돈다.
 *     학년이 안 풀리면 별칭·부분문자열·유사도가 **모두** 막히므로 결과는 반드시 미분류다.
 *     학년이 풀리면 가드는 아무것도 바꾸지 않는다. 코드 복제 없이 정확히 흉내낼 수 있다.
 *
 *   안2 «level 반영» — 적재기가 넘기는 학년 힌트를 `meta.grade`(맨숫자) 대신
 *     `level` 을 반영한 값으로 바꾼다. `normalizeGrade(2)` 가 **공통수학2** 를 주기 때문에
 *     중2 시험지가 고등 단원으로 가는 일이 생긴다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ExamMeta, OUT_DIR, TRACK_D_REPORTS, UNITS_FILE, Unit, gradeKeyOf } from "./paths";
import { mapUnitHint, normalizeGrade } from "../../src/lib/import/mapUnit";

type LabelRow = { problemId: string; externalId: string; examId: string | null; n: number | null; unitId: string };
type Question = { number: unknown; topic?: unknown };
type Paper = { meta?: { grade?: unknown; subject?: unknown }; questions?: Question[] };

type Bucket = "가_틀린것이_옳아짐" | "가2_틀린것이_미분류로" | "나_맞던것이_미분류로"
  | "나2_맞던것이_다른단원으로" | "다_안바뀜";

const BUCKETS: Bucket[] = [
  "가_틀린것이_옳아짐", "가2_틀린것이_미분류로", "나_맞던것이_미분류로",
  "나2_맞던것이_다른단원으로", "다_안바뀜",
];

function main() {
  const units: Unit[] = JSON.parse(readFileSync(UNITS_FILE, "utf8"));
  const unitById = new Map(units.map((u) => [u.id, u]));
  const gradeLabels = new Set(units.map((u) => u.grade));
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

  const empty = () => Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
  const plan1 = empty(), plan2 = empty();
  const plan1Rows: Record<string, string[]> = { 나_맞던것이_미분류로: [], 가2_틀린것이_미분류로: [] };
  const plan2Rows: Record<string, string[]> = { 가_틀린것이_옳아짐: [], 나_맞던것이_미분류로: [], 나2_맞던것이_다른단원으로: [] };
  const byGrade: Record<string, Record<Bucket, number>> = {};

  let scope = 0, noTopic = 0, noPaper = 0, noMeta = 0, guardWouldFire = 0;

  for (const row of rows) {
    const examId = String(row.examId);
    const paper = paperOf(examId);
    if (!paper) { noPaper += 1; continue; }
    const meta = metaById.get(examId);
    if (!meta) { noMeta += 1; continue; }
    const question = (paper.questions ?? []).find((q) => String(q.number) === String(row.n));
    const topic = String(question?.topic ?? "").trim();
    if (!topic || topic === "None") { noTopic += 1; continue; }
    scope += 1;

    const examGrade = gradeKeyOf(meta);
    const gradeOf = (id: string | null) => (id ? unitById.get(id)?.grade ?? null : null);
    const isRight = (id: string | null) => id !== null && examGrade !== null && gradeOf(id) === examGrade;

    // 지금 판정 = DB 에 저장된 값
    const storedId = row.unitId;
    const storedRight = isRight(storedId);

    // 안1: 적재기가 넘기던 힌트(meta.grade ?? meta.subject)가 트리 학년으로 안 풀리면 미분류
    const loaderHint = (paper.meta?.grade ?? paper.meta?.subject) as string | number | undefined;
    const resolved = normalizeGrade(loaderHint);
    const guardFires = !(resolved !== null && gradeLabels.has(resolved));
    if (guardFires) guardWouldFire += 1;
    const plan1Id = guardFires ? null : storedId;   // 가드가 안 걸리면 지금 판정 그대로

    // 안2: level 을 반영한 학년으로 다시 판정
    const fixed = mapUnitHint(topic, units, examGrade ?? undefined);
    const plan2Id = fixed.status === "mapped" ? fixed.unitId : null;

    const classify = (nextId: string | null): Bucket => {
      if (nextId === storedId) return "다_안바뀜";
      if (!storedRight) {
        if (nextId === null) return "가2_틀린것이_미분류로";
        return isRight(nextId) ? "가_틀린것이_옳아짐" : "다_안바뀜";
      }
      return nextId === null ? "나_맞던것이_미분류로" : "나2_맞던것이_다른단원으로";
    };

    const b1 = classify(plan1Id);
    plan1[b1] += 1;
    if (plan1Rows[b1]) plan1Rows[b1].push(row.externalId);

    const b2 = classify(plan2Id);
    plan2[b2] += 1;
    if (plan2Rows[b2]) plan2Rows[b2].push(row.externalId);
    const key = examGrade ?? "(학년미상)";
    byGrade[key] ??= empty();
    byGrade[key][b2] += 1;
  }

  const result = {
    기준선: "DB 에 저장된 unitId (적재 당시 메타를 재현할 수 없어 재현값을 쓰지 않는다)",
    잣대: "시험지 메타 학년(gradeKeyOf) — 35,666행 중 99.54% 일치로 검증됨",
    대상: { 판정을_비교한_행: scope, topic없어_제외: noTopic, 추출본없어_제외: noPaper, 메타없어_제외: noMeta },
    안1_부분문자열가드: { ...plan1, 가드가_걸리는_행: guardWouldFire },
    안2_level반영: plan2,
    안2_학년별: byGrade,
    표본: {
      안1_맞던것이_미분류로: plan1Rows.나_맞던것이_미분류로.slice(0, 8),
      안2_옳아짐: plan2Rows.가_틀린것이_옳아짐.slice(0, 8),
      안2_맞던것이_다른단원으로: plan2Rows.나2_맞던것이_다른단원으로.slice(0, 8),
    },
  };
  writeFileSync(`${OUT_DIR}/mapunit-fix-simulation.json`, JSON.stringify(result, null, 1), "utf8");

  console.log(`판정을 비교한 행: ${scope} (topic 없어 제외 ${noTopic} · 추출본 없어 제외 ${noPaper} · 메타 없어 제외 ${noMeta})`);
  console.log(`\n=== 안1 부분문자열 가드 === (가드가 실제로 걸리는 행 ${guardWouldFire})`);
  for (const b of BUCKETS) console.log(`  ${b}: ${plan1[b]}`);
  console.log("\n=== 안2 level 반영 ===");
  for (const b of BUCKETS) console.log(`  ${b}: ${plan2[b]}`);
  console.log("\n=== 안2 학년별 (바뀌는 것만) ===");
  for (const [g, b] of Object.entries(byGrade)) {
    const changed = BUCKETS.filter((k) => k !== "다_안바뀜" && b[k] > 0).map((k) => `${k} ${b[k]}`).join(" · ");
    if (changed) console.log(`  ${g}: ${changed}`);
  }
  console.log(`\n→ ${OUT_DIR}/mapunit-fix-simulation.json`);
}

main();
