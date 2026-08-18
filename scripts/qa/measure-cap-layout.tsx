/**
 * **그림 폭 상한 × 문항번호 서식**을 조합해 지면을 다시 그려 높이를 전수로 잰다 (읽기 전용).
 *
 *   npx tsx scripts/qa/measure-cap-layout.tsx --cap cap70 --layout base --identity .measure/cont.json
 *   npx tsx scripts/qa/measure-cap-layout.tsx --cap cap45 --layout d --json .measure/cap45-d.json
 *   npx tsx scripts/qa/measure-cap-layout.tsx --cap cap29 --layout base --take 400
 *   npx tsx scripts/qa/measure-cap-layout.tsx --cap cap45 --layout d --only figures --json .measure/cl-cap45-d-fig.json
 *   npx tsx scripts/qa/measure-cap-layout.tsx --verify-page-kind --take 1200
 *   npx tsx scripts/qa/measure-cap-layout.tsx --patch .measure/cl-cap45-d-fig.json --cap cap45 --layout d
 *   npx tsx scripts/qa/measure-cap-layout.tsx --compare .measure/cl-cap70-base.json --identity .measure/cont.json
 *
 * ## 무엇을 하는 모드가 있나
 *
 *   (기본)              조건 하나를 전수(또는 `--only figures`)로 그려 높이를 재고 캐시로 남긴다.
 *   `--patch`           **공유 DB 가 재는 도중에 움직인 자리만** 다시 그려 그 캐시를 맞춘다.
 *   `--compare`         렌더 없이 가드 ⑥(덧칠이 기본값에서 무해한가)만 다시 본다.
 *   `--verify-page-kind` 문항 높이가 «몇째 장인가»와 무관한지 확인한다(이 트랙의 전제).
 *
 * ## 🔴 왜 캐시를 못 쓰나 — 조건마다 지면이 **진짜로** 달라진다
 *
 * `.measure/cont.json` 은 **70mm · 지금 서식**으로 그린 지면의 값이다. 그림 폭 상한을
 * 45mm 로 낮추면 그림이 한 줄에 두 장씩 들어가 문항이 실제로 낮아진다 — 그 순간
 * 캐시는 거짓이다. 그런데 캐시 지문(`inputsHash`)은 **제품 원문**만 보므로 조건을
 * 바꿔도 조용히 통과한다. 그래서 이 도구가 쓰는 캐시 지문에는 **덧입힌 배치**
 * (`overlay`)를 같이 적는다 — 조건이 다른 캐시로 채점하면 채점기가 멈춘다.
 *
 * 창(window) 환산도 안 쓴다. 상한을 바꾸면 Δ 가 **−4,089px** 까지 나므로
 * 「창 밖은 판정이 안 뒤집힌다」가 성립하지 않는다. **조건마다 전수로 다시 그린다.**
 *
 * ## 🔴 제품 코드는 한 줄도 안 고친다
 *
 * 상한·서식은 **탐침 문서에만** `<style>` 로 덧입힌다(`shot-figure-cap.tsx` 와 같은
 * 방식). `src/components`·`src/lib/printOverflow.ts`·`TestPrint.module.css` 는 그대로다.
 *
 * ## 조용히 거짓이 되는 길 — 가드
 *
 * 덧칠이 **안 먹으면 그 조건은 기준선과 똑같이 그려지고**, 표에는 「내려갔다/안 늘었다」가
 * 그럴듯하게 찍힌다. 이 검토가 가장 듣고 싶은 답이라 아무도 의심하지 않는다.
 * 그래서 매 실행:
 *   ① 그림 묶음 표식(`.figureRow`)이 **그림 있는 문항 수만큼** DOM 에 있는가
 *   ② 그 안 `<img>` 의 **실제 `max-width`** 가 조건이 말하는 값인가 (장수별로)
 *   ③ 번호 서식(글꼴·선·여백)이 **실제로** 그 값으로 그려졌는가
 *   ④ 실측 문항 칸이 제품 상수(484px)와 같은가
 *   ⑤ 「정답란 아래」와 「가장 아래」가 같은가 (자가 둘 다 같은 것을 보는가)
 *   ⑥ `--identity` 를 주면 **70mm · 지금 서식**이 기존 전수 캐시와 다르지 않은가 —
 *      덧칠 기구 자체가 기본값에서 무해한지 확인하는 자리다. 다른 것은 **두 갈래로**
 *      가른다(「본문·그림이 바뀌어 다른 것」 / 「설명 안 되는 것」) — 뭉개면 공유 DB 가
 *      한 행만 고쳐도 늘 빨개져서 결국 아무도 안 본다.
 * 하나라도 어긋나면 **던진다.** 다만 산출물은 대조보다 **먼저** 쓴다 — 40분짜리 측정을
 * 판정 때문에 버리게 두면 다음 사람은 판정을 끄고 싶어진다.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { chromium, type Page } from "@playwright/test";

import { JASEUP_MEASURED_PX } from "../../src/lib/printGeometry";
import { capByName, markFigureRows, type FigureCap } from "./capLayoutProbe";
import {
  buildHeightCacheManifest,
  measuredRowsHash,
  readHeightCacheManifest,
  rowDigest,
  rowDigests,
  writeHeightCacheManifest,
} from "./heightCacheManifest";
import { injectMark, layoutByName, type NumberLayout } from "./idLayouts";
import {
  GUARD_SCRIPT,
  assertPaperSane,
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

export interface CapLayoutHeight {
  pid: string;
  availPx: number;
  /** 문항번호 위 ~ **정답란 아래**. 기존 전수 캐시(`.measure/cont.json`)와 같은 자다. */
  neededPx: number;
  /** 문항번호 위 ~ 문항 열에 그려진 것 중 **가장 아래**. 넘침 판정은 이 값으로 한다. */
  usedPx: number;
  /** 그림 묶음이 먹은 세로 — 상한이 실제로 들었는지 보는 근거. */
  figurePx: number;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 이 조건의 지문 — 캐시 옆에 적어 두고, 다른 조건으로 채점하면 멈추게 한다. */
