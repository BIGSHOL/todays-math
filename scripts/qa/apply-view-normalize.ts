/**
 * AI 생성 문항의 **보기 표기를 말뭉치 형식으로** 맞춘다 (`①` → `1.`, 보기 앞 빈 줄).
 *
 *   npx tsx scripts/qa/apply-view-normalize.ts                       드라이런
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-view-normalize.ts --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-view-normalize.ts --revert
 *
 * ## 화면은 안 바뀐다 — 그런데 왜 고치나
 *
 * 실측: 기존 객관식 4,000건 중 **3,999건이 줄머리 `1.`**, 우리 19건은 전부 원문자다.
 * 그런데 `parseProblemContent` 가 마커를 **떼고** 렌더러가 `CHOICE_MARKS` 로 ①②③ 를
 * 다시 붙이므로 **렌더 결과는 글자까지 같다**(`scripts/qa/diff-view.ts` 가 대조한다).
 *
 * 그래도 맞추는 이유는 **우리만 다른 형식이면 앞으로 나올 도구가 정확히 우리 행에서만
 * 헛다리를 짚기 때문**이다. 이 저장소는 「마커를 손으로 세는」 코드를 이미 여러 번
 * 만들었고(그중 하나는 이 적재기 자신이었다), 그런 코드는 소수 형식을 조용히 0으로 센다.
 *
 * ## 🔴 안전 장치
 *
 * ⑴ **렌더가 같은지 한 건씩 확인하고** 다르면 그 행은 건드리지 않는다 — 「같을 것이다」가
 *    아니라 매 행 확인이다. ⑵ 보기 수가 달라지면 안 바꾼다. ⑶ 원장을 **DB 보다 먼저**
 *    쓰고, 되돌리기는 **지금 값이 우리가 쓴 값일 때만** 한다(D-31 · 되돌리기 원장 규약).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";
import { renderMathHtml } from "../../src/lib/math/renderMathHtml";

const prisma = new PrismaClient();
const LEDGER = "scripts/qa/reports/view-normalize-ledger.json";

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");

if ((APPLY || REVERT) && process.env.ALLOW_SHARED_IMPORT !== "1") {
  console.error(
    "공유 DB 쓰기가 막혀 있다(D-31). ALLOW_SHARED_IMPORT=1 이 필요하다.",
  );
  process.exit(1);
}

const MARKS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮";

/** 우리 형식 → 말뭉치 형식. 첫 보기 앞에만 빈 줄을 넣는다(기존 4,000건 전량이 그 모양). */
export function toCorpusShape(content: string): string {
  let first = true;
  const out = content.replace(
    /(\n)([ \t]*)([①-⑮])([ \t]*)/g,
    (_all, _nl, indent: string, mark: string, tail: string) => {
      const n = MARKS.indexOf(mark) + 1;
      const lead = first ? "\n\n" : "\n";
      first = false;
      return `${lead}${indent}${n}.${tail || " "}`;
    },
  );
  return out.replace(/\n{3,}(\d{1,2}\.)/, "\n\n$1");
}

export interface Decision {
  fix: boolean;
  reason?: string;
}

/** 이 행을 바꿔도 되는가 — **렌더가 같을 때만.** */
export function decideNormalize(before: string, after: string): Decision {
  if (after === before)
    return { fix: false, reason: "이미 말뭉치 형식이다 (멱등)" };
  const a = parseProblemContent(before);
  const b = parseProblemContent(after);
  if (a.choices.length !== b.choices.length)
    return {
      fix: false,
      reason: `보기 수가 달라진다 (${a.choices.length} → ${b.choices.length})`,
    };
  const render = (p: { question: string; choices: string[] }) =>
    [renderMathHtml(p.question), ...p.choices.map(renderMathHtml)].join("");
  if (render(a) !== render(b))
    return { fix: false, reason: "렌더가 달라진다 — 건드리지 않는다" };
  return { fix: true };
}

interface LedgerRow {
  id: string;
  code: string;
  before: string;
  after: string;
}

async function main(): Promise<void> {
  if (REVERT) {
    if (!existsSync(LEDGER)) throw new Error(`원장이 없다: ${LEDGER}`);
    const rows = (
      JSON.parse(readFileSync(LEDGER, "utf8")) as { 바꾼행: LedgerRow[] }
    ).바꾼행;
    let back = 0;
    let skip = 0;
    for (const r of rows) {
      // 지금 값이 **우리가 쓴 값일 때만** 되돌린다 — 그 사이 누가 고쳤으면 남의 것이다.
      const now = await prisma.problem.findUnique({
        where: { id: r.id },
        select: { content: true },
      });
      if (!now || now.content !== r.after) {
        skip += 1;
        continue;
      }
      await prisma.problem.update({
        where: { id: r.id },
        data: { content: r.before },
      });
      back += 1;
    }
    console.log(
      `되돌렸다 ${back}건 · 건드리지 않았다 ${skip}건 / 원장 ${rows.length}건`,
    );
    await prisma.$disconnect();
    return;
  }

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id::text AS id, problem_code AS code, content FROM problem
      WHERE source = 'ai_generated' ORDER BY problem_code`,
  )) as { id: string; code: string; content: string }[];

  const todo: LedgerRow[] = [];
  const skipped: { code: string; reason: string }[] = [];
  for (const r of rows) {
    const after = toCorpusShape(r.content);
    const d = decideNormalize(r.content, after);
    if (d.fix) todo.push({ id: r.id, code: r.code, before: r.content, after });
    else skipped.push({ code: r.code, reason: d.reason ?? "?" });
  }

  console.log(
    `  AI 생성 ${rows.length}건 · 바꿀 것 ${todo.length}건 · 건너뜀 ${skipped.length}건`,
  );
  // 분모 검산 — 「바꿀 것 + 건너뜀」이 전체와 안 맞으면 범위가 샌 것이다.
  if (todo.length + skipped.length !== rows.length)
    throw new Error("범위가 샜다.");
  for (const s of skipped.slice(0, 10))
    console.log(`   · ${s.code}  ${s.reason}`);

  if (!APPLY) {
    console.log(`\n드라이런이다 — DB 를 한 건도 안 썼다.`);
    await prisma.$disconnect();
    return;
  }

  // 원장을 **DB 보다 먼저** 쓴다.
  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        적용: "AI 생성 문항 보기 표기를 말뭉치 형식으로 (① → 1., 보기 앞 빈 줄)",
        근거: "기존 객관식 4,000건 중 3,999건이 줄머리 `1.` — 렌더는 양쪽이 같다",
        기준시각: new Date().toISOString(),
        되돌리기: `ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-view-normalize.ts --revert`,
        바꾼행: todo,
      },
      null,
      1,
    ),
    "utf8",
  );
  for (const r of todo)
    await prisma.problem.update({
      where: { id: r.id },
      data: { content: r.after },
    });
  console.log(`\n  바꿨다 ${todo.length}건 · 원장 → ${LEDGER}`);
  await prisma.$disconnect();
}

if (process.argv[1]?.includes("apply-view-normalize")) void main();
