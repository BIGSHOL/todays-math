/**
 * 원본 정답(exam_index) ↔ 현재 DB 정답 대조. **쓰기 없음, 분석 전용.**
 *
 * 목적: AI 백필 정답을 원본으로 교체하기 전에 불일치 규모를 먼저 본다.
 * 불일치가 많으면 AI 백필 품질을 재검토할 근거가 되고, 적으면 안심하고 교체한다.
 *
 * 분류:
 *   RECOVER   현재 센티널("(정답 없음)") → 원본으로 순수 회수 (이득만 있음)
 *   AGREE     AI 정답 == 원본 정답 (AI 품질 교차검증)
 *   DIFFER    AI 정답 != 원본 정답 (검토 필요)
 *   PRE_AGREE/PRE_DIFFER  AI 백필 대상이 아니었던 기존 정답
 *
 * 선행: python scripts/qa/enrich-source-meta.py
 * 사용: node scripts/qa/compare-answers.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const MISSING = "정답 없음";

const records = JSON.parse(
  await readFile("scripts/qa/reports/source-meta.json", "utf8"),
);

// AI 백필로 채운 문항 id (없으면 빈 집합)
let aiFilled = new Set();
try {
  aiFilled = new Set(
    (await readFile("scripts/qa/applied-answers.txt", "utf8"))
      .split(/\r?\n/)
      .filter(Boolean),
  );
} catch {
  /* 기록 없음 */
}

/** 비교용 정규화 — LaTeX·공백·구두점·단위조사를 걷어낸다. */
const norm = (s) =>
  (s ?? "")
    .normalize("NFKC")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[${}\\\s]/g, "")
    .replace(/[,.·、，]/g, "")
    .replace(/(개|명|가지|점|번|cm|m|초|도)$/u, "")
    .trim();

/** 숫자만 뽑아 비교 (부호·소수 포함) */
const nums = (s) => (String(s ?? "").match(/-?\d+(?:\.\d+)?/g) ?? []).join("|");

const withOrigin = records.filter((r) => r.originAnswer);
const ids = withOrigin.map((r) => r.problemId);

const rows = await db.problem.findMany({
  where: { id: { in: ids } },
  select: { id: true, answer: true },
});
const current = new Map(rows.map((r) => [r.id, r.answer]));

const stat = {
  RECOVER: 0,
  AGREE: 0,
  DIFFER: 0,
  PRE_AGREE: 0,
  PRE_DIFFER: 0,
  MISSING_ROW: 0,
};
const differs = [];

for (const r of withOrigin) {
  const cur = current.get(r.problemId);
  if (cur === undefined) {
    stat.MISSING_ROW++;
    continue;
  }
  if (cur.includes(MISSING)) {
    stat.RECOVER++;
    continue;
  }
  const same =
    norm(cur) === norm(r.originAnswer) ||
    (nums(cur) !== "" && nums(cur) === nums(r.originAnswer));
  const byAi = aiFilled.has(r.problemId);
  if (same) stat[byAi ? "AGREE" : "PRE_AGREE"]++;
  else {
    stat[byAi ? "DIFFER" : "PRE_DIFFER"]++;
    differs.push({
      problemId: r.problemId,
      externalId: r.externalId,
      byAi,
      db: cur.slice(0, 80),
      origin: String(r.originAnswer).slice(0, 80),
    });
  }
}

await writeFile(
  "scripts/qa/reports/answer-diff.json",
  JSON.stringify(differs, null, 1),
  "utf8",
);

const aiJudged = stat.AGREE + stat.DIFFER;
console.log("원본 정답 보유 문항:", withOrigin.length);
console.log(JSON.stringify(stat));
if (aiJudged > 0) {
  console.log(
    `AI 정답 교차검증: 일치 ${stat.AGREE} / 불일치 ${stat.DIFFER}  (일치율 ${(
      (stat.AGREE * 100) / aiJudged
    ).toFixed(1)}%)`,
  );
}
console.log("불일치 상세 → scripts/qa/reports/answer-diff.json");
await db.$disconnect();
