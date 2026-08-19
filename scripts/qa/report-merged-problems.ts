/**
 * **한 행에 문항이 여럿 뭉친 것**을 센다.
 *
 * ## 왜 따로 세는가 — 정답 대조로는 **구조적으로 못 본다**
 *
 * `report-unusable-problems.ts` 는 「정답이 보기 중 하나인가」를 묻는다. 그런데
 * 이 부류는 그 물음에 걸리지 않는다:
 *
 * - 뭉친 것이 **서술형**이면 애초에 비객관식이라 판정 대상이 아니고,
 * - 뭉친 것이 **객관식**이어도 첫 문항의 보기·정답은 **정확히 맞는다**
 *   (`4103-15`: 보기 1~5 가 있고 정답 `③` 이 그중 하나다 → 「정상」으로 읽힌다).
 *
 * 지표가 실패를 **셀 수 있는 형태**여야 한다는 자리다(CLAUDE.md 2026-08-16).
 * 열쇠는 정답이 아니라 **머리표의 개수**다.
 *
 * ## 열쇠를 한 번 고쳤다 — 본문 안 상호참조
 *
 * 처음엔 `[서술형` 을 그냥 세어 17건이 나왔다. 표본을 보니 `3078-17` 은 한 문항인데
 * 「**[서술형 3-⑴]의 결과를 이용할 수 있음**」이라고 **자기를 가리키고** 있었다.
 * 그래서 ㉠ 머리표 뒤에 `-`·`의` 가 붙으면 상호참조로 보고 빼고, ㉡ 남은 머리표의
 * **번호가 서로 달라야** 두 문항으로 센다. 11건이 됐고 **전량 눈으로 확인**했다.
 *
 * 사용: `npx tsx scripts/qa/report-merged-problems.ts [--list]`
 */
import { PrismaClient } from "@prisma/client";

import { countProblemHeads } from "../../src/lib/problem/mergedProblemRule";

async function main(): Promise<void> {
  const list = process.argv.includes("--list");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.problem.findMany({
      // 「지금 학생에게 나갈 수 있는가」가 이 보고서의 분모다.
      where: { directUseAllowed: true, reviewStatus: "approved" },
      select: {
        id: true,
        externalId: true,
        source: true,
        content: true,
        answer: true,
      },
      orderBy: { id: "asc" },
    });

    const hits = rows
      .map((r) => ({ ...r, heads: countProblemHeads(r.content ?? "") }))
      .filter((r) => r.heads.length >= 2);

    const bySource: Record<string, number> = {};
    for (const h of hits) bySource[h.source] = (bySource[h.source] ?? 0) + 1;
    const noAnswer = hits.filter((h) => (h.answer ?? "").includes("정답 없음"));

    console.log(`분모: 출제 가능 **${rows.length}건**`);
    console.log(
      `\n■ 한 행에 문항이 여럿 (서로 다른 머리표 2개 이상) **${hits.length}건**`,
    );
    console.log(`   · source 별            ${JSON.stringify(bySource)}`);
    console.log(`   · 정답이 «(정답 없음)»  ${noAnswer.length}건`);
    if (hits.length > 0) {
      const most = hits.reduce((a, b) =>
        b.heads.length > a.heads.length ? b : a,
      );
      console.log(
        `   · 머리표가 가장 많은 것 ${most.externalId ?? most.id} (${most.heads.length}개)`,
      );
    }

    if (list) {
      console.log("\n전량:");
      for (const h of hits) {
        console.log(
          `  · ${h.externalId ?? h.id} [${h.heads.join(",")}] 정답 ${JSON.stringify(
            (h.answer ?? "").slice(0, 46),
          )}`,
        );
      }
    } else if (hits.length > 0) {
      console.log("\n전량을 보려면 --list");
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
