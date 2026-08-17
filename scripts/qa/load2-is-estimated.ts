/**
 * **이 문항의 소단원은 추정으로 붙인 것인가?** — 한 줄로 조회한다.
 *
 *   npx tsx scripts/qa/load2-is-estimated.ts 2375-11
 *   npx tsx scripts/qa/load2-is-estimated.ts 2375-11 4437-3 1360-7   (여러 개 가능)
 *   npx tsx scripts/qa/load2-is-estimated.ts --unit "중3 / 5. 삼각비 / 삼각비의 활용"
 *   npx tsx scripts/qa/load2-is-estimated.ts --exam 2375
 *
 * ## 왜 이 스크립트가 있나
 *
 * 2026-08-17 2차 적재 4,513행은 **시험지가 소단원명을 적어 주지 않은 문항**이고,
 * 소단원을 트랙 G 가 본문·범위로 **추정해서** 붙였다(A안, 실측 정확도 90%).
 * 즉 **약 416행은 엉뚱한 소단원에 실려 있다** — 원장님이 확정하신 전제다.
 *
 * `Problem` 에는 «추정으로 붙였다» 를 적을 칸이 없다.
 * **`scripts/qa/handoff/load2-external-ids.json` 이 유일한 기록이다.**
 *
 * 원장님이 수업에서 진도와 안 맞는 문항을 보셨을 때, 그게 이 묶음에 든 것인지
 * 여기서 한 번에 답한다. 들었다면 소단원이 틀렸을 가능성이 있는 행이고,
 * 안 들었다면 시험지가 적어 준 소단원을 그대로 쓴 행이라 다른 원인을 봐야 한다.
 *
 * 읽기 전용이다. `--unit`·`--exam` 만 DB 를 읽는다(단원 이름을 풀려고).
 */
import { readFile } from "node:fs/promises";

import { isDirectScript } from "../import/isDirectScript";

const IDS = "scripts/qa/handoff/load2-external-ids.json";

interface Verdict {
  externalId: string;
  unitId: string;
  confidence: number;
  학년?: string | null;
}

export async function isEstimated(args: string[]): Promise<void> {
  const list = JSON.parse(await readFile(IDS, "utf8")) as {
    총: number;
    차수: string;
    입력corpus: { fingerprint: string };
    출제보류_pending: string[];
    판정: Verdict[];
  };
  const byId = new Map(list.판정.map((p) => [p.externalId, p]));

  const header = (): void => {
    console.log(
      `추정 배정분 — ${list.차수} · ${list.총}행 · corpus ${list.입력corpus.fingerprint}\n` +
        `기록: ${IDS}\n`,
    );
  };

  const mode = args[0];
  if (args.length === 0) {
    header();
    console.log("사용법: npx tsx scripts/qa/load2-is-estimated.ts <externalId ...>");
    console.log("        npx tsx scripts/qa/load2-is-estimated.ts --exam <examId>");
    console.log('        npx tsx scripts/qa/load2-is-estimated.ts --unit "<학년 / 중단원 / 소단원>"');
    return;
  }

  if (mode === "--exam" || mode === "--unit") {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const units = await prisma.unit.findMany({
        select: { id: true, grade: true, chapter: true, section: true },
      });
      const label = (id: string): string => {
        const u = units.find((x) => x.id === id);
        return u ? `${u.grade} / ${u.chapter} / ${u.section}` : id;
      };
      header();
      if (mode === "--exam") {
        const exam = args[1];
        const hits = list.판정.filter((p) => p.externalId.startsWith(`${exam}-`));
        console.log(`편 ${exam} 의 추정 배정분 ${hits.length}행:`);
        for (const h of hits) {
          console.log(
            `  ${h.externalId.padEnd(12)} 확신 ${String(h.confidence).padEnd(7)} ${label(h.unitId)}`,
          );
        }
      } else {
        const want = args.slice(1).join(" ").trim();
        const hits = list.판정.filter((p) => label(p.unitId) === want);
        console.log(`«${want}» 의 추정 배정분 ${hits.length}행:`);
        for (const h of hits.slice(0, 100)) {
          console.log(`  ${h.externalId.padEnd(12)} 확신 ${h.confidence}`);
        }
        if (hits.length > 100) console.log(`  … 외 ${hits.length - 100}행`);
      }
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  header();
  const pending = new Set(list.출제보류_pending);
  for (const id of args) {
    const hit = byId.get(id);
    if (!hit) {
      console.log(`${id.padEnd(12)} ❌ 이 묶음에 **없다** — 소단원은 시험지가 적어 준 것이다.`);
      continue;
    }
    console.log(
      `${id.padEnd(12)} ⚠️ **추정 배정분이다** · unitId ${hit.unitId}` +
        ` · 확신 ${hit.confidence} · 학년 ${hit.학년 ?? "?"}` +
        (pending.has(id) ? " · 출제보류(pending)" : ""),
    );
  }
}

if (isDirectScript(import.meta.url)) {
  isEstimated(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
