/**
 * 본문 조판 수리 스크린샷 (읽기 전용).
 *
 * 2026-08-18 원장님 지적 8건의 **수리 후** 지면을 실제 KaTeX CSS·지면 글꼴·지면
 * 열 폭으로 그려 PNG 로 남긴다. 붉은 글씨 건만 `trust` 를 끄고/켜서 전·후를
 * 나란히 찍는다(그 건은 옵션 하나로 되돌릴 수 있어 전·후 비교가 가능하다).
 *
 *   npx tsx scripts/qa/shot-body-typeset.tsx
 */
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownRenderer } from "../../src/components/math/MarkdownRenderer";
import { ProblemContent } from "../../src/components/math/ProblemContent";
import { PAPER_FONTS } from "../../src/components/print/tokens";

const prisma = new PrismaClient();
const MM_PX = 96 / 25.4;
const COL = (210 * MM_PX - 100 - 14) * (1.15 / 2.15);
const OUT = path.join(
  process.cwd(),
  "docs/planning/tracks/reports/body-typeset",
);
const KATEX_CSS = pathToFileURL(
  path.join(process.cwd(), "node_modules/katex/dist/katex.min.css"),
).href;
const F = path.join(process.cwd(), "scripts/qa/_shot.html");

/** 지적 8건의 대표 문항 — 전부 실측 id. */
const CASES: Array<{ file: string; title: string; id: string }> = [
  {
    file: "01-box-boundary",
    title: "회귀 ① 상자 끝 경계 — 하위 문항·학교명이 상자 밖으로",
    id: "dba88a32",
  },
  { file: "02-subquestion", title: "① 세부 문항 줄바꿈", id: "2a584201" },
  { file: "03-equation-chain", title: "⑤ 계산 과정 다단 등식", id: "3f425023" },
  {
    file: "04-bare-condition",
    title: "⑥ 마커 없는 «다음 조건» 상자",
    id: "1e7cfc15",
  },
  {
    file: "05-enumeration",
    title: "④ 나열 대상 상자(머리 없음)",
    id: "01482df8",
  },
  {
    file: "06-square-padding",
    title: "③ 빈칸 네모 뒤 채움 정리",
    id: "0515aa41",
  },
];

function page(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${KATEX_CSS}">
<style>
 body{margin:0;background:#c9c9c7;font-family:${PAPER_FONTS.serifKR};color:#0E0E10}
 .card{background:#fff;margin:18px;padding:18px 20px;width:${COL + 40}px}
 .title{font-family:${PAPER_FONTS.sansKR};font-size:12px;font-weight:800;color:#A57F00;margin-bottom:10px}
 .col{width:${COL}px;font-size:12.5px;line-height:1.6;overflow-wrap:anywhere}
 .col p{margin:.5em 0}
 .raw{font-family:ui-monospace,monospace;font-size:9.5px;color:#6b6b72;white-space:pre-wrap;
      margin-top:12px;padding-top:8px;border-top:1px dashed #d4d4d8}
 /* ⚠️ 이 페이지에는 Tailwind 가 없다. 상자·보기 격자의 실제 모양이 안 보이면
    스크린샷이 «고쳤다»를 증명하지 못하므로, 그 클래스들만 손으로 옮겨 둔다.
    (값은 MarkdownRenderer 의 BOX_CARD_CLASS · ProblemContent 의 격자와 같다.) */
 [data-box-card]{margin:1rem 0;border:1px solid #8A8A88;background:#fff;padding:1rem;
   max-width:100%;overflow:hidden}
 [data-box-header]{margin-bottom:.5rem;font-weight:600}
 [data-box-header] p{margin:0}
 [data-box-item]{min-width:0;overflow-wrap:break-word}
 [data-box-item] p{margin:0}
 [data-box-card] .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));
   column-gap:1.5rem;row-gap:.25rem}
 [data-box-card] .space-y-1 > * + *{margin-top:.25rem}
 /* 보기 격자 — ProblemContent 의 grid gap-x-8 gap-y-2 grid-cols-2 와 같은 값 */
 .col > div > div.grid{display:grid;column-gap:2rem;row-gap:.5rem;margin-top:1rem;
   grid-template-columns:repeat(2,minmax(0,1fr))}
 .col > div > div.grid > div{display:flex;align-items:flex-start;gap:.375rem}
</style></head><body>${body}</body></html>`;
}

async function shoot(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  file: string,
  html: string,
) {
  writeFileSync(F, html, "utf8");
  const p = await browser.newPage({
    viewport: { width: Math.ceil(COL) + 120, height: 900 },
  });
  await p.goto(pathToFileURL(F).href, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(OUT, `${file}.png`), fullPage: true });
  await p.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; content: string }>
  >(
    `SELECT id, content FROM problem WHERE ${CASES.map((c) => `id::text LIKE '${c.id}%'`).join(" OR ")}`,
  );
  const byId = new Map(rows.map((r) => [r.id.slice(0, 8), r.content]));

  for (const c of CASES) {
    const content = byId.get(c.id);
    if (!content) {
      console.log(`?? ${c.id} 없음`);
      continue;
    }
    const html = page(
      `<div class="card"><div class="title">${c.title} — ${c.id}</div>` +
        `<div class="col">${renderToStaticMarkup(<ProblemContent content={content} deferFigures={false} />)}</div>` +
        `<div class="raw">원문(DB): ${content.slice(0, 420).replace(/</g, "&lt;")}</div></div>`,
    );
    await shoot(browser, c.file, html);
    console.log(`✓ ${c.file}.png`);
  }

  /* 붉은 글씨 — 전·후. `trust` 를 끈 렌더는 KaTeX 를 직접 불러 재현한다. */
  const RED_SAMPLES = [
    "순환소수 $0.\\overline{3}$ 을 기약분수로 나타내어라.",
    "$1.2\\dot{3}\\dot{4}$ 를 기약분수로 나타내어라.",
    "호 $\\widehat{AB}$ 의 길이를 구하시오.",
  ];
  const after = RED_SAMPLES.map(
    (t) =>
      `<div class="col">${renderToStaticMarkup(<MarkdownRenderer content={t} />)}</div>`,
  ).join("");
  await shoot(
    browser,
    "07-red-text-after",
    page(
      `<div class="card"><div class="title">붉은 글씨 — 수리 후(\`trust\` 연결)</div>${after}</div>`,
    ),
  );
  console.log("✓ 07-red-text-after.png");

  await browser.close();
  unlinkSync(F);
  console.log(`\n→ ${OUT}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
