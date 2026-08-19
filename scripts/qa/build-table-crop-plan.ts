/**
 * **표가 곧 보기인 문항**의 오려내기 계획. 원본 `(완료).PDF` 를 그대로 쓴다.
 *
 *   npx tsx scripts/qa/build-table-crop-plan.ts
 *
 * 출력: `scripts/qa/reports/table-crop-plan.json`
 * 쓰는 곳: `python scripts/figure/crop-table-by-stem.py`
 *
 * ## 이 부류가 무엇인가
 *
 * 시험지에 「표 안에 ①②③④⑤ 가 들어 있는」 문항이 있다. 추출이 표 구조를 잃으면
 * 칸이 한 줄로 뭉개져 **표도 보기도 못 읽는 본문**이 남는다:
 *
 *   `다음 표에서 … 나머지 넷과 결과가 다른 하나는? 수 분류 $-\frac{8}{4}$ $0$ … 자연수 ② 정수 ③ ④ 유리수 ⑤`
 *
 * 그림 유실과 다른 결함이다 — 본문이 그림을 «가리키지» 않으므로 `missingFigureRule` 이
 * 잡지 않고, 보기 그림 짝도 아니다. 그래서 목록을 손으로 들고 있는다.
 * (adv-figref-review.md §3.2 가 이 셋을 「표가 깨진 문항」으로 갈라 두었다.)
 */
import { existsSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const OUT = "scripts/qa/reports/table-crop-plan.json";

/**
 * 대상 — **사람이 눈으로 갈라낸 목록**이다. 자동 판정기가 아직 없다.
 * 새로 찾으면 여기 추가하고, 규칙으로 셀 수 있게 되면 이 목록을 지운다.
 */
const TARGETS: Record<string, string> = {
  "3936-1":
    "효성중 1 — 순환소수/순환마디/간단히 나타내기 3열 표. 칸에 ①③⑤ 가 있다",
  "5348-8": "학산중 8 — 자연수/정수/유리수 ○× 표. 칸에 ①~⑤ 가 있다",
  "5225-7": "대진중 7 — 다항식 덧뺄셈 표. 칸에 ①~⑤ 가 있다",
};

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const rows = await prisma.problem.findMany({
    where: { externalId: { in: Object.keys(TARGETS) } },
    select: {
      id: true,
      externalId: true,
      questionNumber: true,
      content: true,
      sourceFile: true,
    },
  });

  const plan = [];
  let noSource = 0;
  for (const r of rows) {
    if (!r.sourceFile || !existsSync(r.sourceFile)) {
      noSource++;
      console.log(`  원본이 없다: ${r.externalId}`);
      continue;
    }
    plan.push({
      id: r.id,
      externalId: r.externalId!,
      e: r.externalId!.split("-")[0]!,
      q: r.questionNumber ?? Number(r.externalId!.split("-")[1] ?? 0),
      pdf: r.sourceFile,
      content: r.content,
    });
  }
  writeFileSync(
    OUT,
    JSON.stringify(
      { 대상: Object.keys(TARGETS).length, 문항수: plan.length, 목록: plan },
      null,
      1,
    ),
    "utf8",
  );
  // 분모가 안 맞으면 조용히 빠진 행이 있다는 뜻이다.
  const counted =
    plan.length + noSource + (Object.keys(TARGETS).length - rows.length);
  if (counted !== Object.keys(TARGETS).length) {
    throw new Error(
      `분모가 안 맞는다: 대상 ${Object.keys(TARGETS).length} ≠ 합 ${counted}`,
    );
  }
  console.log(
    `대상 ${Object.keys(TARGETS).length}행 · DB 에 있는 것 ${rows.length} · 원본이 있는 것 ${plan.length}\n→ ${OUT}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
