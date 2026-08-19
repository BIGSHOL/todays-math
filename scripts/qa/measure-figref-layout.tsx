/**
 * **보기 그림 조판 시안**을 실제 A4 지면에 그려 세로 px 를 잰다 (읽기 전용 · DB 읽기만).
 *
 *   npx tsx scripts/qa/measure-figref-layout.tsx                    # 전량(=대상 문항)
 *   npx tsx scripts/qa/measure-figref-layout.tsx --take 12          # 표본
 *   npx tsx scripts/qa/measure-figref-layout.tsx --json out.json
 *   npx tsx scripts/qa/measure-figref-layout.tsx --shot <id> --take 2   # 지면 사진
 *
 * ## 무엇을 재는가
 *
 * 「어느 그래프가 ①인가」를 지면이 모르는 문항(`report-choice-figures.ts` 의 합집합)에
 * 대해, 시안마다 **문항번호 위 ~ 정답란 아래**의 실제 높이를 잰다. `measure-print-overflow`
 * 와 같은 구간이라 칸 높이(`JASEUP_MEASURED_PX`)와 바로 견줄 수 있다.
 *
 * ## 🔴 캐시로 채점하지 않는다
 *
 * `.measure/*.json` 은 **현행 지면**의 값이다. 조판을 바꾸면 그 순간 거짓이 된다.
 * 그래서 시안의 높이는 여기서 **전부 새로 잰다**. 「현행」팔도 캐시를 읽지 않고
 * 같은 실행에서 같은 브라우저로 다시 잰다 — 전후 비교의 분모가 추론이 아니라 측정이어야
 * 한다(CLAUDE.md 2026-08-18 「분모를 먼저 검산하라」).
 *
 * ## 🔴 제품 코드는 한 글자도 안 바꾼다
 *
 * 「현행」·「상한45」·「상한29」는 **제품 `ProblemContent`** 를 그대로 그린다
 * (`paperProbe.renderSlot`). 상한 덧칠은 탐침 HTML 의 `<style>` 한 줄이다.
 * 시안 ㄱ~ㅁ 만 탐침 컴포넌트(`figrefLayout.tsx`)를 탄다.
 *
 * ## ⚠️ 짝은 이 스크립트가 «정하는» 것이 아니다
 *
 * 「어느 그림이 ①인가」는 `figref-source` 세션이 답한다. 여기서는 **높이를 재기 위한
 * 가정**을 하나 두고, 그 가정을 보고서에 그대로 적는다(§2 주). 가정이 틀려도
 * «몇 장이 보기 칸에 들어가는가»가 같으면 높이는 같다 — 높이는 배정이 아니라 장수와
 * 치수로 갈리기 때문이다. 다만 **발문 그림 한 장의 자리**는 높이를 바꾸므로,
 * 그 가정(6장이면 첫 장이 발문)은 표본을 눈으로 봐서 확인했다(보고서 §2).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { chromium, type Page } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";

import { JASEUP_MEASURED_PX } from "../../src/lib/printGeometry";
import { stripFigureMarks } from "./figrefRuler";
import {
  CAP_MM,
  FigrefBody,
  PROBE_CSS,
  PRODUCT_VARIANTS,
  VARIANTS,
  type FigurePlan,
  type Variant,
} from "./figrefLayout";
import {
  GUARD_SCRIPT,
  assertPaperSane,
  FIGURE_ROOT,
  paperDocument,
  renderPage,
  renderSlot,
  writeProbe,
} from "./paperProbe";
import {
  isBrokenByParsedChoices,
  isBrokenByMissingChoices,
} from "./report-choice-figures";
import { ANSWER_CIRCLED_CLASS } from "../../src/lib/math/circledNumber";

const prisma = new PrismaClient();
const OUT_DIR = "docs/planning/tracks/reports/figref";

interface Row {
  id: string;
  content: string;
  figureUrls: string[];
  figureDims: number[];
  answer: string;
  school: string | null;
  questionNumber: number | null;
  pool: string;
  reviewStatus: string;
  directUseAllowed: boolean;
  noAnswer: boolean;
}

/**
 * 정답이 **원문자뿐**이면 객관식이다 — 본문과 **독립인 근거**다.
 * (`question_type` 은 못 쓴다: 정답이 `①` 인데 `서술형` 이라 적힌 행이 36건이다.)
 */
