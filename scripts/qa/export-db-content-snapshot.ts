/**
 * 트랙 D — 공유 DB 본문 스냅샷 내보내기 (**읽기 전용**).
 *
 * D-2 교체 판정은 DB 본문과 HWP 원본을 문항 단위로 맞대야 한다. 매 판정마다
 * 공유 DB 를 때리면 느리고 재현이 안 되므로 한 번만 읽어 로컬 JSONL 로 떨군다.
 *
 *   scripts/qa/reports/db-content.jsonl
 *
 * `solution` 은 길이만 싣는다(트랙 B 소관 · 용량). `answer` 도 판정 신호로만 쓰고
 * **쓰지 않는다** — 트랙 B 소관이다.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const OUT = "scripts/qa/reports/db-content.jsonl";
const CHUNK = 2000;

async function main() {
  const prisma = new PrismaClient();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const stream = fs.createWriteStream(OUT, { encoding: "utf-8" });

  let cursor: string | undefined;
  let n = 0;
  for (;;) {
    const rows = await prisma.problem.findMany({
      // ⚠️ `source` 로 먼저 거른다. `examId`/`externalId` 형식을 가정하면 다른 트랙이
      // 다른 모양의 키를 채우는 순간 조용히 어긋난다 — 코디네이터 보고(2026-08-16):
      // build-discard-list.ts 가 externalId 를 `<examId>-<번호>` 로 가정했다가
      // 트랙 C 가 RPM 행에 sumaek UUID 를 넣자 31건이 에러 없이 '원본 미상'이 됐다.
      // HWP 재추출은 기출(past_exam)에만 해당한다.
      where: { source: "past_exam", examId: { not: null } },
      select: {
        id: true,
        externalId: true,
        examId: true,
        questionNumber: true,
        source: true,
        problemType: true,
        difficulty: true,
        score: true,
        content: true,
        answer: true,
        solution: true,
        figureUrls: true,
        unitId: true,
        reviewStatus: true,
        sourceFile: true,
      },
      orderBy: { id: "asc" },
      take: CHUNK,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      stream.write(
        JSON.stringify({
          id: r.id,
          externalId: r.externalId,
          examId: r.examId,
          n: r.questionNumber,
          source: r.source,
          problemType: r.problemType,
          difficulty: r.difficulty,
          score: r.score,
          content: r.content,
          answer: r.answer,
          solLen: r.solution ? r.solution.length : 0,
          figs: r.figureUrls?.length ?? 0,
          unitId: r.unitId,
          review: r.reviewStatus,
          sourceFile: r.sourceFile,
        }) + "\n",
      );
    }
    n += rows.length;
    cursor = rows[rows.length - 1].id;
    if (n % 10000 === 0) console.log(`  … ${n}`);
  }
  stream.end();
  await prisma.$disconnect();
  console.log(`DB 스냅샷 ${n}행 → ${OUT}`);
}

main();
