/**
 * 「눈에 안 보이는 식별자」가 **인쇄 경로에서 살아남는가**를 실측한다 (읽기 전용).
 *
 * 왜 필요한가: 원장님 결정은 「문항번호는 메타데이터로 숨긴다」이다. 그러면 곧바로
 * 물음이 생긴다 — **숨긴 것을 나중에 어떻게 꺼내 쓰나.** 「HTML data 속성에 있으니
 * 괜찮다」는 말은 확인 전에는 추측이다. 지면은 브라우저 인쇄를 거쳐 **PDF 나 종이**가
 * 되는데, 그 변환에서 무엇이 남고 무엇이 사라지는지는 재 봐야 안다.
 *
 *   npx tsx scripts/qa/probe-print-metadata.tsx
 *   npx tsx scripts/qa/probe-print-metadata.tsx --keep   # 산출 PDF 를 남긴다
 *
 * ## 재는 통로 다섯
 *
 *   ① `data-*` 속성        — 지면 DOM 에 이미 있는 `data-problem-number`류
 *   ② `<title>`            — 크로뮴이 PDF `/Title` 로 옮기는가
 *   ③ `<meta>` 태그        — author·description·keywords 가 PDF 로 가는가
 *   ④ 흰 글씨 / 투명 글씨  — 종이엔 안 보이지만 PDF 글자층에는 남는가
 *   ⑤ 브라우저 머리글·꼬리글 — 인쇄 대화상자의 「머리글 및 바닥글」이 켜졌을 때
 *                              URL 이 종이에 찍히는가 (URL 에 시험지 id 가 있다)
 *
 * ## 이 측정이 **답하지 못하는 것** — 먼저 적어 둔다
 *
 * 여기서 쓰는 것은 `page.pdf()`(headless 크로뮴의 printToPDF)다. 원장님의 실제
 * 경로는 앱의 `window.print()` → **크롬 인쇄 대화상자** → 「PDF 로 저장」 또는
 * 실물 프린터다. PDF 백엔드(Skia)는 같지만 대화상자의 기본값(머리글·꼬리글 체크,
 * 배경 그래픽)은 사람이 바꿀 수 있다. 그래서 ⑤ 는 **켰을 때 어떻게 되는가**만
 * 답하고, 「기본값이 무엇인가」는 원장님 실물 확인 항목으로 넘긴다(절대 규칙 6).
 *
 * 그리고 **실물 프린터로 뽑은 종이에는 ①②③④ 가 하나도 없다.** 종이에는 메타데이터가
 * 없다 — 잉크만 있다. 이 스크립트가 초록이어도 그 사실은 바뀌지 않는다.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
// ⚠️ `rmSync` 를 쓰지 마라 — 경로에 한글이 있으면 노드가 죽는다(아래 주석).
import { rm } from "node:fs/promises";
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

const OUT_DIR = path.join(process.cwd(), ".measure", "print-metadata");

/** 찾을 표식들. 각각 어느 통로로 넣었는지 이름에 적어 둔다. */
const NEEDLE = {
  dataAttr: "PIDDATA-4f9a1c",
  title: "PIDTITLE-7b2e5d",
  metaAuthor: "PIDAUTHOR-1a6c3f",
  metaDescription: "PIDDESC-9e4b8a",
  metaKeywords: "PIDKEYS-2c7d6e",
  whiteText: "PIDWHITE-5d8f0b",
  transparentText: "PIDCLEAR-3a9e7c",
  displayNone: "PIDNONE-6b1d4f",
  visible: "PIDVISIBLE-8c2a9d",
} as const;

interface Row {
  id: string;
  content: string;
  figureUrls: string[];
  questionType: string | null;
}

function pdfProbe(file: string, needles: Record<string, string>): unknown {
  const script = `
import json, sys
import pymupdf
doc = pymupdf.open(sys.argv[1])
needles = json.loads(sys.argv[2])
text = "".join(page.get_text() for page in doc)
raw = open(sys.argv[1], "rb").read().decode("latin-1")
print(json.dumps({
  "metadata": {k: v for k, v in doc.metadata.items() if v},
  "pages": doc.page_count,
  "inTextLayer": {k: (v in text) for k, v in needles.items()},
  "inRawBytes": {k: (v in raw) for k, v in needles.items()},
}, ensure_ascii=False))
`;
  const scriptFile = path.join(OUT_DIR, "_probe.py");
  writeFileSync(scriptFile, script, "utf8");
  const out = execFileSync(
    "python",
    [scriptFile, file, JSON.stringify(needles)],
    { encoding: "utf8" },
  );
  return JSON.parse(out) as unknown;
}

