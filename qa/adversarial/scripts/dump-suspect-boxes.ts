/**
 * 적대적 리뷰 — 「끝 경계 의심」 상자를 **전량** 토해 낸다. **읽기 전용.**
 *
 * `scripts/qa/audit-box-boundary.ts` 는 표본 6개만 보여 준다. 보고서는 그 6개를 보고
 * 「남은 것은 감사 도구의 오탐(`f(1)`)」이라고 적었다. 그 주장을 검증하려면 **전량**을
 * 봐야 한다 (CLAUDE.md 2026-08-18: 적용할 컬럼마다 전량을 보라).
 *
 * 실행: npx tsx qa/adversarial/scripts/dump-suspect-boxes.ts <신호이름>
 *   신호이름: 물음표 · 하위문항1 · 하위문항원 · 머리말 · 통짜
 */
import { PrismaClient } from "@prisma/client";

import { parseProblemContent } from "../../../src/lib/problem/parseProblemContent";

const prisma = new PrismaClient();

interface Box {
  header: string;
  items: string[];
  raw: string;
}

function boxesOf(question: string): Box[] {
  const boxes: Box[] = [];
  let cur: string[] | null = null;
  for (const rawLine of question.split(/\r?\n/)) {
    const line = rawLine.trimStart();
    if (line.startsWith(">")) {
      if (cur === null) cur = [];
      cur.push(line.replace(/^>\s?/, ""));
      continue;
    }
    if (cur) {
      boxes.push(toBox(cur));
      cur = null;
    }
  }
  if (cur) boxes.push(toBox(cur));
  return boxes;
}
function toBox(lines: string[]): Box {
  const paras = lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    header: paras[0] ?? "",
    items: paras.slice(1),
    raw: paras.join("\n"),
  };
}

/* audit-box-boundary.ts 와 **같은** 신호를 쓴다 — 비교가 되게. */
const SUB_CIRCLED = /[⑴-⑽]/;
const SUB_PAREN = /(?:^|[\s$\n(])\(\s*[1-9]\s*\)/;
const EXAM_HEADER =
  /\d{4}\s*년|중간고사|기말고사|학력평가|모의고사|[가-힣]{2,5}(?:중|고)등?학?교?\s*\d\s*학년/;

const SIGNALS: Record<string, (body: string, box: Box) => boolean> = {
  물음표: (body) => /[?？]/.test(body),
  하위문항1: (body) => SUB_PAREN.test(body),
  하위문항원: (body) => SUB_CIRCLED.test(body),
  머리말: (body) => EXAM_HEADER.test(body),
  통짜: (_body, box) => box.items.length === 1 && box.items[0]!.length > 200,
};

async function main() {
  const name = process.argv[2] ?? "물음표";
  const test = SIGNALS[name];
  if (!test) throw new Error(`모르는 신호: ${name} (${Object.keys(SIGNALS)})`);

  const total = await prisma.problem.count();
  let found = 0;
  const PAGE = 2000;
  for (let skip = 0; skip < total; skip += PAGE) {
    const rows = await prisma.problem.findMany({
      select: { id: true, content: true },
      orderBy: { id: "asc" },
      skip,
      take: PAGE,
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      const { question } = parseProblemContent(row.content ?? "");
      for (const box of boxesOf(question)) {
        const body = box.items.join("\n");
        if (!test(body, box)) continue;
        found += 1;
        console.log(`\n=== ${found}. ${row.id}`);
        console.log(
          box.raw
            .split("\n")
            .map((l) => "    " + l)
            .join("\n"),
        );
      }
    }
  }
  console.log(`\n합계 ${found}개`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
