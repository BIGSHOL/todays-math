/**
 * 보기 그림 후보를 **파일로 내보낸다** — 파이썬 회수기(`choice_figure_recover.py`)의 입력.
 *
 *   npx tsx scripts/qa/export-choice-figure-candidates.ts
 *
 * DB 접근은 TS 한 곳에 모으고(prisma 가 여기 있다), 원본 PDF 를 읽는 일은 파이썬이
 * 한다(PyMuPDF · testchanger 와 같은 도구). 사이를 잇는 것은 이 JSON 하나다.
 * 본문은 싣지 않는다 — 회수는 **좌표**로 하지 본문으로 하지 않는다(토큰 절약 §4).
 *
 * ## 세 무리를 함께 내보낸다 — 반증할 수 있어야 한다
 *
 *   `보기그림`   판정 대상.
 *   `미분류`     갈리지 않은 것 중 **그림이 둘 이상**인 것. 원본이 무엇이라 하는지 본다.
 *   `반대쪽`     그림 2장 이상인데 «보기글자» 로 본 것. **전량**이다(225건). 여기서 「보기가 그림이다」가
 *                쏟아지면 판정 규칙이 틀린 것이다 — 그 확인이 없으면 자화자찬이다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { PrismaClient } from "@prisma/client";

import {
  classifyChoiceFigureRow,
  type ChoiceFigureRow,
} from "./choiceFigureRules";

const prisma = new PrismaClient();
const OUT = "scripts/qa/reports/choice-figure-candidates.json";

interface Row extends ChoiceFigureRow {
  id: string;
  content: string;
  figureUrls: string[];
  pool: string;
  reviewStatus: string;
  directUseAllowed: boolean;
  noAnswer: boolean;
  answer: string;
  source: string;
  school: string | null;
  sourceFile: string | null;
  examId: string | null;
  questionNumber: number | null;
}

async function main() {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, content, figure_urls AS "figureUrls", pool::text AS pool,
            review_status::text AS "reviewStatus", direct_use_allowed AS "directUseAllowed",
            answer, answer = '(정답 없음)' AS "noAnswer", school, source::text AS source,
            source_file AS "sourceFile", exam_id AS "examId",
            question_number AS "questionNumber"
       FROM problem ORDER BY id`,
  )) as Row[];

  const eligible = rows.filter(
    (r) =>
      r.pool === "shared" &&
      r.reviewStatus === "approved" &&
      r.directUseAllowed &&
      !r.noAnswer,
  );

  const out: unknown[] = [];
  const tally = new Map<string, number>();
  for (const r of eligible) {
    const v = classifyChoiceFigureRow(r);
    let group: string | null = null;
    if (v.klass === "보기그림") group = "보기그림";
    else if (v.klass === "미분류" && v.features.nFig >= 2) group = "미분류";
    else if (v.klass === "보기글자" && v.features.nFig >= 2) group = "반대쪽";
    if (!group) continue;
    tally.set(group, (tally.get(group) ?? 0) + 1);
    out.push({
      id: r.id,
      group,
      klass: v.klass,
      keys: v.keys,
      markerState: v.markerState,
      markRel: v.markRel,
      nFig: v.features.nFig,
      nMark: v.features.nMark,
      markers: v.features.markers.map((m) => m.n),
      source: r.source,
      school: r.school,
      answer: r.answer,
      sourceFile: r.sourceFile,
      examId: r.examId,
      questionNumber: r.questionNumber,
      figureUrls: r.figureUrls,
    });
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 1), "utf8");
  console.log(`출제 가능 ${eligible.length}건 → 후보 ${out.length}건`);
  for (const [k, v] of tally) console.log(`  ${k} ${v}`);
  console.log(`→ ${OUT}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