export function overlayId(cap: FigureCap, layout: NumberLayout): string {
  return `cap=${cap.name};layout=${layout.name}`;
}

/**
 * **그림 장수별로 실제로 걸린 폭 상한.** 가드 ②는 «어긋나면 멈춘다»인데, 그 조건에
 * 해당하는 문항이 한 건도 없으면 **아무것도 확인하지 않고 조용히 지나간다** —
 * 표본 60건에는 그림 5장짜리가 없다. 그래서 무엇을 실제로 보았는지 끝에 찍는다.
 * (「확인했다」와 「확인할 것이 없었다」는 다른 말이다.)
 */
const capWitness = new Map<number, Set<string>>();

/**
 * 지면을 그려 한 조건의 높이를 잰다. **장마다 두 문항** — 칸은 `flex: 1 1 0%` 로
 * 나뉘므로 한 장에 하나만 넣으면 칸이 두 배가 되어 다른 것을 재게 된다.
 */
async function measure(
  page: Page,
  rows: Row[],
  kind: "first" | "continuation",
  cap: FigureCap,
  layout: NumberLayout,
  onProgress?: (done: number) => void,
): Promise<CapLayoutHeight[]> {
  const all: CapLayoutHeight[] = [];
  const PAGES_PER_BATCH = 60;
  for (let start = 0; start < rows.length; start += PAGES_PER_BATCH * 2) {
    const chunk = rows.slice(start, start + PAGES_PER_BATCH * 2);
    const pages: string[] = [];
    for (let i = 0; i < chunk.length; i += 2) {
      const slots = chunk.slice(i, i + 2).map((row, j) => {
        const base = renderSlot(
          {
            id: row.id,
            content: row.content ?? "",
            figureUrls: row.figureUrls,
            essayNumber: row.questionType === "서술형" ? 1 : null,
          },
          i + j + 1,
        );
        return layout.injectsMark ? injectMark(base) : base;
      });
      pages.push(renderPage(kind, slots, kind === "first" ? 1 : 2));
    }
    const doc = markFigureRows(await paperDocument(pages)).replace(
      "</head>",
      `<style>${cap.css}\n${layout.css ?? ""}</style></head>`,
    );
    const url = writeProbe(`probe-cap-${cap.name}-${layout.name}.html`, doc);
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    assertPaperSane(await page.evaluate(GUARD_SCRIPT));

    /* ── 가드 ①② 그림 상한이 **실제로** 걸렸는가 ────────────────────────────
       표식이 안 붙거나 덧칠이 안 먹으면 이 조건은 70mm 그대로 그려지고, 표에는
       「45mm 로도 별로 안 줄었다」가 찍힌다. 그래서 장수별 실제 `max-width` 를 센다. */
    const figureRows = (await page.evaluate(() =>
      [...document.querySelectorAll(".figureRow")].map((node) => {
        const imgs = [...node.querySelectorAll("img")];
        return [
          imgs.length,
          imgs.length ? getComputedStyle(imgs[0]!).maxWidth : "",
        ] as [number, string];
      }),
    )) as [number, string][];
    const expectedRows = chunk.filter((r) => r.figureUrls.length > 0).length;
    if (figureRows.length !== expectedRows)
      throw new Error(
        `${cap.name}: 그림 묶음 표식이 ${figureRows.length}개인데 그림 있는 문항은 ${expectedRows}건이다 — ` +
          `표식이 안 붙었다(제품 마크업이 바뀌었을 수 있다). 이 조건의 «내려갔다» 는 거짓이다.`,
      );
    for (const [count, maxWidth] of figureRows) {
      const seen = capWitness.get(count) ?? new Set<string>();
      seen.add(maxWidth);
      capWitness.set(count, seen);
      const want = cap.expectedMaxWidthPx(count);
      const got = parseFloat(maxWidth);
      if (!Number.isFinite(got) || Math.abs(got - want) > 0.5)
        throw new Error(
          `${cap.name}: 그림 ${count}장짜리의 실제 max-width 가 ${maxWidth} 다 — 의도한 ${want.toFixed(2)}px 이 아니다. 덧칠이 안 먹었다.`,
        );
    }

    /* ── 가드 ③ 번호 서식이 실제로 그 값으로 그려졌는가 ─────────────────── */
    if (layout.expect) {
      const got = (await page.evaluate(() => {
        const el = document.querySelector(".questionNumber");
        if (!el) return null;
        const s = getComputedStyle(el);
        return [
          s.fontSize,
          s.paddingBottom,
          s.marginBottom,
          s.borderBottomWidth,
        ] as [string, string, string, string];
      })) as [string, string, string, string] | null;
      if (!got) throw new Error(`${layout.name}: questionNumber 가 없다.`);
      const want = layout.expect;
      const pairs: [string, string, number][] = [
        ["글꼴", got[0], want.fontSizePx],
        ["선 위 여백", got[1], want.paddingBottomPx],
        ["선 아래 여백", got[2], want.marginBottomPx],
        ["선 굵기", got[3], want.borderBottomPx],
      ];
      for (const [what, actual, expected] of pairs)
        if (actual !== `${expected}px`)
          throw new Error(
            `${layout.name}: 번호 줄 ${what} 가 ${actual} 다 — 의도한 ${expected}px 이 아니다. CSS 가 안 먹었다.`,
          );
    }

    /* ── 가드 ① 식별자 주입이 실제로 붙었는가 ──────────────────────────── */
    const marks = await page.evaluate(
      () => document.querySelectorAll(".idMark").length,
    );
    const wantMarks = layout.injectsMark ? chunk.length : 0;
    if (marks !== wantMarks)
      throw new Error(
        `${layout.name}: 식별자 표시가 ${marks}개인데 ${wantMarks}개여야 한다 — 주입이 샜다.`,
      );

    const measured = (await page.evaluate(() => {
      const out: unknown[] = [];
      document.querySelectorAll(".problemItem").forEach((node) => {
        const item = node as HTMLElement;
        const num = item.querySelector(".questionNumber") as HTMLElement;
        const blank = item.querySelector(".answerBlank") as HTMLElement;
        const area = item.querySelector(".questionArea") as HTMLElement;
        const figRow = item.querySelector(".figureRow") as HTMLElement | null;
        const style = getComputedStyle(item);
        const top = num.getBoundingClientRect().top;
        // 문항 열에 그려진 것 중 가장 아래. (이름 붙은 함수 금지 — paperProbe 주석 (3))
        let bottom = blank.getBoundingClientRect().bottom;
        area.querySelectorAll("*").forEach((child) => {
          const rect = (child as HTMLElement).getBoundingClientRect();
          if (rect.height > 0 && rect.bottom > bottom) bottom = rect.bottom;
        });
        out.push({
          pid: item.dataset.pid,
          // ⚠️ grid row 가 아니라 article 의 content box (paperProbe 주석 (4)).
          availPx:
            item.clientHeight -
            parseFloat(style.paddingTop) -
            parseFloat(style.paddingBottom),
          neededPx: blank.getBoundingClientRect().bottom - top,
          usedPx: bottom - top,
          figurePx: figRow ? figRow.getBoundingClientRect().height : 0,
        });
      });
      return out;
    })) as CapLayoutHeight[];
    all.push(...measured);
    onProgress?.(all.length);
  }
  return all;
}

