/**
 * 이미 소단원이 붙은 문항(= 정답지)을 **현재 DB 에서** 내린다. **읽기 전용.**
 *
 *   npx tsx -r dotenv/config scripts/classify/dump-labels.ts
 *
 * ⚠️ 트랙 D 의 `db-content.jsonl` 스냅샷을 쓰지 않는다. 트랙 F 가 신규 적재를
 * 계속하므로 스냅샷은 금세 낡는다(2026-08-16: 29,682 → 35,724 로 늘었고
 * 늘어난 몫이 고등에 몰려 있었다). 학습셋은 항상 현재 DB 를 본다.
 *
 * `content` 는 정렬 감사(DB 본문 ↔ 재추출 본문 대조)에만 쓰므로 앞부분만 남긴다.
 */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { OUT_DIR } from "./paths";

const OUT = `${OUT_DIR}/db-labels.jsonl`;
const BATCH = 5000;
/** 정렬 감사에 필요한 만큼만 — 한글 bigram 대조에 앞 400자면 충분하다. */
const CONTENT_KEEP = 400;

async function main() {
  const prisma = new PrismaClient();
  try {
    const lines: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const rows = await prisma.problem.findMany({
        where: { source: "past_exam", externalId: { not: null } },
        select: { id: true, externalId: true, examId: true, questionNumber: true, unitId: true, content: true },
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (rows.length === 0) break;
      for (const r of rows) {
        lines.push(JSON.stringify({
          problemId: r.id,
          externalId: r.externalId,
          examId: r.examId,
          n: r.questionNumber,
          unitId: r.unitId,
          content: (r.content ?? "").slice(0, CONTENT_KEEP),
        }));
      }
      cursor = rows[rows.length - 1].id;
      process.stdout.write(`\r내려받는 중 ${lines.length}`);
    }
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
    console.log(`\n라벨 ${lines.length}행 → ${OUT}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
