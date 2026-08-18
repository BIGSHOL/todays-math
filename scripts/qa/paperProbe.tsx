/**
 * 지면 실측 하네스 — **진짜 A4 지면**을 Chromium 에 그려 높이를 재는 공용 도구 (읽기 전용).
 *
 * 왜 필요한가: `printOverflow.ts` 의 줄 수 추정은 근사다. 「잘렸는가」는 근사로 답할 수
 * 없고, jsdom 은 높이를 주지 않는다. 그래서 실제 CSS 로 그려서 잰다.
 *
 * 무엇을 쓰는가 (셋 다 **제품이 쓰는 것 그대로**여야 한다)
 *  1. `katex/dist/katex.min.css` — 화면·인쇄가 `src/app/layout.tsx` 에서 로드하는 것.
 *  2. Tailwind 산출물 — `src/app/globals.css` 를 postcss 로 실제 빌드한다. 손으로
 *     유틸리티 값을 옮겨 적으면 그 순간부터 측정이 지면과 갈린다.
 *  3. `TestPrint.module.css` **원문** — 클래스 이름을 해시하지 않고 그대로 쓰므로
 *     아래 `renderPage` 가 만드는 DOM(=JaseupTemplate 의 DOM)과 그대로 맞는다.
 *
 * ⚠️ 측정이 조용히 거짓이 되는 함정 — 넷 다 실제로 밟았다.
 *  (1) `page.setContent` 는 about:blank 라 `file://` 스타일시트가 막힌다 → 파일로 써서 `goto`.
 *  (2) Tailwind v4 는 CSS 파일 위치 기준으로 소스를 훑는다 → `@source` 를 명시하지 않으면
 *      `mt-4`·`grid-cols-2` 가 **한 줄도 안 나온다**(그러면 지면이 통째로 낮아 보인다).
 *  (3) `page.evaluate` 안에서 **이름 붙은 함수**를 만들면 esbuild 가 `__name` 헬퍼를
 *      끼워 넣어 ReferenceError 로 죽는다. 배열/바인딩으로 이름을 피한다.
 *  (4) 문항 칸의 «남은 공간»을 `questionArea.clientHeight` 로 재면 **영원히 0이 나온다** —
 *      grid row 는 내용이 넘치면 같이 늘어난다. `article` 의 content box 로 재야 한다.
 *
 * 화면과 인쇄가 다르므로 `emulateMedia({ media: "print" })` 를 쓸지 반드시 정할 것
 * (그림 상한이 화면 360px · 인쇄 70mm=264.6px 라 실제로 다르다).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import { ProblemContent } from "../../src/components/math/ProblemContent";
import { PAPER_CSS_VARIABLES } from "../../src/components/print/tokens";

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, "node_modules/.cache/paper-probe");

export const PAPER_VARS = Object.entries(PAPER_CSS_VARIABLES)
  .map(([key, value]) => `${key}:${value}`)
  .join(";");

/** `public/` 아래 그림을 file:// 로 읽게 만든다 — 인쇄 지면은 그림이 빠지면 안 된다. */
export const FIGURE_ROOT = pathToFileURL(path.join(ROOT, "public")).href;

/**
 * 실측 상수. 값을 **여기 적어 두지 말고** `measure-paper-units.tsx` 로 다시 뽑을 것 —
 * 아래는 2026-08-18 인쇄 매체 기준 기록이다(지면 CSS 를 바꾸면 달라진다).
 */
export const MEASURED = {
  /** 이어지는 장 문항 칸 높이 */
  slotContinuationPx: 484,
  /** 첫 장 문항 칸 높이 (머리글 + 핵심 개념 상자만큼 좁다) */
  slotFirstPagePx: 405,
  /** 본문 행높이 12.5px × leading-relaxed 1.625 */
  linePx: 20.3125,
  /** 문항번호 + 정답란 — 본문과 무관하게 늘 붙는 세로 */
  fixedChromePx: 62.5,
} as const;

/** Tailwind 산출물을 실제로 빌드한다(캐시). 손으로 옮겨 적지 않는다. */
export async function buildTailwindCss(): Promise<string> {
  const cached = path.join(CACHE_DIR, "tailwind.css");
  const source = path.join(ROOT, "src/app/globals.css");
  if (
    existsSync(cached) &&
    readFileSync(cached, "utf8").length > 0 &&
    // globals.css 가 더 새것이면 다시 빌드한다.
    (await import("node:fs")).statSync(cached).mtimeMs >
      (await import("node:fs")).statSync(source).mtimeMs
  ) {
    return readFileSync(cached, "utf8");
  }
  const postcss = (await import("postcss")).default;
  const tailwind = (await import("@tailwindcss/postcss")).default;
  const css = readFileSync(source, "utf8").replace(
    '@import "tailwindcss";',
    // ⚠️ 함정 (2) — 이 줄이 없으면 유틸리티가 한 줄도 안 나온다.
    '@import "tailwindcss";\n@source "../../src";',
  );
  const result = await postcss([tailwind()]).process(css, { from: source });
  if (!result.css.includes(".mt-4"))
    throw new Error("Tailwind 유틸리티가 비었다 — 측정 중단(거짓 측정 방지)");
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cached, result.css, "utf8");
  return result.css;
}

export async function paperStyles(): Promise<string> {
  const katex = readFileSync(
    path.join(ROOT, "node_modules/katex/dist/katex.min.css"),
    "utf8",
  );
  const tailwind = await buildTailwindCss();
  const moduleCss = readFileSync(
    path.join(ROOT, "src/components/print/TestPrint.module.css"),
    "utf8",
  );
  return `<style>${katex}</style><style>${tailwind}</style><style>${moduleCss}</style>`;
}