async function fetchRows(take: number, only?: string): Promise<Row[]> {
  /**
   * `--only figures` — **그림이 있는 문항만** 잰다.
   *
   * 왜 이래도 되나: 상한 덧칠(`.figureRow img`)은 그림이 없는 문항의 DOM 에서
   * **아무것도 고르지 못한다.** 그러니 그림 없는 문항은 상한이 무엇이든 지면이
   * 글자 하나까지 같다 — 추론이 아니라 CSS 선택자의 성질이고, 상한별 전수 측정
   * 셋을 서로 대조해서 **숫자로도 확인한다**(`report-cap-layout.ts`).
   * 그래서 「상한 × 배치」 조합은 그림 있는 문항만 다시 그리고, 나머지는 70mm 로
   * 잰 같은 배치의 값을 그대로 쓴다.
   */
  const where =
    only === "figures" ? "WHERE array_length(figure_urls,1) > 0" : "";
  return (await prisma.$queryRawUnsafe(
    `SELECT id, content, figure_urls AS "figureUrls", question_type AS "questionType"
       FROM problem ${where} ORDER BY id ${take > 0 ? `LIMIT ${take}` : ""}`,
  )) as Row[];
}

/**
 * ⚠️ **짝수로 맞춘다.** 홀수면 마지막 장이 한 문항이 되고, 그 칸은 `flex:1 1 0%` 라
 * 997px 로 두 배가 된다 — 484px 을 재려던 자리에서 다른 것을 재게 된다.
 * **버리지 말고 채운다**(버리면 하필 봐야 할 그 문항이 빠진다). 채운 것은 집계에서 뺀다.
 */
