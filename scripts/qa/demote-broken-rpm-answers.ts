/**
 * **정답 값이 훼손된 RPM 문항을 출제에서 뺀다** (`reviewStatus` → `pending`).
 *
 * 왜: 정답에 `\square` 자리표가 남아 답으로 읽히지 않는 행이 97건 있다.
 * 문서 14 §4 가 18건으로 적은 것은 짧은 것만 추린 하한이었다.
 *
 * ⚠️ **원본에서 되가져올 수 없다.** sumaek 원본 DB 를 읽어 97건 전부 대조한 결과
 * 원본 값이 우리 값과 **글자까지 같았다**(2026-08-17). 우리 이관 결함이 아니라
 * 원본 자체의 결함이다. 그래서 「폐기냐 복원이냐」 중 복원 선택지가 없다 —
 * RPM 교재 원본(PDF/HWP)까지 올라가야 답이 나온다.
 *
 * ⚠️ **규칙으로 치환하지 마라.** `\square` 가 `\sqrt` 인지 `\overline` 인지는
 * 자리마다 다르다(`\square PB` 옆에 `\overline{PA}` 가 나란히 있다). 추정 치환은
 * 「깨지지 않은 틀린 답」을 만든다 — 감싸는 것과 고치는 것은 다르다.
 *
 * 삭제하지 않는다. `reviewStatus` 강등은 되돌릴 수 있고 삭제는 되돌릴 수 없다.
 * 되돌리기 목록을 **적용 전에** 파일로 쓰고, 못 쓰면 한 행도 건드리지 않는다.
 *
 *   npx tsx scripts/qa/demote-broken-rpm-answers.ts            대조만
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/demote-broken-rpm-answers.ts --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/demote-broken-rpm-answers.ts --revert
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";

const OUT = "scripts/qa/broken-answer-demoted.json";
const MARK = "\square";

interface Entry {
  id: string;
  externalId: string | null;
  previous: string;
  next: string;
  answerHead: string;
}

/** 공유 DB 쓰기 가드 — 네트워크·DB 를 건드리기 **전에** 본다. */
async function ensureWritable(): Promise<boolean> {
  const inspection = await inspectDatabaseTargets();
  if (
    inspection.selected.canMigrateOrLoad ||
    allowSharedImport(inspection.selected)
  ) {
    return true;
  }
  console.log(
    `차단 — ${inspection.selected.reason}\nALLOW_SHARED_IMPORT=1 을 명시하세요.`,
  );
  return false;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const revert = process.argv.includes("--revert");
  if ((apply || revert) && !(await ensureWritable())) return;

  const prisma = new PrismaClient();
  try {
    if (revert) {
      const saved = JSON.parse(await readFile(OUT, "utf-8")) as {
        entries: Entry[];
      };
      let back = 0;
      for (const e of saved.entries) {
        await prisma.problem.update({
          where: { id: e.id },
          data: { reviewStatus: e.previous as never },
        });
        back += 1;
      }
      console.log(`되돌림 ${back} / ${saved.entries.length}`);
      return;
    }

    const rows = await prisma.problem.findMany({
      where: { source: "transformed", answer: { contains: MARK } },
      select: {
        id: true,
        externalId: true,
        answer: true,
        reviewStatus: true,
      },
    });
    const targets = rows.filter((r) => String(r.reviewStatus) !== "pending");

    console.log("── 정답 훼손 RPM 문항 강등 ──");
    console.log(`\square 든 행 ${rows.length}`);
    console.log(`  이미 pending ${rows.length - targets.length}`);
    console.log(`  강등 대상    ${targets.length}`);
    if (!apply) {
      console.log(`\n대조만 함. 반영하려면 --apply`);
      return;
    }

    const entries: Entry[] = targets.map((r) => ({
      id: r.id,
      externalId: r.externalId,
      previous: String(r.reviewStatus),
      next: "pending",
      answerHead: r.answer.slice(0, 60),
    }));

    // ⚠️ 되돌리기 목록이 먼저다. 못 쓰면 한 행도 건드리지 않는다.
    await mkdir("scripts/qa", { recursive: true });
    await writeFile(
      OUT,
      JSON.stringify(
        {
          생성시각: new Date().toISOString(),
          사유: "정답 값 훼손(\square)",
          entries,
        },
        null,
        1,
      ),
      "utf-8",
    );
    console.log(`되돌리기 목록 → ${OUT} (${entries.length}행)`);

    let done = 0;
    for (const e of entries) {
      await prisma.problem.update({
        where: { id: e.id },
        data: { reviewStatus: "pending" as never },
      });
      done += 1;
    }
    console.log(`\n강등 ${done}`);

    const after = await prisma.problem.count({
      where: {
        source: "transformed",
        answer: { contains: MARK },
        reviewStatus: "approved" as never,
      },
    });
    console.log(`남은 approved (0 이라야 한다) ${after}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