// 계열은 `circledNumber.ts` 한 곳에서 온다.
export const OBJECTIVE_ANSWER = new RegExp(
  String.raw`^[${ANSWER_CIRCLED_CLASS}](?:\s*[,·]\s*[${ANSWER_CIRCLED_CLASS}])*$`,
);

/**
 * 높이를 재기 위한 **가정**. 짝을 정하는 규칙이 아니다 (§2 주).
 *
 * 그림이 5장이면 다섯 장 전부가 보기, 6장이면 첫 장이 발문 그림이고 나머지 다섯이 보기.
 * 표본을 눈으로 봐서 정한 것이고(관음중 17·원화중 4 = 발문 있음 / 대구북중 13·범물중 13 =
 * 발문 없음), 보고서에 근거와 함께 적는다.
 */
export function measurementPlan(figureUrls: readonly string[]): FigurePlan {
  const n = figureUrls.length;
  const choiceCount = n >= 5 ? 5 : n;
  return {
    stem: figureUrls.slice(0, n - choiceCount).map(toFileUrl),
    choiceFigures: figureUrls.slice(n - choiceCount).map(toFileUrl),
  };
}

function toFileUrl(url: string): string {
  return url.startsWith("/") ? FIGURE_ROOT + url : url;
}

/** `paperProbe.renderSlot` 과 **같은 DOM**. 본문만 탐침 컴포넌트로 갈아 끼운다. */
function renderFigrefSlot(row: Row, number: number, variant: Variant): string {
  const body = renderToStaticMarkup(
    <FigrefBody
      // 자(`figrefRuler.estimateFigrefProblemPx`)가 넘기는 것과 **같은 함수·같은 문자열**.
      question={stripFigureMarks(row.content ?? "")}
      plan={measurementPlan(row.figureUrls)}
      variant={variant}
      className="problemText"
    />,
  );
  return `<article class="problemItem" data-problem-number="${number}" data-pid="${row.id}">
  <div class="questionArea">
    <div class="questionNumber">문 ${number}</div>
    <div data-paper-view>${body}</div>
    <div class="answerBlank"><strong>내 정답</strong><span class="answerLine"></span><span>채점</span><span class="checkBox"></span></div>
  </div>
  <div class="scratchPad"><span>SCRATCH PAD</span></div>
</article>`;
}

interface Measured {
  pid: string;
  neededPx: number;
  figurePx: number;
  choicePx: number;
  /** 보기 칸·마커·그림칸의 **실측 폭** — 자(§4)의 상수를 여기서 유도한다. */
  cellPx: number;
  markPx: number;
  figCellPx: number;
  markLinePx: number;
}

const MEASURE_SCRIPT = `(() => {
  const out = [];
  document.querySelectorAll(".problemItem").forEach((node) => {
    const item = node;
    const num = item.querySelector(".questionNumber");
    const blank = item.querySelector(".answerBlank");
    const view = item.querySelector("[data-paper-view]");
    const stem = view.querySelector(".figrefStem") || view.querySelector("div[class*='mt-3']");
    const choices = view.querySelector("[data-figref-choices]")
      || view.querySelector("div[class*='mt-4'][class*='grid']");
    const cell = view.querySelector(".figrefCell");
    const mark = view.querySelector(".figrefMark");
    const fig = view.querySelector(".figrefFig");
    out.push({
      pid: item.dataset.pid || "",
      neededPx: blank.getBoundingClientRect().bottom - num.getBoundingClientRect().top,
      figurePx: stem ? stem.getBoundingClientRect().height : 0,
      choicePx: choices ? choices.getBoundingClientRect().height : 0,
      cellPx: cell ? cell.getBoundingClientRect().width : 0,
      markPx: mark ? mark.getBoundingClientRect().width : 0,
      figCellPx: fig ? fig.getBoundingClientRect().width : 0,
      markLinePx: mark ? mark.getBoundingClientRect().height : 0,
    });
  });
  return out;
})()`;