async function padEven(rows: Row[]): Promise<string | null> {
  if (rows.length % 2 === 0) return null;
  const have = new Set(rows.map((r) => r.id));
  const extra = (await prisma.$queryRawUnsafe(
    `SELECT id, content, figure_urls AS "figureUrls", question_type AS "questionType"
       FROM problem WHERE id <> ALL($1::uuid[]) ORDER BY id LIMIT 1`,
    [...have],
  )) as Row[];
  if (extra.length === 0) throw new Error("짝을 채울 문항이 없다.");
  rows.push(extra[0]!);
  return extra[0]!.id;
}

async function newPage() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1200 },
  });
  await page.emulateMedia({ media: "print" });
  return { browser, page };
}

/**
 * **문항 높이가 «몇째 장인가»와 무관한지** 같은 실행 안에서 확인한다.
 *
 * 왜 필요한가: 이 트랙은 조건 하나를 **한 번만** 그리고 그 값으로 484px·405px 둘 다
 * 채점한다. 그 전제(=문항 자체의 높이는 장 종류와 무관하다)가 거짓이면 첫 장 숫자가
 * 통째로 허깨비다. 지면 구조상 참이어야 하지만(가로 여백이 같다) **추론이지 측정이
 * 아니다** — 그래서 같은 문항을 두 장으로 그려 대조한다(CLAUDE.md 2026-08-18 「분모를
 * 먼저 검산하라」).
 */
