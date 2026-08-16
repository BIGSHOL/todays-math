/**
 * `answer` 컬럼을 **적용 전후로 찍어** 실제로 바뀐 행만 되돌리기 목록으로 남긴다.
 *
 * 왜 따로 있나: 트랙 C 의 `recover-rpm-answers.ts` 는 되돌리기 목록을 안 남기는데,
 * **그 파일은 트랙 C 소유라 내가 고치면 안 된다**(트랙 규칙 9). `answer` 컬럼은
 * 트랙 B 소관이므로, 그 도구를 감싸는 대신 **앞뒤로 값을 찍어 차이를 낸다.**
 *
 * 단계마다 파일을 따로 두는 이유는 phase1~3 과 같다 — 섞이면 되돌릴 때 못 가른다.
 *
 *   npx tsx scripts/qa/snapshot-answers.ts --tag phase4-rpm --before
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/recover-rpm-answers.ts --apply
 *   npx tsx scripts/qa/snapshot-answers.ts --tag phase4-rpm --after
 *
 * `--source` 로 대상을 좁힌다(기본 `transformed`). `--missing-only` 는 지금
 * `(정답 없음)` 인 행만 찍는다 — 채우기 작업이면 그것으로 충분하고 훨씬 가볍다.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { PrismaClient, type ProblemSource } from "@prisma/client";

import { writeAppliedLog } from "./applied-log";

const SENTINEL = "정답 없음";

function arg(name: string, fallback?: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
}

async function main(): Promise<void> {
  const tag = arg("tag");
  if (!tag) {
    console.log("--tag <단계이름> 이 필요하다 (예: phase4-rpm)");
    return;
  }
  const source = arg("source", "transformed") as ProblemSource;
  const missingOnly = process.argv.includes("--missing-only");
  const before = process.argv.includes("--before");
  const after = process.argv.includes("--after");
  if (before === after) {
    console.log("--before 또는 --after 중 하나를 줘야 한다");
    return;
  }
  const snapshotPath = `scripts/qa/reports/_snapshot-${tag}.json`;

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.problem.findMany({
      where: {
        source,
        ...(missingOnly ? { answer: { contains: SENTINEL } } : {}),
      },
      select: { id: true, externalId: true, answer: true },
    });

    if (before) {
      await mkdir("scripts/qa/reports", { recursive: true });
      await writeFile(
        snapshotPath,
        JSON.stringify({ tag, source, missingOnly, rows }, null, 1),
        "utf-8",
      );
      console.log(`적용 전 스냅숏 ${rows.length}행 → ${snapshotPath}`);
      return;
    }

    const snap = JSON.parse(await readFile(snapshotPath, "utf-8")) as {
      rows: Array<{ id: string; externalId: string | null; answer: string }>;
    };
    const wasBy = new Map(snap.rows.map((r) => [r.id, r.answer]));
    // `--missing-only` 로 찍었으면 채워진 행은 이번 조회에 안 잡힌다. 그래서 스냅숏
    // 쪽을 기준으로 지금 값을 다시 읽는다.
    const nowRows = await prisma.problem.findMany({
      where: { id: { in: snap.rows.map((r) => r.id) } },
      select: { id: true, externalId: true, answer: true },
    });
    const changed = nowRows
      .filter((r) => wasBy.get(r.id) !== r.answer)
      .map((r) => ({
        id: r.id,
        externalId: r.externalId,
        before: wasBy.get(r.id) as string,
        after: r.answer,
      }));
    const logPath = await writeAppliedLog(tag, "recover-rpm-answers.ts", changed);
    console.log(
      `스냅숏 ${snap.rows.length}행 중 **실제로 바뀐 것 ${changed.length}행**`,
    );
    for (const row of changed.slice(0, 5)) {
      console.log(
        `   ${(row.externalId ?? row.id).slice(0, 14)} ${JSON.stringify(row.before)} → ${JSON.stringify(row.after)}`,
      );
    }
    console.log(`되돌리기 목록(이 단계만) → ${logPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