async function main() {
  const keep = process.argv.includes("--keep");
  mkdirSync(OUT_DIR, { recursive: true });

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, content, figure_urls AS "figureUrls", question_type AS "questionType"
       FROM problem ORDER BY id LIMIT 2`,
  )) as Row[];

  /* 지면 두 문항 — 제품 DOM 그대로. 여기에 통로 ①④ 를 얹는다. */
  const slots = rows.map((row, i) => {
    let html = renderSlot(
      {
        id: row.id,
        content: row.content ?? "",
        figureUrls: row.figureUrls,
        essayNumber: row.questionType === "서술형" ? 1 : null,
      },
      i + 1,
    );
    // ① data-* 속성 — 제품 지면에도 `data-problem-number` 가 이미 있다.
    html = html.replace(
      '<article class="problemItem"',
      `<article data-problem-id="${NEEDLE.dataAttr}" class="problemItem"`,
    );
    // ④ 흰 글씨 / 투명 글씨 / display:none — 정답란 안에 끼워 넣는다.
    html = html.replace(
      "</div>\n  </div>",
      `<span style="color:#ffffff;font-size:6pt">${NEEDLE.whiteText}</span>` +
        `<span style="color:transparent;font-size:6pt">${NEEDLE.transparentText}</span>` +
        `<span style="display:none">${NEEDLE.displayNone}</span>` +
        `<span style="font-size:6pt;color:#a0a0a8">${NEEDLE.visible}</span>` +
        "</div>\n  </div>",
    );
    return html;
  });

  const body = await paperDocument([renderPage("first", slots, 1)]);
  // ②③ <title> 과 <meta> 를 머리에 넣는다.
  const doc = body.replace(
    '<meta charset="utf-8">',
    `<meta charset="utf-8">` +
      `<title>일일테스트 · 이차방정식 · 2026-08-18 · ${NEEDLE.title}</title>` +
      `<meta name="author" content="${NEEDLE.metaAuthor}">` +
      `<meta name="description" content="${NEEDLE.metaDescription}">` +
      `<meta name="keywords" content="${NEEDLE.metaKeywords}">`,
  );
  const url = writeProbe("probe-print-metadata.html", doc);

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1200 },
  });
  await page.emulateMedia({ media: "print" });
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);

  /* 주입이 실제로 붙었는지부터 확인한다 — 안 붙었는데 「PDF 에 없다」고 적으면
     통로를 잘못 판정한다(없는 것을 못 찾은 것과, 있는데 사라진 것은 다른 말이다). */
  const inDom = await page.evaluate(
    (needles: Record<string, string>) => {
      const html = document.documentElement.outerHTML;
      const out: Record<string, boolean> = {};
      for (const key of Object.keys(needles))
        out[key] = html.includes(needles[key]!);
      return out;
    },
    NEEDLE as unknown as Record<string, string>,
  );
  const missing = Object.entries(inDom).filter(([, v]) => !v);
  if (missing.length > 0)
    throw new Error(
      `DOM 에 안 들어간 표식이 있다: ${missing.map(([k]) => k).join(", ")} — 주입이 샜다. 이 상태로는 «PDF 에 없다»를 판정할 수 없다.`,
    );

  const plain = path.join(OUT_DIR, "plain.pdf");
  await page.pdf({ path: plain, format: "A4", printBackground: true });

  /* ⑤ 크롬 인쇄 대화상자의 「머리글 및 바닥글」과 같은 자리 — URL 이 찍히는 통로다.
     크롬의 기본 꼬리글 템플릿은 URL, 머리글은 문서 제목이다. */
  const headed = path.join(OUT_DIR, "with-header-footer.pdf");
  await page.pdf({
    path: headed,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:9px;width:100%;text-align:center">
        <span class="title"></span></div>`,
    footerTemplate: `<div style="font-size:9px;width:100%;text-align:center">
        <span class="url"></span> — <span class="pageNumber"></span>/<span class="totalPages"></span></div>`,
  });
  await browser.close();

  /**
   * 꼬리글 통로는 **인쇄한 문서의 URL** 이 그대로 찍히는 자리다. 여기서는 탐침
   * 파일 이름이 URL 이지만, 제품의 인쇄 화면 URL 은 `/tests/{시험지 uuid}/print` 라
   * 같은 통로로 **시험지 id 가 통째로** 종이에 실린다. 그래서 「URL 문자열이 PDF 에
   * 남는가」를 재면 그 사실을 그대로 옮겨 읽을 수 있다.
   */
  const needles: Record<string, string> = {
    ...(NEEDLE as unknown as Record<string, string>),
    urlOfDocument: "probe-print-metadata",
  };

  console.log(
    "── ① 기본 인쇄 (머리글·꼬리글 끔) ──────────────────────────────",
  );
  console.log(JSON.stringify(pdfProbe(plain, needles), null, 1));
  console.log(
    "\n── ② 머리글·꼬리글 켬 ─────────────────────────────────────────",
  );
  console.log(JSON.stringify(pdfProbe(headed, needles), null, 1));
  console.log(
    `\n표식이 어느 통로인지:\n` +
      `  dataAttr        = HTML data-* 속성\n` +
      `  title           = <title> 태그\n` +
      `  metaAuthor/Description/Keywords = <meta> 태그\n` +
      `  whiteText       = 흰 글씨(종이엔 안 보임)\n` +
      `  transparentText = 투명 글씨\n` +
      `  displayNone     = display:none\n` +
      `  visible         = 실제로 보이는 6pt 회색 글씨 (대조군 — 이건 반드시 남아야 한다)\n` +
      `  fileUrlPath     = 인쇄한 문서의 URL (꼬리글 통로)\n`,
  );

  // 🔴 `rmSync` 는 경로에 한글이 있으면 노드를 **메시지 없이** 죽인다
  //    (Node v24.13.0 · Windows · 0xC0000409). 오르카 워크트리 이름이 한글이라
  //    이 스크립트가 거기서는 통째로 사라진다. 비동기 `rm` 은 멀쩡하다.
  //    재현: `node scripts/qa/probe-rmsync-crash.mjs`
  if (!keep) await rm(OUT_DIR, { recursive: true, force: true });
  else console.log(`PDF 를 남겼다: ${OUT_DIR}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