/**
 * 탐침 `<style>` — 제품 CSS 는 한 글자도 안 건드린다.
 *  · `cap` 은 제품 시안(현행/상한45/상한29)의 그림 폭 상한 덧칠.
 *  · `stemCapMm` 은 시안 ㄱ~ㅁ 의 **발문 그림** 상한(보기 그림과 따로 움직이는 축).
 */
function probeStyles(variant: Variant, stemCapMm: number): string {
  // 제품 시안은 그림 묶음 전체가 `mt-3` 안에 있고, 시안 ㄱ~ㅂ 은 **발문 그림만** 거기 있다.
  // 그래서 같은 선택자에 서로 다른 뜻의 상한이 붙는다.
  //
  // ⚠️ `--stem-cap` 은 **시안에만** 건다. 「현행」팔에 걸면 분모가 같이 움직여
  //    「현행 = 상한45」 가 되고, 전후 비교가 통째로 거짓이 된다.
  const product = PRODUCT_VARIANTS.includes(variant);
  const capMm = product
    ? CAP_MM[variant]
    : stemCapMm === 70
      ? undefined
      : stemCapMm;
  return (
    `<style>${PROBE_CSS}</style>` +
    (capMm === undefined
      ? // 70mm 는 제품 기본값이라 **덧칠하지 않는다** — 덧칠하면 화면 매체(360px)까지
        // 바뀌어 「화면도 같은가」 측정이 통째로 거짓이 된다.
        ""
      : `<style>[data-paper-view] div[class*="mt-3"] img{max-width:${capMm}mm !important}</style>`)
  );
}

