/**
 * 뺄 43건을 **내가 직접** 다시 골라 본문·정답·그림과 함께 펼친다.
 * 만든 사람의 원장을 믿지 않고 pairs+candidates 에서 다시 유도한다.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface Pair {
  id: string;
  verdict: string;
  why?: string;
  figureUrls?: string[];
}
interface Cand {
  id: string;
  group: string;
  klass: string;
  keys: string[];
  nFig: number;
  nMark: number;
  markers: number[];
  school: string | null;
  answer: string;
  sourceFile: string | null;
  examId: string | null;
  questionNumber: number | null;
  figureUrls: string[];
}

async function main() {
  const pairs = JSON.parse(
    readFileSync("scripts/qa/reports/choice-figure-pairs.json", "utf8"),
  ) as Pair[];
  const cands = JSON.parse(
    readFileSync("scripts/qa/reports/choice-figure-candidates.json", "utf8"),
  ) as Cand[];
  const byId = new Map(cands.map((c) => [c.id, c]));
  const choiceFigure = new Set(
    cands.filter((c) => c.group === "보기그림").map((c) => c.id),
  );

  const mine = pairs.filter(
    (p) => p.verdict === "불가" && choiceFigure.has(p.id),
  );
  console.log(`내가 유도한 «보기그림»의 «불가»: ${mine.length}건`);

  const ledger = JSON.parse(
    readFileSync("scripts/qa/reports/choice-figure-discard-lock.json", "utf8"),
  ) as { 이전상태: { id: string }[] };
  const theirs = new Set(ledger.이전상태.map((r) => r.id));
  const onlyMine = mine.filter((p) => !theirs.has(p.id)).map((p) => p.id);
  const onlyTheirs = [...theirs].filter((id) => !mine.some((p) => p.id === id));
  console.log(
    `  원장과 대조 — 나만 ${onlyMine.length} · 원장만 ${onlyTheirs.length}`,
  );
  if (onlyMine.length) console.log("   나만:", onlyMine);
  if (onlyTheirs.length) console.log("   원장만:", onlyTheirs);

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id::text AS id, content, answer, question_type AS "questionType",
            direct_use_allowed AS "directUseAllowed", figure_urls AS "figureUrls",
            unit_id::text AS "unitId", source::text AS source
       FROM problem WHERE id = ANY($1::uuid[])`,
    mine.map((p) => p.id),
  )) as {
    id: string;
    content: string;
    answer: string;
    questionType: string;
    directUseAllowed: boolean;
    figureUrls: string[];
    unitId: string | null;
    source: string;
  }[];
  const db = new Map(rows.map((r) => [r.id, r]));

  const out: unknown[] = [];
  for (const p of mine) {
    const c = byId.get(p.id)!;
    const r = db.get(p.id)!;
    out.push({
      id: p.id,
      why: p.why,
      school: c.school,
      q: c.questionNumber,
      examId: c.examId,
      keys: c.keys,
      nFig: c.nFig,
      nMark: c.nMark,
      markers: c.markers,
      answer: r?.answer,
      questionType: r?.questionType,
      source: r?.source,
      directUseAllowed: r?.directUseAllowed,
      figureUrls: r?.figureUrls,
      sourceFile: c.sourceFile,
      content: r?.content,
    });
  }
  writeFileSync(
    "qa/adversarial/discard43.json",
    JSON.stringify(out, null, 1),
    "utf8",
  );
  console.log(`→ qa/adversarial/discard43.json (${out.length}건)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
