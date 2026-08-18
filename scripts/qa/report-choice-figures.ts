/**
 * **보기가 그림인데 번호와 그림이 이어지지 않는 문항**을 센다 (읽기 전용).
 *
 *   npx tsx scripts/qa/report-choice-figures.ts
 *
 * ## 왜 이 자를 따로 만들었나
 *
 * 넘침 조사(`report-oversize-problems.ts`)는 **높이**를 센다. 그런데 「그래프 개형
 * 고르기」 문항은 높이를 고쳐도 지면에 `① [그림] ② [그림]` 이라고 찍힌다 —
 * **어느 그래프가 ①인지 지면에 없다.** 학생은 답을 고를 수 없다.
 *
 * 높이 지표는 이 실패를 **셀 수 있는 형태가 아니다**. 키를 줄이면 지표는 좋아지고
 * 문항은 그대로 못 푼다(CLAUDE.md 2026-08-16 «지표가 실패를 셀 수 있는가»).
 * 그래서 지표를 따로 둔다.
 *
 * ## 열쇠를 둘 쓴다 — 하나로는 덜 센다
 *
 *   ㉮ 보기 항목이 **있는데 글자가 없다**  (`1. [그림]` · `2.` 만 있는 것)
 *   ㉯ 그림이 넷 이상인데 **번호가 붙은 보기 다섯이 아예 없다**
 *
 * ㉮ 만 세면 「보기 마커가 통째로 사라진 문항」이 빠진다 — 실측으로 38건 대 93건이다.
 * 둘을 따로 내고 합집합도 같이 낸다. 한 숫자로 뭉개면 어느 쪽이 새는지 못 본다.
 */
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { JASEUP_MEASURED_PX } from "../../src/lib/printGeometry";
import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";

const prisma = new PrismaClient();

interface Row {
  id: string;
  content: string;
  figureUrls: string[];
  pool: string;
  reviewStatus: string;
  directUseAllowed: boolean;
  noAnswer: boolean;
  school: string | null;
  questionNumber: number | null;
}

/** 「보기가 그림이어야 하는」 문항으로 볼 최소 그림 수 (발문 없이 보기만 넷). */
const MIN_FIGURES = 4;

/** `1.`~`5.` 로 번호가 붙은 보기 — 마커별 **글자** 내용. */
const CHOICE_LINE = /(?:^|\n)\s*([1-5])\.\s*(.*)$/gm;

export function choiceTexts(content: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of content.matchAll(CHOICE_LINE))
    out.set(m[1]!, m[2]!.replace(/\[그림\]/g, "").trim());
  return out;
}

/** ㉮ 파서가 본 보기 항목 중 «비었거나 [그림] 뿐»인 것. */
export function emptyParsedChoices(content: string): {
  total: number;
  empty: number;
} {
  const items = parseProblemContent(content).choices ?? [];
  return {
    total: items.length,
    empty: items.filter(
      (c) => c.replace(/\[그림\]/g, "").replace(/\s/g, "").length === 0,
    ).length,
  };
}

export function isBrokenByParsedChoices(row: {
  content: string;
  figureUrls: readonly string[];
}): boolean {
  if (row.figureUrls.length < 3) return false;
  const { total, empty } = emptyParsedChoices(row.content ?? "");
  return total > 0 && empty >= 2;
}

export function isBrokenByMissingChoices(row: {
  content: string;
  figureUrls: readonly string[];
}): boolean {
  if (row.figureUrls.length < MIN_FIGURES) return false;
  const filled = [...choiceTexts(row.content ?? "").values()].filter(
    (t) => t.length > 0,
  ).length;
  return filled < 5;
}

async function main() {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, content, figure_urls AS "figureUrls", pool::text AS pool,
            review_status::text AS "reviewStatus", direct_use_allowed AS "directUseAllowed",
            answer = '(정답 없음)' AS "noAnswer", school, question_number AS "questionNumber"
       FROM problem ORDER BY id`,
  )) as Row[];

  const heights = new Map(
    (
      JSON.parse(readFileSync(".measure/cont.json", "utf8")) as {
        pid: string;
        neededPx: number;
      }[]
    ).map((m) => [m.pid, m.neededPx]),
  );
  const biggest = JASEUP_MEASURED_PX.soloContinuationSlot;
  const eligible = (r: Row) =>
    r.pool === "shared" &&
    r.reviewStatus === "approved" &&
    r.directUseAllowed &&
    !r.noAnswer;

  const tally = { 파서: 0, 보기없음: 0, 합집합: 0 };
  const overTally = { 파서: 0, 보기없음: 0, 합집합: 0, 넘침: 0, 넘침그림넷: 0 };
  const samples: string[] = [];

  for (const r of rows) {
    const a = isBrokenByParsedChoices(r);
    const b = isBrokenByMissingChoices(r);
    if (eligible(r)) {
      if (a) tally.파서 += 1;
      if (b) tally.보기없음 += 1;
      if (a || b) tally.합집합 += 1;
    }
    const h = heights.get(r.id) ?? 0;
    if (h > biggest) {
      overTally.넘침 += 1;
      if (r.figureUrls.length >= MIN_FIGURES) overTally.넘침그림넷 += 1;
      if (a) overTally.파서 += 1;
      if (b) overTally.보기없음 += 1;
      if (a || b) {
        overTally.합집합 += 1;
        if (samples.length < 8) {
          const { total, empty } = emptyParsedChoices(r.content ?? "");
          samples.push(
            `${r.id.slice(0, 8)} ${r.school ?? "?"} ${r.questionNumber ?? "?"}번 · 그림 ${r.figureUrls.length}장 · 보기 ${total}개 중 ${empty}개가 [그림]뿐 · ${h.toFixed(0)}px`,
          );
        }
      }
    }
  }

  console.log(
    `출제 가능 풀에서 «보기 번호와 그림이 안 이어진» 문항\n` +
      `  ㉮ 보기가 [그림] 뿐          ${tally.파서}건\n` +
      `  ㉯ 번호 붙은 보기 다섯이 없음 ${tally.보기없음}건\n` +
      `  합집합                       ${tally.합집합}건`,
  );
  console.log(
    `\n넘침(>${biggest}px) ${overTally.넘침}건 안에서\n` +
      `  그림 ${MIN_FIGURES}장 이상        ${overTally.넘침그림넷}건\n` +
      `  그중 안 이어진 것        ${overTally.합집합}건 (㉮ ${overTally.파서} · ㉯ ${overTally.보기없음})`,
  );
  for (const s of samples) console.log(`  · ${s}`);
  console.log(
    `\n지면 정책으로 키를 줄여도 이 문항들은 **답을 고를 수 없다** — 높이와 별개 일이다.`,
  );
  await prisma.$disconnect();
}

if (process.argv[1]?.includes("report-choice-figures"))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
