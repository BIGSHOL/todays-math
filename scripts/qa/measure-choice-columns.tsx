/**
 * 보기 2열 판정(`TWO_COLUMN_WIDTH_LIMIT = 24`)을 **지면에서** 양쪽으로 검증한다 (읽기 전용).
 *
 * 두 방향을 따로 센다 — 한쪽만 세면 문턱이 옳아 보인다.
 *   · 놓침: 2열로 뒀는데 칸(147px) 안에서 **접히는** 보기   → 원장님이 본 결함
 *   · 과잉: 1열로 내렸는데 **전부 칸에 들어가는** 문항       → 지면만 세로로 길어진다
 *
 * 왜 과잉도 세는가: 1열로 내려간 문항은 지면이 실제로 높아지고(보기 5개면 3줄 → 5줄),
 * 자습 지면은 장당 2문항 고정이라 그 높이가 곧 넘침이다. 「접힘을 없앴다」만 재면
 * 반대쪽 비용이 안 보인다.
 *
 * 접힘 판정은 **높이로 하면 안 된다** — 분수 하나만 있어도 줄 상자가 20.3px 를 넘는다.
 * 같은 글꼴 문맥 안에 nowrap 사본을 만들어 **폭**으로 가른다.
 *
 *   npx tsx scripts/qa/measure-choice-columns.tsx --take 1200
 */
import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";

import {
  assertPaperSane,
  GUARD_SCRIPT,
  paperDocument,
  renderPage,
  renderSlot,
  writeProbe,
} from "./paperProbe";

const prisma = new PrismaClient();

/** 2열 한 칸의 글자 폭 — `displayWidth.ts` 의 한계값이 가정한 값(실측 147px). */
const TWO_COLUMN_CELL_PX = 147;

async function main() {
  const takeIndex = process.argv.indexOf("--take");
  const take = takeIndex >= 0 ? Number(process.argv[takeIndex + 1]) : 1200;

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, content FROM problem ORDER BY id`,
  )) as Array<{ id: string; content: string }>;
  const step = Math.max(1, Math.floor(rows.length / take));
  const picked = rows.filter((_, i) => i % step === 0);
  console.log(
    `표본 ${picked.length}건 (전수 ${rows.length.toLocaleString()}건에서 균등)`,
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1200 },
  });
  await page.emulateMedia({ media: "print" });

  const stat = {
    twoColProblems: 0,
    twoColCells: 0,
    twoColFolded: 0,
    oneColProblems: 0,
    oneColButFits: 0,
    cellWidths: new Set<number>(),
  };
  const BATCH = 60;
  try {
    for (let s = 0; s < picked.length; s += BATCH * 2) {
      const chunk = picked.slice(s, s + BATCH * 2);
      const pages: string[] = [];
      for (let i = 0; i < chunk.length; i += 2) {
        pages.push(
          renderPage(
            "continuation",
            chunk
              .slice(i, i + 2)
              .map((r, j) =>
                renderSlot({ id: r.id, content: r.content ?? "" }, i + j + 1),
              ),
            2,
          ),
        );
      }
      const url = writeProbe("probe-choice.html", await paperDocument(pages));
      await page.goto(url, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      assertPaperSane(await page.evaluate(GUARD_SCRIPT));

      const res = (await page.evaluate((cellPx: number) => {
        const out = {
          twoColProblems: 0,
          twoColCells: 0,
          twoColFolded: 0,
          oneColProblems: 0,
          oneColButFits: 0,
          cellWidths: [] as number[],
        };
        // ⚠️ 이름 붙은 함수를 만들면 esbuild `__name` 때문에 죽는다 — 배열에 담는다.
        const helpers = [
          (el: HTMLElement): number => {
            const clone = el.cloneNode(true) as HTMLElement;
            clone.style.cssText =
              "position:absolute;visibility:hidden;white-space:nowrap;width:max-content;max-width:none;left:-9999px";
            el.parentElement!.appendChild(clone);
            const width = clone.getBoundingClientRect().width;
            clone.remove();
            return width;
          },
        ];
        document.querySelectorAll("[data-paper-view]").forEach((view) => {
          const root = view.firstElementChild as HTMLElement;
          const grid = Array.from(root.children).find((c) =>
            (c as HTMLElement).className.includes("mt-4"),
          ) as HTMLElement | undefined;
          if (!grid) return;
          const twoCol =
            getComputedStyle(grid).gridTemplateColumns.split(" ").length === 2;
          if (twoCol) {
            out.twoColProblems += 1;
            Array.from(grid.children).forEach((cell) => {
              const text = cell.lastElementChild as HTMLElement;
              const avail = text.getBoundingClientRect().width;
              out.cellWidths.push(Math.round(avail));
              out.twoColCells += 1;
              if (helpers[0]!(text) > avail + 0.5) out.twoColFolded += 1;
            });
          } else {
            out.oneColProblems += 1;
            let fitsAll = true;
            Array.from(grid.children).forEach((cell) => {
              const text = cell.lastElementChild as HTMLElement;
              if (helpers[0]!(text) > cellPx) fitsAll = false;
            });
            if (fitsAll) out.oneColButFits += 1;
          }
        });
        return out;
      }, TWO_COLUMN_CELL_PX)) as {
        twoColProblems: number;
        twoColCells: number;
        twoColFolded: number;
        oneColProblems: number;
        oneColButFits: number;
        cellWidths: number[];
      };
      stat.twoColProblems += res.twoColProblems;
      stat.twoColCells += res.twoColCells;
      stat.twoColFolded += res.twoColFolded;
      stat.oneColProblems += res.oneColProblems;
      stat.oneColButFits += res.oneColButFits;
      for (const w of res.cellWidths) stat.cellWidths.add(w);
      process.stdout.write(
        `\r측정 ${Math.min(s + BATCH * 2, picked.length)}/${picked.length}`,
      );
    }
  } finally {
    await browser.close();
  }
  console.log("");
  console.log(`2열 한 칸의 글자 폭(실측) ${[...stat.cellWidths].join(", ")}px`);
  console.log(
    `놓침 — 2열 칸 ${stat.twoColCells}개 중 접힘 ${stat.twoColFolded} (${((stat.twoColFolded * 100) / Math.max(1, stat.twoColCells)).toFixed(2)}%)`,
  );
  console.log(
    `과잉 — 1열 문항 ${stat.oneColProblems}건 중 전부 2열 칸에 들어가는 것 ${stat.oneColButFits} (${((stat.oneColButFits * 100) / Math.max(1, stat.oneColProblems)).toFixed(2)}%)`,
  );
  console.log(
    `  (보기 있는 문항 ${stat.twoColProblems + stat.oneColProblems}건 중 1열 ${((stat.oneColProblems * 100) / (stat.twoColProblems + stat.oneColProblems)).toFixed(1)}%)`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