async function verifyPageKind(take: number) {
  const rows = await fetchRows(take);
  await padEven(rows);
  const cap = capByName("cap70");
  const layout = layoutByName("base");
  const { browser, page } = await newPage();
  try {
    const cont = await measure(page, rows, "continuation", cap, layout);
    const first = await measure(page, rows, "first", cap, layout);
    const byId = new Map(first.map((m) => [m.pid, m]));
    let diff = 0;
    let maxDelta = 0;
    for (const c of cont) {
      const f = byId.get(c.pid)!;
      const d = Math.abs(f.usedPx - c.usedPx);
      if (d > 0.01) diff += 1;
      maxDelta = Math.max(maxDelta, d);
    }
    console.log(
      `문항 ${cont.length.toLocaleString()}건 · 이어지는 장 칸 ${cont[0]!.availPx}px · 첫 장 칸 ${first[0]!.availPx}px\n` +
        `문항 높이가 다른 것 ${diff}건 (최대 차 ${maxDelta.toFixed(3)}px)`,
    );
    if (diff > 0) {
      console.log(
        "→ 장 종류가 문항 높이를 바꾼다. 이 트랙의 «한 번 재서 둘 다 채점» 전제가 거짓이다.",
      );
      process.exitCode = 1;
    } else {
      console.log(
        "→ 문항 높이는 장 종류와 무관하다. 한 번 재서 484px·405px 둘 다 채점해도 된다.",
      );
    }
  } finally {
    await browser.close();
  }
}

/**
 * **공유 DB 가 재는 도중에 움직인 자리를 깁는다** (`--patch`).
 *
 * 조건이 여럿이라 전수 측정이 몇 시간이다. 그 사이 다른 트랙이 `apply-*` 로 본문을
 * 고치거나 `public/figures/` 에 그림을 넣으면, **먼저 잰 조건과 나중에 잰 조건이 서로
 * 다른 DB 를 본 것**이 된다. 그러면 「45mm 가 70mm 보다 낮다」의 일부가 상한이 아니라
 * 시각 차이가 된다 — 조용히, 그리고 늘 «좋아지는» 쪽으로.
 *
 * 그래서 조건 파일마다 **제 지문과 지금 DB 를 대조해 바뀐 행만 다시 그린다.**
 * 조용히 넘기지 않고 몇 건을 기웠는지 찍는다.
 */
