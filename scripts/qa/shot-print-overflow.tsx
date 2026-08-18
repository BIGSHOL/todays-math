/**
 * 넘치는 문항이 지면에서 **실제로 어떻게 되는지** 그림과 PDF 로 남긴다 (읽기 전용).
 *
 * 문항 칸(`.problemItem`)에는 `overflow` 가 없다 — `overflow:hidden` 은 `.a4Page` 하나뿐이다.
 * 그래서 넘침은 «그 문항만 조금 잘림»이 아니라
 *   · 1번이 넘치면 → **2번 문항 위에 겹쳐** 찍히고
 *   · 2번이 넘치면 → 보기·정답란이 지면 밖으로 밀려 **통째로 사라진다**
 * 는 두 가지로 나타난다. 스크린샷과 함께 A4 PDF 도 남겨 인쇄 출력이 정말 한 장인지 본다.
 *
 *   npx tsx scripts/qa/shot-print-overflow.tsx <slot1-id> <slot2-id> out.png [--first-page]
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";

import {
  paperDocument,
  renderPage,
  renderSlot,
  writeProbe,
} from "./paperProbe";

const prisma = new PrismaClient();

async function main() {
  const [first, second, out] = process.argv.slice(2);
  if (!first || !second || !out) {
    console.error(
      "사용법: npx tsx scripts/qa/shot-print-overflow.tsx <id1> <id2> out.png [--first-page]",
    );
    process.exitCode = 1;
    return;
  }
  const kind = process.argv.includes("--first-page") ? "first" : "continuation";
  const rows = (await prisma.problem.findMany({
    where: { id: { in: [first, second] } },
    select: { id: true, content: true, figureUrls: true },
  })) as Array<{ id: string; content: string; figureUrls: string[] }>;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const slots = [first, second].map((id, i) => {
    const row = byId.get(id);
    if (!row) throw new Error(`문항을 못 찾았다: ${id}`);
    return renderSlot(
      { id: row.id, content: row.content ?? "", figureUrls: row.figureUrls },
      i + 1,
    );
  });

  const url = writeProbe(
    "probe-shot.html",
    (await paperDocument([renderPage(kind, slots, kind === "first" ? 1 : 2)]))
      // 스크린샷은 배경 없이 지면만 담는다.
      .replace("background:#c9c9c7", "background:#fff"),
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 900, height: 1200 },
    deviceScaleFactor: 2,
  });
  try {
    await page.emulateMedia({ media: "print" });
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    mkdirSync(path.dirname(out), { recursive: true });
    await page.locator(".a4Page").screenshot({ path: out });
    await page.pdf({
      path: out.replace(/\.png$/, ".pdf"),
      format: "A4",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
  } finally {
    await browser.close();
  }
  console.log(`→ ${out} (+ .pdf)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
