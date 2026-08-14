/**
 * 원본 역추적 메타데이터를 Problem에 백필한다.
 *
 * 채우는 값: externalId(UNIQUE) · examId · questionNumber · school · subject · sourceFile
 * 정답(originAnswer)은 **건드리지 않는다** — 별도 승인 작업(2단계)이다.
 *
 * 안전장치:
 *  1. `--apply` 없으면 드라이런(집계만).
 *  2. 이미 externalId 가 있는 행은 건너뛴다(재실행 멱등).
 *  3. externalId 가 다른 행에 이미 쓰였으면 건너뛴다(UNIQUE 충돌 방지).
 *
 * 선행: python scripts/qa/enrich-source-meta.py
 * 사용: node scripts/qa/backfill-source-meta.mjs [--apply]
 */
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const IN = "scripts/qa/reports/source-meta.json";
const db = new PrismaClient();

const records = JSON.parse(await readFile(IN, "utf8"));

// 이미 쓰인 externalId 를 미리 모아 충돌을 피한다
const taken = new Set(
  (
    await db.problem.findMany({
      where: { externalId: { not: null } },
      select: { externalId: true },
    })
  ).map((r) => r.externalId),
);

let updated = 0;
let skipAlready = 0;
let skipTaken = 0;
let notFound = 0;

for (const r of records) {
  const current = await db.problem.findUnique({
    where: { id: r.problemId },
    select: { externalId: true },
  });
  if (!current) {
    notFound++;
    continue;
  }
  if (current.externalId) {
    skipAlready++;
    continue;
  }
  if (taken.has(r.externalId)) {
    skipTaken++;
    continue;
  }

  if (APPLY) {
    await db.problem.update({
      where: { id: r.problemId },
      data: {
        externalId: r.externalId,
        examId: r.examId,
        questionNumber: r.questionNumber,
        school: r.school,
        subject: r.subject,
        sourceFile: r.sourceFile,
      },
    });
  }
  taken.add(r.externalId);
  updated++;
}

console.log(APPLY ? "── 백필 완료 ──" : "── 드라이런(쓰기 없음) ──");
console.log(
  JSON.stringify({
    입력: records.length,
    갱신: updated,
    "건너뜀:이미있음": skipAlready,
    "건너뜀:externalId충돌": skipTaken,
    "문항없음": notFound,
  }),
);
await db.$disconnect();