async function patchDrift(
  patchPath: string,
  cap: FigureCap,
  layout: NumberLayout,
  kind: "first" | "continuation",
) {
  const existing = JSON.parse(
    readFileSync(patchPath, "utf8"),
  ) as CapLayoutHeight[];
  const have = new Set(existing.map((m) => m.pid));
  const manifest = readHeightCacheManifest(patchPath);
  if (!manifest?.rowDigests)
    throw new Error(
      `${patchPath} 에 문항별 지문이 없다 — 어느 행이 바뀌었는지 알 수 없다.`,
    );
  const onlyFigures = manifest.overlay?.includes(";only=figures") ?? false;
  /**
   * 이 파일이 **담아야 할** 문항 — 전수 파일이면 DB 전량, `only=figures` 파일이면
   * **지금** 그림이 있는 문항이다. 「지금」이 중요하다: 다른 트랙이 그림을 붙이면
   * 그림 없던 문항이 그림 문항이 되는데, 그 행은 이 파일에 아예 없다. 없는 것을
   * 「안 바뀐 것」으로 세면 조합표가 그 문항만 옛 지면으로 채워진다.
   */
  const target = await fetchRows(0, onlyFigures ? "figures" : undefined);
  const targetIds = new Set(target.map((r) => r.id));
  const inFile = target.filter((r) => have.has(r.id));
  const missing = target.filter((r) => !have.has(r.id));
  const extra = existing.filter((m) => !targetIds.has(m.pid));
  const changed = inFile.filter(
    (r) => manifest.rowDigests![r.id] !== rowDigest(r),
  );
  console.log(
    `${patchPath} · ${cap.name} × ${layout.name} — 잰 뒤 바뀐 문항 ${changed.length.toLocaleString()}건` +
      ` · 새로 들어와야 할 문항 ${missing.length.toLocaleString()}건` +
      ` · 이제 이 파일에 없어야 할 문항 ${extra.length.toLocaleString()}건`,
  );
  if (extra.length > 0) {
    const drop = new Set(extra.map((m) => m.pid));
    for (let i = existing.length - 1; i >= 0; i -= 1)
      if (drop.has(existing[i]!.pid)) existing.splice(i, 1);
  }
  if (changed.length + missing.length > 0) {
    const rows = [...changed, ...missing];
    // 짝맞춤 문항은 **이 파일 안에서** 고른다 — 밖에서 가져오면 그 행이 결과에 섞인다.
    const fillerPid =
      rows.length % 2 === 1
        ? (() => {
            const chosen = new Set(rows.map((c) => c.id));
            const spare = target.find((r) => !chosen.has(r.id));
            if (!spare) throw new Error("짝을 채울 문항이 없다.");
            rows.push(spare);
            return spare.id;
          })()
        : null;
    const { browser, page } = await newPage();
    let fresh: CapLayoutHeight[];
    try {
      fresh = await measure(page, rows, kind, cap, layout, (done) =>
        process.stdout.write(`\r기움 ${done}/${rows.length}   `),
      );
    } finally {
      await browser.close();
    }
    process.stdout.write("\r");
    const byId = new Map(existing.map((m) => [m.pid, m]));
    const wanted = new Set([...changed, ...missing].map((r) => r.id));
    let patched = 0;
    let added = 0;
    for (const m of fresh) {
      if (!wanted.has(m.pid)) continue; // 짝맞춤으로 덧댄 행은 결과에 안 넣는다
      const found = byId.get(m.pid);
      if (found) {
        Object.assign(found, m);
        patched += 1;
      } else {
        existing.push(m);
        added += 1;
      }
    }
    existing.sort((a, b) => (a.pid < b.pid ? -1 : a.pid > b.pid ? 1 : 0));
    writeFileSync(patchPath, JSON.stringify(existing), "utf8");
    console.log(
      `  → 기운 것 ${patched.toLocaleString()}건 · 새로 넣은 것 ${added.toLocaleString()}건 · 남은 문항 ${existing.length.toLocaleString()}건`,
    );
    void fillerPid;
  }
  // 지문은 **바뀐 게 없어도** 다시 찍는다 — 그래야 조건 파일들이 같은 DB 를 가리킨다.
  const manifestPath = writeHeightCacheManifest(
    patchPath,
    buildHeightCacheManifest({
      kind,
      rows: existing.length,
      rowsHash: measuredRowsHash(target),
      slotPx: existing[0]!.availPx,
      measuredAt: new Date().toISOString(),
      rowDigests: rowDigests(target),
      overlay: overlayId(cap, layout) + (onlyFigures ? ";only=figures" : ""),
    }),
  );
  if (existing.length !== target.length)
    throw new Error(
      `${patchPath}: 기운 뒤에도 문항이 ${existing.length}건인데 ${target.length}건이어야 한다.`,
    );
  console.log(`  → ${manifestPath}`);
}

/**
 * 가드 ⑥ — 70mm·지금 서식으로 그린 값이 기존 전수 캐시와 다르지 않은가.
 * 다르면 덧칠 기구 자체가 지면을 건드리고 있다는 뜻이고, 그러면 45mm·29mm 의
 * «내려갔다» 중 얼마가 상한 때문인지 알 수 없다.
 *
 * 렌더 없이 다시 볼 수 있게 따로 뽑았다 — `--compare <잰 파일> --identity <기준 캐시>`.
 * 40분짜리 측정을 «판정만 다시 보려고» 되돌리는 일이 없어야 한다.
 */
