/**
 * eywa 학생별 진도 → 우리 DB 동기화 — **CLI 껍데기** (계획 3판 §4 · §8-1).
 *
 *   npx tsx --env-file=.env scripts/sync/sync-eywa.ts            # dry-run (기본)
 *   ALLOW_EYWA_SYNC=1 npx tsx --env-file=.env scripts/sync/sync-eywa.ts   # 실쓰기
 *
 * 본체는 `src/lib/eywa/runSync.ts` 하나다 — 「지금 가져오기」(POST /api/eywa-sync)와
 * **같은 함수**를 부른다. 여기가 더 가진 것은 **파일 원장**뿐이다: 회차별
 * `scripts/sync/ledgers/<runId>.json` (서버는 파일을 못 써 `EywaSyncLedger` 표를 쓴다).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { runEywaSync } from "@/lib/eywa/runSync";

const APPLY = process.env.ALLOW_EYWA_SYNC === "1";
const LEDGER_DIR = path.join(process.cwd(), "scripts", "sync", "ledgers");

async function main() {
  const prisma = new PrismaClient();
  try {
    const summary = await runEywaSync({
      prisma,
      apply: APPLY,
      writeLedger: (runId, payload) => {
        mkdirSync(LEDGER_DIR, { recursive: true });
        const ledgerPath = path.join(LEDGER_DIR, `${runId}.json`);
        writeFileSync(ledgerPath, JSON.stringify(payload, null, 1), "utf8");
        console.log(`\n원장: ${ledgerPath}`);
      },
    });
    if (!APPLY)
      console.log("실쓰기는 ALLOW_EYWA_SYNC=1 로. (summary 는 위 출력 그대로)");
    void summary;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
