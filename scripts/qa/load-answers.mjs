/**
 * 생성된 정답·해설을 DB에 적재한다.
 *
 * 안전장치(되돌릴 수 없는 쓰기이므로 보수적으로):
 *  1. `--apply` 를 주지 않으면 **드라이런**(아무것도 쓰지 않고 집계만 출력).
 *  2. 정답이 아직 센티널 "(정답 없음)"인 문항만 갱신한다 — 사람이 넣은 정답을 덮어쓰지 않는다.
 *  3. answer 가 null 이거나 confidence 가 low 면 건너뛴다 (억지 정답 배제).
 *  4. 적용분은 ledger 에 기록해 재실행 시 중복 처리하지 않는다.
 *
 * 사용:
 *   node load-answers.mjs --in pilot-out.json              # 드라이런
 *   node load-answers.mjs --in pilot-out.json --apply      # 실제 적재
 */
import { readFile, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const IN = argv[argv.indexOf("--in") + 1];
if (!IN) {
  console.error("사용: node load-answers.mjs --in <파일> [--apply]");
  process.exit(1);
}

const MISSING_ANSWER = "(정답 없음)";
const LEDGER = "applied-answers.txt";
const db = new PrismaClient();

const rows = JSON.parse(await readFile(IN, "utf8"));
let applied = 0;
let skipNull = 0;
let skipLow = 0;
let skipNotMissing = 0;
let notFound = 0;
const appliedIds = [];

for (const r of rows) {
  if (!r?.id) continue;
  if (r.answer == null || String(r.answer).trim() === "") {
    skipNull++;
    continue;
  }
  if (r.confidence === "low") {
    skipLow++;
    continue;
  }

  const current = await db.problem.findUnique({
    where: { id: r.id },
    select: { answer: true },
  });
  if (!current) {
    notFound++;
    continue;
  }
  if (!current.answer?.includes(MISSING_ANSWER)) {
    skipNotMissing++;
    continue;
  }

  if (APPLY) {
    await db.problem.update({
      where: { id: r.id },
      data: {
        answer: String(r.answer).trim(),
        ...(r.solution ? { solution: String(r.solution).trim() } : {}),
      },
    });
  }
  applied++;
  appliedIds.push(r.id);
}

if (APPLY && appliedIds.length) {
  await writeFile(LEDGER, appliedIds.join("\n") + "\n", { flag: "a" });
}

console.log(APPLY ? "── 적재 완료 ──" : "── 드라이런(쓰기 없음) ──");
console.log(
  JSON.stringify({
    입력: rows.length,
    적재: applied,
    "건너뜀:정답없음": skipNull,
    "건너뜀:confidence-low": skipLow,
    "건너뜀:이미정답있음": skipNotMissing,
    "찾을수없음": notFound,
  }),
);
await db.$disconnect();