export interface SlotInput {
  id: string;
  content: string;
  figureUrls?: string[];
  /** 「서술형 n」 배지 번호. 없으면 배지를 안 그린다. */
  essayNumber?: number | null;
}

/** `JaseupTemplate` 의 문항 DOM 과 같은 모양. 한 글자라도 다르면 측정이 지면과 갈린다. */
export function renderSlot(row: SlotInput, number: number): string {
  const body = renderToStaticMarkup(
    <ProblemContent
      content={row.content}
      figureUrls={(row.figureUrls ?? []).map((url) =>
        url.startsWith("/") ? FIGURE_ROOT + url : url,
      )}
      className="problemText"
      // 인쇄 지면은 지연 로딩을 쓰지 않는다(PaperProblemView 와 같다).
      deferFigures={false}
    />,
  );
  return `<article class="problemItem" data-problem-number="${number}" data-pid="${row.id}">
  <div class="questionArea">
    <div class="questionNumber">문 ${number}${
      row.essayNumber
        ? `<span class="essayBadge">서술형 ${row.essayNumber}</span>`
        : ""
    }</div>
    <div data-paper-view>${body}</div>
    <div class="answerBlank"><strong>내 정답</strong><span class="answerLine"></span><span>채점</span><span class="checkBox"></span></div>
  </div>
  <div class="scratchPad"><span>SCRATCH PAD</span></div>
</article>`;
}

const SECTION = "이차방정식";
const TITLE = `일일테스트 · ${SECTION}`;

/** 첫 장/이어지는 장 — `JaseupTemplate` 과 같은 머리·꼬리를 붙인다. */
export function renderPage(
  kind: "first" | "continuation",
  slots: string[],
  pageNumber: number,
): string {
  const head =
    kind === "first"
      ? `<header class="firstHeader"><div><div class="academyName">오늘의수학</div><div class="englishLabel">SELF-STUDY</div><h1 class="testTitle">${TITLE}</h1><div class="todayGoal">오늘의 목표 · ${SECTION}의 핵심 개념을 확인하고 문제에 적용한다.</div></div><div class="studentMeta"><div class="dateLabel">학습일</div><div class="dateValue">2026.08.18</div><div class="nameLine">이름 ________ · 반 ______</div></div></header>
<section class="conceptBox"><h2 class="conceptTitle">◆ 핵심 개념 정리</h2><div class="conceptText">${SECTION}의 정의와 계산 원리를 확인한 뒤 풀이 과정에 적용한다.</div></section>`
      : `<header class="continuationHeader"><span>오늘의수학 · ${TITLE}</span><span>p. ${pageNumber}</span></header>`;
  return `<section class="a4Page ${kind === "first" ? "jaseupFirst" : "jaseupContinuation"}" data-page-kind="questions" data-page-number="${pageNumber}" style="${PAPER_VARS}">
${head}
<div class="problemList">${slots.join("\n")}</div>
<footer class="pageFooter"><strong>오늘의 메모</strong><span class="memoLine"></span><span>p. ${pageNumber}</span></footer>
</section>`;
}

export async function paperDocument(pages: string[]): Promise<string> {
  return `<!doctype html><html><head><meta charset="utf-8">${await paperStyles()}
<style>body{margin:0;background:#c9c9c7}.pageGallery{display:flex;flex-direction:column;align-items:center;gap:28px}</style>
</head><body><div class="pageGallery">${pages.join("\n")}</div></body></html>`;
}

/** 측정 전에 스타일시트가 실제로 붙었는지 확인한다 — 안 붙으면 값이 통째로 거짓이다. */
export const GUARD_SCRIPT = `(() => {
  const katex = document.querySelector(".katex-mathml");
  const a4 = document.querySelector(".a4Page");
  const text = document.querySelector(".problemText");
  return {
    katexOk: katex ? getComputedStyle(katex).position === "absolute" : true,
    a4Height: a4 ? a4.getBoundingClientRect().height : 0,
    fontSize: text ? getComputedStyle(text).fontSize : "",
  };
})()`;

export function assertPaperSane(guard: {
  katexOk: boolean;
  a4Height: number;
  fontSize: string;
}) {
  if (!guard.katexOk) throw new Error("KaTeX CSS 미적용 — 측정 중단");
  if (Math.abs(guard.a4Height - 1122.5) > 2)
    throw new Error(`A4 높이가 297mm 가 아니다: ${guard.a4Height}`);
  if (guard.fontSize !== "12.5px")
    throw new Error(`본문 글꼴이 지면과 다르다: ${guard.fontSize}`);
}

/**
 * 탐침 HTML 을 써서 `file://` URL 로 돌려준다.
 *
 * ⚠️ **이름에 프로세스 번호를 넣는다.** 측정이 둘 이상 동시에 돌면 같은 파일을
 *    서로 덮어써서, Windows 에서는 `EBUSY` 로 죽고 (실제로 죽었다) 다른 OS 에서는
 *    **한쪽이 남의 지면을 재고도 조용히 성공한다.** 이 저장소는 오르카 다중 세션이
 *    기본이라(절대 규칙 9) 언제든 겹칠 수 있다.
 */
export function writeProbe(name: string, html: string): string {
  mkdirSync(CACHE_DIR, { recursive: true });
  const unique = name.replace(/(\.[^.]+)?$/, `-${process.pid}$1`);
  const file = path.join(CACHE_DIR, unique);
  writeFileSync(file, html, "utf8");
  return pathToFileURL(file).href;
}
