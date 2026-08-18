/**
 * 문항번호 서식(D·D-tight)을 **실제 A4 지면에 그려** 찍는다 (읽기 전용).
 *
 *   npx tsx scripts/qa/shot-number-layout.tsx base <id> <id>
 *   npx tsx scripts/qa/shot-number-layout.tsx d <id> <id> --out docs/planning/tracks/reports/d-affordable
 *   npx tsx scripts/qa/shot-number-layout.tsx dtight-a <id> <id> --cap cap45
 *
 * 배치 CSS 는 `idLayouts.ts` 한 곳에서 온다 — **재는 쪽(`measure-cap-layout`)과
 * 같은 문자열**이다. 옮겨 적으면 「스크린샷의 모양」과 「표의 px」가 다른 배치의
 * 값이 되고, 그건 아무도 알아채지 못한다.
 *
 * 🔴 제품 CSS 는 한 글자도 안 바꾼다 — 탐침 문서 뒤 `<style>` 로 덮어쓸 뿐이다.
 *
 * 두 장을 찍는다.
 *   · `<배치>.png`      A4 지면 한 장 (칸이 어떻게 달라지는지)
 *   · `<배치>-crop.png` 번호 줄 둘레만 (선·여백이 실제로 어떻게 보이는지)
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";

import { capByName, markFigureRows } from "./capLayoutProbe";
import { injectMark, layoutByName } from "./idLayouts";
import {
  GUARD_SCRIPT,
  assertPaperSane,
  paperDocument,
  renderPage,
  renderSlot,
  writeProbe,
} from "./paperProbe";

const prisma = new PrismaClient();
const DEFAULT_OUT_DIR = "docs/planning/tracks/reports/d-affordable";

async function main() {
  const layout = layoutByName(process.argv[2] ?? "base");
  const flagAt = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const outDir = flagAt("--out") ?? DEFAULT_OUT_DIR;
  const cap = capByName(flagAt("--cap") ?? "cap70");
  const flagValues = new Set(
    [flagAt("--out"), flagAt("--cap")].filter(Boolean) as string[],
  );
  const ids = process.argv
    .slice(3)
    .filter((a) => !a.startsWith("--") && !flagValues.has(a));
  if (ids.length === 0) {
    console.error(
      "사용법: npx tsx scripts/qa/shot-number-layout.tsx <배치> <id>... [--cap capNN] [--out 디렉터리]",
    );
    process.exitCode = 1;
    return;
  }

  const rows = await prisma.problem.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      content: true,
      figureUrls: true,
      questionType: true,
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter((r) => r !== undefined);
  if (ordered.length !== ids.length)
    throw new Error(
      `요청한 문항 ${ids.length}건 중 ${ordered.length}건만 DB 에 있다.`,
    );

  const pages: string[] = [];
  for (let i = 0; i < ordered.length; i += 2)
    pages.push(
      renderPage(
        "continuation",
        ordered.slice(i, i + 2).map((r, j) => {
          const slot = renderSlot(
            {
              id: r.id,
              content: r.content ?? "",
              figureUrls: r.figureUrls,
              essayNumber: r.questionType === "서술형" ? 1 : null,
            },
            i + j + 1,
          );
          return layout.injectsMark ? injectMark(slot) : slot;
        }),
        2,
      ),
    );

  const html = markFigureRows(await paperDocument(pages))
    .replace("</head>", `<style>${cap.css}\n${layout.css ?? ""}</style></head>`)
    .replace("background:#c9c9c7", "background:#fff");

  const url = writeProbe(`probe-layout-${layout.name}-${cap.name}.html`, html);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 950, height: 1200 },
    deviceScaleFactor: 2,
  });
  try {
    await page.emulateMedia({ media: "print" });
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    assertPaperSane(await page.evaluate(GUARD_SCRIPT));

    /* ── 가드 — 배치가 **실제로** 걸렸는가 ────────────────────────────────
       안 걸리면 세 장이 다 똑같이 찍히고, 「선이 있는 느낌이 남는다」가 거짓이 된다.
       스크린샷은 눈으로 보는 것이라 오히려 안 걸린 것을 알아채기 어렵다. */
    const style = (await page.evaluate(() => {
      const el = document.querySelector(".questionNumber");
      if (!el) return null;
      const s = getComputedStyle(el);
      return [
        s.fontSize,
        s.paddingBottom,
        s.marginBottom,
        s.borderBottomWidth,
        s.borderBottomColor,
      ] as string[];
    })) as string[] | null;
    if (!style) throw new Error("questionNumber 가 없다.");
    if (layout.expect) {
      const want = layout.expect;
      const pairs: [string, string, number][] = [
        ["글꼴", style[0]!, want.fontSizePx],
        ["선 위 여백", style[1]!, want.paddingBottomPx],
        ["선 아래 여백", style[2]!, want.marginBottomPx],
        ["선 굵기", style[3]!, want.borderBottomPx],
      ];
      for (const [what, actual, expected] of pairs)
        if (actual !== `${expected}px`)
          throw new Error(
            `${layout.name}: 번호 줄 ${what} 가 ${actual} 다 — 의도한 ${expected}px 이 아니다.`,
          );
    }
    const marks = await page.evaluate(
      () => document.querySelectorAll(".idMark").length,
    );
    if (marks !== (layout.injectsMark ? ordered.length : 0))
      throw new Error(
        `${layout.name}: 식별자 표시가 ${marks}개다 — 주입이 샜다.`,
      );

    const measured = (await page.evaluate(() => {
      const out: [string, number, number][] = [];
      document.querySelectorAll(".problemItem").forEach((node) => {
        const item = node as HTMLElement;
        const num = item.querySelector(".questionNumber") as HTMLElement;
        const blank = item.querySelector(".answerBlank") as HTMLElement;
        const style2 = getComputedStyle(item);
        out.push([
          item.dataset.pid ?? "",
          blank.getBoundingClientRect().bottom -
            num.getBoundingClientRect().top,
          item.clientHeight -
            parseFloat(style2.paddingTop) -
            parseFloat(style2.paddingBottom),
        ]);
      });
      return out;
    })) as [string, number, number][];
    console.log(
      `배치 ${layout.name} · 상한 ${cap.name} · 번호 줄 [글꼴 ${style[0]} · 선 위 ${style[1]} · 선 ${style[3]} ${style[4]} · 선 아래 ${style[2]}]`,
    );
    for (const [pid, needed, avail] of measured)
      console.log(
        `  ${pid.slice(0, 8)} 문항 ${needed.toFixed(1)}px / 칸 ${avail}px`,
      );

    mkdirSync(outDir, { recursive: true });
    const a4 = page.locator(".a4Page").first();
    const full = path.join(outDir, `layout-${layout.name}.png`);
    await a4.screenshot({ path: full });
    console.log(`-> ${full}`);

    // 번호 줄 둘레만 — 선과 여백이 실제로 어떻게 보이는지.
    const box = await page.locator(".problemItem").first().boundingBox();
    if (box) {
      const crop = path.join(outDir, `layout-${layout.name}-crop.png`);
      await page.screenshot({
        path: crop,
        clip: {
          x: box.x - 6,
          y: box.y - 6,
          width: Math.min(box.width + 12, 420),
          height: 150,
        },
      });
      console.log(`-> ${crop}`);
    }
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
