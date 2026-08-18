/**
 * 자습 문제지가 **실제로 잘리는 문항**을 전수로 센다 (읽기 전용 · DB 읽기만).
 *
 * `printOverflow.ts` 의 경고와 대조해 «넘치는데 경고가 없는 것»을 낸다 —
 * 그게 학생에게 그대로 인쇄돼 나가는 부류다(절대 규칙 6).
 *
 *   npx tsx scripts/qa/measure-print-overflow.tsx                 # 전수, 이어지는 장
 *   npx tsx scripts/qa/measure-print-overflow.tsx --take 400      # 표본
 *   npx tsx scripts/qa/measure-print-overflow.tsx --screen        # 화면 미리보기 매체로
 *   npx tsx scripts/qa/measure-print-overflow.tsx --json out.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";

import { displayWidth } from "../../src/lib/math/displayWidth";
import {
  assessOverflowRisk,
  estimateProblemLines,
} from "../../src/lib/printOverflow";
import type { TestPrintProblem } from "../../src/components/print/types";
import {
  MEASURED,
  assertPaperSane,
  GUARD_SCRIPT,
  paperDocument,
  renderPage,
  renderSlot,
  writeProbe,
} from "./paperProbe";

const prisma = new PrismaClient();

interface Row {
  id: string;
  content: string;
  figureUrls: string[];
  questionType: string | null;
}

interface Measured {
  pid: string;
  /** 문항 칸의 **실제** 남은 세로 (article 의 content box) */
  availPx: number;
  /** 문항번호 위 ~ 정답란 아래 실제 높이 */
  neededPx: number;
  figurePx: number;
  choicePx: number;
  boxPx: number;
}

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const take = Number(arg("--take") ?? 0);
  const outPath = arg("--json");
  const media = process.argv.includes("--screen") ? "screen" : "print";
  const kind = process.argv.includes("--first-page") ? "first" : "continuation";

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, content, figure_urls AS "figureUrls", question_type AS "questionType"
       FROM problem ORDER BY id ${take > 0 ? `LIMIT ${take}` : ""}`,
  )) as Row[];
  console.log(
    `문항 ${rows.length.toLocaleString()}건 · ${kind} 장 · ${media} 매체`,
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1200 },
  });
  if (media === "print") await page.emulateMedia({ media: "print" });

  const all: Measured[] = [];
  const PAGES_PER_BATCH = 60;
  try {
    for (let start = 0; start < rows.length; start += PAGES_PER_BATCH * 2) {
      const chunk = rows.slice(start, start + PAGES_PER_BATCH * 2);
      const pages: string[] = [];
      for (let i = 0; i < chunk.length; i += 2) {
        const slots = chunk.slice(i, i + 2).map((row, j) =>
          renderSlot(
            {
              id: row.id,
              content: row.content ?? "",
              figureUrls: row.figureUrls,
              essayNumber: row.questionType === "서술형" ? 1 : null,
            },
            i + j + 1,
          ),
        );
        pages.push(renderPage(kind, slots, kind === "first" ? 1 : 2));
      }
      const url = writeProbe("probe-overflow.html", await paperDocument(pages));
      await page.goto(url, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      assertPaperSane(await page.evaluate(GUARD_SCRIPT));

      const measured = (await page.evaluate(() => {
        const out: unknown[] = [];
        document.querySelectorAll(".problemItem").forEach((node) => {
          const item = node as HTMLElement;
          const num = item.querySelector(".questionNumber") as HTMLElement;
          const blank = item.querySelector(".answerBlank") as HTMLElement;
          const view = item.querySelector("[data-paper-view]") as HTMLElement;
          const style = getComputedStyle(item);
          let boxPx = 0;
          view.querySelectorAll("[data-box-card]").forEach((b) => {
            boxPx += (b as HTMLElement).getBoundingClientRect().height;
          });
          const figures = view.querySelector(
            "div[class*='mt-3']",
          ) as HTMLElement | null;
          const choices = view.querySelector(
            "div[class*='mt-4']",
          ) as HTMLElement | null;
          out.push({
            pid: item.dataset.pid,
            // ⚠️ grid row 가 아니라 article 의 content box 로 잰다(paperProbe 주석 (4)).
            availPx:
              item.clientHeight -
              parseFloat(style.paddingTop) -
              parseFloat(style.paddingBottom),
            neededPx:
              blank.getBoundingClientRect().bottom -
              num.getBoundingClientRect().top,
            figurePx: figures ? figures.getBoundingClientRect().height : 0,
            choicePx: choices ? choices.getBoundingClientRect().height : 0,
            boxPx,
          });
        });
        return out;
      })) as Measured[];
      all.push(...measured);
      process.stdout.write(`\r측정 ${all.length}/${rows.length}`);
    }
  } finally {
    await browser.close();
  }
  console.log("");

  const byId = new Map(rows.map((r) => [r.id, r]));
  const slot =
    kind === "first" ? MEASURED.slotFirstPagePx : MEASURED.slotContinuationPx;
  let over = 0;
  let missed = 0;
  let falseAlarm = 0;
  const missedRows: Array<{ pid: string; excess: number; lines: number }> = [];
  for (const m of all) {
    const row = byId.get(m.pid)!;
    const problem: TestPrintProblem = {
      id: row.id,
      orderIndex: 0,
      content: row.content ?? "",
      answer: "",
      solution: null,
      figureUrls: row.figureUrls,
    };
    const warned = assessOverflowRisk([problem]).length > 0;
    const overflows = m.neededPx > slot;
    if (overflows) over += 1;
    if (overflows && !warned) {
      missed += 1;
      missedRows.push({
        pid: m.pid,
        excess: m.neededPx - slot,
        lines: estimateProblemLines(row.content ?? ""),
      });
    }
    if (!overflows && warned) falseAlarm += 1;
  }
  const pct = (n: number) => `${((n * 100) / all.length).toFixed(2)}%`;
  console.log(`문항 칸 ${slot}px`);
  console.log(`실측 넘침            ${over} (${pct(over)})`);
  console.log(`★ 넘치는데 경고 없음 ${missed} (${pct(missed)})`);
  console.log(`  경고인데 안 넘침   ${falseAlarm} (${pct(falseAlarm)})`);
  console.log(
    `  경고 재현율        ${((100 * (over - missed)) / Math.max(1, over)).toFixed(1)}%`,
  );

  missedRows.sort((a, b) => b.excess - a.excess);
  console.log("\n놓친 표본 — 넘친 양이 큰 순");
  for (const r of missedRows.slice(0, 10)) {
    const row = byId.get(r.pid)!;
    console.log(
      `· ${r.pid} 넘침 ${r.excess.toFixed(0)}px 추정 ${r.lines}줄 폭 ${displayWidth(row.content ?? "")} 그림 ${row.figureUrls.length}`,
    );
  }

  if (outPath) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(all), "utf8");
    console.log(`\n→ ${outPath}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