async function measureVariant(
  page: Page,
  rows: Row[],
  variant: Variant,
  stemCapMm: number,
): Promise<Map<string, Measured>> {
  const out = new Map<string, Measured>();
  const PAGES_PER_BATCH = 40;
  const product = PRODUCT_VARIANTS.includes(variant);

  for (let start = 0; start < rows.length; start += PAGES_PER_BATCH * 2) {
    const chunk = rows.slice(start, start + PAGES_PER_BATCH * 2);
    const pages: string[] = [];
    for (let i = 0; i < chunk.length; i += 2) {
      const slots = chunk.slice(i, i + 2).map((row, j) =>
        product
          ? renderSlot(
              {
                id: row.id,
                content: row.content ?? "",
                figureUrls: row.figureUrls.map(toFileUrl),
              },
              i + j + 1,
            )
          : renderFigrefSlot(row, i + j + 1, variant),
      );
      pages.push(renderPage("continuation", slots, 2));
    }
    let html = await paperDocument(pages);
    html = html.replace("</head>", probeStyles(variant, stemCapMm) + "</head>");
    const url = writeProbe(`probe-figref-${variant}.html`, html);
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    assertPaperSane(await page.evaluate(GUARD_SCRIPT));
    const measured = (await page.evaluate(MEASURE_SCRIPT)) as Measured[];
    for (const m of measured) out.set(m.pid, m);
  }
  if (out.size !== rows.length)
    throw new Error(
      `측정 누락 — ${variant}: ${out.size}/${rows.length} (조용히 넘어가지 않는다)`,
    );
  return out;
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

async function main() {
  // 화면(문제은행·검수) 매체로 잰다 — 그림 상한이 화면 360px · 인쇄 70mm(264.6px) 라
  // **같은 문항이 화면에서 더 크다**. 「지면만 고치면 화면이 남는가」를 재는 자리다.
  const screen = process.argv.includes("--screen");
  const stemArg = process.argv.indexOf("--stem-cap");
  const stemCap = stemArg >= 0 ? Number(process.argv[stemArg + 1]) : 70;
  const takeArg = process.argv.indexOf("--take");
  const take = takeArg >= 0 ? Number(process.argv[takeArg + 1]) : 0;
  const jsonArg = process.argv.indexOf("--json");
  const shotArg = process.argv.indexOf("--shot");
  const shotIds =
    shotArg >= 0
      ? process.argv
          .slice(shotArg + 1)
          .filter((a) => !a.startsWith("--"))
          .slice(0, 4)
      : [];

  const all = (await prisma.$queryRawUnsafe(
    `SELECT id, content, answer, figure_urls AS "figureUrls", figure_dims AS "figureDims",
            pool::text AS pool, review_status::text AS "reviewStatus",
            direct_use_allowed AS "directUseAllowed", answer = '(정답 없음)' AS "noAnswer",
            school, question_number AS "questionNumber"
       FROM problem ORDER BY id`,
  )) as Row[];

  const eligible = (r: Row) =>
    r.pool === "shared" &&
    r.reviewStatus === "approved" &&
    r.directUseAllowed &&
    !r.noAnswer;
  const broken = all.filter(
    (r) =>
      eligible(r) &&
      (isBrokenByParsedChoices(r) || isBrokenByMissingChoices(r)),
  );
  // 객관식만 — 서술형·단답형에 그림이 넷 이상 붙은 것은 «보기 그림» 이 아니다.
  const objective = broken.filter((r) =>
    OBJECTIVE_ANSWER.test((r.answer ?? "").trim()),
  );
  const skipped = broken.length - objective.length;

  let rows = objective;
  if (shotIds.length > 0) {
    const byId = new Map(all.map((r) => [r.id, r]));
    rows = shotIds
      .map((id) => byId.get(id) ?? objective.find((r) => r.id.startsWith(id)))
      .filter((r): r is Row => r !== undefined);
  } else if (take > 0) {
    rows = objective.slice(0, take);
  }

  console.log(
    `대상: 안 이어진 문항 ${broken.length}건 중 **객관식** ${objective.length}건` +
      ` (객관식 아님 ${skipped}건 제외 — 정답이 원문자가 아니다)`,
  );
  console.log(
    `이번 실행에서 재는 것: ${rows.length}건 · 시안 ${VARIANTS.length}개\n`,
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 950, height: 1200 },
    deviceScaleFactor: shotIds.length > 0 ? 2 : 1,
  });
  const results = new Map<Variant, Map<string, Measured>>();
  try {
    await page.emulateMedia({ media: screen ? "screen" : "print" });
    for (const variant of VARIANTS) {
      const started = Date.now();
      results.set(variant, await measureVariant(page, rows, variant, stemCap));
      console.log(`  잰 것: ${variant} (${Date.now() - started}ms)`);
    }

    if (shotIds.length > 0) {
      mkdirSync(OUT_DIR, { recursive: true });
      for (const variant of VARIANTS) {
        const pages: string[] = [];
        const product = PRODUCT_VARIANTS.includes(variant);
        const slots = rows.map((row, j) =>
          product
            ? renderSlot(
                {
                  id: row.id,
                  content: row.content ?? "",
                  figureUrls: row.figureUrls.map(toFileUrl),
                },
                j + 1,
              )
            : renderFigrefSlot(row, j + 1, variant),
        );
        for (let i = 0; i < slots.length; i += 2)
          pages.push(renderPage("continuation", slots.slice(i, i + 2), 2));
        const html = (await paperDocument(pages))
          .replace("</head>", probeStyles(variant, stemCap) + "</head>")
          .replace("background:#c9c9c7", "background:#fff");
        const url = writeProbe(`probe-figref-shot-${variant}.html`, html);
        await page.goto(url, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        const a4 = page.locator(".a4Page");
        for (let i = 0; i < (await a4.count()); i += 1) {
          const file = path.join(
            OUT_DIR,
            `${variant}${(await a4.count()) > 1 ? `-p${i + 1}` : ""}.png`,
          );
          await a4.nth(i).screenshot({ path: file });
          console.log(`-> ${file}`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  /**
   * **분모를 검산한다.** 「현행」팔이 정말 지금 지면인지 추론으로 두면 표 전체가
   * 가정 위에 선다. 전수 실측 캐시(`.measure/cont.json`)와 같은 문항을 맞대 본다 —
   * 캐시는 다른 세션이 다른 날 잰 값이므로 **독립된 두 번째 측정**이다.
   * (캐시가 낡았으면 여기서 갈린다. 갈리면 그 사실을 찍는다 — 조용히 넘기지 않는다.)
   */
  try {
    const cached = new Map(
      (
        JSON.parse(readFileSync(".measure/cont.json", "utf8")) as {
          pid: string;
          neededPx: number;
        }[]
      ).map((m) => [m.pid, m.neededPx]),
    );
    const now = results.get("현행")!;
    const diffs = rows
      .map((r) => ({
        id: r.id,
        cache: cached.get(r.id),
        here: now.get(r.id)!.neededPx,
      }))
      .filter((d) => d.cache !== undefined)
      .map((d) => ({ ...d, delta: Math.abs(d.here - d.cache!) }));
    const off = diffs.filter((d) => d.delta > 1);
    console.log(
      `
분모 검산 — 「현행」팔 ↔ 전수 실측 캐시(.measure/cont.json): ` +
        `${diffs.length}건 대조 · 1px 넘게 다른 것 ${off.length}건` +
        (off.length
          ? ` (최대 ${Math.max(...off.map((d) => d.delta)).toFixed(0)}px — ${off
              .slice(0, 3)
              .map(
                (d) =>
                  `${d.id.slice(0, 8)} ${d.cache!.toFixed(0)}→${d.here.toFixed(0)}`,
              )
              .join(" · ")})`
          : ""),
    );
  } catch (error) {
    console.log(`
분모 검산 못 함 — ${(error as Error).message}`);
  }

  const { soloContinuationSlot, continuationSlot, firstPageSlot } =
    JASEUP_MEASURED_PX;
  console.log(
    `\n문항 높이(문항번호 위~정답란 아래) · ${rows.length}건\n` +
      `| 시안 | 중앙 | 90분위 | 최대 | > ${soloContinuationSlot}px | > ${continuationSlot}px | > ${firstPageSlot}px | 그림+보기 중앙 |`,
  );
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const variant of VARIANTS) {
    const m = results.get(variant)!;
    const needed = rows.map((r) => m.get(r.id)!.neededPx);
    // 그림 블록과 보기 블록은 시안마다 «어디에 그리느냐»가 달라 따로 보면 비교가 안 된다.
    // 둘의 합은 어느 시안에서나 «그림이 먹는 세로»라 같은 뜻이다.
    const both = rows.map((r) => m.get(r.id)!.figurePx + m.get(r.id)!.choicePx);
    console.log(
      `| ${variant} | ${quantile(needed, 0.5).toFixed(0)} | ${quantile(needed, 0.9).toFixed(0)} | ` +
        `${Math.max(...needed).toFixed(0)} | ${needed.filter((v) => v > soloContinuationSlot).length} | ` +
        `${needed.filter((v) => v > continuationSlot).length} | ${needed.filter((v) => v > firstPageSlot).length} | ` +
        `${quantile(both, 0.5).toFixed(0)} |`,
    );
  }

  console.log(`
시안별 **실측 칸 치수** (자의 상수는 여기서 유도한다 — 손으로 적지 않는다)`);
  console.log("| 시안 | 보기 칸 폭 | 마커 폭 | 그림칸 폭 | 마커 줄높이 |");
  console.log("| --- | ---: | ---: | ---: | ---: |");
  for (const variant of VARIANTS) {
    const m = results.get(variant)!;
    const sample = rows.map((r) => m.get(r.id)!).find((x) => x.cellPx > 0);
    if (!sample) continue;
    console.log(
      `| ${variant} | ${sample.cellPx.toFixed(2)} | ${sample.markPx.toFixed(2)} | ` +
        `${sample.figCellPx.toFixed(2)} | ${sample.markLinePx.toFixed(2)} |`,
    );
  }

  if (jsonArg >= 0) {
    const file = process.argv[jsonArg + 1]!;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          slot: JASEUP_MEASURED_PX,
          rows: rows.map((r) => ({
            id: r.id,
            school: r.school,
            questionNumber: r.questionNumber,
            figures: r.figureUrls.length,
            dims: r.figureDims,
            // 자 채점기(`score-figref-ruler.ts`)가 제품 자를 **그대로 다시 부르려면**
            // 본문이 있어야 한다. 옮겨 적은 값으로 채점하면 그 순간 동어반복이 된다.
            content: r.content,
            byVariant: Object.fromEntries(
              VARIANTS.map((v) => [v, results.get(v)!.get(r.id)!]),
            ),
          })),
        },
        null,
        1,
      ),
      "utf8",
    );
    console.log(`\n-> ${file}`);
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