function identityCheck(
  all: CapLayoutHeight[],
  measuredRows: Row[],
  identityPath: string,
): boolean {
  const cached = JSON.parse(readFileSync(identityPath, "utf8")) as Array<{
    pid: string;
    availPx: number;
    neededPx: number;
  }>;
  const byId = new Map(cached.map((m) => [m.pid, m]));
  /**
   * ⚠️ 다른 것을 **두 갈래로** 가른다(`measure-print-overflow.tsx --verify` 와 같은
   * 이유). 공유 DB(D-31)는 다른 트랙이 지금도 고치고 있어서 **재는 도중에도** 본문과
   * 그림이 오간다. 한 갈래로 뭉개면 「공유 DB 가 한 행 고쳤다」와 「덧칠이 지면을
   * 바꾼다」가 같아 보이고, 그러면 이 가드는 늘 빨개져서 결국 아무도 안 본다.
   * (실제로 그랬다 — 첫 실행에서 95건이 걸렸는데 **95건 전부** 그 사이 그림이 붙은 행이었다.)
   */
  const before = readHeightCacheManifest(identityPath)?.rowDigests;
  if (!before)
    console.log(
      `⚠️ ${identityPath} 에 문항별 지문이 없다 — 「바뀐 문항」과 「덧칠 탓」을 가를 수 없다.`,
    );
  const digestNow = new Map(measuredRows.map((r) => [r.id, rowDigest(r)]));
  let drifted = 0;
  let unexplained = 0;
  let maxDelta = 0;
  const examples: string[] = [];
  for (const m of all) {
    const c = byId.get(m.pid);
    if (!c) continue;
    if (Math.abs(c.neededPx - m.neededPx) <= 0.01) continue;
    if (before && before[m.pid] !== digestNow.get(m.pid)) {
      drifted += 1;
      continue;
    }
    unexplained += 1;
    maxDelta = Math.max(maxDelta, Math.abs(c.neededPx - m.neededPx));
    if (examples.length < 10)
      examples.push(
        `${m.pid} 캐시 ${c.neededPx.toFixed(2)} → 지금 ${m.neededPx.toFixed(2)}`,
      );
  }
  console.log(
    `\n대조(${identityPath}) — 본문·그림이 바뀌어 다른 것 ${drifted}건 · ` +
      `**설명 안 되는 것 ${unexplained}건** (최대 차 ${maxDelta.toFixed(2)}px)`,
  );
  for (const e of examples) console.log(`  · ${e}`);
  if (unexplained > 0) {
    console.log(
      "→ 덧칠 기구가 기본값에서 지면을 바꾸고 있다. 이 트랙의 조건별 숫자는 믿을 수 없다.",
    );
    process.exitCode = 1;
    return false;
  }
  console.log(
    "→ 덧칠 기구는 기본값(70mm·지금 서식)에서 무해하다 (다른 것은 전부 공유 DB 가 그 사이 고친 행이다).",
  );
  return true;
}

async function main() {
  if (process.argv.includes("--verify-page-kind"))
    return verifyPageKind(Number(arg("--take") ?? 1200));

  const cap = capByName(arg("--cap") ?? "cap70");
  const layout = layoutByName(arg("--layout") ?? "base");
  const take = Number(arg("--take") ?? 0);
  const outPath = arg("--json");
  const identityPath = arg("--identity");
  const only = arg("--only");
  if (only && only !== "figures")
    throw new Error(`--only 는 figures 만 안다: ${only}`);
  const kind = process.argv.includes("--first-page") ? "first" : "continuation";
  const patchPath = arg("--patch");
  if (patchPath) return patchDrift(patchPath, cap, layout, kind);

  /**
   * `--compare <잰 파일> --identity <기준 캐시>` — **렌더 없이** 가드 ⑥만 다시 본다.
   * 40분짜리 측정을 「판정만 다시 보려고」 되돌리는 일이 없어야 한다.
   */
  const comparePath = arg("--compare");
  if (comparePath) {
    if (!identityPath)
      throw new Error("--compare 에는 --identity <기준 캐시> 가 필요하다.");
    const measured = JSON.parse(
      readFileSync(comparePath, "utf8"),
    ) as CapLayoutHeight[];
    const have = new Set(measured.map((m) => m.pid));
    const dbRows = (await fetchRows(0)).filter((r) => have.has(r.id));
    identityCheck(measured, dbRows, identityPath);
    return;
  }

  const rows = await fetchRows(take, only);
  const fillerPid = await padEven(rows);
  if (fillerPid)
    console.log(`홀수라 짝맞춤 문항 1건을 덧댔다(집계에서 뺀다): ${fillerPid}`);
  console.log(
    `문항 ${rows.length.toLocaleString()}건 · ${kind} 장\n` +
      `  그림 상한  ${cap.label}\n` +
      `  번호 서식  ${layout.label}`,
  );

  const { browser, page } = await newPage();
  let all: CapLayoutHeight[];
  try {
    all = await measure(page, rows, kind, cap, layout, (done) =>
      process.stdout.write(`\r측정 ${done}/${rows.length}   `),
    );
  } finally {
    await browser.close();
  }
  process.stdout.write("\r");

  if (fillerPid) all = all.filter((m) => m.pid !== fillerPid);
  const measuredRows = rows.filter((r) => r.id !== fillerPid);

  /* ── 가드 ④ 실측 칸이 제품 상수와 같은가 ────────────────────────────────── */
  const slots = [...new Set(all.map((m) => m.availPx))];
  if (slots.length !== 1)
    throw new Error(`문항 칸이 ${slots.length}가지다(${slots.join(", ")}).`);
  const slot = slots[0]!;
  const constant =
    kind === "first"
      ? JASEUP_MEASURED_PX.firstPageSlot
      : JASEUP_MEASURED_PX.continuationSlot;
  if (slot !== constant)
    throw new Error(
      `실측 칸 ${slot}px ≠ 제품 상수 ${constant}px — 지면이 바뀌었다.`,
    );

  /* ── 가드 ⑤ 두 자가 같은 것을 가리키는가 ────────────────────────────────
     지금 지면은 정답란이 문항 열의 마지막 요소다. 배치가 정답란 «아래»에 무엇을
     붙이지 않는 한 두 값이 같아야 한다. 다르면 자가 다른 것을 재고 있다. */
  const gap = all
    .map((m) => m.usedPx - m.neededPx)
    .filter((d) => Math.abs(d) > 0.5);
  if (gap.length > 0)
    throw new Error(
      `「정답란 아래」와 「가장 아래」가 ${gap.length}건 다르다(최대 ${Math.max(
        ...gap.map(Math.abs),
      ).toFixed(1)}px) — 두 자가 다른 것을 재고 있다.`,
    );

  const over = (limit: number) => all.filter((m) => m.usedPx > limit).length;
  const pct = (n: number) => `${((100 * n) / all.length).toFixed(2)}%`;
  const figureRows = all.filter((m) => m.figurePx > 0);
  const figureSum = figureRows.reduce((s, m) => s + m.figurePx, 0);
  console.log(
    `\n문항 ${all.length.toLocaleString()}건 · 칸 ${slot}px (실측)\n` +
      `  넘침 484px  ${over(484).toLocaleString()} (${pct(over(484))})\n` +
      `  넘침 405px  ${over(405).toLocaleString()} (${pct(over(405))})\n` +
      `  넘침 997px  ${over(997).toLocaleString()} (${pct(over(997))})\n` +
      `  그림 있는 문항 ${figureRows.length.toLocaleString()}건 · 그림 묶음 평균 ${(
        figureSum / Math.max(1, figureRows.length)
      ).toFixed(1)}px`,
  );
  console.log(
    `  실제로 걸린 폭 상한 (그림 장수 → 브라우저가 읽은 max-width): ` +
      [...capWitness.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([n, set]) => `${n}장 ${[...set].join("/")}`)
        .join(" · "),
  );

  /* ── 산출물을 **먼저** 쓴다 ────────────────────────────────────────────
     전수 한 조건이 40분이다. 아래 대조에서 걸렸다고 그 40분을 버리면, 다음 사람은
     대조를 «끄고» 다시 돌리고 싶어진다. 값은 남기고 판정만 따로 말한다. */
  if (outPath) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(all), "utf8");
    const manifest = writeHeightCacheManifest(
      outPath,
      buildHeightCacheManifest({
        kind,
        rows: all.length,
        rowsHash: measuredRowsHash(measuredRows),
        slotPx: slot,
        measuredAt: new Date().toISOString(),
        rowDigests: rowDigests(measuredRows),
        overlay: overlayId(cap, layout) + (only ? `;only=${only}` : ""),
      }),
    );
    console.log(`\n→ ${outPath}\n→ ${manifest}`);
  }

  if (identityPath && !identityCheck(all, measuredRows, identityPath)) return;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
